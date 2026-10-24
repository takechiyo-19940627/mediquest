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
it('migrates resolution columns while retaining old reports, references and answers', () => {
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
    journal.entries = journal.entries.slice(0, 6);
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
    c.client.exec(
      "update question_sets set status='published',published_at=11,published_by=1,revision=2,publish_request_revision=1,publish_request_fingerprint='hash'; insert into set_items(set_id,question_version_id,position) values(1,1,0)",
    );
    c.client
      .exec(`insert into study_sessions(id,user_id,set_id,status,mode,start_request_key,started_at,completed_at) values(1,1,1,'completed','normal','old',1,3);
insert into study_items(id,session_id,question_version_id,position,selected_ids_json,is_correct,answered_at) values(1,1,1,0,'["a"]',1,2)`);
    c.client.exec(
      "insert into issue_reports(reported_by,question_version_id,study_item_id,message,status,created_at) values(1,1,1,'old report','open',1)",
    );
    const tables = [
      'issue_reports',
      'study_sessions',
      'study_items',
      'question_sets',
      'set_items',
      'users',
      'sources',
      'generation_runs',
      'questions',
      'question_versions',
    ];
    const before = tables.map((table) =>
      c.client
        .prepare(`select * from ${table}`)
        .all()
        .map((row) =>
          table === 'issue_reports'
            ? {
                ...(row as Record<string, unknown>),
                resolved_at: null,
                resolved_by: null,
                resolution_note: null,
              }
            : table === 'question_versions'
              ? {
                  ...(row as Record<string, unknown>),
                  invalidated_at: null,
                  invalidated_by: null,
                  invalidation_reason: null,
                }
              : row,
        ),
    );
    migrateDatabase(c, migrations);
    migrateDatabase(c, migrations);
    expect(
      tables.map((table) => c.client.prepare(`select * from ${table}`).all()),
    ).toEqual(before);
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      c.client.exec('update question_versions set invalidated_at=1'),
    ).toThrow();
    expect(() =>
      c.client.exec(
        "update question_versions set invalidated_at=1,invalidated_by=999,invalidation_reason='bad'",
      ),
    ).toThrow();
    expect(() =>
      c.client.exec('update issue_reports set resolved_at=1'),
    ).toThrow();
    expect(() =>
      c.client.exec(
        "update issue_reports set resolved_at=1,resolved_by=999,resolution_note='bad'",
      ),
    ).toThrow();
    c.client.exec(
      "update issue_reports set status='confirmed',resolved_at=1,resolved_by=1,resolution_note='valid'; update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='valid'; update study_items set excluded_reason='invalidated',excluded_at=1",
    );
    expect(() => c.client.exec('delete from study_items')).toThrow();
    expect(() => c.client.exec('delete from question_versions')).toThrow();
    expect(() => c.client.exec('delete from users')).toThrow();
  } finally {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
