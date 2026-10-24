import { and, eq } from 'drizzle-orm';
import { openDatabase } from '../../db/connection';
import type { Connection } from '../../db/connection';
import {
  generationRuns,
  questionSets,
  questions,
  questionVersions,
  sources,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { SourceError } from '../source-errors';
import { GenerationError } from './contract';
import type {
  GenerationConfig,
  GenerationOutcome,
  GenerationProvider,
} from './contract';
import {
  generationInput,
  generationConfig,
  generationHash,
  validateGeneration,
} from './validation';

type Connect = () => Connection;
type Run = typeof generationRuns.$inferSelect;
function summary(run: Run) {
  return {
    id: run.id,
    setId: run.setId,
    status: run.status,
    model: run.model,
    promptVersion: run.promptVersion,
    errorCode: run.errorCode,
  };
}
function withDatabase<T>(
  connect: Connect,
  action: (connection: Connection) => T,
): T {
  let connection: Connection | undefined;
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    connection = connect();
    result = action(connection);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    connection?.close();
  } catch (error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
  }
  if (failed) {
    if (failure instanceof GenerationError) throw failure;
    if (failure instanceof SourceError && failure.code === 'forbidden')
      throw new GenerationError('forbidden');
    throw new GenerationError('storage');
  }
  return result as T;
}

// A duplicate completion returns the original terminal state before inspecting new output.
export function completeGeneration(
  runId: number,
  outcome: GenerationOutcome,
  connect: Connect = openDatabase,
) {
  if (!Number.isSafeInteger(runId) || runId < 1)
    throw new GenerationError('invalid');
  return withDatabase(connect, (connection) =>
    connection.db.transaction(
      (tx) => {
        const user = requireAdministrator({ db: tx });
        const run = tx
          .select()
          .from(generationRuns)
          .where(
            and(
              eq(generationRuns.id, runId),
              eq(generationRuns.requestedBy, user),
            ),
          )
          .get();
        if (!run) throw new GenerationError('missing');
        if (run.status !== 'running') return summary(run);
        const source = tx
          .select()
          .from(sources)
          .where(eq(sources.id, run.sourceId))
          .get();
        if (!source) throw new GenerationError('missing');
        let status: Run['status'];
        let errorCode: Run['errorCode'] = null;
        if (outcome.kind === 'success') {
          let candidates;
          try {
            candidates = validateGeneration(
              outcome.output,
              run.requestedCount,
              source.body,
            );
          } catch {
            status = 'failed';
            errorCode = 'invalid_output';
          }
          if (candidates) {
            for (const candidate of candidates) {
              const question = tx
                .insert(questions)
                .values({
                  sourceId: source.id,
                  status: 'active',
                  createdAt: Date.now(),
                })
                .returning({ id: questions.id })
                .get();
              tx.insert(questionVersions)
                .values({
                  questionId: question.id,
                  versionNo: 1,
                  body: candidate.body,
                  choicesJson: candidate.choices,
                  answerIdsJson: candidate.answerIds,
                  explanation: candidate.explanation,
                  quote: candidate.quote,
                  quoteVerified: candidate.quoteVerified,
                  generationRunId: run.id,
                  createdAt: Date.now(),
                  reviewedAt: null,
                  reviewedBy: null,
                })
                .run();
            }
            status = 'succeeded';
          }
        } else {
          status = outcome.kind === 'failed' ? 'failed' : 'unknown';
          errorCode =
            outcome.kind === 'failed' ? 'provider_failed' : 'provider_unknown';
        }
        const finished = tx
          .update(generationRuns)
          .set({ status: status!, errorCode, finishedAt: Date.now() })
          .where(
            and(
              eq(generationRuns.id, run.id),
              eq(generationRuns.status, 'running'),
            ),
          )
          .returning()
          .get();
        if (!finished) throw new GenerationError('storage');
        return summary(finished);
      },
      { behavior: 'immediate' },
    ),
  );
}

