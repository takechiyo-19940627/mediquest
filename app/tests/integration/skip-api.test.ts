import { setupSharedHttpServer } from '../fixtures/http-server';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
const f = await catalogFixture(3);
type Item = {
  id: number;
  position: number;
  state: string;
  skippedAt: number | null;
};
type Session = {
  id: number;
  status: string;
  completedAt: number | null;
  currentItemId: number | null;
  items: Item[];
  statistics: Record<string, unknown>;
};
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const path = (s: number, i: number) => `/api/sessions/${s}/items/${i}`;
const skip = (s: number, i: number, body: unknown = {}) =>
  fetch(`${path(s, i)}/skip`, json(body));
const answer = (s: number, i: number, selectedIds: string[]) =>
  fetch(`${path(s, i)}/answer`, json({ selectedIds }));
const resume = (s: number) => fetch(`/api/sessions/${s}/resume`, json({}));
const report = async (s: number, i: number): Promise<number> => {
  const r = await fetch(`${path(s, i)}/reports`, json({ message: '不備' }));
  expect(r.status).toBe(201);
  return (await r.json()).id;
};
const resolve = (reportId: number) =>
  fetch(`/api/admin/reports/${reportId}/resolution`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'confirmed', note: '理由' }),
  });
const create = async (): Promise<Session> =>
  (
    await (
      await fetch(
        '/api/sessions',
        json({ setId: f.run.setId }, { 'idempotency-key': randomUUID() }),
      )
    ).json()
  ).session;
const getSession = async (s: number): Promise<Session> =>
  (await fetch(`/api/sessions/${s}`)).json();
const listed = async (s: number) =>
  (await (await fetch('/api/sessions')).json()).items.find(
    (item: { id: number }) => item.id === s,
  );
