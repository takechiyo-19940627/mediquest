import { seedAdministrator } from '../server/db/seed.ts';
import { openDatabase } from '../server/db/connection.ts';
import type { Connection } from '../server/db/connection.ts';

let connection: Connection | undefined;
let stage: 'connection' | 'seed' = 'connection';
let succeeded = false;
try {
  connection = openDatabase();
  stage = 'seed';
  seedAdministrator(connection);
  succeeded = true;
} catch {
  console.error(
    stage === 'connection'
      ? 'Database connection failed'
      : 'Database seed failed',
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
if (succeeded) console.log('Initial administrator exists');
