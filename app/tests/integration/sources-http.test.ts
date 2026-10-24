import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { request as nodeRequest } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';

const directory = mkdtempSync(join(tmpdir(), 'mediquest-http-SECRET_PATH-'));
const database = join(directory, 'db.sqlite');
const connection = openDatabase({ MEDIQUEST_DB_PATH: database });
migrateDatabase(
  connection,
  fileURLToPath(new URL('../../drizzle', import.meta.url)),
);
seedAdministrator(connection);
const origin = 'http://127.0.0.1:3195';
const path = '/api/admin/sources';
const headers = () => ({
  'content-type': 'application/json',
  'idempotency-key': randomUUID(),
});
async function post(body: unknown, key = randomUUID()) {
  return fetch(path, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

describe('sources over real HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3195,
    env: {
      MEDIQUEST_DB_PATH: database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: origin,
    },
  });
  afterAll(async () => {
    try {
      connection.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('creates, lists without body and retrieves exact text safely as JSON', async () => {
    const body = '\n <script>SECRET_BODY</script> \n';
    const result = await post({ title: ' 教材 ', body });
    expect(result.status).toBe(201);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const { id } = await result.json();
    const list = await (await fetch(path)).json();
    expect(list.items).toContainEqual({
      id,
      title: '教材',
      createdAt: expect.any(Number),
    });
    expect(JSON.stringify(list)).not.toContain('SECRET_BODY');
    expect(Object.keys(list.items[0]).sort()).toEqual([
      'createdAt',
      'id',
      'title',
    ]);
    const detail = await fetch(`${path}/${id}`);
    expect(detail.headers.get('content-type')).toContain('application/json');
    expect(await detail.json()).toMatchObject({
      id,
      title: '教材',
      body,
      createdBy: 1,
    });
  });
  it('atomically handles concurrent identical and conflicting requests', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        post({ title: '同時', body: '同じ' }, key),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      200, 200, 200, 201,
    ]);
    const ids = await Promise.all(
      results.map((result) => result.json().then((body) => body.id)),
    );
    expect(new Set(ids).size).toBe(1);
    expect(
      connection.client
        .prepare('SELECT COUNT(*) AS n FROM sources WHERE title = ?')
        .get('同時'),
    ).toEqual({ n: 1 });
    const conflict = randomUUID();
    const conflictResults = await Promise.all(
      ['a', 'b'].map((body) => post({ title: '競合', body }, conflict)),
    );
    expect(conflictResults.map((result) => result.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      connection.client
        .prepare('SELECT COUNT(*) AS n FROM sources WHERE title = ?')
        .get('競合'),
    ).toEqual({ n: 1 });
  });
  it('bounds paging with stable cursors', async () => {
    const first = await (await fetch(`${path}?limit=1`)).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = await (
      await fetch(`${path}?limit=1&before=${first.nextCursor}`)
    ).json();
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await fetch(`${path}?limit=101`)).status).toBe(400);
  });
  it('rejects invalid input, malformed JSON, type, id, missing source and oversized data', async () => {
    for (const body of [
      null,
      [],
      { title: ' ', body: 'b' },
      { title: 't', body: 'b', createdBy: 9 },
    ])
      expect((await post(body)).status).toBe(400);
    expect((await post({ title: 't', body: 'x'.repeat(100001) })).status).toBe(
      413,
    );
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers: headers(),
          body: '{invalid',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'x',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers: { ...headers(), 'content-type': 'text/plain' },
          body: 'x',
        })
      ).status,
    ).toBe(415);
    for (const id of ['0', '-1', '1.2', '1e2', '9007199254740992'])
      expect((await fetch(`${path}/${id}`)).status).toBe(400);
    expect((await fetch(`${path}/999999`)).status).toBe(404);
  });
  it('enforces a streamed byte limit without trusting Content-Length', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = nodeRequest(
        `${origin}${path}`,
        { method: 'POST', headers: headers() },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.write('{"title":"t","body":"');
      for (let i = 0; i < 9; i++) request.write('x'.repeat(65536));
      request.end('"}');
    });
    expect(status).toBe(413);
  });
  it('rejects browser cross-origin requests and ignores spoofed identity', async () => {
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers: { ...headers(), origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const forgedHostStatus = await new Promise<number>((resolve, reject) => {
      const request = nodeRequest(
        `${origin}${path}`,
        { headers: { host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(forgedHostStatus).toBe(403);
    connection.client
      .prepare("UPDATE users SET role='learner' WHERE id=1")
      .run();
    try {
      for (const url of [path, `${path}/1`])
        expect(
          (
            await fetch(url, {
              headers: { 'x-user-id': '1', 'x-role': 'admin' },
            })
          ).status,
        ).toBe(403);
      expect((await post({ title: 't', body: 'b' })).status).toBe(403);
    } finally {
      connection.client
        .prepare("UPDATE users SET role='admin' WHERE id=1")
        .run();
    }
  });
  it('rejects missing local user without seeding or accepting client identity', async () => {
    const emptyPath = join(directory, 'missing-user.sqlite');
    const empty = openDatabase({ MEDIQUEST_DB_PATH: emptyPath });
    try {
      migrateDatabase(
        empty,
        fileURLToPath(new URL('../../drizzle', import.meta.url)),
      );
    } finally {
      empty.close();
    }
    await startServer({ env: { MEDIQUEST_DB_PATH: emptyPath } });
    try {
      expect(
        (
          await fetch(path, {
            headers: { 'x-user-id': '1', 'x-role': 'admin' },
          })
        ).status,
      ).toBe(403);
      expect((await post({ title: 't', body: 'b' })).status).toBe(403);
    } finally {
      await startServer({ env: { MEDIQUEST_DB_PATH: database } });
    }
  });
  it('fails closed without explicit local mode', async () => {
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: '' } });
    expect((await fetch(path)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
  });
  it('redacts internal errors from responses and captured server logs', async () => {
    connection.client.exec(
      'ALTER TABLE source_creation_requests RENAME TO hidden_requests',
    );
    try {
      const response = await post({ title: 't', body: 'SECRET_ERROR_BODY' });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain('internal');
      for (const marker of [
        'SECRET_ERROR_BODY',
        database,
        'hidden_requests',
        'SQLITE',
      ])
        expect(text).not.toContain(marker);
    } finally {
      connection.client.exec(
        'ALTER TABLE hidden_requests RENAME TO source_creation_requests',
      );
    }
    const logs = JSON.stringify(getServerLogs());
    for (const marker of ['SECRET_BODY', 'SECRET_ERROR_BODY', database])
      expect(logs).not.toContain(marker);
  });
});
