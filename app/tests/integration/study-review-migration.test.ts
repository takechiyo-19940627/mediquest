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
// Issue #44 AC-5: 0008 rebuilds study_sessions with mode normal/review and a
// nullable self-referencing parent_session_id. Old sessions, items, answers,
// skips, exclusions, invalidations and reports survive, re-application is a
// no-op, and all references stay valid with enforcement restored.
it('adds parent_session_id as null to existing sessions while retaining answers, skips, exclusions, reports and references on repeated migration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-review-migration-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(directory, 'db.sqlite') });
  try {
    const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const baseline = join(directory, 'baseline');
    mkdirSync(join(baseline, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
    );
    expect(journal.entries[8].tag).toBe('0008_study_session_review');
    // The runner skips migrations not newer than the last applied one.
    expect(journal.entries[8].when).toBeGreaterThan(journal.entries[7].when);
    journal.entries = journal.entries.slice(0, 8);
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
    const columns = () =>
      (c.client.pragma('table_info(study_sessions)') as { name: string }[]).map(
        (column) => column.name,
      );
    expect(columns()).not.toContain('parent_session_id');
    c.client
      .exec(`insert into users(id,display_name,role,created_at) values(1,'管理者','admin',1),(2,'学習者','learner',1);
 insert into sources(id,title,body,created_by,created_at) values(1,'教材','保持する本文',1,1);
 insert into question_sets(id,source_id,title,status,created_by,created_at) values(1,1,'セット','draft',1,1);
 insert into generation_runs(id,requested_by,source_id,set_id,request_key,request_hash,requested_count,model,prompt_version,status,started_at,finished_at) values(1,1,1,1,'key','hash',2,'test','v1','succeeded',1,2);
 insert into questions(id,source_id,status,created_at) values(1,1,'active',1),(2,1,'active',1);
 insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,reviewed_by,reviewed_at,generation_run_id,created_at) values(1,1,1,'本文','[]','[]','解説','引用',0,1,7,1,1),(2,2,1,'本文2','[]','[]','解説2','引用2',0,1,7,1,1);`);
    c.client.exec(
      "update question_sets set status='published',published_at=11,published_by=1,revision=2,publish_request_revision=1,publish_request_fingerprint='hash'; insert into set_items(set_id,question_version_id,position) values(1,1,0),(1,2,1)",
    );
    c.client
      .exec(`insert into study_sessions(id,user_id,set_id,status,mode,start_request_key,started_at,completed_at) values(1,1,1,'completed','normal','old',1,3),(2,2,1,'in_progress','normal','open',4,null);
insert into study_items(id,session_id,question_version_id,position,selected_ids_json,is_correct,answered_at,skipped_at) values(1,1,1,0,'["a"]',1,2,null),(2,1,2,1,null,null,null,null),(3,2,1,0,null,null,null,9),(4,2,2,1,'["b"]',0,5,null);
insert into issue_reports(id,reported_by,question_version_id,study_item_id,message,status,created_at) values(1,1,2,2,'confirmed report','confirmed',2),(2,2,1,3,'open report','open',6);
update issue_reports set resolved_at=8,resolved_by=1,resolution_note='不備' where id=1;
update question_versions set invalidated_at=8,invalidated_by=1,invalidation_reason='不備' where id=2;
update study_items set excluded_reason='invalidated',excluded_at=8 where id=2;`);
    const tables = [
      'users',
      'sources',
      'question_sets',
      'generation_runs',
      'questions',
      'question_versions',
      'set_items',
      'study_sessions',
      'study_items',
      'issue_reports',
    ];
    const snapshot = () =>
      tables.map((table) =>
        c.client.prepare(`select * from ${table} order by id`).all(),
      );
    const before = snapshot().map((rows, index) =>
      tables[index] === 'study_sessions'
        ? rows.map((row) => ({
            ...(row as Record<string, unknown>),
            parent_session_id: null,
          }))
        : rows,
    );
    migrateDatabase(c, migrations);
    const migrated = snapshot();
    expect(migrated).toEqual(before);
    migrateDatabase(c, migrations);
    expect(snapshot()).toEqual(migrated);
    expect(
      c.client.prepare('select count(*) n from __drizzle_migrations').get(),
    ).toEqual({ n: 9 });
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    expect(c.client.pragma('foreign_keys', { simple: true })).toBe(1);
    const column = (
      c.client.pragma('table_info(study_sessions)') as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }[]
    ).find((entry) => entry.name === 'parent_session_id');
    expect(column).toMatchObject({
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
    });
    // The rebuilt table no longer refers to its temporary name.
    const definition = c.client
      .prepare(
        "select sql from sqlite_master where type='table' and name='study_sessions'",
      )
      .get() as { sql: string };
    expect(definition.sql).not.toContain('__new_');
    expect(definition.sql).toContain('parent_session_id');
    // Old constraints still hold; the new ones tie mode and parent together.
    for (const sql of [
      "update study_sessions set mode='bad' where id=1",
      "update study_sessions set mode='review' where id=1",
      'update study_sessions set parent_session_id=2 where id=1',
      "update study_sessions set mode='review',parent_session_id=1 where id=1",
      "insert into study_sessions(user_id,set_id,status,mode,start_request_key,started_at) values(2,1,'in_progress','review','rev',5)",
      "insert into study_sessions(user_id,set_id,status,mode,parent_session_id,start_request_key,started_at) values(2,1,'in_progress','review',999,'rev',5)",
      "insert into study_sessions(user_id,set_id,status,mode,parent_session_id,start_request_key,started_at) values(2,1,'in_progress','normal',2,'rev',5)",
      "insert into study_sessions(user_id,set_id,status,mode,start_request_key,started_at) values(2,1,'in_progress','normal','open',5)",
      'update study_items set session_id=999999 where id=3',
      "update study_sessions set status='bad' where id=2",
    ])
      expect(() => c.client.exec(sql)).toThrow();
    expect(snapshot()).toEqual(migrated);
    // A valid review session references its parent and protects it.
    const child = c.client
      .prepare(
        "insert into study_sessions(user_id,set_id,status,mode,parent_session_id,start_request_key,started_at) values(2,1,'in_progress','review',2,'rev',5) returning id",
      )
      .get() as { id: number };
    expect(child.id).toBe(3);
    expect(
      c.client
        .prepare('select mode,parent_session_id from study_sessions where id=3')
        .get(),
    ).toEqual({ mode: 'review', parent_session_id: 2 });
    expect(() =>
      c.client.exec('delete from study_sessions where id=2'),
    ).toThrow();
    expect(() => c.client.exec('delete from study_items where id=2')).toThrow();
    expect(() => c.client.exec('delete from question_versions')).toThrow();
    expect(() => c.client.exec('delete from users')).toThrow();
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    c.client.exec('delete from study_sessions where id=3');
    expect(snapshot()).toEqual(migrated);
  } finally {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
it('creates parent_session_id on a new database with the full migration set', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-review-migration-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(directory, 'db.sqlite') });
  try {
    migrateDatabase(
      c,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    expect(
      (c.client.pragma('table_info(study_sessions)') as { name: string }[]).map(
        (column) => column.name,
      ),
    ).toContain('parent_session_id');
    expect(c.client.prepare('select * from study_sessions').all()).toEqual([]);
    expect(c.client.pragma('foreign_key_check')).toEqual([]);
    expect(
      c.client
        .prepare(
          "select count(*) n from sqlite_master where name='study_session_user_request_unique'",
        )
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
