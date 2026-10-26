import { createHash } from 'node:crypto';
import { requestKey } from '../source-input';
import { SourceError } from '../source-errors';
export function revisionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('invalid');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        !['requestKey', 'expectedRevision', 'title', 'description'].includes(
          key,
        ),
    ) ||
    typeof input.expectedRevision !== 'number' ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    typeof input.title !== 'string' ||
    typeof input.description !== 'string'
  )
    throw new SourceError('invalid');
  const title = input.title.trim();
  if (!title || [...title].length > 200 || [...input.description].length > 2000)
    throw new SourceError('invalid');
  return {
    requestKey: requestKey(input.requestKey),
    expectedRevision: input.expectedRevision,
    title,
    description: input.description,
  };
}
export function revisionFingerprint(
  setId: number,
  input: ReturnType<typeof revisionInput>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        setId,
        input.expectedRevision,
        input.title,
        input.description,
      ]),
    )
    .digest('hex');
}
