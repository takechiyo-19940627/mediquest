import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { migrations } from './legacy-migrations';
import { sourceText } from './generation';
export function manualFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-manual-'));
  const database = join(directory, 'test.sqlite');
  const c = openDatabase({ MEDIQUEST_DB_PATH: database });
  try {
    migrateDatabase(c, migrations);
    seedAdministrator(c);
    createSource(c, { title: '教材', body: sourceText }, randomUUID());
    return {
      c,
      database,
      close: () => {
        c.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    c.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
