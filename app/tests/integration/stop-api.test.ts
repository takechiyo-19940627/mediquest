import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
import { confirmVersion, getSet } from '../../server/services/review/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
// Issue #50 HTTP contract: POST /api/admin/questions/:questionId/stop with {}.
const f = await catalogFixture();
const PORT = 3209;
type Item = { id: number; position: number; state: string };
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
// The fixture set's versions were rewritten to SECRET_* ids; sets generated
// later by publishedSet() keep the generated choices a (correct) / b.
const CORRECT = ['SECRET_ANSWER'];
const FRESH_CORRECT = ['a'];
const WRONG = ['b'];
const json = (
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const stop = (questionId: number | string, body: unknown = {}) =>
  fetch(`/api/admin/questions/${questionId}/stop`, json(body));
const publish = (setId: number, body: unknown) =>
  fetch(`/api/admin/sets/${setId}/publish`, json(body));
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
const getItem = async (s: number, i: number) =>
  (await fetch(`/api/sessions/${s}/items/${i}`)).json();
const byPosition = (s: Session, position: number) =>
  s.items.find((item) => item.position === position)!.id;
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
const questionStatus = (id: number) =>
  (
    f.c.client.prepare('select status from questions where id=?').get(id) as {
      status: string;
    }
  ).status;
const itemRow = (id: number) =>
  f.c.client.prepare('select * from study_items where id=?').get(id) as Record<
    string,
    unknown
  >;
const sessionRow = (id: number) =>
  f.c.client
    .prepare('select * from study_sessions where id=?')
    .get(id) as Record<string, unknown>;
// Only questions.status of the stopped questions may differ.
function stoppedOnly(before: ReturnType<typeof snapshot>, ids: number[]) {
  const after = snapshot();
  const rows = (s: ReturnType<typeof snapshot>) =>
    (s.questions as Record<string, unknown>[]).map((row) =>
      ids.includes(row.id as number) ? { ...row, status: undefined } : row,
    );
  expect(rows(after)).toEqual(rows(before));
  for (const table of tables.filter((t) => t !== 'questions'))
    expect(after[table]).toEqual(before[table]);
}
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
// A fresh published set of the fixture source (candidates a/b, answer a). Like
// the fixture set it publishes the first two of three candidates, so position i
// is questions[i] and a stopped questions[0] leaves position 1 alone.
async function publishedSet() {
  const run = await f.generate();
  for (const v of getSet(f.c, run.setId).candidates)
    confirmVersion(f.c, run.setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    });
  const candidates = getSet(f.c, run.setId).candidates.slice(0, 2);
  const ids = candidates.map((v) => v.id);
  replaceItems(f.c, run.setId, { expectedRevision: 0, versionIds: ids });
  const d = getSet(f.c, run.setId);
  publishSet(f.c, run.setId, {
    expectedRevision: d.revision,
    publishFingerprint: d.publishFingerprint,
    confirmed: true,
  });
  return {
    id: run.setId,
    questions: candidates.map((v) => v.questionId),
  };
}
async function started(setId: number): Promise<Session> {
  const r = await start(setId);
  expect(r.status).toBe(201);
  return (await r.json()).session;
}
// A completed parent whose every answer is wrong.
async function completedParent(setId: number) {
  const s = await started(setId);
  let last = s;
  for (const item of s.items) {
    const r = await answer(s.id, item.id, WRONG);
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
describe('stop HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: PORT,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: `http://127.0.0.1:${PORT}`,
    },
  });
  afterAll(f.close);
  const q0 = f.detail().candidates[0]!.questionId;
  const q1 = f.detail().candidates[1]!.questionId;
  it('rejects malformed input, ids and non-local or non-admin callers without writing', async () => {
    const before = snapshot();
    for (const body of [
      null,
      [],
      'stop',
      { status: 'stopped' },
      { userId: 1 },
      { reason: 'x' },
      { questionId: q0 },
    ]) {
      const r = await stop(q0, body);
      expect(r.status).toBe(400);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await r.json()).error.code).toBe('invalid');
    }
    expect((await stop(999999, { userId: 1 })).status).toBe(400);
    for (const id of ['0', 'abc', '1.5', '-1']) {
      expect((await stop(id)).status).toBe(400);
    }
    expect(
      (
        await fetch(`/api/admin/questions/${q0}/stop`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect((await stop(q0, { padding: 'x'.repeat(512 * 1024) })).status).toBe(
      413,
    );
    const missing = await stop(999999);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect((await missing.json()).error.code).toBe('missing');
    noSecrets(await Promise.all([stop(999999), stop(999999)]));
    // Both write boundaries: learner, missing user, Origin/Host, local mode.
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await stop(q0)).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    expect((await stop(q0)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    for (const headers of [
      { origin: 'http://untrusted.invalid' } as Record<string, string>,
      { host: 'untrusted.invalid' },
    ])
      expect(await rawStatus(`/api/admin/questions/${q0}/stop`, headers)).toBe(
        403,
      );
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await stop(q0)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    expect(snapshot()).toEqual(before);
    expect(questionStatus(q0)).toBe('active');
  });
  it('stops every version once under concurrent resend, keeps saved answers, excludes the question from catalog, starts, reviews and adoption, and survives restart', async () => {
    // q0 gets a second, unpublished version: the draft set's first candidate is
    // re-parented to q0 as version 2, confirmed and adopted in the draft.
    const v2 = getSet(f.c, f.draftId).candidates[0]!.id;
    f.c.client.transaction(() => {
      f.c.client.pragma('defer_foreign_keys=ON');
      f.c.client
        .prepare(
          'update question_versions set question_id=?,version_no=2 where id=?',
        )
        .run(q0, v2);
      f.c.client
        .prepare(
          'update set_candidates set question_id=? where question_version_id=?',
        )
        .run(q0, v2);
    })();
    const candidate = getSet(f.c, f.draftId).candidates.find(
      (v) => v.id === v2,
    )!;
    confirmVersion(f.c, f.draftId, v2, {
      fingerprint: candidate.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    });
    replaceItems(f.c, f.draftId, { expectedRevision: 0, versionIds: [v2] });
    const draft = getSet(f.c, f.draftId);
    const publishRequest = {
      expectedRevision: draft.revision,
      publishFingerprint: draft.publishFingerprint,
      confirmed: true,
    };
    // Saved sessions before the stop: n1 answered q0 (wrong) and left q1 open;
    // n2 answered q1 and skipped q0; p1 (both wrong) has review r1 (K2); p2 has
    // no review; k1 is a saved normal start key.
    const k1 = randomUUID();
    const n1: Session = (await (await start(f.run.setId, k1)).json()).session;
    expect(n1.items.map((item) => item.position)).toEqual([0, 1]);
    expect((await answer(n1.id, byPosition(n1, 0), WRONG)).status).toBe(200);
    const n2 = await started(f.run.setId);
    expect((await answer(n2.id, byPosition(n2, 1), WRONG)).status).toBe(200);
    expect((await skip(n2.id, byPosition(n2, 0))).status).toBe(200);
    const p1 = await completedParent(f.run.setId);
    const k2 = randomUUID();
    const created = await review(p1.id, k2);
    expect(created.status).toBe(201);
    const r1: Session = (await created.json()).session;
    expect(r1.items.map((item) => item.position)).toEqual([0, 1]);
    const p2 = await completedParent(f.run.setId);
    const n1Before = await getSession(n1.id);
    const n1Feedback = await getItem(n1.id, byPosition(n1, 0));
    expect(n1Feedback.feedback).toMatchObject({
      selectedIds: WRONG,
      isCorrect: false,
    });
    expect(
      await (await fetch(`/api/sets/${f.run.setId}`)).json(),
    ).toMatchObject({ availableQuestionCount: 2, canStart: true });
    const before = snapshot();
    const responses = await Promise.all([stop(q0), stop(q0)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    for (const r of responses)
      expect(r.headers.get('cache-control')).toBe('no-store');
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.map((b) => b.replayed).sort()).toEqual([false, true]);
    for (const body of bodies) {
      expect(Object.keys(body).sort()).toEqual(['id', 'replayed', 'status']);
      expect(body).toMatchObject({ id: q0, status: 'stopped' });
    }
    noSecrets(bodies);
    stoppedOnly(before, [q0]);
    expect(questionStatus(q0)).toBe('stopped');
    expect(questionStatus(q1)).toBe('active');
    // A later resend is replayed and writes nothing.
    const stopped = snapshot();
    const again = await stop(q0);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      id: q0,
      status: 'stopped',
      replayed: true,
    });
    expect(snapshot()).toEqual(stopped);
    // Catalog: listed with one fewer available question; new normal starts
    // carry only q1, new reviews drop q0, saved keys replay the current state.
    const list = await (await fetch('/api/sets')).json();
    expect(
      list.items.find((i: { id: number }) => i.id === f.run.setId),
    ).toMatchObject({ availableQuestionCount: 1 });
    expect(
      await (await fetch(`/api/sets/${f.run.setId}`)).json(),
    ).toMatchObject({ availableQuestionCount: 1, canStart: true });
    const fresh = await started(f.run.setId);
    expect(fresh.items.map((item) => item.position)).toEqual([1]);
    const r2Response = await review(p2.id);
    expect(r2Response.status).toBe(201);
    const r2: Session = (await r2Response.json()).session;
    expect(r2.items.map((item) => item.position)).toEqual([1]);
    const replayNormal = await start(f.run.setId, k1);
    expect(replayNormal.status).toBe(200);
    expect(await replayNormal.json()).toEqual({
      session: await getSession(n1.id),
      replayed: true,
    });
    const replayReview = await review(p1.id, k2);
    expect(replayReview.status).toBe(200);
    const replayed = await replayReview.json();
    expect(replayed).toEqual({
      session: await getSession(r1.id),
      replayed: true,
    });
    expect(replayed.session.items).toEqual([
      {
        id: byPosition(r1, 0),
        position: 0,
        state: 'excluded',
        skippedAt: null,
      },
      {
        id: byPosition(r1, 1),
        position: 1,
        state: 'unanswered',
        skippedAt: null,
      },
    ]);
    // Answered q0 keeps grade and feedback; unanswered q0 is excluded and
    // refuses answer and skip; q1 stays answerable.
    expect(await getSession(n1.id)).toEqual(n1Before);
    expect(await getItem(n1.id, byPosition(n1, 0))).toEqual(n1Feedback);
    const replayAnswer = await answer(n1.id, byPosition(n1, 0), WRONG);
    expect(replayAnswer.status).toBe(200);
    expect((await replayAnswer.json()).replayed).toBe(true);
    expect(await getItem(n2.id, byPosition(n2, 0))).toEqual({
      id: byPosition(n2, 0),
      position: 0,
      state: 'excluded',
    });
    expect(await getSession(n2.id)).toMatchObject({
      status: 'in_progress',
      currentItemId: null,
      statistics: { excludedCount: 1, eligibleCount: 1 },
    });
    for (const r of await Promise.all([
      answer(n2.id, byPosition(n2, 0), WRONG),
      skip(n2.id, byPosition(n2, 0)),
      answer(r1.id, byPosition(r1, 0), CORRECT),
      skip(r1.id, byPosition(r1, 0)),
    ])) {
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe('conflict');
    }
    expect(itemRow(byPosition(n2, 0))).toMatchObject({
      selected_ids_json: null,
      is_correct: null,
      answered_at: null,
      excluded_at: null,
    });
    const r1Done = await answer(r1.id, byPosition(r1, 1), CORRECT);
    expect(r1Done.status).toBe(200);
    expect((await r1Done.json()).session).toMatchObject({
      status: 'completed',
      statistics: { correctEligibleCount: 1, eligibleCount: 1 },
    });
    // GET, catalog and history never write; resume saves the exclusion once and
    // completes the all-excluded session.
    const projected = snapshot();
    await getSession(n2.id);
    await getItem(n2.id, byPosition(n2, 0));
    await fetch('/api/sessions');
    await fetch('/api/sets');
    await fetch(`/api/sets/${f.run.setId}`);
    await fetch(`/api/admin/sets/${f.run.setId}`);
    await fetch('/api/admin/sets');
    expect(snapshot()).toEqual(projected);
    expect(sessionRow(n2.id).completed_at).toBeNull();
    const resumed = await resume(n2.id);
    expect(resumed.status).toBe(200);
    const resumedSession = await resumed.json();
    expect(resumedSession).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
    });
    expect(itemRow(byPosition(n2, 0))).toMatchObject({
      excluded_reason: 'stopped',
      excluded_at: expect.any(Number),
      answered_at: null,
    });
    const saved = snapshot();
    expect(await (await resume(n2.id)).json()).toEqual(resumedSession);
    expect(snapshot()).toEqual(saved);
    // Adoption and publication of q0's unpublished version are refused.
    const adopt = await fetch(
      `/api/admin/sets/${f.draftId}/items`,
      json({ expectedRevision: 1, versionIds: [v2] }, {}, 'PUT'),
    );
    expect(adopt.status).toBe(409);
    expect((await publish(f.draftId, publishRequest)).status).toBe(409);
    expect(
      await (await fetch(`/api/admin/sets/${f.draftId}`)).json(),
    ).toMatchObject({ status: 'draft', revision: 1 });
    expect(snapshot()).toEqual(saved);
    // Restart: the stop and its replay survive; the exclusions stay.
    await startServer();
    expect(questionStatus(q0)).toBe('stopped');
    const afterRestart = await stop(q0);
    expect(afterRestart.status).toBe(200);
    expect(await afterRestart.json()).toEqual({
      id: q0,
      status: 'stopped',
      replayed: true,
    });
    expect(await getSession(n2.id)).toEqual(resumedSession);
    expect((await started(f.run.setId)).items.map((i) => i.position)).toEqual([
      1,
    ]);
    // Stopping q1 as well keeps the set listed with nothing to start.
    expect((await stop(q1)).status).toBe(200);
    expect(
      await (await fetch(`/api/sets/${f.run.setId}`)).json(),
    ).toMatchObject({ availableQuestionCount: 0, canStart: false });
    expect(
      (await (await fetch('/api/sets')).json()).items.map(
        (i: { id: number }) => i.id,
      ),
    ).toContain(f.run.setId);
    const refused = await start(f.run.setId);
    expect(refused.status).toBe(409);
    expect((await review(p2.id)).status).toBe(409);
    expect(await getSession(fresh.id)).toMatchObject({
      status: 'in_progress',
      currentItemId: null,
    });
    expect((await (await resume(fresh.id)).json()).status).toBe('completed');
    const logs = JSON.stringify(getServerLogs());
    for (const marker of [...privateMarkers, f.database])
      expect(logs).not.toContain(marker);
  });
  it('serializes stop against normal start, review start, answer and skip in both orders', async () => {
    // A: stop vs normal start, concurrently. Either order yields a consistent
    // session: two items with q0 projected excluded, or q1 alone.
    const a = await publishedSet();
    const [aStop, aStart] = await Promise.all([
      stop(a.questions[0]!),
      start(a.id),
    ]);
    expect(aStop.status).toBe(200);
    expect(aStart.status).toBe(201);
    const aSession: Session = (await aStart.json()).session;
    expect([[1], [0, 1]]).toContainEqual(
      aSession.items.map((item) => item.position),
    );
    const aNow = await getSession(aSession.id);
    for (const item of aNow.items)
      expect(item.state).toBe(item.position === 0 ? 'excluded' : 'unanswered');
    if (aSession.items.length === 2)
      expect(
        (await answer(aSession.id, byPosition(aSession, 0), FRESH_CORRECT))
          .status,
      ).toBe(409);
    expect(
      (await answer(aSession.id, byPosition(aSession, 1), FRESH_CORRECT))
        .status,
    ).toBe(200);
    expect((await getSession(aSession.id)).status).toBe('completed');
    // B: stop vs review start, concurrently.
    const b = await publishedSet();
    const bParent = await completedParent(b.id);
    const [bStop, bReview] = await Promise.all([
      stop(b.questions[0]!),
      review(bParent.id),
    ]);
    expect(bStop.status).toBe(200);
    expect(bReview.status).toBe(201);
    const bChild: Session = (await bReview.json()).session;
    expect([[1], [0, 1]]).toContainEqual(
      bChild.items.map((item) => item.position),
    );
    for (const item of (await getSession(bChild.id)).items)
      expect(item.state).toBe(item.position === 0 ? 'excluded' : 'unanswered');
    const bAgain = await review(bParent.id);
    expect(bAgain.status).toBe(201);
    expect(
      ((await bAgain.json()).session as Session).items.map(
        (item) => item.position,
      ),
    ).toEqual([1]);
    // C: stop vs answer of q0, concurrently. Transaction order decides: a
    // saved grade stays, a refused answer leaves the columns null; no later
    // grading of the stopped version happens either way.
    const c = await publishedSet();
    const cSession = await started(c.id);
    const cItem = byPosition(cSession, 0);
    const [cStop, cAnswer] = await Promise.all([
      stop(c.questions[0]!),
      answer(cSession.id, cItem, WRONG),
    ]);
    expect(cStop.status).toBe(200);
    expect([200, 409]).toContain(cAnswer.status);
    const cRow = itemRow(cItem);
    if (cAnswer.status === 200) {
      expect(cRow).toMatchObject({
        selected_ids_json: JSON.stringify(WRONG),
        is_correct: 0,
        answered_at: expect.any(Number),
        excluded_at: null,
      });
      expect(await getItem(cSession.id, cItem)).toMatchObject({
        feedback: { selectedIds: WRONG, isCorrect: false },
      });
      expect((await answer(cSession.id, cItem, FRESH_CORRECT)).status).toBe(
        409,
      );
    } else {
      expect(cRow).toMatchObject({
        selected_ids_json: null,
        is_correct: null,
        answered_at: null,
      });
      expect(await getItem(cSession.id, cItem)).toEqual({
        id: cItem,
        position: 0,
        state: 'excluded',
      });
      expect((await answer(cSession.id, cItem, WRONG)).status).toBe(409);
    }
    expect(itemRow(cItem)).toEqual(cRow);
    // D: stop vs skip of q0, concurrently.
    const d = await publishedSet();
    const dSession = await started(d.id);
    const dItem = byPosition(dSession, 0);
    const [dStop, dSkip] = await Promise.all([
      stop(d.questions[0]!),
      skip(dSession.id, dItem),
    ]);
    expect(dStop.status).toBe(200);
    expect([200, 409]).toContain(dSkip.status);
    expect(itemRow(dItem)).toMatchObject({
      skipped_at: dSkip.status === 200 ? expect.any(Number) : null,
      answered_at: null,
      excluded_at: null,
    });
    expect((await skip(dSession.id, dItem)).status).toBe(409);
    expect(await getItem(dSession.id, dItem)).toMatchObject({
      state: 'excluded',
    });
    // Sequential orders. Answer first: the grade and time stay after the stop.
    const e = await publishedSet();
    const eSession = await started(e.id);
    const eItem = byPosition(eSession, 0);
    expect((await answer(eSession.id, eItem, WRONG)).status).toBe(200);
    const eRow = itemRow(eItem);
    expect(eRow).toMatchObject({
      selected_ids_json: JSON.stringify(WRONG),
      is_correct: 0,
      answered_at: expect.any(Number),
    });
    expect((await stop(e.questions[0]!)).status).toBe(200);
    expect(itemRow(eItem)).toEqual(eRow);
    expect(await getItem(eSession.id, eItem)).toMatchObject({
      feedback: { selectedIds: WRONG, isCorrect: false },
    });
    // Stop first: the answer is refused and the columns stay null; GET alone
    // never completes the session, resume does.
    const g = await publishedSet();
    const gSession = await started(g.id);
    const gItem = byPosition(gSession, 0);
    expect(
      (await answer(gSession.id, byPosition(gSession, 1), FRESH_CORRECT))
        .status,
    ).toBe(200);
    expect((await stop(g.questions[0]!)).status).toBe(200);
    const gRefused = await answer(gSession.id, gItem, FRESH_CORRECT);
    expect(gRefused.status).toBe(409);
    expect(itemRow(gItem)).toMatchObject({
      selected_ids_json: null,
      is_correct: null,
      answered_at: null,
      excluded_at: null,
    });
    expect(await getSession(gSession.id)).toMatchObject({
      status: 'in_progress',
      currentItemId: null,
    });
    expect(sessionRow(gSession.id).completed_at).toBeNull();
    expect(await (await resume(gSession.id)).json()).toMatchObject({
      status: 'completed',
      statistics: { correctEligibleCount: 1, eligibleCount: 1 },
    });
    expect(itemRow(gItem)).toMatchObject({
      excluded_reason: 'stopped',
      answered_at: null,
    });
  });
  it('returns a safe 500 and rolls back when the update fails, and GET paths never write', async () => {
    const h = await publishedSet();
    const session = await started(h.id);
    const before = snapshot();
    f.c.client.exec(
      "create trigger fail_stop before update of status on questions when new.status='stopped' begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const failed = await stop(h.questions[0]!);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    const body = await failed.json();
    expect(body.error.code).toBe('internal');
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    noSecrets(body);
    expect(snapshot()).toEqual(before);
    expect(questionStatus(h.questions[0]!)).toBe('active');
    f.c.client.exec('drop trigger fail_stop');
    const ok = await stop(h.questions[0]!);
    expect(ok.status).toBe(200);
    expect((await ok.json()).replayed).toBe(false);
    stoppedOnly(before, [h.questions[0]!]);
    const stopped = snapshot();
    await fetch(`/api/admin/sets/${h.id}`);
    await fetch('/api/admin/sets');
    await fetch('/api/admin/reports');
    await fetch('/api/sets');
    await fetch(`/api/sets/${h.id}`);
    await fetch('/api/sessions');
    await getSession(session.id);
    await getItem(session.id, byPosition(session, 0));
    expect(snapshot()).toEqual(stopped);
    const logs = JSON.stringify(getServerLogs());
    expect(logs).not.toMatch(/PRIVATE_SQL/);
    for (const marker of [...privateMarkers, f.database])
      expect(logs).not.toContain(marker);
  });
});
