import { createHash } from 'node:crypto';
import { SourceError } from './source-errors';
export const maxRequestBytes = 512 * 1024;
export function sourceInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SourceError('invalid');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !['title', 'body'].includes(key)) ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string'
  )
    throw new SourceError('invalid');
  const title = value.title.trim();
  const body = value.body;
  if (!title || !body.trim()) throw new SourceError('invalid');
  if ([...title].length > 200 || [...body].length > 100000)
    throw new SourceError('too_large');
  return { title, body };
}
export function sourceHash(input: ReturnType<typeof sourceInput>) {
  return createHash('sha256')
    .update(JSON.stringify([input.title, input.body]))
    .digest('hex');
}
export function requestKey(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new SourceError('invalid');
  return value.toLowerCase();
}
export function sourceId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new SourceError('invalid');
  return Number(value);
}
export function sourcePage(query: Record<string, unknown>) {
  if (Object.keys(query).some((key) => !['limit', 'before'].includes(key)))
    throw new SourceError('invalid');
  const limit = query.limit === undefined ? 20 : sourceId(query.limit);
  if (limit > 100) throw new SourceError('invalid');
  let before: { createdAt: number; id: number } | undefined;
  if (query.before !== undefined) {
    if (
      typeof query.before !== 'string' ||
      !/^[0-9]+:[1-9][0-9]*$/.test(query.before)
    )
      throw new SourceError('invalid');
    const [time, id] = query.before.split(':');
    const createdAt = Number(time);
    if (!Number.isSafeInteger(createdAt)) throw new SourceError('invalid');
    before = { createdAt, id: sourceId(id) };
  }
  return { limit, before };
}
