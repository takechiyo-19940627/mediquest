import { SourceError } from '../source-errors';
import { sourceId } from '../source-input';
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
// Issue #41 skip: the body is an empty object. The server fixes the user, time
// and target item; client user/time/answer fields are rejected before the DB.
export function skipInput(value: unknown) {
  resumeInput(value);
}
// Issue #36 history listing: own sessions only, so no user/role/set filters.
export function historyQuery(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (key) => !['limit', 'status', 'before'].includes(key),
    )
  )
    throw new SourceError('invalid');
  const limit = query.limit === undefined ? 20 : sourceId(query.limit);
  if (limit > 100) throw new SourceError('invalid');
  let status: 'in_progress' | 'completed' | undefined;
  if (query.status !== undefined) {
    if (query.status !== 'in_progress' && query.status !== 'completed')
      throw new SourceError('invalid');
    status = query.status;
  }
  let before: { startedAt: number; id: number } | undefined;
  if (query.before !== undefined) {
    if (
      typeof query.before !== 'string' ||
      !/^study:[0-9]+:[1-9][0-9]*$/.test(query.before)
    )
      throw new SourceError('invalid');
    const [, time, id] = query.before.split(':');
    const startedAt = Number(time);
    if (!Number.isSafeInteger(startedAt)) throw new SourceError('invalid');
    before = { startedAt, id: sourceId(id) };
  }
  return { limit, status, before };
}
export class StudyError extends Error {
  constructor(public code: 'missing' | 'conflict') {
    super(code);
  }
}
