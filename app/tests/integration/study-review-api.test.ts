import { setupSharedHttpServer } from '../fixtures/http-server';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
// Issue #44 HTTP contract: four published questions (positions 0-3, version
// f.ids[i]) so that a completed parent can mix correct and wrong answers.
const f = await catalogFixture(4, 4);
type Item = {
  id: number;
  position: number;
  state: string;
  skippedAt: number | null;
  excludedReason?: string;
};
type Session = {
  id: number;
  setId: number;
  status: string;
  mode: string;
  parentSessionId: number | null;
  completedAt: number | null;
  currentItemId: number | null;
  items: Item[];
  statistics: Record<string, unknown>;
};
const CORRECT = ['SECRET_ANSWER'];
const WRONG = ['b'];
const sessionKeys = [
  'id',
  'setId',
  'status',
  'mode',
  'parentSessionId',
  'startedAt',
  'completedAt',
  'items',
  'currentItemId',
  'statistics',
].sort();
const json = (
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const review = (parentId: number | string, key: string, body: unknown = {}) =>
  fetch(
    `/api/sessions/${parentId}/reviews`,
    json(body, { 'idempotency-key': key }),
  );
const start = (key = randomUUID()) =>
  fetch(
    '/api/sessions',
    json({ setId: f.run.setId }, { 'idempotency-key': key }),
  );
const answer = (s: number, i: number, selectedIds: string[]) =>
  fetch(`/api/sessions/${s}/items/${i}/answer`, json({ selectedIds }));
const skip = (s: number, i: number) =>
  fetch(`/api/sessions/${s}/items/${i}/skip`, json({}));
const resume = (s: number) => fetch(`/api/sessions/${s}/resume`, json({}));
const getSession = async (s: number): Promise<Session> =>
  (await fetch(`/api/sessions/${s}`)).json();
const listed = async (s: number) =>
  (await (await fetch('/api/sessions')).json()).items.find(
    (item: { id: number }) => item.id === s,
  );
const report = async (s: number, i: number): Promise<number> => {
  const r = await fetch(
    `/api/sessions/${s}/items/${i}/reports`,
    json({ message: '不備' }),
  );
  expect(r.status).toBe(201);
  return (await r.json()).id;
};
const resolve = (reportId: number) =>
  fetch(
    `/api/admin/reports/${reportId}/resolution`,
    json({ decision: 'confirmed', note: '理由' }, {}, 'PUT'),
  );
// A completed parent: answers[i] selects the grade of position i (true =
// correct, false = wrong). Every published item is answered.
async function parent(answers: boolean[]): Promise<Session> {
  const s: Session = (await (await start()).json()).session;
  expect(s.items.length).toBe(answers.length);
  let last: Session = s;
  for (const [index, item] of s.items.entries()) {
    const r = await answer(s.id, item.id, answers[index] ? CORRECT : WRONG);
    expect(r.status).toBe(200);
    last = (await r.json()).session;
  }
  expect(last.status).toBe('completed');
  return last;
}
const sessionRow = (id: number) =>
  f.c.client.prepare('select * from study_sessions where id=?').get(id);
const itemRows = (id: number) =>
  f.c.client
    .prepare('select * from study_items where session_id=? order by position')
    .all(id);
const snapshot = (id: number) => ({
  session: sessionRow(id),
  items: itemRows(id),
});
const counts = () =>
  f.c.client
    .prepare(
      "select (select count(*) from study_sessions) sessions,(select count(*) from study_sessions where mode='review') reviews,(select count(*) from study_items) items",
    )
    .get() as { sessions: number; reviews: number; items: number };
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /feedback|answerIds|answer_ids|isCorrect|is_correct|selectedIds|explanation|quote|choices|body|reviewedBy|generationRun|questionVersion|userId|user_id|startRequestKey|start_request_key/,
  );
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
function rawStatus(route: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:3206${route}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...headers,
        },
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
describe('review start HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3206,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3206',
    },
  });
  afterAll(f.close);
  it('creates one review under concurrent resend, replays by key, keeps keys apart across modes and parents, and exposes only safe DTOs across restart', async () => {
    const p = await parent([true, false, false, false]);
    const before = snapshot(p.id);
    const key = randomUUID();
    const responses = await Promise.all([review(p.id, key), review(p.id, key)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    for (const r of responses)
      expect(r.headers.get('cache-control')).toBe('no-store');
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(bodies[0].session).toEqual(bodies[1].session);
    expect(Object.keys(bodies[0]).sort()).toEqual(['replayed', 'session']);
    const child: Session = bodies[0].session;
    expect(Object.keys(child).sort()).toEqual(sessionKeys);
    expect(child).toMatchObject({
      setId: f.run.setId,
      status: 'in_progress',
      mode: 'review',
      parentSessionId: p.id,
      completedAt: null,
      currentItemId: child.items[0]!.id,
      statistics: {
        totalItemCount: 3,
        eligibleCount: 3,
        unansweredEligibleCount: 3,
        accuracy: 0,
      },
    });
    expect(child.items).toEqual(
      [1, 2, 3].map((position) => ({
        id: expect.any(Number),
        position,
        state: 'unanswered',
        skippedAt: null,
      })),
    );
    noSecrets(bodies);
    expect(counts()).toMatchObject({ reviews: 1 });
    expect(itemRows(child.id)).toEqual(
      [1, 2, 3].map((position) =>
        expect.objectContaining({
          question_version_id: f.ids[position],
          position,
          selected_ids_json: null,
          is_correct: null,
          answered_at: null,
          skipped_at: null,
          excluded_at: null,
        }),
      ),
    );
    expect(snapshot(p.id)).toEqual(before);
    // The child's item DTO is the unanswered allowlist: no parent grade leaks.
    const item = await (
      await fetch(`/api/sessions/${child.id}/items/${child.items[0]!.id}`)
    ).json();
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    expect(JSON.stringify(item)).not.toMatch(
      /feedback|answerIds|isCorrect|explanation|quote|SECRET_EXPLANATION|SECRET_QUOTE/,
    );
    // Same key, another parent; a review key as a normal start; a normal key
    // as a review: all conflicts that create nothing.
    const q = await parent([false, true, true, true]);
    const saved = counts();
    expect((await review(q.id, key)).status).toBe(409);
    expect((await start(key)).status).toBe(409);
    const normalKey = randomUUID();
    expect((await start(normalKey)).status).toBe(201);
    expect((await review(p.id, normalKey)).status).toBe(409);
    expect(counts()).toEqual({
      ...saved,
      sessions: saved.sessions + 1,
      items: saved.items + 4,
    });
    // GET, history and restart agree with the start response.
    const single = await getSession(child.id);
    expect(single).toEqual(child);
    expect(await listed(child.id)).toMatchObject({
      mode: 'review',
      parentSessionId: p.id,
      currentItemId: child.currentItemId,
      statistics: child.statistics,
    });
    expect(await listed(p.id)).toMatchObject({
      mode: 'normal',
      parentSessionId: null,
    });
    await startServer();
    expect(await getSession(child.id)).toEqual(child);
    expect(await (await review(p.id, key)).json()).toEqual({
      session: child,
      replayed: true,
    });
    // Answering, skipping and resuming the child leaves the parent unchanged.
    const [x, y, z] = child.items as [Item, Item, Item];
    expect((await skip(child.id, x.id)).status).toBe(200);
    expect((await answer(child.id, y.id, CORRECT)).status).toBe(200);
    expect((await answer(child.id, z.id, WRONG)).status).toBe(200);
    const done = await (await answer(child.id, x.id, WRONG)).json();
    expect(done.session).toMatchObject({
      status: 'completed',
      parentSessionId: p.id,
      statistics: { correctEligibleCount: 1, eligibleCount: 3 },
    });
    expect((await resume(child.id)).status).toBe(200);
    expect(snapshot(p.id)).toEqual(before);
    // The child can be reviewed again; only the direct parent is stored.
    const again = await review(child.id, randomUUID());
    expect(again.status).toBe(201);
    const grandchild: Session = (await again.json()).session;
    expect(grandchild).toMatchObject({
      mode: 'review',
      parentSessionId: child.id,
    });
    expect(grandchild.items.map((i) => i.position)).toEqual([1, 3]);
    expect((await getSession(grandchild.id)).parentSessionId).toBe(child.id);
    expect(snapshot(p.id)).toEqual(before);
  });
  it('rejects spoofed, malformed or oversize input, incomplete, foreign or missing parents, and all-correct parents without writing', async () => {
    const open: Session = (await (await start()).json()).session;
    const done = await parent([true, false, true, true]);
    const saved = counts();
    expect((await review(open.id, randomUUID())).status).toBe(409);
    for (const body of [
      { userId: 1 },
      { parentSessionId: done.id },
      { versionIds: [f.ids[0]] },
      { isCorrect: false },
      { setId: f.run.setId },
      [],
      null,
      'review',
    ]) {
      const r = await review(done.id, randomUUID(), body);
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe('invalid');
    }
    expect(
      (
        await fetch(`/api/sessions/${done.id}/reviews`, {
          method: 'POST',
          headers: {
            'content-type': 'text/plain',
            'idempotency-key': randomUUID(),
          },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (await review(done.id, randomUUID(), { padding: 'x'.repeat(512 * 1024) }))
        .status,
    ).toBe(413);
    expect((await review(done.id, 'not-a-uuid')).status).toBe(400);
    expect(
      (await fetch(`/api/sessions/${done.id}/reviews`, json({}))).status,
    ).toBe(400);
    expect((await review(0, randomUUID())).status).toBe(400);
    expect((await review('abc', randomUUID())).status).toBe(400);
    // Invalid input is rejected before the ownership lookup.
    expect((await review(999999, randomUUID(), { userId: 1 })).status).toBe(
      400,
    );
    const missing = await review(999999, randomUUID());
    expect(missing.status).toBe(404);
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    f.c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(done.id);
    const foreign = await review(done.id, randomUUID());
    expect(foreign.status).toBe(404);
    const missingBody = await missing.json();
    expect(await foreign.json()).toEqual(missingBody);
    noSecrets(missingBody);
    f.c.client
      .prepare('update study_sessions set user_id=1 where id=?')
      .run(done.id);
    expect(counts()).toEqual(saved);
    const perfect = await parent([true, true, true, true]);
    const after = counts();
    const empty = await review(perfect.id, randomUUID());
    expect(empty.status).toBe(409);
    noSecrets(await empty.json());
    expect(counts()).toEqual(after);
  });
  it('lets a learner review their own session while local and management boundaries stay closed', async () => {
    const p = await parent([false, true, true, true]);
    f.c.client.exec("update users set role='learner' where id=1");
    const r = await review(p.id, randomUUID());
    expect(r.status).toBe(201);
    expect((await r.json()).session.parentSessionId).toBe(p.id);
    expect((await fetch('/api/admin/sets')).status).toBe(403);
    expect((await fetch('/api/admin/reports')).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    const saved = counts();
    for (const headers of [
      { origin: 'http://bad.invalid' } as Record<string, string>,
      { host: 'bad.invalid' },
    ])
      expect(await rawStatus(`/api/sessions/${p.id}/reviews`, headers)).toBe(
        403,
      );
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect((await review(p.id, randomUUID())).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await review(p.id, randomUUID())).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    expect(counts()).toEqual(saved);
  });
  // Issue #44: a real resolution PUT and review POST meet over HTTP. Whichever
  // lands first, the invalidated version is excluded from the review; both
  // sequential orders are then driven explicitly, including an empty target.
  it('excludes the invalidated version whichever way confirmation and review race, and rejects an empty target after confirmation', async () => {
    const p1 = await parent([true, false, false, true]);
    const wrong1 = p1.items[1]!;
    const first = await report(p1.id, wrong1.id);
    const [put, raced] = await Promise.all([
      resolve(first),
      review(p1.id, randomUUID()),
    ]);
    expect(put.status).toBe(200);
    expect(raced.status).toBe(201);
    const child1: Session = (await raced.json()).session;
    const state1 = await getSession(child1.id);
    // Either the review saw the invalidation (one item) or it did not (two
    // items, position 1 projected as excluded); position 2 is the only target.
    expect(
      state1.items
        .filter((i) => i.state === 'unanswered')
        .map((i) => i.position),
    ).toEqual([2]);
    expect(state1.statistics).toMatchObject({
      eligibleCount: 1,
      unansweredEligibleCount: 1,
      excludedCount: state1.items.length - 1,
    });
    for (const item of state1.items.filter((i) => i.position === 1))
      expect(item).toMatchObject({
        state: 'excluded',
        excludedReason: 'invalidated',
      });
    expect(state1.currentItemId).toBe(
      state1.items.find((i) => i.position === 2)!.id,
    );
    expect(await listed(child1.id)).toMatchObject({
      parentSessionId: p1.id,
      statistics: state1.statistics,
    });
    noSecrets(state1);
    // Review first, then confirm: the child keeps the row and projects the
    // exclusion; new reviews of the parent no longer include that version.
    const p2 = await parent([true, false, false]);
    const r2 = await review(p2.id, randomUUID());
    expect(r2.status).toBe(201);
    const child2: Session = (await r2.json()).session;
    expect(child2.items.map((i) => i.position)).toEqual([2, 3]);
    const second = await report(p2.id, p2.items[1]!.id);
    expect((await resolve(second)).status).toBe(200);
    const state2 = await getSession(child2.id);
    expect(state2.items[0]).toMatchObject({
      position: 2,
      state: 'excluded',
      excludedReason: 'invalidated',
    });
    expect(state2).toMatchObject({
      status: 'in_progress',
      currentItemId: child2.items[1]!.id,
      statistics: { eligibleCount: 1, excludedCount: 1 },
    });
    expect(
      itemRows(child2.id).map(
        (row) => (row as { excluded_at: unknown }).excluded_at,
      ),
    ).toEqual([null, null]);
    const later: Session = (await (await review(p2.id, randomUUID())).json())
      .session;
    expect(later.items.map((i) => i.position)).toEqual([3]);
    // Confirm first, then review: the only wrong answer is invalidated, so
    // there is no target and no session is created.
    const p3 = await parent([true, false]);
    const third = await report(p3.id, p3.items[1]!.id);
    expect((await resolve(third)).status).toBe(200);
    const saved = counts();
    const empty = await review(p3.id, randomUUID());
    expect(empty.status).toBe(409);
    expect(counts()).toEqual(saved);
    expect(JSON.stringify(getServerLogs())).not.toMatch(
      /SECRET_EXPLANATION|SECRET_QUOTE|SECRET_SOURCE/,
    );
    f.c.client.exec(
      'update question_versions set invalidated_at=null,invalidated_by=null,invalidation_reason=null',
    );
  });
  it('replays saved reviews of an archived set but refuses new ones, and returns a safe 500 with full rollback when the item insert fails', async () => {
    const p = await parent([false, true, true, false]);
    const key = randomUUID();
    const created = await review(p.id, key);
    expect(created.status).toBe(201);
    const child: Session = (await created.json()).session;
    const saved = counts();
    f.c.client
      .prepare("update question_sets set status='archived' where id=?")
      .run(f.run.setId);
    const replay = await review(p.id, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ session: child, replayed: true });
    const refused = await review(p.id, randomUUID());
    expect(refused.status).toBe(409);
    noSecrets(await refused.json());
    expect((await getSession(child.id)).parentSessionId).toBe(p.id);
    f.c.client
      .prepare("update question_sets set status='published' where id=?")
      .run(f.run.setId);
    expect(counts()).toEqual(saved);
    const before = snapshot(p.id);
    f.c.client.exec(
      "create trigger fail_http_review after insert on study_items when new.position=3 begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const failed = await review(p.id, randomUUID());
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    const body = await failed.json();
    expect(body.error.code).toBe('internal');
    noSecrets(body);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    expect(counts()).toEqual(saved);
    expect(snapshot(p.id)).toEqual(before);
    expect(await getSession(child.id)).toEqual(child);
    f.c.client.exec('drop trigger fail_http_review');
    expect((await review(p.id, randomUUID())).status).toBe(201);
    // GET paths never write.
    const all = f.c.client.prepare('select * from study_items').all();
    await getSession(child.id);
    await fetch('/api/sessions');
    await fetch(`/api/sessions/${child.id}/items/${child.items[0]!.id}`);
    expect(f.c.client.prepare('select * from study_items').all()).toEqual(all);
    const logs = JSON.stringify(getServerLogs());
    expect(logs).not.toMatch(/PRIVATE_SQL/);
    for (const marker of [...privateMarkers, f.database])
      expect(logs).not.toContain(marker);
  });
});