const itemRow = (id: number) =>
  f.c.client.prepare('select * from study_items where id=?').get(id) as Record<
    string,
    unknown
  >;
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /feedback|answerIds|answer_ids|isCorrect|is_correct|selectedIds|explanation|quote|choices|body|reviewedBy|generationRun|questionVersion|userId|user_id/,
  );
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
function rawStatus(route: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:3205${route}`,
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
describe('skip HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3205,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3205',
    },
  });
  afterAll(f.close);
  it('skips once under concurrent resend, orders ordinary before skipped in GET and history, survives restart and resume, then answers normally', async () => {
    const s = await create();
    const [a, b, c] = s.items as [Item, Item, Item];
    expect(s.items.map((item) => item.skippedAt)).toEqual([null, null, null]);
    const responses = await Promise.all([skip(s.id, a.id), skip(s.id, a.id)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    for (const r of responses)
      expect(r.headers.get('cache-control')).toBe('no-store');
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(bodies[0].item).toEqual(bodies[1].item);
    expect(bodies[0].session).toEqual(bodies[1].session);
    expect(Object.keys(bodies[0]).sort()).toEqual([
      'item',
      'replayed',
      'session',
    ]);
    expect(bodies[0].item).toEqual({
      id: a.id,
      position: 0,
      skippedAt: expect.any(Number),
    });
    noSecrets(bodies);
    const skippedAt = bodies[0].item.skippedAt as number;
    expect(itemRow(a.id)).toMatchObject({
      skipped_at: skippedAt,
      answered_at: null,
      excluded_at: null,
      excluded_reason: null,
      selected_ids_json: null,
      is_correct: null,
    });
    const after = await getSession(s.id);
    expect(after).toEqual(bodies[0].session);
    expect(after).toMatchObject({
      status: 'in_progress',
      currentItemId: b.id,
      statistics: { unansweredEligibleCount: 3, skippedUnansweredCount: 1 },
    });
    expect(after.items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(after.items[0]).toEqual({
      id: a.id,
      position: 0,
      state: 'unanswered',
      skippedAt,
    });
    const history = await listed(s.id);
    expect(history).toMatchObject({
      currentItemId: b.id,
      statistics: after.statistics,
    });
    expect(Object.keys(history)).not.toContain('items');
    // The item GET keeps its DTO: the skip adds no feedback or grading data.
    const item = await (await fetch(path(s.id, a.id))).json();
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    expect((await skip(s.id, b.id)).status).toBe(200);
    const last = await (await skip(s.id, c.id)).json();
    expect(last.session).toMatchObject({
      status: 'in_progress',
      completedAt: null,
      currentItemId: a.id,
      statistics: { unansweredEligibleCount: 3, skippedUnansweredCount: 3 },
    });
    await startServer();
    const resumed = await (await resume(s.id)).json();
    expect(resumed).toEqual(last.session);
    expect(resumed.items.map((i: Item) => i.skippedAt)).toEqual([
      skippedAt,
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(await getSession(s.id)).toEqual(last.session);
    expect((await listed(s.id)).currentItemId).toBe(a.id);
    // Re-skipping the current first skip replays without rotating the order.
    expect(await (await skip(s.id, a.id)).json()).toEqual({
      item: bodies[0].item,
      session: last.session,
      replayed: true,
    });
    const answered = await (await answer(s.id, a.id, ['SECRET_ANSWER'])).json();
    expect(answered.replayed).toBe(false);
    expect(answered.item.feedback.isCorrect).toBe(true);
    expect(answered.session).toMatchObject({
      status: 'in_progress',
      currentItemId: b.id,
      statistics: { answeredEligibleCount: 1, skippedUnansweredCount: 2 },
    });
    expect(answered.session.items[0]).toEqual({
      id: a.id,
      position: 0,
      state: 'answered',
      skippedAt,
    });
    // A late skip after the answer is rejected and changes nothing.
    const saved = itemRow(a.id);
    const late = await skip(s.id, a.id);
    expect(late.status).toBe(409);
    noSecrets(await late.json());
    expect(itemRow(a.id)).toEqual(saved);
  });
  it('commits exactly one answer when answer and skip race and completes only through answers', async () => {
    const s = await create();
    const [a, b, c] = s.items as [Item, Item, Item];
    const results = await Promise.all([
      answer(s.id, a.id, ['b']),
      skip(s.id, a.id),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    const saved = itemRow(a.id);
    expect(saved).toMatchObject({
      selected_ids_json: '["b"]',
      is_correct: 0,
      answered_at: expect.any(Number),
    });
    if (statuses[1] === 200)
      expect(saved.skipped_at).toEqual(expect.any(Number));
    else expect(saved.skipped_at).toBeNull();
    const item = await (await fetch(path(s.id, a.id))).json();
    expect(item.feedback).toMatchObject({
      selectedIds: ['b'],
      isCorrect: false,
    });
    expect((await answer(s.id, b.id, ['SECRET_ANSWER'])).status).toBe(200);
    // Skipping the last unanswered item keeps it current; no completion.
    const lastSkip = await (await skip(s.id, c.id)).json();
    expect(lastSkip.session).toMatchObject({
      status: 'in_progress',
      completedAt: null,
      currentItemId: c.id,
      statistics: { unansweredEligibleCount: 1, skippedUnansweredCount: 1 },
    });
    expect(await (await resume(s.id)).json()).toMatchObject({
      status: 'in_progress',
      currentItemId: c.id,
    });
    const done = await (await answer(s.id, c.id, ['SECRET_ANSWER'])).json();
    expect(done.session).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
      currentItemId: null,
      statistics: { unansweredEligibleCount: 0, skippedUnansweredCount: 0 },
    });
    expect((await skip(s.id, c.id)).status).toBe(409);
    expect(itemRow(c.id).skipped_at).toBe(lastSkip.item.skippedAt);
  });
  it('rejects spoofed or malformed bodies, cross-session and foreign items, and stopped or invalidated items without writing', async () => {
    const s = await create();
    const other = await create();
    for (const body of [
      { userId: 1 },
      { skippedAt: 1 },
      { selectedIds: ['b'] },
      [],
      null,
      'skip',
    ])
      expect((await skip(s.id, s.items[0]!.id, body)).status).toBe(400);
    expect(
      (
        await fetch(`${path(s.id, s.items[0]!.id)}/skip`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await skip(s.id, s.items[0]!.id, {
          padding: 'x'.repeat(512 * 1024),
        })
      ).status,
    ).toBe(413);
    expect((await fetch('/api/sessions/0/items/1/skip', json({}))).status).toBe(
      400,
    );
    expect(
      (await fetch(`/api/sessions/${s.id}/items/abc/skip`, json({}))).status,
    ).toBe(400);
    // Invalid input is rejected before ownership lookup.
    expect((await skip(999999, s.items[0]!.id, { userId: 1 })).status).toBe(
      400,
    );
    const missing = await skip(999999, s.items[0]!.id);
    expect(missing.status).toBe(404);
    const cross = await skip(s.id, other.items[0]!.id);
    expect(cross.status).toBe(404);
    const crossBody = await cross.json();
    expect(crossBody).toEqual(await missing.json());
    noSecrets(crossBody);
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    f.c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(other.id);
    expect((await skip(other.id, other.items[0]!.id)).status).toBe(404);
    expect(
      f.c.client
        .prepare(
          'select count(*) n from study_items where skipped_at is not null and session_id in (?,?)',
        )
        .get(s.id, other.id),
    ).toEqual({ n: 0 });
    // Stopped: 409, no exclusion or skip saved, order moves past it.
    f.c.client
      .prepare("update questions set status='stopped' where id=?")
      .run(f.detail().candidates[0]!.questionId);
    const before = f.c.client
      .prepare('select * from study_items where session_id=?')
      .all(s.id);
    const stopped = await skip(s.id, s.items[0]!.id);
    expect(stopped.status).toBe(409);
    noSecrets(await stopped.json());
    expect(
      f.c.client
        .prepare('select * from study_items where session_id=?')
        .all(s.id),
    ).toEqual(before);
    expect((await getSession(s.id)).currentItemId).toBe(s.items[1]!.id);
    expect((await skip(s.id, s.items[1]!.id)).status).toBe(200);
    expect(await getSession(s.id)).toMatchObject({
      currentItemId: s.items[2]!.id,
      statistics: { skippedUnansweredCount: 1 },
    });
    // A skipped item later invalidated leaves the order and the skip count,
    // and cannot be skipped again; GET only projects the exclusion.
    f.c.client
      .prepare(
        "update question_versions set invalidated_at=5,invalidated_by=1,invalidation_reason='bad' where id=?",
      )
      .run(f.ids[1]);
    const projected = await getSession(s.id);
    expect(projected).toMatchObject({
      status: 'in_progress',
      currentItemId: s.items[2]!.id,
      statistics: {
        excludedCount: 2,
        eligibleCount: 1,
        unansweredEligibleCount: 1,
        skippedUnansweredCount: 0,
      },
    });
    expect(projected.items[1]).toMatchObject({
      state: 'excluded',
      excludedReason: 'invalidated',
      skippedAt: expect.any(Number),
    });
    const invalidated = await skip(s.id, s.items[1]!.id);
    expect(invalidated.status).toBe(409);
    noSecrets(await invalidated.json());
    expect(
      f.c.client
        .prepare('select excluded_at from study_items where session_id=?')
        .all(s.id),
    ).toEqual([
      { excluded_at: null },
      { excluded_at: null },
      { excluded_at: null },
    ]);
    f.c.client.exec(
      "update questions set status='active'; update question_versions set invalidated_at=null,invalidated_by=null,invalidation_reason=null",
    );
  });
  it('lets a learner skip their own item while local and management boundaries stay closed', async () => {
    const s = await create();
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await skip(s.id, s.items[0]!.id)).status).toBe(200);
    expect((await fetch('/api/admin/sets')).status).toBe(403);
    expect((await fetch('/api/admin/reports')).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    for (const headers of [
      { origin: 'http://bad.invalid' } as Record<string, string>,
      { host: 'bad.invalid' },
    ])
      expect(
        await rawStatus(`${path(s.id, s.items[1]!.id)}/skip`, headers),
      ).toBe(403);
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect((await skip(s.id, s.items[1]!.id)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await skip(s.id, s.items[1]!.id)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    expect(itemRow(s.items[1]!.id).skipped_at).toBeNull();
  });
  it('returns a safe 500 and leaves the item unskipped when the write fails, and GET paths never write', async () => {
    const s = await create();
    f.c.client.exec(
      "create trigger fail_http_skip after update on study_items when new.skipped_at is not null begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const r = await skip(s.id, s.items[0]!.id);
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    expect(body.error.code).toBe('internal');
    noSecrets(body);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    expect(itemRow(s.items[0]!.id).skipped_at).toBeNull();
    expect((await getSession(s.id)).currentItemId).toBe(s.items[0]!.id);
    f.c.client.exec('drop trigger fail_http_skip');
    expect((await skip(s.id, s.items[0]!.id)).status).toBe(200);
    const snapshot = f.c.client.prepare('select * from study_items').all();
    await getSession(s.id);
    await fetch('/api/sessions');
    await fetch(path(s.id, s.items[0]!.id));
    expect(f.c.client.prepare('select * from study_items').all()).toEqual(
      snapshot,
    );
    expect(JSON.stringify(getServerLogs())).not.toMatch(
      /PRIVATE_SQL|SECRET_EXPLANATION|SECRET_QUOTE|SECRET_SOURCE/,
    );
  });
  // Issue #41: a real resolution PUT and skip POST meet over HTTP. The race
  // may land either way (skip first 200, confirmation first 409); both
  // sequential orders are then driven explicitly so each outcome is covered.
  it('excludes the item whichever way confirmation and skip race over HTTP, drops it from the next item and counts, and never writes an answer', async () => {
    const s = await create();
    const [a, b, c] = s.items as [Item, Item, Item];
    const versionOf = (item: Item) =>
      f.c.client
        .prepare(
          'select invalidated_at,invalidated_by,invalidation_reason from question_versions where id=(select question_version_id from study_items where id=?)',
        )
        .get(item.id);
    const confirmed = async (
      r: Awaited<ReturnType<typeof fetch>>,
      reportId: number,
    ): Promise<number> => {
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual({
        id: reportId,
        status: 'confirmed',
        resolvedBy: 1,
        resolvedAt: expect.any(Number),
        resolutionNote: '理由',
        replayed: false,
      });
      return body.resolvedAt;
    };
    // Order-independent invariants once the version is invalidated: GET,
    // history and the item DTO project the exclusion without writing it, the
    // item leaves the next item and the eligible/skipped counts, the answer
    // columns stay null, and a later skip or answer is rejected unchanged.
    const excluded = async (
      item: Item,
      skippedAt: number | null,
      resolvedAt: number,
      next: number | null,
      excludedCount: number,
    ) => {
      expect(versionOf(item)).toEqual({
        invalidated_at: resolvedAt,
        invalidated_by: 1,
        invalidation_reason: '理由',
      });
      const row = itemRow(item.id);
      expect(row).toMatchObject({
        skipped_at: skippedAt,
        answered_at: null,
        selected_ids_json: null,
        is_correct: null,
        excluded_at: null,
        excluded_reason: null,
      });
      const state = await getSession(s.id);
      expect(state).toMatchObject({
        status: 'in_progress',
        currentItemId: next,
        statistics: {
          totalItemCount: 3,
          excludedCount,
          eligibleCount: 3 - excludedCount,
          answeredEligibleCount: 0,
          unansweredEligibleCount: 3 - excludedCount,
          skippedUnansweredCount: 0,
        },
      });
      expect(state.items[item.position]).toEqual({
        id: item.id,
        position: item.position,
        state: 'excluded',
        excludedReason: 'invalidated',
        skippedAt,
      });
      expect(await listed(s.id)).toMatchObject({
        currentItemId: next,
        statistics: state.statistics,
      });
      const dto = await (await fetch(path(s.id, item.id))).json();
      expect(dto).toEqual({
        id: item.id,
        position: item.position,
        state: 'excluded',
        excludedReason: 'invalidated',
      });
      noSecrets([state, dto]);
      const late = await skip(s.id, item.id);
      expect(late.status).toBe(409);
      noSecrets(await late.json());
      expect((await answer(s.id, item.id, ['SECRET_ANSWER'])).status).toBe(409);
      expect(itemRow(item.id)).toEqual(row);
    };
    // 1. Concurrent PUT and POST: the confirmation always lands; the skip is
    //    accepted only if it committed first, and then keeps its timestamp.
    const first = await report(s.id, a.id);
    const [put, raced] = await Promise.all([resolve(first), skip(s.id, a.id)]);
    const resolvedA = await confirmed(put, first);
    expect([200, 409]).toContain(raced.status);
    const racedBody = await raced.json();
    noSecrets(racedBody);
    if (raced.status === 200)
      expect(racedBody).toMatchObject({
        item: { id: a.id, position: 0, skippedAt: expect.any(Number) },
        replayed: false,
      });
    const skippedA: number | null =
      raced.status === 200 ? racedBody.item.skippedAt : null;
    await excluded(a, skippedA, resolvedA, b.id, 1);
    // 2. Skip first, then confirm: the skip stays recorded but the item is
    //    excluded and no longer counted as skipped-unanswered.
    const skipB = await skip(s.id, b.id);
    expect(skipB.status).toBe(200);
    const skippedB: number = (await skipB.json()).item.skippedAt;
    const second = await report(s.id, b.id);
    const resolvedB = await confirmed(await resolve(second), second);
    await excluded(b, skippedB, resolvedB, c.id, 2);
    // 3. Confirm first, then skip: the skip is rejected with 409.
    const third = await report(s.id, c.id);
    const resolvedC = await confirmed(await resolve(third), third);
    await excluded(c, null, resolvedC, null, 3);
    // Resume saves the exclusions and completes; answers were never written.
    expect(await (await resume(s.id)).json()).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
      currentItemId: null,
      statistics: {
        excludedCount: 3,
        eligibleCount: 0,
        unansweredEligibleCount: 0,
        skippedUnansweredCount: 0,
        accuracyStatus: 'no_eligible_items',
      },
    });
    expect(
      f.c.client
        .prepare(
          'select excluded_at,excluded_reason,skipped_at,answered_at,selected_ids_json,is_correct from study_items where session_id=? order by position',
        )
        .all(s.id),
    ).toEqual(
      [
        [resolvedA, skippedA],
        [resolvedB, skippedB],
        [resolvedC, null],
      ].map(([excluded_at, skipped_at]) => ({
        excluded_at,
        excluded_reason: 'invalidated',
        skipped_at,
        answered_at: null,
        selected_ids_json: null,
        is_correct: null,
      })),
    );
    f.c.client.exec(
      'update question_versions set invalidated_at=null,invalidated_by=null,invalidation_reason=null',
    );
  });
});
