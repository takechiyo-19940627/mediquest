import { SourceError } from '../source-errors';
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new SourceError('invalid');
  return value as Record<string, unknown>;
}
function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new SourceError('invalid');
  return value;
}
export function itemsInput(value: unknown) {
  const input = record(value, ['expectedRevision', 'versionIds']);
  const expectedRevision = revision(input.expectedRevision);
  if (
    !Array.isArray(input.versionIds) ||
    input.versionIds.length > 10 ||
    input.versionIds.some(
      (id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0,
    ) ||
    new Set(input.versionIds).size !== input.versionIds.length
  )
    throw new SourceError('invalid');
  return { expectedRevision, versionIds: input.versionIds as number[] };
}
export function publishInput(value: unknown) {
  const input = record(value, [
    'expectedRevision',
    'publishFingerprint',
    'confirmed',
  ]);
  const expectedRevision = revision(input.expectedRevision);
  if (
    input.confirmed !== true ||
    typeof input.publishFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.publishFingerprint)
  )
    throw new SourceError('invalid');
  return {
    expectedRevision,
    publishFingerprint: input.publishFingerprint,
    confirmed: true,
  };
}
