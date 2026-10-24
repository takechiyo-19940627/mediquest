import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../server/db/migrate.ts';
import { openDatabase } from '../server/db/connection.ts';
import type { Connection } from '../server/db/connection.ts';

let connection: Connection | undefined;
let stage: 'connection' | 'migrate' = 'connection';
let succeeded = false;
try {
  connection = openDatabase();
  stage = 'migrate';
  migrateDatabase(
    connection,
    fileURLToPath(new URL('../drizzle', import.meta.url)),
  );
  succeeded = true;
} catch {
  console.error(
    stage === 'connection'
      ? 'Database connection failed'
      : 'Database migrate failed',
  );
  process.exitCode = 1;
} finally {
  if (connection) {
    try {
      connection.close();
    } catch {
      console.error('Database close failed');
      process.exitCode = 1;
      succeeded = false;
    }
  }
}
if (succeeded) console.log('Migration completed');
