import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { migrations } from '../fixtures/legacy-migrations';
it('migrates manual provenance preserving old ids, references and deleted high-water sequence, and is repeatable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-manual-migration-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(directory, 'db.sqlite') });
  try {
    const baseline = join(directory, 'baseline');
    mkdirSync(join(baseline, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.slice(0, 10);
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
    c.client
      .exec(`insert into users(id,display_name,role,created_at) values(1,'管理','admin',1);
 insert into sources(id,title,body,created_by,created_at) values(1,'教材','本文',1,1);
 insert into question_sets(id,source_id,title,status,created_by,created_at) values(1,1,'セット','draft',1,1);
 insert into generation_runs(id,requested_by,source_id,set_id,request_key,request_hash,requested_count,model,prompt_version,status,started_at) values(1,1,1,1,'key','hash',1,'test','v1','succeeded',1);
 insert into questions(id,source_id,status,created_at) values(1,1,'active',1);
 insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,generation_run_id,created_at) values(1,1,1,'本文','[]','[]','解説','引用',0,1,1);
 insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,derived_from_version_id,created_at) values(2,1,2,'保持する改訂','[]','[]','解説','引用',0,1,1);
 insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,derived_from_version_id,created_at) values(100,1,3,'改訂','[]','[]','解説','引用',0,1,1);
 delete from question_versions where id=100;
 insert into set_candidates(set_id,question_id,question_version_id) values(1,1,2);
 insert into study_sessions(id,user_id,set_id,status,mode,start_request_key,started_at) values(1,1,1,'in_progress','normal','key',1);
 insert into study_items(session_id,question_version_id,position,selected_ids_json,is_correct,answered_at) values(1,2,0,'["a"]',1,2);`);
    const tables = [
      'question_versions',
      'set_candidates',
      'study_items',
      'study_sessions',
    ];
    const before = tables.map((t) =>
      c.client.prepare(`select * from ${t}`).all(),
    );
    migrateDatabase(c, migrations);
    migrateDatabase(c, migrations);
    expect(
      tables.map((t) => c.client.prepare(`select * from ${t}`).all()),
    ).toEqual(
      before.map((rows, i) =>
        i === 0
          ? rows.map((row) => ({ ...(row as object), manual_created_by: null }))
          : rows,
      ),
    );
    expect(
      c.client
        .prepare(
          "select seq from sqlite_sequence where name='question_versions'",
        )
        .get(),
    ).toEqual({ seq: 100 });
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
    c.client.exec(
      `insert into question_versions(question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,manual_created_by,created_at) values(1,3,'手動','[]','[]','解説','引用',0,1,1)`,
    );
    expect(
      c.client.prepare('select max(id) as id from question_versions').get(),
    ).toEqual({ id: 101 });
  } finally {
    c.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
