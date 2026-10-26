import { setupSharedHttpServer } from '../fixtures/http-server';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
import { confirmVersion, getSet } from '../../server/services/review/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
// Issue #46 HTTP contract: POST /api/admin/sets/:setId/archive with {}.
const f = await catalogFixture();
const PORT = 3207;
type Item = { id: number; position: number; state: string };
type Session = {
  id: number;
  setId: number;
  status: string;
  mode: string;
  parentSessionId: number | null;
  currentItemId: number | null;
  items: Item[];
  statistics: Record<string, unknown>;
};
const json = (
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const archive = (setId: number | string, body: unknown = {}) =>
  fetch(`/api/admin/sets/${setId}/archive`, json(body));
const publish = (setId: number, body: unknown) =>
  fetch(`/api/admin/sets/${setId}/publish`, json(body));
const admin = async (setId: number) =>
  (await fetch(`/api/admin/sets/${setId}`)).json();
const start = (setId: number, key = randomUUID()) =>
  fetch('/api/sessions', json({ setId }, { 'idempotency-key': key }));
const review = (parentId: number, key = randomUUID()) =>
  fetch(
    `/api/sessions/${parentId}/reviews`,
    json({}, { 'idempotency-key': key }),
  );
const answer = (s: number, i: number, selectedIds: string[]) =>
  fetch(`/api/sessions/${s}/items/${i}/answer`, json({ selectedIds }));
const skip = (s: number, i: number) =>
  fetch(`/api/sessions/${s}/items/${i}/skip`, json({}));
const resume = (s: number) => fetch(`/api/sessions/${s}/resume`, json({}));
const getSession = async (s: number): Promise<Session> =>
  (await fetch(`/api/sessions/${s}`)).json();
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
  Object.fromEntries(
    tables.map((table) => [
      table,
      f.c.client.prepare(`select * from ${table} order by id`).all(),
    ]),
  );
const setRow = (id: number) =>
  f.c.client
    .prepare('select * from question_sets where id=?')
    .get(id) as Record<string, unknown>;
// Only question_sets.status/revision of the archived set may differ.
function archivedOnly(before: ReturnType<typeof snapshot>, id: number) {
  const after = snapshot();
  const rows = (s: ReturnType<typeof snapshot>) =>
    (s.question_sets as Record<string, unknown>[]).map((row) =>
      row.id === id ? { ...row, status: undefined, revision: undefined } : row,
    );
  expect(rows(after)).toEqual(rows(before));
  for (const table of tables.filter((t) => t !== 'question_sets'))
    expect(after[table]).toEqual(before[table]);
}
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
// A fresh published set of the fixture source (candidates a/b, answer a).
async function publishedSet() {
  const run = await f.generate();
  for (const v of getSet(f.c, run.setId).candidates)
    confirmVersion(f.c, run.setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    });
  const ids = getSet(f.c, run.setId).candidates.map((v) => v.id);
  replaceItems(f.c, run.setId, { expectedRevision: 0, versionIds: ids });
  const d = getSet(f.c, run.setId);
  const request = {
    expectedRevision: d.revision,
    publishFingerprint: d.publishFingerprint,
    confirmed: true,
  };
  publishSet(f.c, run.setId, request);
  return { id: run.setId, request };
}
// A completed parent on a set whose candidate answers are a (correct) / b.
async function completedParent(setId: number, wrong: string[]) {
  const s: Session = (await (await start(setId)).json()).session;
  let last = s;
  for (const item of s.items) {
    const r = await answer(s.id, item.id, wrong);
    expect(r.status).toBe(200);
    last = (await r.json()).session;
  }
  expect(last.status).toBe('completed');
  return last;
}
function rawStatus(route: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:${PORT}${route}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}
describe('archive HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: PORT,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: `http://127.0.0.1:${PORT}`,
    },
  });
  afterAll(f.close);
  it('rejects malformed input, ids and non-local or non-admin callers without writing', async () => {
    const before = snapshot();
    for (const body of [
      null,
      [],
      'archive',
      { status: 'archived' },
      { userId: 1 },
      { revision: 1 },
      { expectedRevision: 1 },
    ]) {
      const r = await archive(f.run.setId, body);
      expect(r.status).toBe(400);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await r.json()).error.code).toBe('invalid');
    }
    expect((await archive(999999, { userId: 1 })).status).toBe(400);
    for (const id of ['0', 'abc', '1.5', '-1']) {
      expect((await archive(id)).status).toBe(400);
    }
    expect(
      (
        await fetch(`/api/admin/sets/${f.run.setId}/archive`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (await archive(f.run.setId, { padding: 'x'.repeat(512 * 1024) })).status,
    ).toBe(413);
    const missing = await archive(999999);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('missing');
    const draft = await archive(f.draftId);
    expect(draft.status).toBe(409);
    expect((await draft.json()).error.code).toBe('conflict');
    noSecrets(await Promise.all([archive(999999), archive(f.draftId)]));
    // Both write boundaries: learner, missing user, Origin/Host, local mode.
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await archive(f.run.setId)).status).toBe(403);
    expect((await fetch(`/api/admin/sets/${f.run.setId}`)).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    expect((await archive(f.run.setId)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    for (const headers of [
      { origin: 'http://untrusted.invalid' } as Record<string, string>,
      { host: 'untrusted.invalid' },
    ])
      expect(
        await rawStatus(`/api/admin/sets/${f.run.setId}/archive`, headers),
      ).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await archive(f.run.setId)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    expect(snapshot()).toEqual(before);
    expect(setRow(f.run.setId).status).toBe('published');
  });
  it('archives once under concurrent resend, keeps every record, hides the set from learners, refuses new starts and keeps saved sessions usable across restart', async () => {
    // Saved normal (K1) and review (K2) sessions before the stop.
    const k1 = randomUUID();
    const started = await start(f.run.setId, k1);
    expect(started.status).toBe(201);
    const parent: Session = (await started.json()).session;
    expect(parent.items).toHaveLength(2);
    let completed = parent;
    for (const item of parent.items)
      completed = (await (await answer(parent.id, item.id, ['b'])).json())
        .session;
    expect(completed.status).toBe('completed');
    const k2 = randomUUID();
    const created = await review(parent.id, k2);
    expect(created.status).toBe(201);
    const child: Session = (await created.json()).session;
    const publishRequest = {
      expectedRevision: setRow(f.run.setId).publish_request_revision,
      publishFingerprint: setRow(f.run.setId).publish_request_fingerprint,
      confirmed: true,
    };
    expect((await publish(f.run.setId, publishRequest)).status).toBe(200);
    const published = setRow(f.run.setId);
    const before = snapshot();
    const responses = await Promise.all([
      archive(f.run.setId),
      archive(f.run.setId),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    for (const r of responses)
      expect(r.headers.get('cache-control')).toBe('no-store');
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.map((b) => b.replayed).sort()).toEqual([false, true]);
    for (const body of bodies) {
      expect(Object.keys(body).sort()).toEqual(
        [
          'id',
          'status',
          'revision',
          'publishedBy',
          'publishedAt',
          'replayed',
        ].sort(),
      );
      expect(body).toMatchObject({
        id: f.run.setId,
        status: 'archived',
        revision: (published.revision as number) + 1,
        publishedBy: published.published_by,
        publishedAt: published.published_at,
      });
    }
    noSecrets(bodies);
    archivedOnly(before, f.run.setId);
    expect(setRow(f.run.setId)).toMatchObject({
      status: 'archived',
      revision: (published.revision as number) + 1,
      published_by: published.published_by,
      published_at: published.published_at,
      publish_request_revision: published.publish_request_revision,
      publish_request_fingerprint: published.publish_request_fingerprint,
    });
    // A later resend is replayed and the old publish request no longer republishes.
    const archived = snapshot();
    const again = await archive(f.run.setId);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ...bodies[0], replayed: true });
    expect((await publish(f.run.setId, publishRequest)).status).toBe(409);
    expect(
      (
        await fetch(
          `/api/admin/sets/${f.run.setId}/items`,
          json(
            {
              expectedRevision: (published.revision as number) + 1,
              versionIds: [],
            },
            {},
            'PUT',
          ),
        )
      ).status,
    ).toBe(409);
    expect(snapshot()).toEqual(archived);
    // Administration keeps reading the archived set and its fixed selection.
    const detail = await admin(f.run.setId);
    expect(detail).toMatchObject({
      status: 'archived',
      revision: (published.revision as number) + 1,
      publishedAt: published.published_at,
    });
    expect(detail.items.map((i: { versionId: number }) => i.versionId)).toEqual(
      f.ids.slice(0, 2),
    );
    expect(
      (await (await fetch('/api/admin/sets')).json()).items.find(
        (s: { id: number }) => s.id === f.run.setId,
      ).status,
    ).toBe('archived');
    // Learners: not listed, detail 404, new normal 404, new review 409.
    const list = await (await fetch('/api/sets')).json();
    expect(list.items.map((i: { id: number }) => i.id)).not.toContain(
      f.run.setId,
    );
    expect((await fetch(`/api/sets/${f.run.setId}`)).status).toBe(404);
    expect((await start(f.run.setId)).status).toBe(404);
    expect((await review(parent.id)).status).toBe(409);
    // Saved keys replay the saved sessions.
    const replayNormal = await start(f.run.setId, k1);
    expect(replayNormal.status).toBe(200);
    expect(await replayNormal.json()).toEqual({
      session: await getSession(parent.id),
      replayed: true,
    });
    const replayReview = await review(parent.id, k2);
    expect(replayReview.status).toBe(200);
    expect(await replayReview.json()).toEqual({
      session: child,
      replayed: true,
    });
    expect(snapshot()).toEqual(archived);
    // The saved child still works; the parent's grades never change.
    const parentRows = () => ({
      session: f.c.client
        .prepare('select * from study_sessions where id=?')
        .get(parent.id),
      items: f.c.client
        .prepare(
          'select * from study_items where session_id=? order by position',
        )
        .all(parent.id),
    });
    const parentBefore = parentRows();
    const [x, y] = child.items as [Item, Item];
    const item = await (
      await fetch(`/api/sessions/${child.id}/items/${x.id}`)
    ).json();
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    expect((await skip(child.id, x.id)).status).toBe(200);
    expect((await answer(child.id, y.id, ['SECRET_ANSWER'])).status).toBe(200);
    const report = await fetch(
      `/api/sessions/${child.id}/items/${y.id}/reports`,
      json({ message: '不備' }),
    );
    expect(report.status).toBe(201);
    const done = await (await answer(child.id, x.id, ['b'])).json();
    expect(done.session).toMatchObject({
      status: 'completed',
      parentSessionId: parent.id,
      statistics: { correctEligibleCount: 1, eligibleCount: 2 },
    });
    expect((await resume(child.id)).status).toBe(200);
    expect(
      (await (await fetch('/api/sessions')).json()).items
        .map((s: { id: number }) => s.id)
        .sort(),
    ).toEqual([parent.id, child.id].sort());
    expect(parentRows()).toEqual(parentBefore);
    expect((await review(child.id)).status).toBe(409);
    // Restart: the stop and its replay survive.
    await startServer();
    expect(setRow(f.run.setId).status).toBe('archived');
    const afterRestart = await archive(f.run.setId);
    expect(afterRestart.status).toBe(200);
    expect(await afterRestart.json()).toEqual({ ...bodies[0], replayed: true });
    expect((await start(f.run.setId)).status).toBe(404);
    expect(await getSession(child.id)).toEqual(done.session);
    const logs = JSON.stringify(getServerLogs());
    for (const marker of [...privateMarkers, f.database])
      expect(logs).not.toContain(marker);
  });
  it('serializes archive against normal start, review start and a stale publish resend in both orders', async () => {
    // A: archive vs normal start, concurrently.
    const a = await publishedSet();
    const [aArchive, aStart] = await Promise.all([archive(a.id), start(a.id)]);
    expect(aArchive.status).toBe(200);
    expect([201, 404]).toContain(aStart.status);
    if (aStart.status === 201) {
      const s: Session = (await aStart.json()).session;
      expect((await getSession(s.id)).id).toBe(s.id);
      expect((await answer(s.id, s.items[0]!.id, ['a'])).status).toBe(200);
    } else {
      expect(
        f.c.client
          .prepare('select count(*) n from study_sessions where set_id=?')
          .get(a.id),
      ).toEqual({ n: 0 });
    }
    expect(setRow(a.id).status).toBe('archived');
    expect((await start(a.id)).status).toBe(404);
    // B: archive vs review start, concurrently.
    const b = await publishedSet();
    const bParent = await completedParent(b.id, ['b']);
    const [bArchive, bReview] = await Promise.all([
      archive(b.id),
      review(bParent.id),
    ]);
    expect(bArchive.status).toBe(200);
    expect([201, 409]).toContain(bReview.status);
    if (bReview.status === 201) {
      const s: Session = (await bReview.json()).session;
      expect((await getSession(s.id)).parentSessionId).toBe(bParent.id);
    } else {
      expect(
        f.c.client
          .prepare(
            "select count(*) n from study_sessions where set_id=? and mode='review'",
          )
          .get(b.id),
      ).toEqual({ n: 0 });
    }
    expect(setRow(b.id).status).toBe('archived');
    expect((await review(bParent.id)).status).toBe(409);
    // C: archive vs the stored publish request resent concurrently.
    const c = await publishedSet();
    const [cArchive, cPublish] = await Promise.all([
      archive(c.id),
      publish(c.id, c.request),
    ]);
    expect(cArchive.status).toBe(200);
    expect([200, 409]).toContain(cPublish.status);
    expect(setRow(c.id).status).toBe('archived');
    expect((await publish(c.id, c.request)).status).toBe(409);
    expect((await archive(c.id)).status).toBe(200);
    expect((await (await archive(c.id)).json()).replayed).toBe(true);
    // Sequential orders: start first keeps the session; archive first refuses.
    const d = await publishedSet();
    const dStart = await start(d.id);
    expect(dStart.status).toBe(201);
    const dSession: Session = (await dStart.json()).session;
    expect((await archive(d.id)).status).toBe(200);
    expect((await getSession(dSession.id)).id).toBe(dSession.id);
    expect(
      (await answer(dSession.id, dSession.items[0]!.id, ['a'])).status,
    ).toBe(200);
    expect((await start(d.id)).status).toBe(404);
    const e = await publishedSet();
    const eParent = await completedParent(e.id, ['b']);
    expect((await archive(e.id)).status).toBe(200);
    expect((await review(eParent.id)).status).toBe(409);
    expect((await start(e.id)).status).toBe(404);
    expect(
      f.c.client
        .prepare('select count(*) n from study_sessions where set_id=?')
        .get(e.id),
    ).toEqual({ n: 1 });
  });
  it('returns a safe 500 and rolls back when the update fails, and GET paths never write', async () => {
    const g = await publishedSet();
    const before = snapshot();
    f.c.client.exec(
      "create trigger fail_archive before update of status on question_sets when new.status='archived' begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const failed = await archive(g.id);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    const body = await failed.json();
    expect(body.error.code).toBe('internal');
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    noSecrets(body);
    expect(snapshot()).toEqual(before);
    expect(setRow(g.id).status).toBe('published');
    f.c.client.exec('drop trigger fail_archive');
    const ok = await archive(g.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).replayed).toBe(false);
    archivedOnly(before, g.id);
    const archived = snapshot();
    await admin(g.id);
    await fetch('/api/admin/sets');
    await fetch('/api/sets');
    await fetch(`/api/sets/${g.id}`);
    await fetch('/api/sessions');
    expect(snapshot()).toEqual(archived);
    const logs = JSON.stringify(getServerLogs());
    expect(logs).not.toMatch(/PRIVATE_SQL/);
    for (const marker of [...privateMarkers, f.database])
      expect(logs).not.toContain(marker);
  });
});
