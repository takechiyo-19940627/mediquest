import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
it('migrates the preceding baseline twice while preserving existing reviewed candidates and sources', () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'mediquest-publication-migration-'),
  );
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(directory, 'db.sqlite') });
  try {
    const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const baseline = join(directory, 'baseline');
    mkdirSync(join(baseline, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.slice(0, -1);
    writeFileSync(
      join(baseline, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      copyFileSync(
        join(migrations, `${entry.tag}.sql`),
        join(baseline, `${entry.tag}.sql`),
      );
    migrateDatabase(c, baseline);
    c.client
      .exec(`insert into users(id,display_name,role,created_at) values(1,'管理者','admin',1);
 insert into sources(id,title,body,created_by,created_at) values(1,'教材','保持する本文',1,1);
 insert into question_sets(id,source_id,title,status,created_by,created_at) values(1,1,'セット','draft',1,1);
 insert into generation_runs(id,requested_by,source_id,set_id,request_key,request_hash,requested_count,model,prompt_version,status,started_at,finished_at) values(1,1,1,1,'key','hash',1,'test','v1','succeeded',1,2);
 insert into questions(id,source_id,status,created_at) values(1,1,'active',1);
 insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,reviewed_by,reviewed_at,generation_run_id,created_at) values(1,1,1,'本文','[]','[]','解説','引用',0,1,7,1,1);`);
    const tables = [
      'users',
      'sources',
      'generation_runs',
      'questions',
      'question_versions',
    ];
    const before = tables.map((table) =>
      c.client.prepare(`select * from ${table}`).all(),
    );
    migrateDatabase(c, migrations);
    migrateDatabase(c, migrations);
    expect(
      tables.map((table) => c.client.prepare(`select * from ${table}`).all()),
    ).toEqual(before);
    expect(
      c.client
        .prepare(
          'select revision,publish_request_revision,publish_request_fingerprint from question_sets',
        )
        .get(),
    ).toEqual({
      revision: 0,
      publish_request_revision: null,
      publish_request_fingerprint: null,
    });
    expect(c.client.prepare('select * from set_items').all()).toEqual([]);
  } finally {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
