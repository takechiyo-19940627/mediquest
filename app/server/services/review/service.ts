import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  questionVersions,
  questions,
  generationRuns,
  sources,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { validateGeneration } from '../generation/validation';
import type { sourcePage } from '../source-input';
import { fingerprint, ReviewError, reviewInput } from './input';

function candidates(db: Pick<Connection['db'], 'select'>, setId: number) {
  return db
    .select({
      version: questionVersions,
      question: questions,
      run: generationRuns,
      source: sources,
    })
    .from(questionVersions)
    .innerJoin(
      generationRuns,
      eq(questionVersions.generationRunId, generationRuns.id),
    )
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .innerJoin(sources, eq(generationRuns.sourceId, sources.id))
    .where(eq(generationRuns.setId, setId))
    .orderBy(questionVersions.id)
    .all();
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
      candidateCount: sql<number>`(select count(*) from question_versions v join generation_runs r on v.generation_run_id=r.id where r.set_id=question_sets.id)`,
      reviewedCount: sql<number>`(select count(*) from question_versions v join generation_runs r on v.generation_run_id=r.id where r.set_id=question_sets.id and v.reviewed_by is not null and v.reviewed_at is not null)`,
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
    if (
      rows.some(
        ({ question, run }) =>
          question.sourceId !== set.sourceId || run.sourceId !== set.sourceId,
      )
    )
      throw new ReviewError('conflict');
    return {
      ...set,
      candidates: rows.map(({ version, source }) => ({
        id: version.id,
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
export function confirmVersion(
  connection: Connection,
  setId: number,
  versionId: number,
  input: ReturnType<typeof reviewInput>,
) {
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
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
        run.status !== 'succeeded' ||
        question.status !== 'active' ||
        question.sourceId !== set.sourceId ||
        run.sourceId !== set.sourceId
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
