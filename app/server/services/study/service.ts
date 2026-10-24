import { answerInput, gradeAnswer, itemState, statistics } from './answers';
import { ReviewError } from '../review/input';
import { and, eq, isNull } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  questionVersions,
  questions,
  studySessions,
  studyItems,
} from '../../db/schema';
import { requireLocalLearner } from '../learning-catalog/service';
import { selectedItems, versionForSet } from '../publication/state';
import { validateGeneration } from '../generation/validation';
import { requestKey } from '../source-input';
import { startInput, StudyError } from './input';
type Reader = Pick<Connection['db'], 'select'>;
function owned(db: Reader, id: number, userId: number) {
  const session = db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, id), eq(studySessions.userId, userId)))
    .get();
  if (!session) throw new StudyError('missing');
  return session;
}
function items(db: Reader, id: number) {
  return db
    .select({ item: studyItems, questionStatus: questions.status })
    .from(studyItems)
    .innerJoin(
      questionVersions,
      eq(studyItems.questionVersionId, questionVersions.id),
    )
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .where(eq(studyItems.sessionId, id))
    .orderBy(studyItems.position)
    .all();
}
function summary(db: Reader, session: typeof studySessions.$inferSelect) {
  const rows = items(db, session.id);
  const projected = rows.map(({ item, questionStatus }) => ({
    id: item.id,
    position: item.position,
    state: itemState(item, questionStatus),
  }));
  const stats = statistics(
    rows.map(({ item, questionStatus }) => ({
      state: itemState(item, questionStatus),
      isCorrect: item.isCorrect,
    })),
  );
  return {
    id: session.id,
    setId: session.setId,
    status: session.status,
    mode: session.mode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    items: projected,
    statistics: stats,
    currentItemId:
      projected.find((item) => item.state === 'unanswered')?.id ?? null,
  };
}
export function startSession(
  connection: Connection,
  value: unknown,
  keyValue: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      const input = startInput(value);
      const key = requestKey(keyValue);
      const prior = tx
        .select()
        .from(studySessions)
        .where(
          and(
            eq(studySessions.userId, userId),
            eq(studySessions.startRequestKey, key),
          ),
        )
        .get();
      if (prior) {
        if (prior.setId !== input.setId) throw new StudyError('conflict');
        return { session: summary(tx, prior), replayed: true };
      }
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, input.setId))
        .get();
      if (
        !set ||
        set.status !== 'published' ||
        set.publishedBy === null ||
        set.publishedAt === null
      )
        throw new StudyError('missing');
      const selected = selectedItems(tx, set.id);
      if (selected.length > 10) throw new StudyError('conflict');
      const available: typeof selected = [];
      const seen = new Set<number>();
      for (const item of selected) {
        let row: ReturnType<typeof versionForSet>;
        try {
          row = versionForSet(tx, set, item.questionVersionId);
        } catch (error) {
          if (error instanceof ReviewError) throw new StudyError('conflict');
          throw error;
        }
        const { version, question, run, source } = row;
        // invalidated_at does not exist yet; add its exclusion here and in catalog when introduced.
        if (
          question.status !== 'active' ||
          version.reviewedBy === null ||
          version.reviewedAt === null ||
          run.status !== 'succeeded'
        )
          continue;
        try {
          validateGeneration(
            {
              questions: [
                {
                  body: version.body,
                  choices: version.choicesJson,
                  answerIds: version.answerIdsJson,
                  explanation: version.explanation,
                  quote: version.quote,
                },
              ],
            },
            1,
            source.body,
          );
        } catch {
          throw new StudyError('conflict');
        }
        if (seen.has(question.id)) throw new StudyError('conflict');
        seen.add(question.id);
        available.push(item);
      }
      if (!available.length) throw new StudyError('conflict');
      const session = tx
        .insert(studySessions)
        .values({
          userId,
          setId: set.id,
          status: 'in_progress',
          mode: 'normal',
          startRequestKey: key,
          startedAt: Date.now(),
        })
        .returning()
        .get();
      for (const item of available)
        tx.insert(studyItems)
          .values({
            sessionId: session.id,
            questionVersionId: item.questionVersionId,
            position: item.position,
          })
          .run();
      return { session: summary(tx, session), replayed: false };
    },
    { behavior: 'immediate' },
  );
}
export function getSession(connection: Connection, id: number) {
  return connection.db.transaction((tx) => {
    const userId = requireLocalLearner({ db: tx });
    return summary(tx, owned(tx, id, userId));
  });
}
function itemRow(db: Reader, sessionId: number, itemId: number) {
  const row = db
    .select({
      item: studyItems,
      version: questionVersions,
      questionStatus: questions.status,
    })
    .from(studyItems)
    .innerJoin(
      questionVersions,
      eq(studyItems.questionVersionId, questionVersions.id),
    )
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .where(and(eq(studyItems.sessionId, sessionId), eq(studyItems.id, itemId)))
    .get();
  if (!row) throw new StudyError('missing');
  return row;
}
function itemDto(row: ReturnType<typeof itemRow>) {
  if (itemState(row.item, row.questionStatus) === 'excluded')
    return {
      id: row.item.id,
      position: row.item.position,
      state: 'excluded' as const,
    };
  const base = {
    id: row.item.id,
    position: row.item.position,
    body: row.version.body,
    choices: row.version.choicesJson.map((choice) => ({
      id: choice.id,
      label: choice.label,
    })),
    requiredSelectionCount: row.version.answerIdsJson.length,
  };
  if (row.item.answeredAt === null) return base;
  return {
    ...base,
    feedback: {
      selectedIds: row.item.selectedIdsJson,
      isCorrect: row.item.isCorrect,
      answeredAt: row.item.answeredAt,
      answerIds: row.version.answerIdsJson,
      explanation: row.version.explanation,
      quote: row.version.quote,
    },
  };
}
export function getStudyItem(
  connection: Connection,
  sessionId: number,
  itemId: number,
) {
  return connection.db.transaction((tx) => {
    const userId = requireLocalLearner({ db: tx });
    owned(tx, sessionId, userId);
    return itemDto(itemRow(tx, sessionId, itemId));
  });
}
type Writer = Pick<Connection['db'], 'select' | 'update'>;
function syncProgress(tx: Writer, session: typeof studySessions.$inferSelect) {
  const now = Date.now();
  for (const { item, questionStatus } of items(tx, session.id))
    if (
      item.answeredAt === null &&
      item.excludedAt === null &&
      questionStatus === 'stopped'
    )
      tx.update(studyItems)
        .set({ excludedReason: 'stopped', excludedAt: now })
        .where(
          and(
            eq(studyItems.id, item.id),
            isNull(studyItems.excludedAt),
            isNull(studyItems.answeredAt),
          ),
        )
        .run();
  const state = summary(tx, session);
  if (
    state.statistics.unansweredEligibleCount === 0 &&
    session.status === 'in_progress'
  ) {
    const completed = tx
      .update(studySessions)
      .set({ status: 'completed', completedAt: session.completedAt ?? now })
      .where(
        and(
          eq(studySessions.id, session.id),
          eq(studySessions.status, 'in_progress'),
        ),
      )
      .returning()
      .get();
    if (!completed) throw new Error('storage');
    return summary(tx, completed);
  }
  return state;
}
export function answerStudyItem(
  connection: Connection,
  sessionId: number,
  itemId: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      const session = owned(tx, sessionId, userId);
      const row = itemRow(tx, sessionId, itemId);
      const input = answerInput(value);
      if (row.item.answeredAt !== null) {
        if (
          !row.item.selectedIdsJson ||
          JSON.stringify([...row.item.selectedIdsJson].sort()) !==
            JSON.stringify(input.selectedIds)
        )
          throw new StudyError('conflict');
        return {
          item: itemDto(row),
          session: summary(tx, session),
          replayed: true,
        };
      }
      if (
        session.status !== 'in_progress' ||
        itemState(row.item, row.questionStatus) === 'excluded'
      )
        throw new StudyError('conflict');
      const isCorrect = gradeAnswer(
        input.selectedIds,
        row.version.choicesJson,
        row.version.answerIdsJson,
      );
      const result = tx
        .update(studyItems)
        .set({
          selectedIdsJson: input.selectedIds,
          isCorrect,
          answeredAt: Date.now(),
        })
        .where(
          and(
            eq(studyItems.id, itemId),
            isNull(studyItems.answeredAt),
            isNull(studyItems.excludedAt),
          ),
        )
        .run();
      if (result.changes !== 1) throw new StudyError('conflict');
      const progress = syncProgress(tx, session);
      return {
        item: itemDto(itemRow(tx, sessionId, itemId)),
        session: progress,
        replayed: false,
      };
    },
    { behavior: 'immediate' },
  );
}
export function resumeSession(connection: Connection, id: number) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      const session = owned(tx, id, userId);
      return syncProgress(tx, session);
    },
    { behavior: 'immediate' },
  );
}
