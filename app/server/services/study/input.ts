import { SourceError } from '../source-errors';
export function startInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('invalid');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'setId') ||
    typeof input.setId !== 'number' ||
    !Number.isSafeInteger(input.setId) ||
    input.setId <= 0
  )
    throw new SourceError('invalid');
  return { setId: input.setId };
}
export function resumeInput(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length
  )
    throw new SourceError('invalid');
}
export class StudyError extends Error {
  constructor(public code: 'missing' | 'conflict') {
    super(code);
  }
}
