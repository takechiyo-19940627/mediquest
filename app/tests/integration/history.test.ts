import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
import type { Connection } from '../../server/db/connection';
import { listSessions } from '../../server/services/study/history';
import {
  answerStudyItem,
  getSession,
  resumeSession,
  startSession,
} from '../../server/services/study/service';
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const close of cleanups.splice(0))
    try {
      close();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors);
});
async function fixture() {
  const f = await catalogFixture();
  cleanups.push(f.close);
  return f;
}
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
type Status = 'in_progress' | 'completed' | undefined;
type Before = { startedAt: number; id: number } | undefined;
function list(c: Connection, limit = 20, status?: Status, before?: Before) {
  return listSessions(c, { limit, status, before });
}
function ids(page: ReturnType<typeof listSessions>) {
  return page.items.map((item) => item.id);
}
// Walk every page with limit=1 and return the ids in order.
function walk(c: Connection, status?: Status) {
  const seen: number[] = [];
  let before: Before;
  for (let guard = 0; guard < 50; guard++) {
    const page = list(c, 1, status, before);
    expect(page.items.length).toBeLessThanOrEqual(1);
    seen.push(...ids(page));
    if (page.nextCursor === null) return seen;
    const [namespace, time, id] = page.nextCursor.split(':');
    expect(namespace).toBe('study');
    before = { startedAt: Number(time), id: Number(id) };
  }
  throw new Error('history paging did not terminate');
}
// The single-session GET is the reference projection for every history item.
function expected(c: Connection, id: number, setTitle: string) {
  const s = getSession(c, id);
  return {
    id: s.id,
    setId: s.setId,
    setTitle,
    status: s.status,
    mode: s.mode,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    currentItemId: s.currentItemId,
    statistics: s.statistics,
  };
}
it('lists only own sessions newest first with the explicit DTO and pages stably across equal start times and status filters', async () => {
  const f = await fixture();
  const start = () =>
    startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  const a = start();
  const b = start();
  const c = start();
  f.c.client.exec('update study_sessions set started_at=100');
  f.c.client.exec(
    "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
  );
  const foreign = start();
  f.c.client
    .prepare('update study_sessions set user_id=2,started_at=1000 where id=?')
    .run(foreign.id);
  answerStudyItem(f.c, b.id, b.items[0]!.id, {
    selectedIds: ['SECRET_ANSWER'],
  });
  answerStudyItem(f.c, b.id, b.items[1]!.id, { selectedIds: ['b'] });
  const page = list(f.c);
  expect(ids(page)).toEqual([c.id, b.id, a.id]);
  expect(page.nextCursor).toBeNull();
  for (const item of page.items) expect(Object.keys(item).sort()).toEqual(keys);
  expect(page.items[1]).toEqual(expected(f.c, b.id, 'セット'));
  expect(page.items[1]).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    currentItemId: null,
    statistics: { accuracy: 0.5, accuracyStatus: 'available' },
  });
  expect(page.items[2]).toEqual(expected(f.c, a.id, 'セット'));
  for (const marker of privateMarkers)
    expect(JSON.stringify(page)).not.toContain(marker);
  const first = list(f.c, 1);
  expect(ids(first)).toEqual([c.id]);
  expect(first.nextCursor).toBe(`study:100:${c.id}`);
  expect(walk(f.c)).toEqual([c.id, b.id, a.id]);
  expect(walk(f.c, 'completed')).toEqual([b.id]);
  expect(walk(f.c, 'in_progress')).toEqual([c.id, a.id]);
  const d = start();
  expect(ids(list(f.c, 1, undefined, { startedAt: 100, id: c.id }))).toEqual([
    b.id,
  ]);
  expect(ids(list(f.c, 2))).toEqual([d.id, c.id]);
  expect(walk(f.c)).toEqual([d.id, c.id, b.id, a.id]);
  f.c.client
    .prepare('update study_sessions set started_at=50 where id=?')
    .run(c.id);
  expect(walk(f.c)).toEqual([d.id, b.id, a.id, c.id]);
  f.c.client
    .prepare(
      "update question_sets set title='改題',status='archived' where id=?",
    )
    .run(f.run.setId);
  expect(list(f.c).items.map((item) => item.setTitle)).toEqual([
    '改題',
    '改題',
    '改題',
    '改題',
  ]);
  f.c.client.exec('update study_sessions set user_id=2');
  for (const status of [undefined, 'completed', 'in_progress'] as const)
    expect(list(f.c, 20, status)).toEqual({ items: [], nextCursor: null });
  expect(list(f.c, 1, undefined, { startedAt: 1000, id: foreign.id })).toEqual({
    items: [],
    nextCursor: null,
  });
});
it('matches the single-session projection for answered, stopped, invalidated and all-excluded sessions without writing or completing', async () => {
  const f = await fixture();
  const session = startSession(
    f.c,
    { setId: f.run.setId },
    randomUUID(),
  ).session;
  const [first, second] = session.items;
  const tables = [
    'study_sessions',
    'study_items',
    'question_versions',
    'questions',
    'question_sets',
  ];
  const snapshot = () =>
    tables.map((table) => f.c.client.prepare(`select * from ${table}`).all());
  const compare = () =>
    expect(list(f.c).items).toEqual([expected(f.c, session.id, 'セット')]);
  compare();
  expect(list(f.c).items[0]!.currentItemId).toBe(first!.id);
  answerStudyItem(f.c, session.id, first!.id, {
    selectedIds: ['SECRET_ANSWER'],
  });
  compare();
  expect(list(f.c).items[0]!.currentItemId).toBe(second!.id);
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[1]!.questionId);
  const before = snapshot();
  expect(list(f.c).items[0]).toMatchObject({
    status: 'in_progress',
    completedAt: null,
    currentItemId: null,
    statistics: {
      totalItemCount: 2,
      excludedCount: 1,
      eligibleCount: 1,
      answeredEligibleCount: 1,
      unansweredEligibleCount: 0,
      correctEligibleCount: 1,
      accuracy: 1,
      accuracyStatus: 'available',
    },
  });
  compare();
  expect(snapshot()).toEqual(before);
  f.c.client
    .prepare(
      "update question_versions set invalidated_at=5,invalidated_by=1,invalidation_reason='bad' where id=?",
    )
    .run(f.ids[0]);
  const invalidated = snapshot();
  expect(list(f.c).items[0]).toMatchObject({
    status: 'in_progress',
    completedAt: null,
    currentItemId: null,
    statistics: {
      totalItemCount: 2,
      excludedCount: 2,
      eligibleCount: 0,
      answeredEligibleCount: 0,
      correctEligibleCount: 0,
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    },
  });
  compare();
  expect(snapshot()).toEqual(invalidated);
  expect(
    f.c.client
      .prepare(
        'select selected_ids_json,is_correct,answered_at from study_items where id=?',
      )
      .get(first!.id),
  ).toEqual({
    selected_ids_json: '["SECRET_ANSWER"]',
    is_correct: 1,
    answered_at: expect.any(Number),
  });
  expect(resumeSession(f.c, session.id)).toMatchObject({ status: 'completed' });
  expect(list(f.c).items[0]).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    currentItemId: null,
  });
  compare();
});
it('serves learner and admin their own history only and rejects a missing local user', async () => {
  const f = await fixture();
  const own = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  for (const role of ['admin', 'learner']) {
    f.c.client.prepare('update users set role=? where id=1').run(role);
    expect(ids(list(f.c))).toEqual([own.id]);
  }
  f.c.client.pragma('foreign_keys = OFF');
  f.c.client.exec('update users set id=3 where id=1');
  expect(() => list(f.c)).toThrow('forbidden');
  f.c.client.exec('update users set id=1 where id=3');
  f.c.client.pragma('foreign_keys = ON');
  expect(ids(list(f.c))).toEqual([own.id]);
});