async function executeGeneration(
  value: unknown,
  config: GenerationConfig | (() => GenerationConfig),
  provider: GenerationProvider,
  connect: Connect = openDatabase,
  onAccepted: (replayed: boolean) => void = () => {},
) {
  const input = generationInput(value);
  const accepted = withDatabase(connect, (connection) =>
    connection.db.transaction(
      (tx) => {
        const user = requireAdministrator({ db: tx });
        const hash = generationHash(input);
        const prior = tx
          .select()
          .from(generationRuns)
          .where(
            and(
              eq(generationRuns.requestedBy, user),
              eq(generationRuns.requestKey, input.requestKey),
            ),
          )
          .get();
        if (prior) {
          if (prior.requestHash !== hash) throw new GenerationError('conflict');
          return { run: prior, sourceText: '', created: false };
        }
        const source = tx
          .select()
          .from(sources)
          .where(eq(sources.id, input.sourceId))
          .get();
        if (!source) throw new GenerationError('missing');
        const settings = generationConfig(
          typeof config === 'function' ? config() : config,
        );
        const now = Date.now();
        const set = tx
          .insert(questionSets)
          .values({
            sourceId: source.id,
            title: input.title,
            status: 'draft',
            createdBy: user,
            createdAt: now,
            publishedBy: null,
            publishedAt: null,
          })
          .returning({ id: questionSets.id })
          .get();
        const run = tx
          .insert(generationRuns)
          .values({
            requestedBy: user,
            sourceId: source.id,
            setId: set.id,
            requestKey: input.requestKey,
            requestHash: hash,
            requestedCount: input.requestedCount,
            ...settings,
            status: 'running',
            startedAt: now,
          })
          .returning()
          .get();
        return { run, sourceText: source.body, created: true };
      },
      { behavior: 'immediate' },
    ),
  );
  onAccepted(!accepted.created);
  if (!accepted.created) return summary(accepted.run);
  let outcome: GenerationOutcome;
  try {
    outcome = await provider({
      sourceText: accepted.sourceText,
      requestedCount: accepted.run.requestedCount,
      model: accepted.run.model,
      promptVersion: accepted.run.promptVersion,
    });
    if (!outcome || !['success', 'failed', 'unknown'].includes(outcome.kind))
      outcome = { kind: 'unknown' };
  } catch {
    outcome = { kind: 'unknown' };
  }
  try {
    return completeGeneration(accepted.run.id, outcome, connect);
  } catch (error) {
    if (!(error instanceof GenerationError) || error.code !== 'storage')
      throw error;
    // The result transaction rolled back. Record only a fixed storage error in a separate short transaction.
    return withDatabase(connect, (connection) =>
      connection.db.transaction(
        (tx) => {
          requireAdministrator({ db: tx });
          const run = tx
            .update(generationRuns)
            .set({
              status: 'failed',
              errorCode: 'storage_failed',
              finishedAt: Date.now(),
            })
            .where(
              and(
                eq(generationRuns.id, accepted.run.id),
                eq(generationRuns.status, 'running'),
              ),
            )
            .returning()
            .get();
          if (run) return summary(run);
          const current = tx
            .select()
            .from(generationRuns)
            .where(eq(generationRuns.id, accepted.run.id))
            .get();
          if (!current) throw new GenerationError('storage');
          return summary(current);
        },
        { behavior: 'immediate' },
      ),
    );
  }
}

export function generateQuestions(
  value: unknown,
  config: GenerationConfig | (() => GenerationConfig),
  provider: GenerationProvider,
  connect: Connect = openDatabase,
) {
  return executeGeneration(value, config, provider, connect);
}
export async function generateQuestionsWithReceipt(
  value: unknown,
  config: () => GenerationConfig,
  provider: GenerationProvider,
  connect: Connect = openDatabase,
) {
  let replayed = false;
  const run = await executeGeneration(
    value,
    config,
    provider,
    connect,
    (value) => {
      replayed = value;
    },
  );
  return { ...run, replayed };
}
export function generationStatus(id: number, connect: Connect = openDatabase) {
  if (!Number.isSafeInteger(id) || id < 1) throw new GenerationError('invalid');
  return withDatabase(connect, (connection) => {
    const user = requireAdministrator(connection);
    const run = connection.db
      .select()
      .from(generationRuns)
      .where(
        and(eq(generationRuns.id, id), eq(generationRuns.requestedBy, user)),
      )
      .get();
    if (!run) throw new GenerationError('missing');
    return {
      ...summary(run),
      sourceId: run.sourceId,
      requestedCount: run.requestedCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt: run.finishedAt ?? run.startedAt,
    };
  });
}
