import { copyDatabase } from '../server/db/backup.ts';
import { databasePath } from '../server/db/path.ts';

try {
  if (process.argv.length !== 3) throw new Error('Database arguments invalid');
  await copyDatabase(databasePath(), process.argv[2]!);
  console.log('Backup completed');
} catch {
  console.error('Database backup failed');
  process.exitCode = 1;
}
