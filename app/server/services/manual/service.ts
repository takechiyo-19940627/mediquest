import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  manualSetRequests,
  questionSets,
  questions,
  questionVersions,
  setCandidates,
  sources,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { requestKey } from '../source-input';
import { SourceError } from '../source-errors';
import { validateGeneration } from '../generation/validation';

export function manualInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('invalid');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['title', 'questions'].includes(key)) ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    [...input.title.trim()].length > 200 ||
    !Array.isArray(input.questions)
  )
    throw new SourceError('invalid');
  try {
    const questions = validateGeneration(
      { questions: input.questions },
      input.questions.length,
      '',
    );
    return {
      title: input.title.trim(),
      questions: questions.map((q) => ({
        body: q.body,
        choices: q.choices,
        answerIds: q.answerIds,
        explanation: q.explanation,
        quote: q.quote,
      })),
    };
  } catch {
    throw new SourceError('invalid');
  }
}
export function createManualSet(
  connection: Connection,
  sourceId: number,
  value: unknown,
  key: unknown,
) {
  const input = manualInput(value);
  const normalizedKey = requestKey(key);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1)
    throw new SourceError('invalid');
  const hash = createHash('sha256')
    .update(JSON.stringify([sourceId, input]))
    .digest('hex');
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      const prior = tx
        .select()
        .from(manualSetRequests)
        .where(
          and(
            eq(manualSetRequests.requestedBy, user),
            eq(manualSetRequests.requestKey, normalizedKey),
          ),
        )
        .get();
      if (prior) {
        if (prior.requestHash !== hash) throw new SourceError('conflict');
        return { setId: prior.setId, replayed: true };
      }
      const source = tx
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId))
        .get();
      if (!source) throw new SourceError('missing');
      const now = Date.now();
      const set = tx
        .insert(questionSets)
        .values({
          sourceId,
          title: input.title,
          status: 'draft',
          createdBy: user,
          createdAt: now,
        })
        .returning()
        .get();
      for (const candidate of input.questions) {
        const question = tx
          .insert(questions)
          .values({ sourceId, status: 'active', createdAt: now })
          .returning()
          .get();
        const version = tx
          .insert(questionVersions)
          .values({
            questionId: question.id,
            versionNo: 1,
            body: candidate.body,
            choicesJson: candidate.choices,
            answerIdsJson: candidate.answerIds,
            explanation: candidate.explanation,
            quote: candidate.quote,
            quoteVerified: source.body.includes(candidate.quote),
            manualCreatedBy: user,
            createdAt: now,
          })
          .returning()
          .get();
        tx.insert(setCandidates)
          .values({
            setId: set.id,
            questionId: question.id,
            questionVersionId: version.id,
          })
          .run();
      }
      tx.insert(manualSetRequests)
        .values({
          requestedBy: user,
          requestKey: normalizedKey,
          requestHash: hash,
          setId: set.id,
          createdAt: now,
        })
        .run();
      return { setId: set.id, replayed: false };
    },
    { behavior: 'immediate' },
  );
}
