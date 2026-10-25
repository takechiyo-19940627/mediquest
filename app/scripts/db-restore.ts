import { copyDatabase } from '../server/db/backup.ts';

try {
  if (process.argv.length !== 4) throw new Error('Database arguments invalid');
  await copyDatabase(process.argv[2]!, process.argv[3]!);
  console.log('Restore completed');
} catch {
  console.error('Database restore failed');
  process.exitCode = 1;
}
