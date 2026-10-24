import { describe, it, expect, afterAll } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { fileURLToPath } from 'node:url';
import { publicationFixture } from '../fixtures/publication';
const f = await publicationFixture();
const base = `/api/admin/sets/${f.run.setId}`;
const get = async () => (await fetch(base)).json();
const put = (body: unknown) =>
  fetch(`${base}/items`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const publish = (body: unknown) =>
  fetch(`${base}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const request = (detail: { revision: number; publishFingerprint: string }) => ({
  expectedRevision: detail.revision,
  publishFingerprint: detail.publishFingerprint,
  confirmed: true,
});
describe('publication HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3198,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3198',
    },
  });
  afterAll(f.close);
  it('rejects invalid and excessive input, foreign candidates and stale requests with no changes', async () => {
    expect(
      (
        await put({
          expectedRevision: 0,
          versionIds: [f.ids[0]],
          role: 'admin',
        })
      ).status,
    ).toBe(400);
    expect(
      (await put({ expectedRevision: 0, versionIds: [f.ids[0], f.ids[0]] }))
        .status,
    ).toBe(400);
    expect(
      (await publish({ ...request(await get()), confirmed: false })).status,
    ).toBe(400);
    expect(
      (
        await put({
          expectedRevision: 0,
          versionIds: [],
          padding: 'x'.repeat(512 * 1024),
        })
      ).status,
    ).toBe(413);
    expect(
      (await fetch('/api/admin/sets/0/items', { method: 'PUT' })).status,
    ).toBe(400);
    expect(
      (
        await fetch('/api/admin/sets/999999/items', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: 0, versionIds: [] }),
        })
      ).status,
    ).toBe(404);
    const other = await f.generate();
    const otherId = f.c.client
      .prepare('select id from question_versions where generation_run_id=?')
      .get(other.id) as { id: number };
    expect(
      (await put({ expectedRevision: 0, versionIds: [otherId.id] })).status,
    ).toBe(404);
    expect((await get()).revision).toBe(0);
  });
  it('requires local administration at both write boundaries and returns safe storage failures', async () => {
    const publishRequest = request(f.detail());
    const probes = () =>
      Promise.all([
        put({ expectedRevision: 0, versionIds: [f.ids[0]] }),
        publish(publishRequest),
      ]);
    f.c.client.exec("update users set role='learner'");
    expect((await probes()).map((r) => r.status)).toEqual([403, 403]);
    f.c.client.exec("update users set role='admin'");
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    expect((await probes()).map((r) => r.status)).toEqual([403, 403]);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    for (const [path, method] of [
      ['items', 'PUT'],
      ['publish', 'POST'],
    ])
      expect(
        (
          await fetch(`${base}/${path}`, {
            method,
            headers: { origin: 'http://untrusted.invalid' },
          })
        ).status,
      ).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await probes()).map((r) => r.status)).toEqual([403, 403]);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    f.c.client.exec(
      "create trigger fail_items after insert on set_items begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const response = await put({ expectedRevision: 0, versionIds: [f.ids[0]] });
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    expect((await get()).revision).toBe(0);
    f.c.client.exec('drop trigger fail_items');
    expect(JSON.stringify(getServerLogs())).not.toContain('PRIVATE_SQL');
  });
  it('serializes competing selections, selection against publish, and exact concurrent publication replay', async () => {
    const responses = await Promise.all([
      put({ expectedRevision: 0, versionIds: [f.ids[0]] }),
      put({ expectedRevision: 0, versionIds: [f.ids[1]] }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const snapshot = await get();
    expect(snapshot.items).toHaveLength(1);
    const oldRequest = request(snapshot);
    const competing = await Promise.all([
      publish(oldRequest),
      put({ expectedRevision: 1, versionIds: [f.ids[2]] }),
    ]);
    const statuses = competing.map((r) => r.status);
    if (statuses[0] === 201) {
      expect(statuses[1]).toBe(409);
      expect((await get()).items).toEqual(snapshot.items);
    } else {
      expect(statuses).toEqual([409, 200]);
      expect((await get()).items[0].versionId).toBe(f.ids[2]);
    }
    const latest = await get();
    const finalRequest =
      latest.status === 'published' ? oldRequest : request(latest);
    const again = await Promise.all([
      publish(finalRequest),
      publish(finalRequest),
    ]);
    const results = await Promise.all(again.map((r) => r.json()));
    expect(results[0].publishedAt).toBe(results[1].publishedAt);
    expect(results[0].revision).toBe(results[1].revision);
    expect(
      again
        .map((r) => r.status)
        .every((status) => status === 200 || status === 201),
    ).toBe(true);
    const final = await get();
    expect(final.status).toBe('published');
    expect(final.items).toHaveLength(1);
    expect(final.candidates).toHaveLength(3);
    expect(
      (await publish({ ...finalRequest, publishFingerprint: '0'.repeat(64) }))
        .status,
    ).toBe(409);
    expect(
      (await put({ expectedRevision: final.revision, versionIds: [] })).status,
    ).toBe(409);
    const v = final.candidates.find(
      (v: { id: number }) => v.id === final.items[0].versionId,
    );
    expect(
      (
        await fetch(`${base}/versions/${v.id}/review`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fingerprint: v.fingerprint, confirmed: true }),
        })
      ).status,
    ).toBe(409);
    expect((await get()).publishedAt).toBe(final.publishedAt);
  });
});
