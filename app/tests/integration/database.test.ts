import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import type { Connection } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { sources, users } from '../../server/db/schema';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const connections: Connection[] = [];
const directories: string[] = [];
function fresh() {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-db-'));
  directories.push(directory);
  const connection = openDatabase({
    MEDIQUEST_DB_PATH: join(directory, 'test.sqlite'),
  });
  connections.push(connection);
  migrateDatabase(connection, migrations);
  return connection;
}
afterEach(() => {
  const errors: unknown[] = [];
  for (const connection of connections.splice(0)) {
    try {
      if (connection.client.open) connection.close();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Temporary database cleanup failed');
});

describe('generated SQLite migration and persistence', () => {
  it('preserves records on reopening the same file and enables FK on the new connection', () => {
    const first = fresh();
    seedAdministrator(first);
    first.db
      .insert(sources)
      .values({
        title: '保持',
        body: '再接続本文',
        createdBy: 1,
        createdAt: 2000,
      })
      .run();
    const usersBefore = first.db.select().from(users).all();
    const sourcesBefore = first.db.select().from(sources).all();
    const databaseFile = first.client.name;
    first.close();

    const reopened = openDatabase({ MEDIQUEST_DB_PATH: databaseFile });
    connections.push(reopened);
    expect(reopened.db.select().from(users).all()).toEqual(usersBefore);
    expect(reopened.db.select().from(sources).all()).toEqual(sourcesBefore);
    expect(reopened.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      reopened.client
        .prepare(
          'INSERT INTO sources (title,body,created_by,created_at) VALUES (?,?,?,?)',
        )
        .run('t', 'b', 999, 0),
    ).toThrow();
  });

  it('creates users/sources and preserves records across migration and seed replay', () => {
    const c = fresh();
    seedAdministrator(c);
    c.client
      .prepare('UPDATE users SET display_name = ? WHERE id = 1')
      .run('変更後');
    c.db
      .insert(sources)
      .values({
        title: '教材',
        body: 'テスト本文',
        createdBy: 1,
        createdAt: 1000,
      })
      .run();
    const before = c.db.select().from(users).all();
    migrateDatabase(c, migrations);
    seedAdministrator(c);
    expect(c.db.select().from(users).all()).toEqual(before);
    expect(c.db.select().from(sources).all()).toEqual([
      {
        id: 1,
        title: '教材',
        body: 'テスト本文',
        createdBy: 1,
        createdAt: 1000,
      },
    ]);
  });
  it('keeps isolated DB files and enables FK on every connection', () => {
    const a = fresh();
    const b = fresh();
    seedAdministrator(a);
    expect(b.db.select().from(users).all()).toEqual([]);
    for (const c of [a, b]) {
      expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(() =>
        c.client
          .prepare(
            'INSERT INTO sources (title,body,created_by,created_at) VALUES (?,?,?,?)',
          )
          .run('t', 'b', 999, 0),
      ).toThrow();
    }
  });
  it('enforces role CHECK, required ownership, and restricts referenced user deletion', () => {
    const c = fresh();
    seedAdministrator(c);
    expect(() =>
      c.client
        .prepare(
          'INSERT INTO users (display_name,role,created_at) VALUES (?,?,?)',
        )
        .run('bad', 'owner', 0),
    ).toThrow();
    expect(() =>
      c.client
        .prepare('INSERT INTO sources (title,body,created_at) VALUES (?,?,?)')
        .run('t', 'b', 0),
    ).toThrow();
    c.db
      .insert(sources)
      .values({ title: 't', body: 'b', createdBy: 1, createdAt: 0 })
      .run();
    expect(() =>
      c.client.prepare('DELETE FROM users WHERE id = 1').run(),
    ).toThrow();
  });
  it('does not promote or overwrite an existing learner during seed', () => {
    const c = fresh();
    c.db
      .insert(users)
      .values({ id: 1, displayName: '保持', role: 'learner', createdAt: 55 })
      .run();
    expect(() => seedAdministrator(c)).toThrow('non-admin');
    expect(c.db.select().from(users).all()).toEqual([
      { id: 1, displayName: '保持', role: 'learner', createdAt: 55 },
    ]);
  });
});
