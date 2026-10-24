import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
for (const failure of ['SQL', 'FK'] as const)
  it(`rolls back DDL/data/journal and restores FK after ${failure} migration failure`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'migration-failure-'));
    const c = openDatabase({ MEDIQUEST_DB_PATH: join(dir, 'test.sqlite') });
    try {
      const folder = join(dir, 'migrations');
      mkdirSync(join(folder, 'meta'), { recursive: true });
      writeFileSync(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'sqlite',
          entries: [
            {
              idx: 0,
              version: '6',
              when: 1,
              tag: '0000_test',
              breakpoints: true,
            },
          ],
        }),
      );
      writeFileSync(
        join(folder, '0000_test.sql'),
        `CREATE TABLE added(id integer primary key, parent_id integer references parents(id));--> statement-breakpoint\nINSERT INTO parents VALUES(2);--> statement-breakpoint\n${failure === 'SQL' ? 'INVALID SQL;' : 'INSERT INTO added VALUES(1,999);'}`,
      );
      c.client.exec(
        'CREATE TABLE parents(id integer primary key); INSERT INTO parents VALUES(1)',
      );
      expect(() => migrateDatabase(c, folder)).toThrow();
      expect(c.client.prepare('select * from parents').all()).toEqual([
        { id: 1 },
      ]);
      expect(
        c.client
          .prepare(
            "select name from sqlite_master where name in ('added','__drizzle_migrations')",
          )
          .all(),
      ).toEqual([]);
      expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(c.client.inTransaction).toBe(false);
    } finally {
      try {
        c.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
it('rejects migration within an existing transaction without altering its state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migration-nested-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(dir, 'db.sqlite') });
  try {
    mkdirSync(join(dir, 'meta'));
    writeFileSync(join(dir, 'meta/_journal.json'), '{}');
    c.client.exec(
      'CREATE TABLE original(id integer); BEGIN; INSERT INTO original VALUES(1)',
    );
    expect(() => migrateDatabase(c, dir)).toThrow('independent connection');
    expect(c.client.inTransaction).toBe(true);
    expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(c.client.prepare('select * from original').all()).toEqual([
      { id: 1 },
    ]);
    c.client.exec('ROLLBACK');
    expect(c.client.prepare('select * from original').all()).toEqual([]);
  } finally {
    try {
      c.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
