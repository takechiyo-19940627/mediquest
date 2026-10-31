import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  setItems,
  setCandidates,
  questionVersions,
  questions,
  generationRuns,
  sources,
} from '../../db/schema';
import { fingerprint, ReviewError } from '../review/input';
import { validateGeneration } from '../generation/validation';
export type DatabaseReader = Pick<Connection['db'], 'select'>;
export type SetRow = typeof questionSets.$inferSelect;
// The single safe step of question_sets.revision shared by selection, publish,
// archive and (Issue #48) draft content edits.
export function nextRevision(revision: number) {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision === Number.MAX_SAFE_INTEGER
  )
    throw new ReviewError('conflict');
  return revision + 1;
}
export function selectedItems(db: DatabaseReader, setId: number) {
  return db
    .select()
    .from(setItems)
    .where(eq(setItems.setId, setId))
    .orderBy(setItems.position)
    .all();
}
export function versionForSet(db: DatabaseReader, set: SetRow, id: number) {
  const row = db
    .select({
      version: questionVersions,
      question: questions,
      run: generationRuns,
      source: sources,
      candidate: setCandidates,
    })
    .from(questionVersions)
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .leftJoin(
      generationRuns,
      eq(questionVersions.generationRunId, generationRuns.id),
    )
    .innerJoin(sources, eq(questions.sourceId, sources.id))
    .innerJoin(
      setCandidates,
      and(
        eq(setCandidates.questionVersionId, questionVersions.id),
        eq(setCandidates.setId, set.id),
      ),
    )
    .where(eq(questionVersions.id, id))
    .get();
  if (!row) throw new ReviewError('missing');
  if (
    row.question.sourceId !== set.sourceId ||
    row.candidate.questionId !== row.version.questionId ||
    (row.version.generationRunId !== null &&
      (!row.run || row.run.sourceId !== set.sourceId))
  )
    throw new ReviewError('conflict');
  if (row.version.derivedFromVersionId !== null) {
    const parent =
      row.version.derivedFromVersionId === null
        ? undefined
        : db
            .select({ questionId: questionVersions.questionId })
            .from(questionVersions)
            .where(eq(questionVersions.id, row.version.derivedFromVersionId))
            .get();
    if (!parent || parent.questionId !== row.version.questionId)
      throw new ReviewError('conflict');
  }
  return row;
}
export function validateSelection(
  db: DatabaseReader,
  set: SetRow,
  ids: number[],
) {
  const questionIds = new Set<number>();
  for (const id of ids) {
    const { version, question, run, source } = versionForSet(db, set, id);
    if (
      (version.generationRunId !== null && run?.status !== 'succeeded') ||
      question.status !== 'active' ||
      version.invalidatedAt !== null ||
      version.reviewedBy === null ||
      version.reviewedAt === null ||
      questionIds.has(question.id)
    )
      throw new ReviewError('conflict');
    questionIds.add(question.id);
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
      throw new ReviewError('conflict');
    }
  }
}
export function publicationState(db: DatabaseReader, set: SetRow) {
  const selected = selectedItems(db, set.id);
  const items = selected.map((item) => {
    const { version, question, run } = versionForSet(
      db,
      set,
      item.questionVersionId,
    );
    return {
      versionId: version.id,
      position: item.position,
      questionId: version.questionId,
      fingerprint: fingerprint(version),
      invalidatedAt: version.invalidatedAt,
      reviewedBy: version.reviewedBy,
      reviewedAt: version.reviewedAt,
      questionStatus: question.status,
      generationStatus: run?.status ?? null,
    };
  });
  const revisionState =
    set.supersedesSetId === null
      ? []
      : [
          set.supersedesSetId,
          set.supersedesRevision,
          db
            .select({
              candidate: setCandidates,
              version: questionVersions,
              questionStatus: questions.status,
              generationStatus: generationRuns.status,
            })
            .from(setCandidates)
            .innerJoin(
              questionVersions,
              eq(setCandidates.questionVersionId, questionVersions.id),
            )
            .innerJoin(questions, eq(questionVersions.questionId, questions.id))
            .leftJoin(
              generationRuns,
              eq(questionVersions.generationRunId, generationRuns.id),
            )
            .where(eq(setCandidates.setId, set.id))
            .orderBy(setCandidates.questionId, setCandidates.questionVersionId)
            .all()
            .map(({ candidate, version, questionStatus, generationStatus }) => [
              candidate.questionId,
              candidate.questionVersionId,
              version.questionId,
              fingerprint(version),
              version.reviewedBy,
              version.reviewedAt,
              version.invalidatedAt,
              questionStatus,
              generationStatus,
              version.generationRunId,
              version.derivedFromVersionId,
              version.manualCreatedBy,
            ]),
        ];
  const publishFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        set.id,
        set.sourceId,
        set.revision,
        ...revisionState,
        items.map((item) => [
          item.position,
          item.versionId,
          item.questionId,
          item.fingerprint,
          item.invalidatedAt,
          item.reviewedBy,
          item.reviewedAt,
          item.questionStatus,
          item.generationStatus,
        ]),
      ]),
    )
    .digest('hex');
  return { items, publishFingerprint };
}

// Both publication branches validate the same adopted collection.
export function validatePublishableSelection(db: DatabaseReader, set: SetRow) {
  const items = selectedItems(db, set.id);
  if (
    !items.length ||
    items.length > 10 ||
    items.some((item, index) => item.position !== index)
  )
    throw new ReviewError('conflict');
  try {
    validateSelection(
      db,
      set,
      items.map((item) => item.questionVersionId),
    );
  } catch (error) {
    if (error instanceof ReviewError) throw new ReviewError('conflict');
    throw error;
  }
}

export function validateRevisionSource(db: DatabaseReader, set: SetRow) {
  const validId = (id: number | null): id is number =>
    id !== null && Number.isSafeInteger(id) && id > 0;
  const validRevision = (revision: number | null) =>
    revision !== null && Number.isSafeInteger(revision) && revision >= 0;
  if (!validId(set.supersedesSetId) || !validRevision(set.supersedesRevision))
    throw new ReviewError('conflict');
  const visited = new Set([set.id]);
  let id: number | null = set.supersedesSetId;
  let source: SetRow | undefined;
  while (id !== null) {
    if (!validId(id) || visited.has(id)) throw new ReviewError('conflict');
    visited.add(id);
    const ancestor: SetRow | undefined = db
      .select()
      .from(questionSets)
      .where(eq(questionSets.id, id))
      .get();
    if (
      !ancestor ||
      ancestor.sourceId !== set.sourceId ||
      (ancestor.supersedesSetId === null) !==
        (ancestor.supersedesRevision === null) ||
      (ancestor.supersedesSetId !== null &&
        !validRevision(ancestor.supersedesRevision))
    )
      throw new ReviewError('conflict');
    source ??= ancestor;
    id = ancestor.supersedesSetId;
  }
  if (
    !source ||
    !['published', 'archived'].includes(source.status) ||
    source.publishedBy === null ||
    source.publishedAt === null ||
    source.revision !== set.supersedesRevision
  )
    throw new ReviewError('conflict');
  const successor = db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(
      and(
        eq(questionSets.supersedesSetId, source.id),
        isNotNull(questionSets.publishedAt),
      ),
    )
    .get();
  if (successor) throw new ReviewError('conflict', successor.id);
  return source;
}
