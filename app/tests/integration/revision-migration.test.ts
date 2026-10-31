import { mkdtempSync, rmSync, cpSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { getSet } from '../../server/services/review/service';
import { publishSet } from '../../server/services/publication/service';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { legacyMigrations, migrations } from '../fixtures/legacy-migrations';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'revision-migration-'));
  const c = openDatabase({ MEDIQUEST_DB_PATH: join(directory, 'old.sqlite') });
  try {
    migrateDatabase(c, legacyMigrations(directory));
    c.client.exec(`
      insert into users(id,display_name,role,created_at) values(1,'admin','admin',1),(2,'learner','learner',1);
      insert into sources(id,title,body,created_by,created_at) values(1,'source','body',1,1),(2,'other','other',1,2);
      insert into source_creation_requests(created_by,request_key,source_id,request_hash) values(1,'source',1,'source-hash');
      insert into question_sets(id,source_id,title,description,status,created_by,published_by,published_at,revision,publish_request_revision,publish_request_fingerprint,created_at) values(1,1,'set','description','published',1,1,10,3,2,'fingerprint',1),(2,1,'draft','','draft',1,null,null,0,null,null,2);
      insert into generation_runs(id,requested_by,source_id,set_id,request_key,request_hash,requested_count,model,prompt_version,status,started_at,finished_at) values(1,1,1,1,'generation','generation-hash',2,'test','v1','succeeded',1,2);
      insert into questions(id,source_id,status,created_at) values(1,1,'active',1),(2,1,'stopped',1);
      insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,reviewed_by,reviewed_at,invalidated_at,invalidated_by,invalidation_reason,generation_run_id,created_at) values(1,1,1,'body','[{"id":"a","label":"A"}]','["a"]','explain','quote',0,1,7,null,null,null,1,1),(2,2,1,'body2','[]','[]','explain2','quote2',1,1,8,9,1,'invalid',1,2);
      insert into set_items(id,set_id,question_version_id,position) values(1,1,2,0),(2,1,1,1);
      insert into study_sessions(id,user_id,set_id,status,mode,parent_session_id,start_request_key,started_at,completed_at) values(1,2,1,'completed','normal',null,'start',1,8),(2,2,1,'in_progress','review',1,'review',9,null);
      insert into study_items(id,session_id,question_version_id,position,selected_ids_json,is_correct,answered_at,skipped_at,excluded_reason,excluded_at) values(1,1,1,0,'["a"]',1,4,3,null,null),(2,1,2,1,null,null,null,5,'invalidated',9),(3,2,2,0,null,null,null,null,'stopped',10);
      insert into issue_reports(reported_by,question_version_id,study_item_id,message,status,created_at,resolved_by,resolved_at,resolution_note) values(2,2,2,'report','confirmed',6,1,9,'note');
    `);
    // These three tables are rebuilt; deleted IDs must never be reused.
    c.client
      .exec(`insert into question_sets(id,source_id,title,status,created_by,created_at) values(100,1,'deleted','draft',1,1); delete from question_sets where id=100;
      insert into question_versions(id,question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,generation_run_id,created_at) select 100,question_id,2,body,choices_json,answer_ids_json,explanation,quote,quote_verified,generation_run_id,created_at from question_versions where id=1; delete from question_versions where id=100;
      insert into set_items(id,set_id,question_version_id,position) values(100,2,1,0); delete from set_items where id=100;`);
    // Build the old publication fingerprint from the pre-migration columns,
    // independently of the new membership reader. Publication bumped 2 -> 3.
    const oldItems = c.client
      .prepare(
        `select i.position,v.*,q.status question_status,r.status generation_status from set_items i join question_versions v on v.id=i.question_version_id join questions q on q.id=v.question_id join generation_runs r on r.id=v.generation_run_id where i.set_id=1 order by i.position`,
      )
      .all() as {
      position: number;
      id: number;
      question_id: number;
      body: string;
      choices_json: string;
      answer_ids_json: string;
      explanation: string;
      quote: string;
      invalidated_at: number | null;
      reviewed_by: number | null;
      reviewed_at: number | null;
      question_status: string;
      generation_status: string;
    }[];
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const oldFingerprint = (revision: number) =>
      hash([
        1,
        1,
        revision,
        oldItems.map((v) => [
          v.position,
          v.id,
          v.question_id,
          hash([
            v.id,
            v.body,
            (JSON.parse(v.choices_json) as { id: string; label: string }[]).map(
              (c) => [c.id, c.label],
            ),
            JSON.parse(v.answer_ids_json),
            v.explanation,
            v.quote,
          ]),
          v.invalidated_at,
          v.reviewed_by,
          v.reviewed_at,
          v.question_status,
          v.generation_status,
        ]),
      ]);
    c.client
      .prepare(
        'update question_sets set publish_request_fingerprint=? where id=1',
      )
      .run(oldFingerprint(2));
    return {
      c,
      oldFingerprint,
      directory,
      close: () => {
        c.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    c.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
const tables = [
  'users',
  'sources',
  'source_creation_requests',
  'question_sets',
  'generation_runs',
  'questions',
  'question_versions',
  'set_items',
  'study_sessions',
  'study_items',
  'issue_reports',
];
function snapshot(c: ReturnType<typeof openDatabase>) {
  return tables.map((table) =>
    c.client.prepare(`select * from ${table} order by id`).all(),
  );
}
it('backfills once while retaining all data, adopted order, requests, history and deleted high-water IDs', () => {
  const f = fixture();
  try {
    const before = snapshot(f.c).map((rows, index) =>
      rows.map((row) => ({
        ...(row as Record<string, unknown>),
        ...(tables[index] === 'question_sets'
          ? { supersedes_set_id: null, supersedes_revision: null }
          : {}),
        ...(tables[index] === 'question_versions'
          ? { derived_from_version_id: null, manual_created_by: null }
          : {}),
      })),
    );
    const sequences = f.c.client
      .prepare('select * from sqlite_sequence order by name')
      .all();
    migrateDatabase(f.c, migrations);
    expect(snapshot(f.c)).toEqual(before);
    expect(getSet(f.c, 1).publishFingerprint).toBe(f.oldFingerprint(3));
    expect(
      publishSet(f.c, 1, {
        expectedRevision: 2,
        publishFingerprint: f.oldFingerprint(2),
        confirmed: true,
      }),
    ).toMatchObject({ replayed: true, revision: 3, publishedAt: 10 });
    expect(snapshot(f.c)).toEqual(before);

    expect(
      f.c.client
        .prepare(
          "select * from sqlite_sequence where name<>'set_candidates' order by name",
        )
        .all(),
    ).toEqual(sequences);
    const candidates = f.c.client
      .prepare(
        'select set_id,question_id,question_version_id from set_candidates order by question_version_id',
      )
      .all();
    expect(candidates).toEqual([
      { set_id: 1, question_id: 1, question_version_id: 1 },
      { set_id: 1, question_id: 2, question_version_id: 2 },
    ]);
    migrateDatabase(f.c, migrations);
    expect(snapshot(f.c)).toEqual(before);
    expect(
      f.c.client
        .prepare(
          'select set_id,question_id,question_version_id from set_candidates order by question_version_id',
        )
        .all(),
    ).toEqual(candidates);
    expect(
      f.c.client.prepare('select count(*) n from __drizzle_migrations').get(),
    ).toEqual({ n: 10 });
    expect(f.c.client.pragma('foreign_key_check')).toEqual([]);
    for (const table of ['question_sets', 'question_versions', 'set_items'])
      expect(
        f.c.client
          .prepare('select seq from sqlite_sequence where name=?')
          .get(table),
      ).toEqual({ seq: 100 });
    const id = f.c.client
      .prepare(
        "insert into question_sets(source_id,title,status,created_by,created_at) values(1,'next','draft',1,1) returning id",
      )
      .get();
    expect(id).toEqual({ id: 101 });
  } finally {
    f.close();
  }
});
for (const failure of [
  'question material',
  'run material',
  'duplicate question',
  'outside candidate',
  'foreign key',
  'SQL',
])
  it(`rolls back all DDL, data, sequences and journal on ${failure}`, () => {
    const f = fixture();
    try {
      if (failure === 'question material')
        f.c.client.exec('update questions set source_id=2 where id=1');
      if (failure === 'run material')
        f.c.client.exec('update generation_runs set source_id=2');
      if (failure === 'duplicate question')
        f.c.client.exec(
          'update question_versions set question_id=1,version_no=2 where id=2',
        );
      if (failure === 'outside candidate')
        f.c.client.exec('update set_items set set_id=2 where id=1');
      if (failure === 'foreign key') {
        f.c.client.pragma('foreign_keys=OFF');
        f.c.client.exec('update generation_runs set source_id=9999');
        f.c.client.pragma('foreign_keys=ON');
      }
      const before = snapshot(f.c);
      const schema = f.c.client
        .prepare('select * from sqlite_master order by name')
        .all();
      const history = f.c.client
        .prepare('select * from __drizzle_migrations')
        .all();
      const seq = f.c.client
        .prepare('select * from sqlite_sequence order by name')
        .all();
      let folder = migrations;
      if (failure === 'SQL') {
        folder = join(f.directory, 'broken');
        cpSync(migrations, folder, { recursive: true });
        appendFileSync(
          join(folder, '0009_set_candidates_revision_base.sql'),
          '\n--> statement-breakpoint\nINVALID SQL;',
        );
      }
      expect(() => migrateDatabase(f.c, folder)).toThrow();
      expect(snapshot(f.c)).toEqual(before);
      expect(
        f.c.client.prepare('select * from sqlite_master order by name').all(),
      ).toEqual(schema);
      expect(
        f.c.client.prepare('select * from __drizzle_migrations').all(),
      ).toEqual(history);
      expect(
        f.c.client.prepare('select * from sqlite_sequence order by name').all(),
      ).toEqual(seq);
      expect(f.c.client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(f.c.client.inTransaction).toBe(false);
    } finally {
      f.close();
    }
  });
