import { expect, it } from 'vitest';
import { catalogPage } from '../../server/services/learning-catalog/input';
it('uses a dedicated published cursor with finite page and integer boundaries', () => {
  expect(catalogPage({})).toEqual({ limit: 20, before: undefined });
  expect(catalogPage({ limit: '100', before: 'published:0:1' })).toEqual({
    limit: 100,
    before: { publishedAt: 0, id: 1 },
  });
  for (const query of [
    { limit: '101' },
    { limit: '0' },
    { limit: '1.1' },
    { limit: ['1', '2'] },
    { before: '123:1' },
    { before: 'published:-1:1' },
    { before: 'published:9007199254740992:1' },
    { before: 'published:1:0' },
    { before: ['published:1:1'] },
    { role: 'admin' },
    { userId: '1' },
  ])
    expect(() => catalogPage(query)).toThrow('invalid');
});
