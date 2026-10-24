import { expect, it } from 'vitest';
import { historyQuery } from '../../server/services/study/input';
it('accepts only limit/status/before with a dedicated study cursor and finite integer boundaries', () => {
  expect(historyQuery({})).toEqual({
    limit: 20,
    status: undefined,
    before: undefined,
  });
  expect(
    historyQuery({ limit: '100', status: 'completed', before: 'study:0:1' }),
  ).toEqual({
    limit: 100,
    status: 'completed',
    before: { startedAt: 0, id: 1 },
  });
  expect(historyQuery({ limit: '1', status: 'in_progress' })).toEqual({
    limit: 1,
    status: 'in_progress',
    before: undefined,
  });
  expect(
    historyQuery({ before: 'study:9007199254740991:9007199254740991' }).before,
  ).toEqual({ startedAt: 9007199254740991, id: 9007199254740991 });
  for (const query of [
    { limit: '101' },
    { limit: '0' },
    { limit: '-1' },
    { limit: '1.1' },
    { limit: 1 },
    { limit: ['1', '2'] },
    { status: 'all' },
    { status: '' },
    { status: 'COMPLETED' },
    { status: ['completed'] },
    { status: ['completed', 'in_progress'] },
    { before: '123:1' },
    { before: 'published:1:1' },
    { before: 'study:-1:1' },
    { before: 'study:9007199254740992:1' },
    { before: 'study:1:9007199254740992' },
    { before: 'study:1:0' },
    { before: 'study:1:1:1' },
    { before: 'study::1' },
    { before: ['study:1:1'] },
    { role: 'admin' },
    { userId: '1' },
    { setId: '1' },
    { order: 'asc' },
  ])
    expect(() => historyQuery(query)).toThrow('invalid');
});
