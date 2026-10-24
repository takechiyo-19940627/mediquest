import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Connection } from './connection.ts';

export function migrateDatabase(
  connection: Connection,
  migrationsFolder: string,
) {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
    throw new Error('Generated migration journal is missing');
  }
  migrate(connection.db, { migrationsFolder });
}
