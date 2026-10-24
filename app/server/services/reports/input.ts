import { SourceError } from '../source-errors';
export function reportInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('invalid');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'message') ||
    typeof input.message !== 'string'
  )
    throw new SourceError('invalid');
  const message = input.message.trim();
  if (!message || [...message].length > 2000) throw new SourceError('invalid');
  return { message };
}

export function resolutionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SourceError('invalid');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['decision', 'note'].includes(key)) ||
    (input.decision !== 'confirmed' && input.decision !== 'dismissed') ||
    typeof input.note !== 'string'
  )
    throw new SourceError('invalid');
  const note = input.note.trim();
  if (!note || [...note].length > 2000) throw new SourceError('invalid');
  return { decision: input.decision as 'confirmed' | 'dismissed', note };
}
