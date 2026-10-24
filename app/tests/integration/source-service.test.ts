import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import type { Connection } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
let connection: Connection | undefined;
let directory: string | undefined;
function fixture(migrate = true) {
  directory = mkdtempSync(join(tmpdir(), 'mediquest-source-service-'));
  connection = openDatabase({
    MEDIQUEST_DB_PATH: join(directory, 'test.sqlite'),
  });
  if (migrate) {
    migrateDatabase(connection, migrations);
    seedAdministrator(connection);
  }
  return connection;
}
afterEach(() => {
  try {
    connection?.close();
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
  connection = undefined;
  directory = undefined;
});
it('rolls back source creation if the request record cannot be stored', () => {
  const c = fixture();
  c.client.exec(
    "CREATE TRIGGER fail_request BEFORE INSERT ON source_creation_requests BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  expect(() =>
    createSource(
      c,
      { title: 't', body: 'b' },
      'aaaaaaaa-0000-0000-0000-000000000000',
    ),
  ).toThrow();
  expect(c.client.prepare('SELECT COUNT(*) AS n FROM sources').get()).toEqual({
    n: 0,
  });
});
it('preserves pre-migration users and sources and tolerates replay', () => {
  const c = fixture(false);
  const baseline = join(directory!, 'baseline');
  mkdirSync(join(baseline, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify(journal));
  copyFileSync(
    join(migrations, `${journal.entries[0].tag}.sql`),
    join(baseline, `${journal.entries[0].tag}.sql`),
  );
  migrateDatabase(c, baseline);
  seedAdministrator(c);
  c.client
    .prepare(
      'INSERT INTO sources (title, body, created_by, created_at) VALUES (?, ?, 1, 123)',
    )
    .run('旧教材', '旧本文');
  const beforeUsers = c.client.prepare('SELECT * FROM users').all();
  const beforeSources = c.client.prepare('SELECT * FROM sources').all();
  migrateDatabase(c, migrations);
  migrateDatabase(c, migrations);
  expect(c.client.prepare('SELECT * FROM users').all()).toEqual(beforeUsers);
  expect(c.client.prepare('SELECT * FROM sources').all()).toEqual(
    beforeSources,
  );
  expect(
    createSource(
      c,
      { title: '新', body: '新本文' },
      'bbbbbbbb-0000-0000-0000-000000000000',
    ).id,
  ).toBe(2);
});
