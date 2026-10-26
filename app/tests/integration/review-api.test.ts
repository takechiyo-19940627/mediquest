import { setupSharedHttpServer } from '../fixtures/http-server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { generateQuestions } from '../../server/services/generation/service';
import { output, sourceText } from '../fixtures/generation';
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'mediquest-review-http-'));
const database = join(directory, 'test.sqlite');
const env = { MEDIQUEST_DB_PATH: database };
const c = openDatabase(env);
migrateDatabase(c, join(root, 'drizzle'));
seedAdministrator(c);
createSource(c, { title: '教材', body: sourceText }, randomUUID());
const run = await generateQuestions(
  { sourceId: 1, requestedCount: 2, title: 'セット', requestKey: randomUUID() },
  { model: 'test', promptVersion: 'v1' },
  async () => ({ kind: 'success', output: output(2) }),
  () => openDatabase(env),
);
const failed = await generateQuestions(
  { sourceId: 1, requestedCount: 1, title: '空', requestKey: randomUUID() },
  { model: 'test', promptVersion: 'v1' },
  async () => ({ kind: 'failed' }),
  () => openDatabase(env),
);
const detail = `/api/admin/sets/${run.setId}`;
const review = (id: number) => `${detail}/versions/${id}/review`;
const put = (id: number, body: unknown) =>
  fetch(review(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('administrator candidate review HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: root,
    port: 3197,
    env: {
      ...env,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3197',
    },
  });
  afterAll(() => {
    try {
      c.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('gets scoped candidates, empty failed set and safe list then confirms concurrently without publication', async () => {
    const response = await fetch(detail);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const set = await response.json();
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates[0].reviewedAt).toBeNull();
    expect(
      (await (await fetch(`/api/admin/sets/${failed.setId}`)).json())
        .candidates,
    ).toEqual([]);
    const page = await (await fetch('/api/admin/sets?limit=1')).json();
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain('answerIds');
    expect(page.nextCursor).not.toBeNull();
    const v = set.candidates[0];
    const input = { fingerprint: v.fingerprint, confirmed: true };
    const responses = await Promise.all([put(v.id, input), put(v.id, input)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results[0]).toEqual(results[1]);
    const after = await (await fetch(detail)).json();
    expect(after).toMatchObject({
      status: 'draft',
      publishedBy: null,
      publishedAt: null,
    });
    expect(after.candidates[0]).toMatchObject({
      reviewedBy: 1,
      reviewedAt: results[0].reviewedAt,
    });
  });
  it('rejects input, foreign version, stale fingerprint and requires quote mismatch acknowledgement', async () => {
    const set = await (await fetch(detail)).json();
    const v = set.candidates[1];
    const input = { fingerprint: v.fingerprint, confirmed: true };
    for (const body of [
      { ...input, reviewedBy: 1 },
      { ...input, confirmed: false },
      { ...input, role: 'admin' },
    ])
      expect((await put(v.id, body)).status).toBe(400);
    expect(
      (await put(v.id, { ...input, fingerprint: 'f'.repeat(64) })).status,
    ).toBe(409);
    expect((await put(999999, input)).status).toBe(404);
    expect(
      (
        await fetch(`/api/admin/sets/${failed.setId}/versions/${v.id}/review`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(404);
    expect((await fetch('/api/admin/sets/0')).status).toBe(400);
    expect((await fetch('/api/admin/sets/999999')).status).toBe(404);
    expect((await fetch('/api/admin/sets?limit=101')).status).toBe(400);
    expect(
      (await put(v.id, { ...input, padding: 'x'.repeat(512 * 1024) })).status,
    ).toBe(413);
    c.client
      .prepare('update question_versions set quote=? where id=?')
      .run('PRIVATE_QUOTE_NOT_IN_SOURCE', v.id);
    const fresh = (await (await fetch(detail)).json()).candidates[1];
    expect(fresh.quoteVerified).toBe(false);
    expect(
      (await put(v.id, { ...input, fingerprint: fresh.fingerprint })).status,
    ).toBe(409);
    expect(
      (
        await put(v.id, {
          ...input,
          fingerprint: fresh.fingerprint,
          acknowledgeQuoteMismatch: true,
        })
      ).status,
    ).toBe(200);
  });
  it('rejects all routes for learner, absent administrator, origin and disabled local mode', async () => {
    const v = (await (await fetch(detail)).json()).candidates[0];
    const probes = () =>
      Promise.all([
        fetch('/api/admin/sets'),
        fetch(detail),
        put(v.id, { fingerprint: v.fingerprint, confirmed: true }),
      ]);
    c.client.exec("update users set role='learner' where id=1");
    expect((await probes()).map((r) => r.status)).toEqual([403, 403, 403]);
    c.client.exec("update users set role='admin' where id=1");
    for (const path of ['/api/admin/sets', detail, review(v.id)])
      expect(
        (
          await fetch(path, {
            method: path.endsWith('/review') ? 'PUT' : 'GET',
            headers: { origin: 'http://untrusted.invalid' },
          })
        ).status,
      ).toBe(403);
    c.client.pragma('foreign_keys = OFF');
    c.client.exec('delete from users where id=1');
    expect((await probes()).map((r) => r.status)).toEqual([403, 403, 403]);
    seedAdministrator(c);
    c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await probes()).map((r) => r.status)).toEqual([403, 403, 403]);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
  });
  it('maps storage errors safely and leaves confirmation unchanged', async () => {
    c.client.exec(
      'update question_versions set reviewed_by=null, reviewed_at=null',
    );
    const v = (await (await fetch(detail)).json()).candidates[0];
    c.client.exec(
      "create trigger review_fail after update on question_versions begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const response = await put(v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/PRIVATE_SQL|sqlite|stack|answerIds/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      (await (await fetch(detail)).json()).candidates[0].reviewedAt,
    ).toBeNull();
    c.client.exec('drop trigger review_fail');
    expect(JSON.stringify(getServerLogs())).not.toMatch(
      /PRIVATE_SQL|PRIVATE_QUOTE_NOT_IN_SOURCE/,
    );
  });
});
