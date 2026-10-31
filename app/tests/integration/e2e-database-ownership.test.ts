import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { e2eDatabasePath, withE2eDatabase } from '../../scripts/e2e-database';
import setup from '../e2e/global-setup';
import * as catalog from '../e2e/fixtures/catalog-db';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([false, true])(
  'leaves an inherited database and its siblings untouched (setup failure: %s)',
  async (failSetup) => {
    const unrelated = mkdtempSync(join(tmpdir(), 'mediquest-unrelated-'));
    const externalDb = join(unrelated, 'existing.sqlite');
    const sentinel = join(unrelated, 'keep.txt');
    writeFileSync(sentinel, 'unrelated data');
    const db = new Database(externalDb);
    db.exec(
      "CREATE TABLE precious(value TEXT); INSERT INTO precious VALUES ('keep');",
    );
    db.close();
    const originalBytes = readFileSync(externalDb);
    vi.stubEnv('MEDIQUEST_E2E_DB', externalDb);
    // Even an inherited session descriptor must be replaced for each run.
    vi.stubEnv(
      'MEDIQUEST_E2E_SESSION',
      JSON.stringify({ directory: unrelated, token: 'untrusted' }),
    );
    let ownedDirectory = '';
    try {
      const initialize = catalog.initialize;
      if (failSetup)
        vi.spyOn(catalog, 'initialize').mockImplementationOnce(() => {
          initialize();
          throw new Error('setup failed after creating database');
        });
      const result = withE2eDatabase(async (env) => {
        expect(env.MEDIQUEST_E2E_DB).toBeUndefined();
        const path = e2eDatabasePath(env);
        ownedDirectory = dirname(path);
        expect(ownedDirectory).not.toBe(unrelated);
        vi.stubEnv('MEDIQUEST_E2E_SESSION', env.MEDIQUEST_E2E_SESSION);
        try {
          setup();
          await catalog.seedCatalog();
          catalog.emptyCatalog();
          expect(existsSync(path)).toBe(true);
        } finally {
          // Teardown must use captured ownership, even if the environment changes.
          vi.stubEnv(
            'MEDIQUEST_E2E_SESSION',
            JSON.stringify({ directory: unrelated, token: 'untrusted' }),
          );
          vi.stubEnv('MEDIQUEST_E2E_DB', externalDb);
        }
      });
      if (failSetup) await expect(result).rejects.toThrow('setup failed');
      else await result;
      expect(existsSync(ownedDirectory)).toBe(false);
      expect(readFileSync(sentinel, 'utf8')).toBe('unrelated data');
      expect(readFileSync(externalDb)).toEqual(originalBytes);
    } finally {
      rmSync(unrelated, { recursive: true, force: true });
    }
  },
);

it('allocates a fresh directory each time and rejects direct unowned fixture access', async () => {
  vi.stubEnv('MEDIQUEST_E2E_SESSION', undefined);
  expect(() => catalog.initialize()).toThrow('npm run test:e2e');
  expect(() => catalog.emptyCatalog()).toThrow('npm run test:e2e');
  const paths: string[] = [];
  for (let i = 0; i < 2; i++)
    await withE2eDatabase(async (env) => {
      paths.push(e2eDatabasePath(env));
    });
  expect(paths[0]).not.toBe(paths[1]);
  for (const path of paths) expect(existsSync(dirname(path))).toBe(false);
});
