import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { users } from '../../server/db/schema';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directories: string[] = [];
function temporaryPath() {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-cli-'));
  directories.push(directory);
  return join(directory, 'private.sqlite');
}
function run(script: string, path?: string) {
  const env = { ...process.env };
  delete env.MEDIQUEST_DB_PATH;
  if (path !== undefined) env.MEDIQUEST_DB_PATH = path;
  return spawnSync(process.execPath, [`scripts/${script}.ts`], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('runs actual Node CLI migration and seed twice without duplicating the administrator', () => {
  const path = temporaryPath();
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const script of ['db-migrate', 'db-seed']) {
      const result = run(script, path);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain(path);
    }
  }
  const connection = openDatabase({ MEDIQUEST_DB_PATH: path });
  try {
    const records = connection.db.select().from(users).all();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 1, role: 'admin' });
  } finally {
    connection.close();
  }
});
it('fails closed with sanitized output for missing, invalid and inaccessible configuration', () => {
  for (const script of ['db-migrate', 'db-seed']) {
    for (const path of [
      undefined,
      'private-relative.sqlite',
      join(temporaryPath(), 'missing.sqlite'),
    ]) {
      const result = run(script, path);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Database connection failed\n');
    }
  }
});
it('reports migration-required seed failure without raw SQLite errors', () => {
  const result = run('db-seed', temporaryPath());
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Database seed failed\n');
});
