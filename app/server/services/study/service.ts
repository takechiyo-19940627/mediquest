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
  const projected = items(db, session.id).map(({ item, questionStatus }) => ({
    id: item.id,
    position: item.position,
    state:
      item.excludedAt !== null || questionStatus === 'stopped'
        ? ('excluded' as const)
        : item.answeredAt !== null
          ? ('answered' as const)
          : ('unanswered' as const),
  }));
  return {
    id: session.id,
    setId: session.setId,
    status: session.status,
    mode: session.mode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    items: projected,
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
export function getStudyItem(
  connection: Connection,
  sessionId: number,
  itemId: number,
) {
  return connection.db.transaction((tx) => {
    const userId = requireLocalLearner({ db: tx });
    owned(tx, sessionId, userId);
    const row = tx
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
      .where(
        and(eq(studyItems.sessionId, sessionId), eq(studyItems.id, itemId)),
      )
      .get();
    if (!row) throw new StudyError('missing');
    if (row.item.excludedAt !== null || row.questionStatus === 'stopped')
      return {
        id: row.item.id,
        position: row.item.position,
        state: 'excluded' as const,
      };
    return {
      id: row.item.id,
      position: row.item.position,
      body: row.version.body,
      choices: row.version.choicesJson.map((choice) => ({
        id: choice.id,
        label: choice.label,
      })),
      requiredSelectionCount: row.version.answerIdsJson.length,
    };
  });
}
export function resumeSession(connection: Connection, id: number) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      const session = owned(tx, id, userId);
      const now = Date.now();
      for (const { item, questionStatus } of items(tx, id))
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
      return summary(tx, session);
    },
    { behavior: 'immediate' },
  );
}
