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
