import {
  answerInput,
  gradeAnswer,
  itemState,
  nextItemId,
  statistics,
  exclusionReason,
} from './answers';
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
import type { SetRow } from '../publication/state';
import { validateGeneration } from '../generation/validation';
import { requestKey } from '../source-input';
import { reviewStartInput, startInput, StudyError } from './input';
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
    .select({
      item: studyItems,
      questionStatus: questions.status,
      invalidatedAt: questionVersions.invalidatedAt,
    })
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
  const projected = rows.map(({ item, questionStatus, invalidatedAt }) => ({
    id: item.id,
    position: item.position,
    state: itemState(item, questionStatus, invalidatedAt),
    skippedAt: item.skippedAt,
    ...(invalidatedAt !== null
      ? { excludedReason: 'invalidated' as const }
      : {}),
  }));
  const stats = statistics(
    rows.map(({ item, questionStatus, invalidatedAt }) => ({
      state: itemState(item, questionStatus, invalidatedAt),
      isCorrect: item.isCorrect,
      skippedAt: item.skippedAt,
    })),
  );
  return {
    id: session.id,
    setId: session.setId,
    status: session.status,
    mode: session.mode,
    parentSessionId: session.parentSessionId,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    items: projected,
    statistics: stats,
    currentItemId: nextItemId(projected),
  };
}
// The user's saved start request for this key, if any. The (user, key) unique
// constraint is shared by every mode, so callers compare mode/parent/set.
function priorStart(db: Reader, userId: number, key: string) {
  return db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.userId, userId),
        eq(studySessions.startRequestKey, key),
      ),
    )
    .get();
}
// A set is open for a new start only while it is published with a publisher
// and time. Archiving stops new starts (and new reviews) but keeps sessions.
function publishedSet(db: Reader, setId: number) {
  const set = db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, setId))
    .get();
  if (
    !set ||
    set.status !== 'published' ||
    set.publishedBy === null ||
    set.publishedAt === null
  )
    return null;
  return set;
}
// Shared start-time check for one fixed version of a set. Integrity failures
// (wrong set/source, broken format, duplicate logical question) are conflicts;
// stopped, invalidated, unconfirmed or failed-run versions are not obtainable.
function obtainable(
  db: Reader,
  set: SetRow,
  versionId: number,
  seen: Set<number>,
) {
  let row: ReturnType<typeof versionForSet>;
  try {
    row = versionForSet(db, set, versionId);
  } catch (error) {
    if (error instanceof ReviewError) throw new StudyError('conflict');
    throw error;
  }
  const { version, question, run, source } = row;
  if (
    question.status !== 'active' ||
    version.invalidatedAt !== null ||
    version.reviewedBy === null ||
    version.reviewedAt === null ||
    run.status !== 'succeeded'
  )
    return false;
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
  return true;
}
type Inserter = Pick<Connection['db'], 'select' | 'insert'>;
function createSession(
  tx: Inserter,
  session: Omit<typeof studySessions.$inferInsert, 'startedAt' | 'status'>,
  items: { questionVersionId: number; position: number }[],
) {
  const created = tx
    .insert(studySessions)
    .values({ ...session, status: 'in_progress', startedAt: Date.now() })
    .returning()
    .get();
  for (const item of items)
    tx.insert(studyItems)
      .values({
        sessionId: created.id,
        questionVersionId: item.questionVersionId,
        position: item.position,
      })
      .run();
  return created;
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
      const prior = priorStart(tx, userId, key);
      if (prior) {
        // Issue #44: a review started with this key is never replayed here.
        if (
          prior.mode !== 'normal' ||
          prior.parentSessionId !== null ||
          prior.setId !== input.setId
        )
          throw new StudyError('conflict');
        return { session: summary(tx, prior), replayed: true };
      }
      const set = publishedSet(tx, input.setId);
      if (!set) throw new StudyError('missing');
      const selected = selectedItems(tx, set.id);
      if (selected.length > 10) throw new StudyError('conflict');
      const seen = new Set<number>();
      const available = selected.filter((item) =>
        obtainable(tx, set, item.questionVersionId, seen),
      );
      if (!available.length) throw new StudyError('conflict');
      const session = createSession(
        tx,
        { userId, setId: set.id, mode: 'normal', startRequestKey: key },
        available,
      );
      return { session: summary(tx, session), replayed: false };
    },
    { behavior: 'immediate' },
  );
}
// Issue #44: start a review session from the owner's completed session. The
// server picks the parent's wrong answers (answered, incorrect, no saved
// exclusion) whose fixed version is still obtainable: question active, version
// not invalidated, set still published and the version still in its published
// collection. The child keeps the parent's version ids and position values,
// stores only its direct parent, and starts with every answer column null. The
// parent's rows are read, never written. Replays of the same key return the
// saved child without re-selecting; a key saved for another mode, parent or
// set is a conflict. No eligible wrong answer, a parent that is not completed,
// or a set no longer open for new starts is a conflict and creates nothing.
export function startReviewSession(
  connection: Connection,
  parentId: number,
  value: unknown,
  keyValue: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      reviewStartInput(value);
      const key = requestKey(keyValue);
      const parent = owned(tx, parentId, userId);
      const prior = priorStart(tx, userId, key);
      if (prior) {
        if (
          prior.mode !== 'review' ||
          prior.parentSessionId !== parent.id ||
          prior.setId !== parent.setId
        )
          throw new StudyError('conflict');
        return { session: summary(tx, prior), replayed: true };
      }
      if (parent.status !== 'completed') throw new StudyError('conflict');
      const set = publishedSet(tx, parent.setId);
      if (!set) throw new StudyError('conflict');
      const published = new Set(
        selectedItems(tx, set.id).map((item) => item.questionVersionId),
      );
      const seen = new Set<number>();
      const targets: { questionVersionId: number; position: number }[] = [];
      for (const { item } of items(tx, parent.id)) {
        if (
          item.answeredAt === null ||
          item.isCorrect !== false ||
          item.excludedAt !== null
        )
          continue;
        if (!published.has(item.questionVersionId))
          throw new StudyError('conflict');
        if (obtainable(tx, set, item.questionVersionId, seen))
          targets.push(item);
      }
      if (!targets.length) throw new StudyError('conflict');
      const session = createSession(
        tx,
        {
          userId,
          setId: set.id,
          mode: 'review',
          parentSessionId: parent.id,
          startRequestKey: key,
        },
        targets,
      );
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
  if (
    itemState(row.item, row.questionStatus, row.version.invalidatedAt) ===
    'excluded'
  )
    return {
      id: row.item.id,
      position: row.item.position,
      state: 'excluded' as const,
      ...(exclusionReason(
        row.item,
        row.questionStatus,
        row.version.invalidatedAt,
      ) === 'invalidated'
        ? { excludedReason: 'invalidated' as const }
        : {}),
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
  for (const { item, questionStatus, invalidatedAt } of items(tx, session.id)) {
    if (invalidatedAt !== null) {
      tx.update(studyItems)
        .set({ excludedReason: 'invalidated', excludedAt: invalidatedAt })
        .where(eq(studyItems.id, item.id))
        .run();
    } else if (
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
  }
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
        itemState(row.item, row.questionStatus, row.version.invalidatedAt) ===
          'excluded'
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
// Issue #41: the owner skips one of their own obtainable unanswered items.
// The item stays unanswered (no answer, grade, or exclusion is written) and the
// first skip time is kept on resend or concurrent sends. Answered, excluded
// (stopped/invalidated/saved) items and non-in_progress sessions are rejected
// without writing anything. Completion and exclusion saving stay with
// answer/resume; the response only projects the current state.
export function skipStudyItem(
  connection: Connection,
  sessionId: number,
  itemId: number,
) {
  return connection.db.transaction(
    (tx) => {
      const userId = requireLocalLearner({ db: tx });
      const session = owned(tx, sessionId, userId);
      const row = itemRow(tx, sessionId, itemId);
      const skipped = (skippedAt: number, replayed: boolean) => ({
        item: { id: row.item.id, position: row.item.position, skippedAt },
        session: summary(tx, session),
        replayed,
      });
      if (
        row.item.answeredAt !== null ||
        session.status !== 'in_progress' ||
        itemState(row.item, row.questionStatus, row.version.invalidatedAt) ===
          'excluded'
      )
        throw new StudyError('conflict');
      if (row.item.skippedAt !== null) return skipped(row.item.skippedAt, true);
      const now = Date.now();
      const result = tx
        .update(studyItems)
        .set({ skippedAt: now })
        .where(
          and(
            eq(studyItems.id, itemId),
            isNull(studyItems.answeredAt),
            isNull(studyItems.excludedAt),
            isNull(studyItems.skippedAt),
          ),
        )
        .run();
      if (result.changes !== 1) throw new StudyError('conflict');
      return skipped(now, false);
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
