import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { generateQuestions } from '../../server/services/generation/service';
import { getSet, confirmVersion } from '../../server/services/review/service';
import { output, sourceText } from './generation';
export async function publicationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-publication-'));
  const database = join(directory, 'test.sqlite');
  const env = { MEDIQUEST_DB_PATH: database };
  const c = openDatabase(env);
  const close = () => {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    migrateDatabase(
      c,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    seedAdministrator(c);
    createSource(c, { title: '教材', body: sourceText }, randomUUID());
    const generate = () =>
      generateQuestions(
        {
          sourceId: 1,
          requestedCount: 3,
          title: 'セット',
          requestKey: randomUUID(),
        },
        { model: 'test', promptVersion: 'v1' },
        async () => ({ kind: 'success', output: output(3) }),
        () => openDatabase(env),
      );
    const run = await generate();
    for (const v of getSet(c, run.setId).candidates)
      confirmVersion(c, run.setId, v.id, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: false,
      });
    const detail = () => getSet(c, run.setId);
    return {
      c,
      database,
      directory,
      run,
      detail,
      generate,
      close,
      ids: detail().candidates.map((v) => v.id),
    };
  } catch (error) {
    close();
    throw error;
  }
}
