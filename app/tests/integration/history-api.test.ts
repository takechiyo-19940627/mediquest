import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
const f = await catalogFixture();
type Session = { id: number; items: { id: number }[] };
let a: Session;
let b: Session;
const keys = [
  'id',
  'setId',
  'setTitle',
  'status',
  'mode',
  'startedAt',
  'completedAt',
  'currentItemId',
  'statistics',
].sort();
const tables = [
  'users',
  'question_sets',
  'questions',
  'question_versions',
  'study_sessions',
  'study_items',
  'issue_reports',
];
const snapshot = () =>
  tables.map((table) => f.c.client.prepare(`select * from ${table}`).all());
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const start = () =>
  fetch('/api/sessions', {
    ...json({ setId: f.run.setId }),
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
  });
const answer = (sessionId: number, itemId: number, selectedIds: string[]) =>
  fetch(`/api/sessions/${sessionId}/items/${itemId}/answer`, {
    ...json({ selectedIds }),
  });
const resume = (id: number) => fetch(`/api/sessions/${id}/resume`, json({}));
const list = (query = '') => fetch(`/api/sessions${query}`);
const listIds = async (query = '') =>
  (await (await list(query)).json()).items.map(
    (item: { id: number }) => item.id,
  );
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /answerIds|answer_ids|isCorrect|is_correct|selectedIds|explanation|quote|choices|body|position|userId|user_id|displayName|requestKey|request_key|reviewedBy|generationRun|questionVersion/,
  );
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
function rawStatus(path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(`http://127.0.0.1:3204${path}`, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
describe('study history HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3204,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3204',
    },
  });
  afterAll(f.close);
  it('lists own sessions after start and answer, links to GET/resume/next item, and keeps order across restart', async () => {
    expect(await (await list()).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    a = (await (await start()).json()).session;
    b = (await (await start()).json()).session;
    expect((await answer(a.id, a.items[0]!.id, ['SECRET_ANSWER'])).status).toBe(
      200,
    );
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const page = await response.json();
    expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor']);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item: { id: number }) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(keys);
    expect(page.items[1]).toMatchObject({
      setId: f.run.setId,
      setTitle: 'セット',
      status: 'in_progress',
      mode: 'normal',
      startedAt: expect.any(Number),
      completedAt: null,
      currentItemId: a.items[1]!.id,
      statistics: {
        totalItemCount: 2,
        excludedCount: 0,
        eligibleCount: 2,
        answeredEligibleCount: 1,
        unansweredEligibleCount: 1,
        correctEligibleCount: 1,
        accuracy: 0.5,
        accuracyStatus: 'available',
      },
    });
    noSecrets(page);
    const single = await (await fetch(`/api/sessions/${a.id}`)).json();
    expect(page.items[1]).toEqual({
      id: single.id,
      setId: single.setId,
      setTitle: 'セット',
      status: single.status,
      mode: single.mode,
      startedAt: single.startedAt,
      completedAt: single.completedAt,
      currentItemId: single.currentItemId,
      statistics: single.statistics,
    });
    const resumed = await resume(a.id);
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).currentItemId).toBe(
      page.items[1].currentItemId,
    );
    const next = await (
      await fetch(`/api/sessions/${a.id}/items/${page.items[1].currentItemId}`)
    ).json();
    expect(Object.keys(next).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    await startServer();
    expect(await (await list()).json()).toEqual(page);
  });
  it('validates query inputs and pages with a dedicated cursor and status filter', async () => {
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=1.5',
      '?limit=1&limit=2',
      '?status=all',
      '?status=completed&status=in_progress',
      '?before=published:1:1',
      '?before=1:1',
      '?before=study:1:0',
      '?before=study:9007199254740992:1',
      '?before=study:1:1&before=study:1:2',
      '?userId=1',
      '?setId=1',
      '?order=asc',
    ]) {
      const response = await list(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('invalid');
    }
    const first = await (await list('?limit=1')).json();
    expect(first.items.map((item: { id: number }) => item.id)).toEqual([b.id]);
    expect(first.nextCursor).toBe(`study:${first.items[0].startedAt}:${b.id}`);
    const second = await (
      await list(`?limit=1&before=${first.nextCursor}`)
    ).json();
    expect(second.items.map((item: { id: number }) => item.id)).toEqual([a.id]);
    expect(second.nextCursor).toBeNull();
    const tail = `study:${second.items[0].startedAt}:${a.id}`;
    expect(await listIds(`?limit=1&before=${tail}`)).toEqual([]);
    expect(await (await list('?status=completed')).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    expect((await answer(b.id, b.items[0]!.id, ['SECRET_ANSWER'])).status).toBe(
      200,
    );
    expect((await answer(b.id, b.items[1]!.id, ['b'])).status).toBe(200);
    const completed = await (await list('?status=completed')).json();
    expect(completed.items.map((item: { id: number }) => item.id)).toEqual([
      b.id,
    ]);
    expect(completed.items[0]).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
      currentItemId: null,
      statistics: { accuracy: 0.5, accuracyStatus: 'available' },
    });
    expect(await listIds('?status=in_progress')).toEqual([a.id]);
    expect(
      await listIds(`?status=in_progress&limit=1&before=${first.nextCursor}`),
    ).toEqual([a.id]);
    expect(await listIds('?limit=100')).toEqual([b.id, a.id]);
  });
  it('hides other users, keeps archived and invalidated history read-only, and serves learner only own history', async () => {
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    const foreign = (await (await start()).json()).session;
    f.c.client
      .prepare('update study_sessions set user_id=2,started_at=? where id=?')
      .run(Date.now() + 100000, foreign.id);
    expect(await listIds('?limit=1')).toEqual([b.id]);
    expect(await listIds()).toEqual([b.id, a.id]);
    expect(await listIds('?status=in_progress')).toEqual([a.id]);
    f.c.client
      .prepare(
        "update question_sets set status='archived',title='改題' where id=?",
      )
      .run(f.run.setId);
    f.c.client.exec(
      "update question_versions set invalidated_at=7,invalidated_by=1,invalidation_reason='bad'",
    );
    const before = snapshot();
    const all = await (await list()).json();
    expect(all.items.map((item: { id: number }) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
    const excluded = {
      totalItemCount: 2,
      excludedCount: 2,
      eligibleCount: 0,
      answeredEligibleCount: 0,
      unansweredEligibleCount: 0,
      correctEligibleCount: 0,
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    };
    expect(all.items[0]).toMatchObject({
      setTitle: '改題',
      status: 'completed',
      currentItemId: null,
      statistics: excluded,
    });
    expect(all.items[1]).toMatchObject({
      setTitle: '改題',
      status: 'in_progress',
      completedAt: null,
      currentItemId: null,
      statistics: excluded,
    });
    expect(snapshot()).toEqual(before);
    const single = await (await fetch(`/api/sessions/${a.id}`)).json();
    expect(single).toMatchObject({
      status: 'in_progress',
      currentItemId: null,
    });
    expect(all.items[1].statistics).toEqual(single.statistics);
    noSecrets(all);
    expect((await resume(a.id)).status).toBe(200);
    expect(await listIds('?status=completed')).toEqual([b.id, a.id]);
    expect(await listIds('?status=in_progress')).toEqual([]);
    f.c.client.exec("update users set role='learner' where id=1");
    const learner = await list();
    expect(learner.status).toBe(200);
    expect(
      (await learner.json()).items.map((item: { id: number }) => item.id),
    ).toEqual([b.id, a.id]);
    expect((await fetch('/api/admin/sets')).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
  });
  it('enforces local boundaries and returns safe failures without leaking internals', async () => {
    for (const headers of [
      { origin: 'http://bad.invalid' } as Record<string, string>,
      { host: 'bad.invalid' },
    ])
      expect(await rawStatus('/api/sessions', headers)).toBe(403);
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect((await list()).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await list()).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    f.c.client.exec('alter table study_sessions rename to hidden_sessions');
    try {
      const response = await list();
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body.error.code).toBe('internal');
      expect(JSON.stringify(body)).not.toMatch(
        /hidden_sessions|study_sessions|sqlite|stack|SECRET/,
      );
    } finally {
      f.c.client.exec('alter table hidden_sessions rename to study_sessions');
    }
    expect(await listIds()).toEqual([b.id, a.id]);
    const logs = JSON.stringify(getServerLogs());
    for (const marker of [...privateMarkers, f.database, 'hidden_sessions'])
      expect(logs).not.toContain(marker);
  });
});
