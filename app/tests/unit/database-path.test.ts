import { describe, expect, it } from 'vitest';
import { databasePath } from '../../server/db/path';

describe('database configuration', () => {
  it.each([
    undefined,
    '',
    'db.sqlite',
    ':memory:',
    ' /tmp/db.sqlite',
    '/tmp/a\0b',
  ])('rejects invalid configuration %s', (value) => {
    expect(() => databasePath({ MEDIQUEST_DB_PATH: value })).toThrow();
  });
  it('uses the explicit absolute path', () => {
    expect(databasePath({ MEDIQUEST_DB_PATH: '/tmp/example/db.sqlite' })).toBe(
      '/tmp/example/db.sqlite',
    );
  });
});
