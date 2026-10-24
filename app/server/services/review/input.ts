import { createHash } from 'node:crypto';
import { SourceError } from '../source-errors';
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
