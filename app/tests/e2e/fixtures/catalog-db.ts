import { catalogFixture } from '../../fixtures/catalog';
import { openDatabase } from '../../../server/db/connection';
import { migrateDatabase } from '../../../server/db/migrate';
import { seedAdministrator } from '../../../server/db/seed';
import {
  confirmVersion,
  getSet,
} from '../../../server/services/review/service';
import {
  replaceItems,
  publishSet,
} from '../../../server/services/publication/service';

export function database() {
  return openDatabase({ MEDIQUEST_DB_PATH: process.env.MEDIQUEST_E2E_DB });
}
export function emptyCatalog() {
  const c = database();
  try {
    c.client.pragma('foreign_keys = OFF');
    const tables = c.client
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables)
      c.client.exec(`delete from "${name.replaceAll('"', '""')}"`);
    c.client.pragma('foreign_keys = ON');
    seedAdministrator(c);
  } finally {
    c.close();
  }
}
export function initialize() {
  const c = database();
  try {
    migrateDatabase(c, 'drizzle');
    seedAdministrator(c);
  } finally {
    c.close();
  }
}
export async function seedCatalog() {
  const f = await catalogFixture();
  try {
    const ids = [f.run.setId];
    for (let i = 1; i < 22; i++) {
      const run = await f.generate();
      const d = getSet(f.c, run.setId);
      for (const v of d.candidates)
        confirmVersion(f.c, run.setId, v.id, {
          fingerprint: v.fingerprint,
          confirmed: true,
          acknowledgeQuoteMismatch: true,
        });
      replaceItems(f.c, run.setId, {
        expectedRevision: 0,
        versionIds: d.candidates.map((v) => v.id),
      });
      const ready = getSet(f.c, run.setId);
      publishSet(f.c, run.setId, {
        expectedRevision: ready.revision,
        publishFingerprint: ready.publishFingerprint,
        confirmed: true,
      });
      ids.push(run.setId);
    }
    for (const [index, id] of ids.entries())
      f.c.client
        .prepare(
          'update question_sets set title=?,description=?,published_at=? where id=?',
        )
        .run(
          `公開セット${index + 1}${index === 21 ? '長い日本語の題名'.repeat(12) : ''}`,
          '説明文です。\n' + '長い説明'.repeat(60),
          1000 + index,
          id,
        );
    f.c.client
      .prepare('update question_sets set title=? where id=?')
      .run('DRAFT_SECRET_TITLE', f.draftId);
    f.c.client
      .prepare('update question_sets set title=? where id=?')
      .run('ARCHIVED_SECRET_TITLE', f.archivedId);
    // Published zero-question sets remain visible.
    f.c.client.prepare('delete from set_items where set_id=?').run(ids[21]!);
    await f.c.client.backup(process.env.MEDIQUEST_E2E_DB!);
    return { ids, draftId: f.draftId, archivedId: f.archivedId };
  } finally {
    f.close();
  }
}
export function sql(statement: string) {
  const c = database();
  try {
    c.client.exec(statement);
  } finally {
    c.close();
  }
}
