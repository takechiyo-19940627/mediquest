import { createHash } from 'node:crypto';
import { SourceError } from '../source-errors';
import { GenerationError } from '../generation/contract';
import { validateGeneration } from '../generation/validation';
// Issue #48: the administrator's full replacement of one unpublished
// candidate's content. The body is the complete content set plus the set
// revision and the content fingerprint the client last saw. Identity, origin,
// confirmation and quoteVerified are never chosen by the client; the content
// contract (sizes, 2-6 unique choice ids, answer subset) is the generation
// contract, so an edited candidate obeys the same rules as a generated one.
export function contentInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SourceError('invalid');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'expectedRevision',
          'expectedFingerprint',
          'body',
          'choices',
          'answerIds',
          'explanation',
          'quote',
        ].includes(key),
    ) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    typeof value.expectedFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.expectedFingerprint)
  )
    throw new SourceError('invalid');
  let content: ReturnType<typeof validateGeneration>[number];
  try {
    content = validateGeneration(
      {
        questions: [
          {
            body: value.body,
            choices: value.choices,
            answerIds: value.answerIds,
            explanation: value.explanation,
            quote: value.quote,
          },
        ],
      },
      1,
      '',
    )[0]!;
  } catch (error) {
    if (error instanceof GenerationError) throw new SourceError('invalid');
    throw error;
  }
  return {
    expectedRevision: value.expectedRevision,
    expectedFingerprint: value.expectedFingerprint,
    content: {
      body: content.body,
      choices: content.choices,
      answerIds: content.answerIds,
      explanation: content.explanation,
      quote: content.quote,
    },
  };
}
export function reviewInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SourceError('invalid');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        !['fingerprint', 'confirmed', 'acknowledgeQuoteMismatch'].includes(key),
    ) ||
    value.confirmed !== true ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    (value.acknowledgeQuoteMismatch !== undefined &&
      typeof value.acknowledgeQuoteMismatch !== 'boolean')
  )
    throw new SourceError('invalid');
  return {
    fingerprint: value.fingerprint,
    confirmed: true,
    acknowledgeQuoteMismatch: value.acknowledgeQuoteMismatch === true,
  };
}
export function fingerprint(version: {
  id: number;
  body: string;
  choicesJson: { id: string; label: string }[];
  answerIdsJson: string[];
  explanation: string;
  quote: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        version.id,
        version.body,
        version.choicesJson.map((choice) => [choice.id, choice.label]),
        version.answerIdsJson,
        version.explanation,
        version.quote,
      ]),
    )
    .digest('hex');
}
export class ReviewError extends Error {
  constructor(public code: 'missing' | 'conflict') {
    super(code);
  }
}
