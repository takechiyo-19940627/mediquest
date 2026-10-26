import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const migrations = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);
export function legacyMigrations(directory: string) {
  const baseline = join(directory, 'baseline');
  mkdirSync(join(baseline, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 9);
  writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(
      join(migrations, `${entry.tag}.sql`),
      join(baseline, `${entry.tag}.sql`),
    );
  return baseline;
}
