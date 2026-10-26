import { GenerationError } from '../../server/services/generation/contract';
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
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import {
  generateQuestions,
  completeGeneration,
} from '../../server/services/generation/service';
import type {
  GenerationOutcome,
  GenerationProvider,
} from '../../server/services/generation/contract';
import { output, sourceText } from '../fixtures/generation';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const folders: string[] = [];
const close: (() => void)[] = [];
const config = { model: 'test-only-model', promptVersion: 'test-v1' };
function fixture(migrate = true) {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-generation-'));
  folders.push(directory);
  const env = { MEDIQUEST_DB_PATH: join(directory, 'test.sqlite') };
  const connection = openDatabase(env);
  close.push(() => {
    if (connection.client.open) connection.close();
  });
  if (migrate) {
    migrateDatabase(connection, migrations);
    seedAdministrator(connection);
    createSource(connection, { title: '教材', body: sourceText }, randomUUID());
  }
  return { connection, connect: () => openDatabase(env), directory };
}
const input = (overrides = {}) => ({
  sourceId: 1,
  requestedCount: 1,
  title: 'セット',
  requestKey: randomUUID(),
  ...overrides,
});
const provider: GenerationProvider = async ({ requestedCount }) => ({
  kind: 'success',
  output: output(requestedCount),
});
afterEach(() => {
  const errors: unknown[] = [];
  for (const dispose of close.splice(0)) {
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const directory of folders.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  vi.restoreAllMocks();
  if (errors.length)
    throw new AggregateError(errors, 'Generation fixture cleanup failed');
});

it('saves consistent unreviewed draft candidates and makes duplicate completion a no-op', async () => {
  const { connection: c, connect } = fixture();
  const request = input({ requestedCount: 2 });
  const run = await generateQuestions(request, config, provider, connect);
  expect(run.status).toBe('succeeded');
  const set = c.client.prepare('SELECT * FROM question_sets').get() as Record<
    string,
    unknown
  >;
  expect(set).toMatchObject({
    id: run.setId,
    source_id: 1,
    created_by: 1,
    status: 'draft',
    published_by: null,
    published_at: null,
  });
  const rows = c.client
    .prepare(
      'SELECT q.source_id, v.* FROM question_versions v JOIN questions q ON q.id=v.question_id',
    )
    .all();
  expect(rows).toHaveLength(2);
  expect(
    c.client
      .prepare(
        'select set_id,question_id,question_version_id from set_candidates order by id',
      )
      .all(),
  ).toEqual([
    { set_id: run.setId, question_id: 1, question_version_id: 1 },
    { set_id: run.setId, question_id: 2, question_version_id: 2 },
  ]);
  for (const row of rows)
    expect(row).toMatchObject({
      source_id: 1,
      version_no: 1,
      generation_run_id: run.id,
      reviewed_by: null,
      reviewed_at: null,
      quote_verified: 1,
    });
  expect(
    completeGeneration(run.id, { kind: 'success', output: output(2) }, connect),
  ).toEqual(run);
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM question_versions').get(),
  ).toEqual({ n: 2 });
  expect(
    await generateQuestions(
      request,
      { model: 'new-model', promptVersion: 'v2' },
      async () => {
        throw new Error('must not call');
      },
      connect,
    ),
  ).toEqual(run);
});
it('keeps one in-flight run/provider across concurrent replays and holds no transaction or connection across provider await', async () => {
  const { connection: c, connect } = fixture();
  let settle!: (result: GenerationOutcome) => void;
  const deferred = new Promise<GenerationOutcome>((resolve) => {
    settle = resolve;
  });
  let calls = 0;
  let openConnections = 0;
  const trackedConnect = () => {
    const connection = connect();
    openConnections++;
    return {
      ...connection,
      close: () => {
        const result = connection.close();
        openConnections--;
        return result;
      },
    };
  };
  const slow: GenerationProvider = async (providerInput) => {
    calls++;
    expect(providerInput).toEqual({ sourceText, requestedCount: 1, ...config });
    return deferred;
  };
  const request = input();
  const original = generateQuestions(request, config, slow, trackedConnect);
  expect(calls).toBe(1);
  expect(openConnections).toBe(0);
  // This is a separate SQLite connection while the provider promise remains unresolved.
  c.client
    .prepare(
      "INSERT INTO users (display_name, role, created_at) VALUES ('独立', 'learner', 0)",
    )
    .run();
  const duplicates = await Promise.all(
    Array.from({ length: 3 }, () =>
      generateQuestions(request, config, slow, trackedConnect),
    ),
  );
  expect(
    duplicates.every(
      (run) => run.status === 'running' && run.id === duplicates[0]?.id,
    ),
  ).toBe(true);
  await expect(
    generateQuestions(
      { ...request, title: '異入力' },
      config,
      slow,
      trackedConnect,
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(calls).toBe(1);
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM generation_runs').get(),
  ).toEqual({ n: 1 });
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM question_sets').get(),
  ).toEqual({ n: 1 });
  settle({ kind: 'success', output: output() });
  expect((await original).status).toBe('succeeded');
  expect(openConnections).toBe(0);
  expect(
    c.client.prepare('select count(*) n from set_candidates').get(),
  ).toEqual({ n: 1 });
});
it.each([
  ['failed', 'provider_failed', async () => ({ kind: 'failed' as const })],
  ['unknown', 'provider_unknown', async () => ({ kind: 'unknown' as const })],
  [
    'unknown',
    'provider_unknown',
    async () => {
      throw new Error('API_KEY_SECRET provider body answer');
    },
  ],
  [
    'failed',
    'invalid_output',
    async () => ({ kind: 'success' as const, output: { questions: [] } }),
  ],
] as const)(
  'preserves material and does not retry %s / %s outcomes',
  async (status, errorCode, failing) => {
    const { connection: c, connect } = fixture();
    const before = c.client.prepare('SELECT * FROM sources').all();
    const log = vi.spyOn(console, 'error');
    const request = input();
    let calls = 0;
    const run = await generateQuestions(
      request,
      config,
      async () => {
        calls++;
        return failing();
      },
      connect,
    );
    expect(run).toMatchObject({ status, errorCode });
    expect(
      await generateQuestions(
        request,
        config,
        async () => {
          calls++;
          return failing();
        },
        connect,
      ),
    ).toEqual(run);
    expect(calls).toBe(1);
    expect(
      completeGeneration(
        run.id,
        { kind: 'success', output: output() },
        connect,
      ),
    ).toEqual(run);
    expect(c.client.prepare('SELECT * FROM sources').all()).toEqual(before);
    expect(
      c.client.prepare('SELECT COUNT(*) AS n FROM question_versions').get(),
    ).toEqual({ n: 0 });
    expect(
      JSON.stringify(c.client.prepare('SELECT * FROM generation_runs').all()),
    ).not.toContain('API_KEY_SECRET');
    expect(log).not.toHaveBeenCalled();
  },
);
it('rolls back partial candidates and success when a later insert fails, keeping earlier generations', async () => {
  const { connection: c, connect } = fixture();
  const existing = await generateQuestions(input(), config, provider, connect);
  c.client.exec(
    "CREATE TRIGGER fail_second BEFORE INSERT ON question_versions WHEN NEW.body='問題2' BEGIN SELECT RAISE(ABORT, 'SECRET_SQL'); END",
  );
  const run = await generateQuestions(
    input({ requestedCount: 2 }),
    config,
    provider,
    connect,
  );
  expect(run).toMatchObject({ status: 'failed', errorCode: 'storage_failed' });
  expect(c.client.prepare('SELECT COUNT(*) AS n FROM questions').get()).toEqual(
    { n: 1 },
  );
  expect(
    c.client.prepare('SELECT generation_run_id FROM question_versions').all(),
  ).toEqual([{ generation_run_id: existing.id }]);
  expect(
    c.client
      .prepare('SELECT status FROM question_sets WHERE id=?')
      .get(run.setId),
  ).toEqual({ status: 'draft' });
});
it('stores quote mismatch as an unreviewed draft rather than rejecting or publishing it', async () => {
  const { connection: c, connect } = fixture();
  const run = await generateQuestions(
    input(),
    config,
    async () => ({
      kind: 'success',
      output: {
        questions: [{ ...output().questions[0], quote: '引用不一致' }],
      },
    }),
    connect,
  );
  expect(run.status).toBe('succeeded');
  expect(
    c.client
      .prepare('SELECT quote_verified, reviewed_by FROM question_versions')
      .get(),
  ).toEqual({ quote_verified: 0, reviewed_by: null });
});
it('rejects missing source, learner, and missing local user before provider execution', async () => {
  const { connection: c, connect } = fixture();
  const forbiddenProvider = vi.fn(provider);
  await expect(
    generateQuestions(
      input({ sourceId: 999 }),
      config,
      forbiddenProvider,
      connect,
    ),
  ).rejects.toMatchObject({ code: 'missing' });
  c.client.prepare("UPDATE users SET role='learner' WHERE id=1").run();
  await expect(
    generateQuestions(input(), config, forbiddenProvider, connect),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const empty = fixture(false);
  migrateDatabase(empty.connection, migrations);
  await expect(
    generateQuestions(input(), config, forbiddenProvider, empty.connect),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(forbiddenProvider).not.toHaveBeenCalled();
});
it('enforces new FK, UNIQUE and state constraints', async () => {
  const { connection: c, connect } = fixture();
  await generateQuestions(input(), config, provider, connect);
  expect(() =>
    c.client.exec("UPDATE generation_runs SET status='invented'"),
  ).toThrow();
  expect(() =>
    c.client.exec('UPDATE generation_runs SET requested_count=11'),
  ).toThrow();
  expect(() => c.client.exec('UPDATE questions SET source_id=99999')).toThrow();
  expect(() =>
    c.client.exec(
      'INSERT INTO generation_runs (requested_by, source_id, set_id, request_key, request_hash, requested_count, model, prompt_version, status, started_at) SELECT requested_by, source_id, set_id, request_key, request_hash, requested_count, model, prompt_version, status, started_at FROM generation_runs',
    ),
  ).toThrow();
});
it('upgrades the previous migrations without changing existing users, material, or request records', () => {
  const { connection: c, directory } = fixture(false);
  const baseline = join(directory, 'baseline');
  mkdirSync(join(baseline, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 2);
  writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(
      join(migrations, `${entry.tag}.sql`),
      join(baseline, `${entry.tag}.sql`),
    );
  migrateDatabase(c, baseline);
  seedAdministrator(c);
  createSource(c, { title: '旧教材', body: sourceText }, randomUUID());
  const tables = ['users', 'sources', 'source_creation_requests'];
  const before = tables.map((table) =>
    c.client.prepare(`SELECT * FROM ${table}`).all(),
  );
  migrateDatabase(c, migrations);
  migrateDatabase(c, migrations);
  expect(
    tables.map((table) => c.client.prepare(`SELECT * FROM ${table}`).all()),
  ).toEqual(before);
});

it('does not save or claim success after administrator permission is revoked during provider execution', async () => {
  const { connection: c, connect } = fixture();
  let settle!: (value: GenerationOutcome) => void;
  const pending = new Promise<GenerationOutcome>((resolve) => {
    settle = resolve;
  });
  const generation = generateQuestions(
    input(),
    config,
    async () => pending,
    connect,
  );
  c.client.prepare("UPDATE users SET role='learner' WHERE id=1").run();
  settle({ kind: 'success', output: output() });
  await expect(generation).rejects.toMatchObject({
    code: 'forbidden',
    message: 'generation_forbidden',
  });
  expect(c.client.prepare('SELECT status FROM generation_runs').get()).toEqual({
    status: 'running',
  });
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM question_versions').get(),
  ).toEqual({ n: 0 });
});
it('keeps running with a fixed storage error when the DB is unavailable after provider completion', async () => {
  const { connection: c, connect } = fixture();
  let calls = 0;
  const unavailableLater = () => {
    if (++calls > 1) throw new Error('SECRET_DB_PATH SQL password');
    return connect();
  };
  await expect(
    generateQuestions(input(), config, provider, unavailableLater),
  ).rejects.toMatchObject({ code: 'storage', message: 'generation_storage' });
  expect(c.client.prepare('SELECT status FROM generation_runs').get()).toEqual({
    status: 'running',
  });
  expect(c.client.prepare('SELECT COUNT(*) AS n FROM questions').get()).toEqual(
    { n: 0 },
  );
});
it('redacts connection close failure without invoking the provider or reporting completion', async () => {
  const { connection: c, connect } = fixture();
  const failingClose = () => {
    const connection = connect();
    return {
      ...connection,
      close: () => {
        connection.close();
        throw new Error('SECRET_CLOSE_PATH');
      },
    };
  };
  const spy = vi.fn(provider);
  await expect(
    generateQuestions(input(), config, spy, failingClose),
  ).rejects.toMatchObject({ code: 'storage', message: 'generation_storage' });
  expect(spy).not.toHaveBeenCalled();
  expect(c.client.prepare('SELECT status FROM generation_runs').get()).toEqual({
    status: 'running',
  });
});

it('resolves settings only for new requests and preserves replay while running or terminal after removal', async () => {
  const { connection: c, connect } = fixture();
  const unavailable = () => {
    throw new GenerationError('unavailable');
  };
  const spy = vi.fn(provider);
  await expect(
    generateQuestions(input(), unavailable, spy, connect),
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect(spy).not.toHaveBeenCalled();
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM generation_runs').get(),
  ).toEqual({ n: 0 });
  expect(
    c.client.prepare('SELECT COUNT(*) AS n FROM question_sets').get(),
  ).toEqual({ n: 0 });
  let settle!: (value: GenerationOutcome) => void;
  const pendingOutput = new Promise<GenerationOutcome>((resolve) => {
    settle = resolve;
  });
  const slow = vi.fn(async () => pendingOutput);
  const request = input();
  const pending = generateQuestions(request, () => config, slow, connect);
  const running = await generateQuestions(request, unavailable, slow, connect);
  expect(running.status).toBe('running');
  settle({ kind: 'success', output: output() });
  const complete = await pending;
  expect(await generateQuestions(request, unavailable, slow, connect)).toEqual(
    complete,
  );
  expect(slow).toHaveBeenCalledTimes(1);
});

it('rolls back every generated row when candidate insertion fails', async () => {
  const { connection: c, connect } = fixture();
  c.client.exec(
    "create trigger fail_candidate before insert on set_candidates when new.question_id=2 begin select raise(abort,'candidate_failure'); end",
  );
  const run = await generateQuestions(
    input({ requestedCount: 2 }),
    config,
    provider,
    connect,
  );
  expect(run).toMatchObject({ status: 'failed', errorCode: 'storage_failed' });
  for (const table of ['questions', 'question_versions', 'set_candidates'])
    expect(c.client.prepare(`select count(*) n from ${table}`).get()).toEqual({
      n: 0,
    });
});
it('rejects changed material identity before storing any generated candidate', async () => {
  const { connection: c, connect } = fixture();
  const run = await generateQuestions(
    input(),
    config,
    async () => {
      createSource(c, { title: '別教材', body: sourceText }, randomUUID());
      c.client.exec('update question_sets set source_id=2');
      return { kind: 'success', output: output() };
    },
    connect,
  );
  expect(run).toMatchObject({ status: 'failed', errorCode: 'storage_failed' });
  for (const table of ['questions', 'question_versions', 'set_candidates'])
    expect(c.client.prepare(`select count(*) n from ${table}`).get()).toEqual({
      n: 0,
    });
});
