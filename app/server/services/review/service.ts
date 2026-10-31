import { rejectPastExamMutation } from '../past-exams/service';
import {
  nextRevision,
  publicationState,
  versionForSet,
} from '../publication/state';
import { and, desc, eq, lt, or, sql, isNotNull, ne } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  questionVersions,
  setCandidates,
  setItems,
  studyItems,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { validateGeneration } from '../generation/validation';
import type { sourcePage } from '../source-input';
import { contentInput, fingerprint, ReviewError, reviewInput } from './input';

function candidates(db: Pick<Connection['db'], 'select'>, setId: number) {
  const set = db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, setId))
    .get();
  if (!set) throw new ReviewError('missing');
  return db
    .select({ id: setCandidates.questionVersionId })
    .from(setCandidates)
    .where(eq(setCandidates.setId, setId))
    .orderBy(setCandidates.questionVersionId)
    .all()
    .map(({ id }) => versionForSet(db, set, id));
}
export function listSets(
  connection: Connection,
  page: ReturnType<typeof sourcePage>,
) {
  requireAdministrator(connection);
  const before = page.before;
  const rows = connection.db
    .select({
      id: questionSets.id,
      title: questionSets.title,
      status: questionSets.status,
      sourceId: questionSets.sourceId,
      createdAt: questionSets.createdAt,
      candidateCount: sql<number>`(select count(*) from set_candidates c join question_versions v on c.question_version_id=v.id where c.set_id=question_sets.id)`,
      reviewedCount: sql<number>`(select count(*) from set_candidates c join question_versions v on c.question_version_id=v.id where c.set_id=question_sets.id and v.reviewed_by is not null and v.reviewed_at is not null)`,
    })
    .from(questionSets)
    .where(
      before
        ? or(
            lt(questionSets.createdAt, before.createdAt),
            and(
              eq(questionSets.createdAt, before.createdAt),
              lt(questionSets.id, before.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(questionSets.createdAt), desc(questionSets.id))
    .limit(page.limit + 1)
    .all();
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > page.limit && last ? `${last.createdAt}:${last.id}` : null,
  };
}
export function getSet(connection: Connection, id: number) {
  return connection.db.transaction((tx) => {
    requireAdministrator({ db: tx });
    const set = tx
      .select()
      .from(questionSets)
      .where(eq(questionSets.id, id))
      .get();
    if (!set) throw new ReviewError('missing');
    const rows = candidates(tx, id);
    return {
      ...set,
      ...publicationState(tx, set),
      candidates: rows.map(({ version, source }) => ({
        id: version.id,
        generationRunId: version.generationRunId,
        manualCreatedBy: version.manualCreatedBy,
        derivedFromVersionId: version.derivedFromVersionId,
        questionId: version.questionId,
        versionNo: version.versionNo,
        body: version.body,
        choices: version.choicesJson,
        answerIds: version.answerIdsJson,
        explanation: version.explanation,
        quote: version.quote,
        quoteVerified: source.body.includes(version.quote),
        reviewedBy: version.reviewedBy,
        reviewedAt: version.reviewedAt,
        fingerprint: fingerprint(version),
      })),
    };
  });
}
// Sharing alone does not forbid confirming unchanged content. Content edits
// below cannot clear the confirmation of a shared version or an immutable parent.
export function confirmVersion(
  connection: Connection,
  setId: number,
  versionId: number,
  input: ReturnType<typeof reviewInput>,
) {
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      rejectPastExamMutation(tx, setId);
      input = reviewInput(input);
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, setId))
        .get();
      if (!set) throw new ReviewError('missing');
      const item = candidates(tx, setId).find(
        (item) => item.version.id === versionId,
      );
      if (!item) throw new ReviewError('missing');
      const { version, question, run, source } = item;
      if (
        set.status !== 'draft' ||
        set.publishedAt !== null ||
        tx
          .select({ id: questionVersions.id })
          .from(questionVersions)
          .where(eq(questionVersions.derivedFromVersionId, versionId))
          .get() !== undefined ||
        tx
          .select({ id: setItems.id })
          .from(setItems)
          .innerJoin(questionSets, eq(setItems.setId, questionSets.id))
          .where(
            and(
              eq(setItems.questionVersionId, versionId),
              isNotNull(questionSets.publishedAt),
            ),
          )
          .get() !== undefined ||
        (version.generationRunId !== null && run?.status !== 'succeeded') ||
        tx
          .select({ id: studyItems.id })
          .from(studyItems)
          .where(eq(studyItems.questionVersionId, versionId))
          .get() !== undefined ||
        version.invalidatedAt !== null ||
        question.status !== 'active' ||
        question.sourceId !== set.sourceId ||
        (run !== null && run.sourceId !== set.sourceId)
      )
        throw new ReviewError('conflict');
      let quoteVerified: boolean;
      try {
        quoteVerified = validateGeneration(
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
        )[0]!.quoteVerified;
      } catch {
        throw new ReviewError('conflict');
      }
      if (
        fingerprint(version) !== input.fingerprint ||
        (!quoteVerified && !input.acknowledgeQuoteMismatch)
      )
        throw new ReviewError('conflict');
      if ((version.reviewedBy === null) !== (version.reviewedAt === null))
        throw new ReviewError('conflict');
      if (version.reviewedBy !== null)
        return {
          id: version.id,
          reviewedBy: version.reviewedBy,
          reviewedAt: version.reviewedAt,
          fingerprint: input.fingerprint,
        };
      const reviewedAt = Date.now();
      tx.update(questionVersions)
        .set({ reviewedBy: user, reviewedAt })
        .where(eq(questionVersions.id, versionId))
        .run();
      return {
        id: version.id,
        reviewedBy: user,
        reviewedAt,
        fingerprint: input.fingerprint,
      };
    },
    { behavior: 'immediate' },
  );
}
// Shared and historical versions are immutable: edits create a derived candidate.
export function updateVersionContent(
  connection: Connection,
  setId: number,
  versionId: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      requireAdministrator({ db: tx });
      rejectPastExamMutation(tx, setId);
      const input = contentInput(value);
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, setId))
        .get();
      if (!set) throw new ReviewError('missing');
      const item = candidates(tx, setId).find(
        (item) => item.version.id === versionId,
      );
      if (!item) {
        const old = tx
          .select()
          .from(questionVersions)
          .where(eq(questionVersions.id, versionId))
          .get();
        const replacement =
          old &&
          tx
            .select()
            .from(setCandidates)
            .where(
              and(
                eq(setCandidates.setId, setId),
                eq(setCandidates.questionId, old.questionId),
              ),
            )
            .get();
        throw new ReviewError(replacement ? 'conflict' : 'missing');
      }
      const { version, question, run, source } = item;
      if (
        set.status !== 'draft' ||
        set.publishedAt !== null ||
        (version.generationRunId !== null && run?.status !== 'succeeded') ||
        question.status !== 'active' ||
        question.sourceId !== set.sourceId ||
        (run !== null && run.sourceId !== set.sourceId) ||
        (version.reviewedBy === null) !== (version.reviewedAt === null)
      )
        throw new ReviewError('conflict');
      const current = fingerprint(version);
      if (
        current !== input.expectedFingerprint ||
        set.revision !== input.expectedRevision
      )
        throw new ReviewError('conflict');
      const next = {
        ...version,
        body: input.content.body,
        choicesJson: input.content.choices,
        answerIdsJson: input.content.answerIds,
        explanation: input.content.explanation,
        quote: input.content.quote,
      };
      const result = (
        row: typeof next,
        quoteVerified: boolean,
        revision: number,
        changed: boolean,
      ) => ({
        id: row.id,
        questionId: row.questionId,
        versionNo: row.versionNo,
        body: row.body,
        choices: row.choicesJson,
        answerIds: row.answerIdsJson,
        explanation: row.explanation,
        quote: row.quote,
        quoteVerified,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
        fingerprint: fingerprint(row),
        revision,
        changed,
      });
      if (fingerprint(next) === current)
        return result(
          version,
          source.body.includes(version.quote),
          set.revision,
          false,
        );
      const quoteVerified = source.body.includes(next.quote);
      const revision = nextRevision(set.revision);
      const copyOnWrite =
        tx
          .select({ id: setCandidates.id })
          .from(setCandidates)
          .where(
            and(
              eq(setCandidates.questionVersionId, versionId),
              ne(setCandidates.setId, setId),
            ),
          )
          .get() !== undefined ||
        tx
          .select({ id: questionVersions.id })
          .from(questionVersions)
          .where(eq(questionVersions.derivedFromVersionId, versionId))
          .get() !== undefined ||
        tx
          .select({ id: setItems.id })
          .from(setItems)
          .innerJoin(questionSets, eq(setItems.setId, questionSets.id))
          .where(
            and(
              eq(setItems.questionVersionId, versionId),
              isNotNull(questionSets.publishedAt),
            ),
          )
          .get() !== undefined ||
        tx
          .select({ id: studyItems.id })
          .from(studyItems)
          .where(eq(studyItems.questionVersionId, versionId))
          .get() !== undefined ||
        version.invalidatedAt !== null;
      let saved: typeof version = {
        ...next,
        quoteVerified,
        reviewedBy: null,
        reviewedAt: null,
      };
      if (copyOnWrite) {
        const maximum = tx
          .select({ value: sql<number>`max(${questionVersions.versionNo})` })
          .from(questionVersions)
          .where(eq(questionVersions.questionId, version.questionId))
          .get()!;
        saved = tx
          .insert(questionVersions)
          .values({
            questionId: version.questionId,
            versionNo: nextRevision(maximum.value),
            body: next.body,
            choicesJson: next.choicesJson,
            answerIdsJson: next.answerIdsJson,
            explanation: next.explanation,
            quote: next.quote,
            quoteVerified,
            generationRunId: null,
            derivedFromVersionId: versionId,
            createdAt: Date.now(),
          })
          .returning()
          .get();
        const adopted = tx
          .select()
          .from(setItems)
          .where(
            and(
              eq(setItems.setId, setId),
              eq(setItems.questionVersionId, versionId),
            ),
          )
          .get();
        if (adopted)
          tx.delete(setItems).where(eq(setItems.id, adopted.id)).run();
        tx.update(setCandidates)
          .set({ questionVersionId: saved.id })
          .where(
            and(
              eq(setCandidates.setId, setId),
              eq(setCandidates.questionVersionId, versionId),
            ),
          )
          .run();
        if (adopted)
          tx.insert(setItems)
            .values({
              setId,
              questionVersionId: saved.id,
              position: adopted.position,
            })
            .run();
      } else {
        tx.update(questionVersions)
          .set({
            body: next.body,
            choicesJson: next.choicesJson,
            answerIdsJson: next.answerIdsJson,
            explanation: next.explanation,
            quote: next.quote,
            quoteVerified,
            reviewedBy: null,
            reviewedAt: null,
          })
          .where(eq(questionVersions.id, versionId))
          .run();
      }
      tx.update(questionSets)
        .set({ revision })
        .where(eq(questionSets.id, setId))
        .run();
      return result(saved, quoteVerified, revision, true);
    },
    { behavior: 'immediate' },
  );
}
