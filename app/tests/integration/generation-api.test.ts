import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, expect, it, describe, inject } from 'vitest';
import {
  fetch,
  setup,
  startServer,
  getServerLogs,
  useTestContext,
} from '@nuxt/test-utils/e2e';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { waitForFileEvent } from '../fixtures/file-event';
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'mediquest-generation-http-'));
const database = join(directory, 'test.sqlite');
const events = join(directory, 'events');
writeFileSync(events, '');
const connection = openDatabase({ MEDIQUEST_DB_PATH: database });
migrateDatabase(connection, join(root, 'drizzle'));
seedAdministrator(connection);
const ids = [
  'ordinary SECRET_SOURCE',
  'SCENARIO_PENDING',
  'SCENARIO_REJECT',
  'SCENARIO_INVALID',
].map(
  (body) => createSource(connection, { title: '教材', body }, randomUUID()).id,
);
const origin = 'http://127.0.0.1:3196';
const count = () => readFileSync(events, 'utf8').split('called').length - 1;
const post = (
  id: number,
  key: string = randomUUID(),
  body: unknown = { title: 'セット', requestedCount: 1 },
  signal?: AbortSignal,
) =>
  fetch(`/api/admin/sources/${id}/generations`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
// This is a test-harness completion deadline, not the provider's timeout contract.
async function settledServerRequest(key: string) {
  if (!readFileSync(events, 'utf8').split('\n').includes(`called:${key}`))
    return;
  await expect
    .poll(
      () =>
        connection.client
          .prepare('SELECT status FROM generation_runs WHERE request_key=?')
          .get(key),
      { timeout: 10000 },
    )
    .toMatchObject({
      status: expect.stringMatching(/^(succeeded|failed|unknown)$/),
    });
}
describe('generation HTTP with test-only transport injection', async () => {
  await setup({
    rootDir: root,
    server: true,
    port: 3196,
    env: {
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: origin,
      MEDIQUEST_DB_PATH: database,
      MEDIQUEST_GENERATION_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'TEST_ONLY_KEY',
      MEDIQUEST_ANTHROPIC_MODEL: 'test-model',
      TEST_GENERATION_EVENTS: events,
    },
    nuxtConfig: {
      alias: {
        '#generation-provider': fileURLToPath(
          new URL('../fixtures/generation-api-provider.ts', import.meta.url),
        ),
      },
    },
  });
  afterAll(() => {
    try {
      connection.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('keeps the test transport in a separate artifact', () => {
    const output = useTestContext().nuxt!.options.nitro.output!.dir!;
    expect(output).not.toBe(inject('mediquestNuxtOutputDir'));
    const entry = readFileSync(join(output, 'server/index.mjs'), 'utf8');
    expect(entry).toBeTruthy();
  });
  it('creates once and returns only safe status metadata, including replay after settings are removed', async () => {
    const key = randomUUID();
    const response = await post(ids[0]!, key);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const run = await response.json();
    expect(run.status).toBe('succeeded');
    const before = count();
    await startServer({
      env: {
        ANTHROPIC_API_KEY: '',
        MEDIQUEST_ANTHROPIC_MODEL: '',
        MEDIQUEST_GENERATION_ENABLED: '',
      },
    });
    const replay = await post(ids[0]!, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      id: run.id,
      replayed: true,
      model: 'test-model',
    });
    const detail = await fetch(run.statusUrl);
    expect(detail.status).toBe(200);
    const text = await detail.text();
    expect(text).toContain('updatedAt');
    for (const secret of ['TEST_ONLY_KEY', 'SECRET_SOURCE', database])
      expect(text).not.toContain(secret);
    const rowCount = connection.client
      .prepare('SELECT COUNT(*) AS n FROM generation_runs')
      .get();
    expect((await post(ids[0]!)).status).toBe(503);
    expect(
      connection.client
        .prepare('SELECT COUNT(*) AS n FROM generation_runs')
        .get(),
    ).toEqual(rowCount);
    expect(count()).toBe(before);
    await startServer({
      env: {
        ANTHROPIC_API_KEY: 'TEST_ONLY_KEY',
        MEDIQUEST_ANTHROPIC_MODEL: 'test-model',
        MEDIQUEST_GENERATION_ENABLED: 'true',
      },
    });
  });
  it('returns 202 for a true in-flight replay, rejects conflicts, and allows GET without a second provider call', async () => {
    const key = randomUUID();
    const id = createSource(
      connection,
      { title: 'pending', body: `SCENARIO_PENDING_DELAYED:${key}` },
      randomUUID(),
    ).id;
    const controller = new AbortController();
    const release = `${events}.${key}.release`;
    const pending = post(id, key, undefined, controller.signal).then(
      (response) => ({ response, error: undefined }),
      (error) => ({ response: undefined, error }),
    );
    try {
      await waitForFileEvent(events, `called:${key}`, controller.signal);
      const duplicate = await post(id, key);
      expect(duplicate.status).toBe(202);
      const run = await duplicate.json();
      expect((await (await fetch(run.statusUrl)).json()).status).toBe(
        'running',
      );
      expect(
        (await post(id, key, { title: 'different', requestedCount: 1 })).status,
      ).toBe(409);
      expect(
        readFileSync(events, 'utf8')
          .split('\n')
          .filter((line) => line === `called:${key}`),
      ).toHaveLength(1);
      writeFileSync(release, 'release');
      const result = await pending;
      expect(result.error).toBeUndefined();
      expect((await result.response!.json()).status).toBe('succeeded');
    } finally {
      controller.abort();
      await pending;
      await settledServerRequest(key);
      rmSync(release, { force: true });
    }
  });
  it('detects a real client socket abort after dispatch and records unknown without retrying', async () => {
    const key = randomUUID();
    const id = createSource(
      connection,
      { title: 'abort', body: `SCENARIO_PENDING:${key}` },
      randomUUID(),
    ).id;
    const controller = new AbortController();
    const req = request(`${origin}/api/admin/sources/${id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    });
    const closed = new Promise<void>((resolve) => req.once('close', resolve));
    req.on('error', () => {});
    req.end(JSON.stringify({ title: 'abort', requestedCount: 1 }));
    try {
      await waitForFileEvent(events, `called:${key}`, controller.signal);
      req.destroy();
      await closed;
      await waitForFileEvent(events, `aborted:${key}`, controller.signal);
      // Provider abort precedes transaction completion; status GET waits on that exact request.
      await expect
        .poll(
          () =>
            connection.client
              .prepare('SELECT status FROM generation_runs WHERE request_key=?')
              .get(key),
          { timeout: 10000 },
        )
        .toEqual({ status: 'unknown' });
      expect(
        (
          await (
            await post(id, key, { title: 'abort', requestedCount: 1 })
          ).json()
        ).status,
      ).toBe('unknown');
      expect(
        readFileSync(events, 'utf8')
          .split('\n')
          .filter((line) => line === `called:${key}`),
      ).toHaveLength(1);
    } finally {
      controller.abort();
      req.destroy();
      await closed;
      await settledServerRequest(key);
    }
  });
  it('settles a dispatched request after an assertion failure before the next request', async () => {
    const key = randomUUID();
    const id = createSource(
      connection,
      { title: 'cleanup', body: `SCENARIO_PENDING:${key}` },
      randomUUID(),
    ).id;
    const controller = new AbortController();
    const pending = post(id, key, undefined, controller.signal).then(
      (response) => ({ response, error: undefined }),
      (error) => ({ response: undefined, error }),
    );
    await expect(
      (async () => {
        try {
          await waitForFileEvent(events, `called:${key}`, controller.signal);
          throw new Error('simulated assertion failure');
        } finally {
          controller.abort();
          await pending;
          await settledServerRequest(key);
        }
      })(),
    ).rejects.toThrow('simulated assertion failure');
    expect(
      connection.client
        .prepare('SELECT status FROM generation_runs WHERE request_key=?')
        .get(key),
    ).toEqual({ status: 'unknown' });
    expect(readFileSync(events, 'utf8').split('\n')).toContain(
      `aborted:${key}`,
    );
    const nextKey = randomUUID();
    const next = await post(ids[0]!, nextKey);
    expect(next.status).toBe(201);
    expect((await next.json()).status).toBe('succeeded');
    expect(
      readFileSync(events, 'utf8')
        .split('\n')
        .filter((line) => line === `called:${key}`),
    ).toHaveLength(1);
  });
  it('returns failed status for explicit refusal and invalid output without leaking provider bodies', async () => {
    for (const id of [ids[2]!, ids[3]!]) {
      const response = await post(id);
      expect(response.status).toBe(201);
      const text = await response.text();
      expect(JSON.parse(text).status).toBe('failed');
      expect(text).not.toContain('TEST_ONLY_SECRET_ERROR');
    }
    expect(JSON.stringify(getServerLogs())).not.toContain('TEST_ONLY_KEY');
  });
  it('checks local administrator and request boundaries on both routes', async () => {
    expect(
      (
        await post(ids[0]!, randomUUID(), {
          title: 't',
          requestedCount: 1,
          model: 'bad',
        })
      ).status,
    ).toBe(400);
    expect((await fetch('/api/admin/generations/0')).status).toBe(400);
    expect((await fetch('/api/admin/generations/999999')).status).toBe(404);
    connection.client.exec("UPDATE users SET role='learner' WHERE id=1");
    try {
      expect((await post(ids[0]!)).status).toBe(403);
      expect((await fetch('/api/admin/generations/1')).status).toBe(403);
    } finally {
      connection.client.exec("UPDATE users SET role='admin' WHERE id=1");
    }
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: '' } });
    try {
      expect((await post(ids[0]!)).status).toBe(403);
      expect((await fetch('/api/admin/generations/1')).status).toBe(403);
    } finally {
      await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    }
  });
  it('leaves a persisted running request unchanged after server restart and never resumes it', async () => {
    const run = connection.client
      .prepare('SELECT * FROM generation_runs LIMIT 1')
      .get() as { id: number; request_key: string; source_id: number };
    connection.client
      .prepare(
        "UPDATE generation_runs SET status='running', finished_at=NULL, error_code=NULL WHERE id=?",
      )
      .run(run.id);
    const before = count();
    await startServer({
      env: { ANTHROPIC_API_KEY: '', MEDIQUEST_GENERATION_ENABLED: '' },
    });
    const replay = await post(run.source_id, run.request_key);
    expect(replay.status).toBe(202);
    expect((await replay.json()).status).toBe('running');
    expect(
      (await (await fetch(`/api/admin/generations/${run.id}`)).json()).status,
    ).toBe('running');
    expect(count()).toBe(before);
    expect(existsSync(events)).toBe(true);
  });
});
