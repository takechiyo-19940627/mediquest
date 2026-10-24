import { SourceError } from '../source-errors';
import { sourceId } from '../source-input';
export function catalogPage(query: Record<string, unknown>) {
  if (Object.keys(query).some((key) => !['limit', 'before'].includes(key)))
    throw new SourceError('invalid');
  const limit = query.limit === undefined ? 20 : sourceId(query.limit);
  if (limit > 100) throw new SourceError('invalid');
  let before: { publishedAt: number; id: number } | undefined;
  if (query.before !== undefined) {
    if (
      typeof query.before !== 'string' ||
      !/^published:[0-9]+:[1-9][0-9]*$/.test(query.before)
    )
      throw new SourceError('invalid');
    const [, time, id] = query.before.split(':');
    const publishedAt = Number(time);
    if (!Number.isSafeInteger(publishedAt)) throw new SourceError('invalid');
    before = { publishedAt, id: sourceId(id) };
  }
  return { limit, before };
}
