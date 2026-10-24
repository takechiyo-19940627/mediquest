import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Connection } from './connection.ts';

export function migrateDatabase(
  connection: Connection,
  migrationsFolder: string,
) {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
    throw new Error('Generated migration journal is missing');
  }
  // SQLite table rebuilds require FK enforcement to be toggled outside a transaction.
  // Check all references before committing, and restore enforcement on every path.
  const client = connection.client;
  if (client.inTransaction)
    throw new Error('Migration requires an independent connection');
  const migrations = readMigrationFiles({ migrationsFolder });
  client.pragma('foreign_keys = OFF');
  try {
    client
      .transaction(() => {
        client.exec(
          'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
        );
        const last = client
          .prepare(
            'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
          )
          .get() as { created_at: number } | undefined;
        for (const migration of migrations) {
          if (last && Number(last.created_at) >= migration.folderMillis)
            continue;
          for (const statement of migration.sql) client.exec(statement);
          client
            .prepare(
              'INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)',
            )
            .run(migration.hash, migration.folderMillis);
        }
        if ((client.pragma('foreign_key_check') as unknown[]).length)
          throw new Error('Migration reference validation failed');
      })
      .immediate();
  } finally {
    client.pragma('foreign_keys = ON');
  }
}
