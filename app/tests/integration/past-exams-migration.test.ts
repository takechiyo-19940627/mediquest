import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { createManualSet } from '../../server/services/manual/service';
import { candidate } from '../fixtures/generation';
import { migrations } from '../fixtures/legacy-migrations';
import { randomUUID } from 'node:crypto';
it('adds past-paper storage without changing existing source, question, answer or receipt rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mediquest-past-migration-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(dir, 'db.sqlite') });
  try {
    const baseline = join(dir, 'baseline');
    mkdirSync(join(baseline, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.slice(0, 11);
    writeFileSync(
      join(baseline, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      copyFileSync(
        join(migrations, entry.tag + '.sql'),
        join(baseline, entry.tag + '.sql'),
      );
    migrateDatabase(c, baseline);
    seedAdministrator(c);
    const source = createSource(
      c,
      { title: '既存教材', body: '既存本文' },
      randomUUID(),
    );
    const saved = createManualSet(
      c,
      source.id,
      { title: '既存問題', questions: [candidate()] },
      randomUUID(),
    );
    c.client
      .prepare(
        "insert into study_sessions(user_id,set_id,status,mode,start_request_key,started_at) values(1,?,'completed','normal','saved',1)",
      )
      .run(saved.setId);
    c.client.exec(
      'insert into study_items(session_id,question_version_id,position,selected_ids_json,is_correct,answered_at) values(1,1,0,\'["a"]\',1,2)',
    );
    const names = (
      c.client
        .prepare(
          "select name from sqlite_master where type='table' and name not like '__drizzle%' and name not like 'sqlite_%' order by name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    const before = names.map((name) =>
      c.client.prepare(`select * from ${name}`).all(),
    );
    migrateDatabase(c, migrations);
    migrateDatabase(c, migrations);
    expect(
      names.map((name) => c.client.prepare(`select * from ${name}`).all()),
    ).toEqual(before);
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    expect(c.client.prepare('select * from past_exams').all()).toEqual([]);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
