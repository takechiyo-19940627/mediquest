import { describe, it, expect, afterAll } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { fileURLToPath } from 'node:url';
import { getSet, confirmVersion } from '../../server/services/review/service';
import { replaceItems } from '../../server/services/publication/service';
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
  it('rejects a fully reviewed and selected revision with HTTP409 before any publication side effect', async () => {
    const next = await f.generate();
    for (const v of getSet(f.c, next.setId).candidates)
      confirmVersion(f.c, next.setId, v.id, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: false,
      });
    replaceItems(f.c, next.setId, {
      expectedRevision: 0,
      versionIds: getSet(f.c, next.setId).candidates.map((v) => v.id),
    });
    f.c.client
      .prepare(
        'update question_sets set supersedes_set_id=?,supersedes_revision=0 where id=?',
      )
      .run(f.run.setId, next.setId);
    const d = getSet(f.c, next.setId);
    const before = f.c.client
      .prepare('select * from question_sets order by id')
      .all();
    const publishNext = () =>
      fetch(`/api/admin/sets/${next.setId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request(d)),
      });
    f.c.client.exec("update users set role='learner'");
    expect((await publishNext()).status).toBe(403);
    f.c.client.exec("update users set role='admin'");
    const rejected = await publishNext();
    expect(rejected.status).toBe(409);
    expect(rejected.headers.get('cache-control')).toBe('no-store');
    expect(
      f.c.client.prepare('select * from question_sets order by id').all(),
    ).toEqual(before);
    expect(
      f.c.client.prepare('select * from set_revision_requests').all(),
    ).toEqual([]);
    f.c.client
      .prepare(
        'update question_sets set supersedes_set_id=null,supersedes_revision=null where id=?',
      )
      .run(next.setId);
    expect((await publishNext()).status).toBe(201);
    expect((await publishNext()).status).toBe(200);
    expect(
      (
        await fetch(`/api/admin/sets/${next.setId}/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(200);
  });
  it('uses explicit membership in administrative HTTP counts, nullable provenance, review and selection', async () => {
    const next = await f.generate();
    const sharedId = f.ids[0]!;
    const parentId = f.ids[1]!;
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(next.setId, sharedId);
    const derived = f.c.client
      .prepare(
        `insert into question_versions(question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,generation_run_id,derived_from_version_id,created_at)
      select question_id,2,body,choices_json,answer_ids_json,explanation,quote,quote_verified,null,id,created_at from question_versions where id=? returning id`,
      )
      .get(parentId) as { id: number };
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(next.setId, derived.id);
    const path = `/api/admin/sets/${next.setId}`;
    const detail = await (await fetch(path)).json();
    expect(detail.candidates).toHaveLength(5);
    const candidate = detail.candidates.find(
      (v: { id: number }) => v.id === derived.id,
    );
    expect(candidate).toMatchObject({
      generationRunId: null,
      derivedFromVersionId: parentId,
      reviewedAt: null,
    });
    const list = await (await fetch('/api/admin/sets')).json();
    expect(
      list.items.find((s: { id: number }) => s.id === next.setId),
    ).toMatchObject({ candidateCount: 5, reviewedCount: 1 });
    const call = (suffix: string, body: unknown) =>
      fetch(`${path}/${suffix}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const shared = detail.candidates.find(
      (v: { id: number }) => v.id === sharedId,
    );
    expect(
      (
        await call(`versions/${sharedId}/review`, {
          fingerprint: shared.fingerprint,
          confirmed: true,
          acknowledgeQuoteMismatch: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`versions/${derived.id}/review`, {
          fingerprint: candidate.fingerprint,
          confirmed: true,
          acknowledgeQuoteMismatch: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('items', {
          expectedRevision: 0,
          versionIds: [sharedId, derived.id],
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await fetch(path)).json()).items.map(
        (v: { generationStatus: string | null }) => v.generationStatus,
      ),
    ).toEqual(['succeeded', null]);
    expect(
      (await call('items', { expectedRevision: 1, versionIds: [f.ids[2]] }))
        .status,
    ).toBe(404);
    const before = f.c.client
      .prepare('select * from question_versions order by id')
      .all();
    const v = detail.candidates.find((v: { id: number }) => v.id === sharedId);
    expect(
      (
        await call(`versions/${sharedId}/content`, {
          expectedRevision: 1,
          expectedFingerprint: v.fingerprint,
          body: 'changed',
          choices: v.choices,
          answerIds: v.answerIds,
          explanation: v.explanation,
          quote: v.quote,
        })
      ).status,
    ).toBe(409);
    // A source mismatch is a service boundary, not a cross-table CHECK.
    f.c.client.exec(
      "insert into sources(title,body,created_by,created_at) values('foreign','foreign',1,1)",
    );
    f.c.client
      .prepare('update question_sets set source_id=2 where id=?')
      .run(next.setId);
    expect((await fetch(path)).status).toBe(409);
    expect(
      (await call('items', { expectedRevision: 1, versionIds: [sharedId] }))
        .status,
    ).toBe(409);
    f.c.client
      .prepare('update question_sets set source_id=1 where id=?')
      .run(next.setId);
    expect(
      f.c.client.prepare('select * from question_versions order by id').all(),
    ).toEqual(before);
    // Remove fixture sharing so subsequent tests exercise the original set independently.
    f.c.client.prepare('delete from set_items where set_id=?').run(next.setId);
    f.c.client
      .prepare(
        'delete from set_candidates where set_id=? and question_version_id in (?,?)',
      )
      .run(next.setId, sharedId, derived.id);
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
