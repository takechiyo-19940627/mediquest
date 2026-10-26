import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { legacyMigrations } from '../fixtures/legacy-migrations';
import { migrateDatabase } from '../../server/db/migrate';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import { copyDatabase } from '../../server/db/backup';
import { openDatabase } from '../../server/db/connection';
import {
  answerStudyItem,
  getSession,
  getStudyItem,
  skipStudyItem,
  startReviewSession,
  startSession,
} from '../../server/services/study/service';
import { listSessions } from '../../server/services/study/history';
import {
  createReport,
  resolveReport,
} from '../../server/services/reports/service';

const root = fileURLToPath(new URL('../../', import.meta.url));
function cli(input: string, output: string, backup = false) {
  return spawnSync(
    process.execPath,
    [
      backup ? 'scripts/db-backup.ts' : 'scripts/db-restore.ts',
      ...(backup ? [output] : [input, output]),
    ],
    {
      cwd: root,
      env: { ...process.env, MEDIQUEST_DB_PATH: input },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
}
function dump(db: Database.Database) {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => [
    name,
    db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]);
}
function failed(result: ReturnType<typeof cli>, backup = false) {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(
    `Database ${backup ? 'backup' : 'restore'} failed\n`,
  );
}
it('round trips all rows, reports, normal/review answers and skips through actual CLIs including committed WAL pages', async () => {
  const f = await catalogFixture(3);
  try {
    const dir = realpathSync(f.directory);
    f.c.client.pragma('journal_mode=WAL');
    f.c.client.pragma('wal_autocheckpoint=0');
    const s = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
    answerStudyItem(f.c, s.id, s.items[0]!.id, { selectedIds: ['b'] });
    skipStudyItem(f.c, s.id, s.items[1]!.id);
    answerStudyItem(f.c, s.id, s.items[1]!.id, {
      selectedIds: ['SECRET_ANSWER'],
    });
    answerStudyItem(f.c, s.id, s.items[2]!.id, {
      selectedIds: ['SECRET_ANSWER'],
    });
    const review = startReviewSession(f.c, s.id, {}, randomUUID()).session;
    answerStudyItem(f.c, review.id, review.items[0]!.id, {
      selectedIds: ['b'],
    });
    const report = createReport(f.c, s.id, s.items[2]!.id, {
      message: 'SECRET_REPORT',
    });
    resolveReport(f.c, report.id, {
      decision: 'confirmed',
      note: 'SECRET_NOTE',
    });
    // Persist all stage-1 data via fixture SQL, with no new operational API.
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(f.draftId, f.ids[0]);
    const derived = f.c.client
      .prepare(
        `insert into question_versions(question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,generation_run_id,derived_from_version_id,created_at)
      select question_id,2,body,choices_json,answer_ids_json,explanation,quote,quote_verified,null,id,created_at from question_versions where id=? returning id`,
      )
      .get(f.ids[1]) as { id: number };
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(f.draftId, derived.id);
    f.c.client
      .prepare(
        'update question_sets set supersedes_set_id=?,supersedes_revision=3 where id=?',
      )
      .run(f.run.setId, f.draftId);
    f.c.client
      .prepare(
        'insert into set_revision_requests(requested_by,request_key,source_set_id,source_revision,request_fingerprint,created_set_id,created_at) values(1,?,?,?,?,?,1)',
      )
      .run('revision', f.run.setId, 3, 'fingerprint', f.draftId);
    const before = dump(f.c.client);
    const originalBytes = readFileSync(f.database);
    expect(statSync(f.database + '-wal').size).toBeGreaterThan(0);
    const backup = join(dir, 'backup.sqlite'),
      restored = join(dir, 'restored.sqlite');
    for (const result of [
      cli(f.database, backup, true),
      cli(backup, restored),
    ]) {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toMatch(/^(Backup|Restore) completed\n$/);
    }
    expect(readFileSync(f.database)).toEqual(originalBytes);
    expect(dump(f.c.client)).toEqual(before);
    const c = openDatabase({ MEDIQUEST_DB_PATH: restored });
    try {
      expect(dump(c.client)).toEqual(before);
      expect(c.client.pragma('integrity_check')).toEqual([
        { integrity_check: 'ok' },
      ]);
      expect(c.client.pragma('foreign_key_check')).toEqual([]);
      expect(getSession(c, s.id)).toEqual(getSession(f.c, s.id));
      expect(getStudyItem(c, s.id, s.items[0]!.id)).toEqual(
        getStudyItem(f.c, s.id, s.items[0]!.id),
      );
      expect(
        listSessions(c, { limit: 20, status: undefined, before: undefined }),
      ).toEqual(
        listSessions(f.c, { limit: 20, status: undefined, before: undefined }),
      );
      c.client.exec("UPDATE sources SET title='independent'");
      expect(dump(f.c.client)).toEqual(before);
    } finally {
      c.close();
    }
    const b = new Database(backup, { readonly: true });
    try {
      expect(dump(b)).toEqual(before);
    } finally {
      b.close();
    }
    for (const p of [backup, restored])
      expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((p) => p.startsWith('.mediquest-'))).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});
it('rejects invalid inputs, schema and destinations with fixed errors and preserves existing data', async () => {
  const f = await catalogFixture();
  try {
    const dir = realpathSync(f.directory),
      good = join(dir, 'good.sqlite');
    expect(cli(f.database, good, true).status).toBe(0);
    const marker = join(dir, 'marker');
    writeFileSync(marker, 'SECRET_EXISTING');
    const link = join(dir, 'link');
    symlinkSync(marker, link);
    const dangling = join(dir, 'dangling');
    symlinkSync(join(dir, 'missing'), dangling);
    const parentLink = join(dir, 'parent-link');
    symlinkSync(dir, parentLink);
    for (const out of [
      marker,
      link,
      dangling,
      f.database,
      good,
      'relative.sqlite',
      join(dir, 'absent', 'out'),
      join(parentLink, 'out'),
    ])
      failed(cli(good, out));
    const sidecarOutput = join(dir, 'sidecar');
    writeFileSync(sidecarOutput + '-wal', 'SECRET_WAL');
    failed(cli(good, sidecarOutput));
    for (const kind of [
      'missing',
      'empty',
      'corrupt',
      'unrelated',
      'future',
      'hash',
      'missing-history',
      'schema',
      'fk',
    ]) {
      const input = join(dir, kind + '.sqlite');
      if (kind === 'empty') writeFileSync(input, '');
      else if (kind === 'corrupt') writeFileSync(input, 'SECRET_CORRUPT');
      else if (kind !== 'missing') {
        if (kind === 'unrelated') {
          const db = new Database(input);
          db.exec('CREATE TABLE unrelated(id)');
          db.close();
        } else {
          expect(cli(good, input).status).toBe(0);
          const db = new Database(input);
          try {
            if (kind === 'future')
              db.exec(
                "INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('SECRET_FUTURE',9999999999999)",
              );
            if (kind === 'hash')
              db.exec("UPDATE __drizzle_migrations SET hash='SECRET_HASH'");
            if (kind === 'missing-history')
              db.exec('DELETE FROM __drizzle_migrations');
            if (kind === 'schema')
              db.exec('ALTER TABLE users ADD COLUMN unknown text');
            if (kind === 'fk') {
              db.pragma('foreign_keys=OFF');
              db.exec('UPDATE sources SET created_by=9999');
            }
          } finally {
            db.close();
          }
        }
      }
      const out = join(dir, 'rejected.sqlite');
      failed(cli(input, out));
      failed(cli(input, out, true), true);
      expect(existsSync(out)).toBe(false);
    }
    failed(cli(link, join(dir, 'out')));
    expect(readFileSync(marker, 'utf8')).toBe('SECRET_EXISTING');
    expect(readFileSync(sidecarOutput + '-wal', 'utf8')).toBe('SECRET_WAL');
    expect(readdirSync(dir).filter((p) => p.startsWith('.mediquest-'))).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});
it('rejects invalid input paths and backup destinations through both CLI entrypoints', async () => {
  const f = await catalogFixture();
  try {
    const dir = realpathSync(f.directory);
    const output = join(dir, 'invalid-input.sqlite');
    for (const input of ['', 'relative.sqlite', ` ${f.database}`]) {
      failed(cli(input, output));
      failed(cli(input, output, true), true);
      expect(existsSync(output)).toBe(false);
    }
    for (const path of [
      f.database,
      'relative.sqlite',
      join(dir, 'absent', 'out'),
    ])
      failed(cli(f.database, path, true), true);
  } finally {
    f.close();
  }
});
it('publishes only once under competing real CLI processes', async () => {
  const f = await catalogFixture();
  try {
    const output = join(realpathSync(f.directory), 'race.sqlite');
    const run = () =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const p = spawn(
            process.execPath,
            ['scripts/db-restore.ts', f.database, output],
            { cwd: root },
          );
          let stdout = '',
            stderr = '';
          p.stdout.on('data', (b) => (stdout += b));
          p.stderr.on('data', (b) => (stderr += b));
          p.on('error', reject);
          p.on('close', (code) => resolve({ code, stdout, stderr }));
        },
      );
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Database restore failed\n',
    });
    const db = new Database(output);
    try {
      expect(dump(db)).toEqual(dump(f.c.client));
    } finally {
      db.close();
    }
  } finally {
    f.close();
  }
});
it('cleans partial writes and closes connections on transfer, verification and close failures', async () => {
  const f = await catalogFixture();
  try {
    const dir = realpathSync(f.directory),
      output = join(dir, 'failed.sqlite');
    for (const stage of ['transfer', 'verification', 'close']) {
      const opened: Database.Database[] = [];
      await expect(
        copyDatabase(f.database, output, {
          open: (p) => {
            const db = new Database(p, { readonly: true });
            opened.push(db);
            if (stage === 'close' && opened.length === 2) {
              const close = db.close.bind(db);
              db.close = () => {
                close();
                throw new Error('SECRET_CLOSE');
              };
            }
            return db;
          },
          backup: async (db, p) => {
            if (stage === 'transfer') {
              writeFileSync(p, 'SECRET_PARTIAL');
              throw new Error('SECRET_TRANSFER');
            }
            await db.backup(p);
            if (stage === 'verification') writeFileSync(p, 'SECRET_BROKEN');
          },
        }),
      ).rejects.toThrow(/^Database /);
      expect(opened.every((db) => !db.open)).toBe(true);
      expect(existsSync(output)).toBe(false);
      expect(
        readdirSync(dir).filter((p) => p.startsWith('.mediquest-')),
      ).toEqual([]);
    }
  } finally {
    f.close();
  }
});
it('preserves a destination created during backup and removes only its own staging files', async () => {
  const f = await catalogFixture();
  try {
    const dir = realpathSync(f.directory);
    const output = join(dir, 'late-destination.sqlite');
    const before = dump(f.c.client);
    await expect(
      copyDatabase(f.database, output, {
        backup: async (db, path) => {
          await db.backup(path);
          writeFileSync(output, 'SECRET_COMPETING_OUTPUT', { flag: 'wx' });
        },
      }),
    ).rejects.toThrow('Database output rejected');
    expect(readFileSync(output, 'utf8')).toBe('SECRET_COMPETING_OUTPUT');
    expect(dump(f.c.client)).toEqual(before);
    expect(readdirSync(dir).filter((p) => p.startsWith('.mediquest-'))).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});
it('fails without success output while the input is exclusively locked', async () => {
  const f = await catalogFixture();
  try {
    const output = join(realpathSync(f.directory), 'locked.sqlite');
    f.c.client.exec('BEGIN EXCLUSIVE');
    try {
      failed(cli(f.database, output));
      expect(existsSync(output)).toBe(false);
    } finally {
      f.c.client.exec('ROLLBACK');
    }
    expect(
      readdirSync(f.directory).filter((p) => p.startsWith('.mediquest-')),
    ).toEqual([]);
  } finally {
    f.close();
  }
});
it('rejects missing and excess CLI arguments without printing paths or stacks', () => {
  for (const script of ['backup', 'restore']) {
    for (const args of [[], ['SECRET_A', 'SECRET_B', 'SECRET_C']]) {
      const result = spawnSync(
        process.execPath,
        [`scripts/db-${script}.ts`, ...args],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(`Database ${script} failed\n`);
    }
  }
});

it('rejects an actual 0008 backup without implicit migration or changing source/output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'revision-old-backup-'));
  const path = join(directory, 'old.sqlite');
  const c = openDatabase({ MEDIQUEST_DB_PATH: path });
  try {
    migrateDatabase(c, legacyMigrations(directory));
    const before = dump(c.client);
    const bytes = readFileSync(path);
    const out = join(directory, 'rejected.sqlite');
    failed(cli(path, out));
    failed(cli(path, out, true), true);
    expect(existsSync(out)).toBe(false);
    expect(readFileSync(path)).toEqual(bytes);
    expect(dump(c.client)).toEqual(before);
    writeFileSync(out, 'existing');
    failed(cli(path, out));
    expect(readFileSync(out, 'utf8')).toBe('existing');
  } finally {
    c.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
