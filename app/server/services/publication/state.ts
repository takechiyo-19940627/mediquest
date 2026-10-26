import type { questionSets } from '../../db/schema';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
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
  if (row.version.generationRunId === null) {
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
  const publishFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        set.id,
        set.sourceId,
        set.revision,
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
