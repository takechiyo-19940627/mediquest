import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import { listSessions } from '../../server/services/study/history';
import {
  answerStudyItem,
  getSession,
  getStudyItem,
  resumeSession,
  skipStudyItem,
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
type Fixture = Awaited<ReturnType<typeof catalogFixture>>;
// Issue #41 tests need three published questions so that ordinary unanswered,
// skipped unanswered and answered items can coexist.
async function fixture() {
  const f = await catalogFixture(3);
  cleanups.push(f.close);
  return {
    ...f,
    session: startSession(f.c, { setId: f.run.setId }, randomUUID()).session,
  };
}
function rows(f: Fixture, sessionId: number) {
  return f.c.client
    .prepare('select * from study_items where session_id=? order by id')
    .all(sessionId) as Record<string, unknown>[];
}
const skipTimes = (f: Fixture, sessionId: number) =>
  rows(f, sessionId).map((row) => row.skipped_at);
// GET and the history listing must agree on the next item and the counts.
function current(f: Fixture, sessionId: number) {
  const session = getSession(f.c, sessionId);
  const listed = listSessions(f.c, {
    limit: 20,
    status: undefined,
    before: undefined,
  }).items.find((item) => item.id === sessionId)!;
  expect(listed.currentItemId).toBe(session.currentItemId);
  expect(listed.statistics).toEqual(session.statistics);
  return session;
}
it('keeps skips unanswered, orders ordinary before skipped in every current path, keeps the first skip time, and answers skipped items once', async () => {
  const f = await fixture();
  const [a, b, c] = f.session.items as [
    (typeof f.session.items)[number],
    (typeof f.session.items)[number],
    (typeof f.session.items)[number],
  ];
  expect(f.session.items.map((item) => item.position)).toEqual([0, 1, 2]);
  expect(f.session.items.map((item) => item.skippedAt)).toEqual([
    null,
    null,
    null,
  ]);
  expect(f.session.currentItemId).toBe(a.id);
  expect(f.session.statistics.skippedUnansweredCount).toBe(0);
  const initial = rows(f, f.session.id);
  const first = skipStudyItem(f.c, f.session.id, a.id);
  expect(first).toEqual({
    item: { id: a.id, position: 0, skippedAt: expect.any(Number) },
    session: {
      ...f.session,
      items: [{ ...a, skippedAt: first.item.skippedAt }, b, c],
      statistics: { ...f.session.statistics, skippedUnansweredCount: 1 },
      currentItemId: b.id,
    },
    replayed: false,
  });
  expect(current(f, f.session.id)).toEqual(first.session);
  // The item DTO is unchanged: no feedback, grade or exclusion appears.
  expect(Object.keys(getStudyItem(f.c, f.session.id, a.id)).sort()).toEqual(
    ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
  );
  expect(rows(f, f.session.id)).toEqual(
    initial.map((row) =>
      row.id === a.id ? { ...row, skipped_at: first.item.skippedAt } : row,
    ),
  );
  // Resending the same skip returns the saved time without rewriting it.
  expect(skipStudyItem(f.c, f.session.id, a.id)).toEqual({
    ...first,
    replayed: true,
  });
  expect(skipStudyItem(f.c, f.session.id, b.id).session.currentItemId).toBe(
    c.id,
  );
  const third = skipStudyItem(f.c, f.session.id, c.id);
  // Everything skipped: back to the first skip, still in progress, no completion.
  expect(third.session).toMatchObject({
    status: 'in_progress',
    completedAt: null,
    currentItemId: a.id,
    statistics: {
      eligibleCount: 3,
      answeredEligibleCount: 0,
      unansweredEligibleCount: 3,
      skippedUnansweredCount: 3,
      accuracy: 0,
      accuracyStatus: 'available',
    },
  });
  expect(resumeSession(f.c, f.session.id)).toEqual(third.session);
  expect(current(f, f.session.id)).toEqual(third.session);
  // Skipping the current first skip again does not rotate the order.
  expect(skipStudyItem(f.c, f.session.id, a.id)).toEqual({
    ...first,
    session: third.session,
    replayed: true,
  });
  expect(current(f, f.session.id).currentItemId).toBe(a.id);
  // Stored positions, versions and answer columns never changed.
  expect(
    rows(f, f.session.id).map(({ skipped_at: _skipped, ...rest }) => rest),
  ).toEqual(initial.map(({ skipped_at: _skipped, ...rest }) => rest));
  const times = skipTimes(f, f.session.id);
  expect(times).toEqual([
    first.item.skippedAt,
    expect.any(Number),
    third.item.skippedAt,
  ]);
  // Answering a skipped item confirms once, keeps skipped_at, moves to the
  // next skipped item in stored order.
  const answered = answerStudyItem(f.c, f.session.id, a.id, {
    selectedIds: ['SECRET_ANSWER'],
  });
  expect(answered.replayed).toBe(false);
  expect(answered.item).toMatchObject({ feedback: { isCorrect: true } });
  expect(answered.session).toMatchObject({
    status: 'in_progress',
    currentItemId: b.id,
    statistics: {
      answeredEligibleCount: 1,
      unansweredEligibleCount: 2,
      skippedUnansweredCount: 2,
    },
  });
  expect(answered.session.items[0]).toEqual({
    id: a.id,
    position: 0,
    state: 'answered',
    skippedAt: first.item.skippedAt,
  });
  expect(current(f, f.session.id)).toEqual(answered.session);
  expect(
    answerStudyItem(f.c, f.session.id, a.id, {
      selectedIds: ['SECRET_ANSWER'],
    }),
  ).toEqual({ ...answered, replayed: true });
  expect(() =>
    answerStudyItem(f.c, f.session.id, a.id, { selectedIds: ['b'] }),
  ).toThrow('conflict');
  // A late skip resend after the answer is rejected and changes nothing.
  const afterAnswer = rows(f, f.session.id);
  expect(() => skipStudyItem(f.c, f.session.id, a.id)).toThrow('conflict');
  expect(rows(f, f.session.id)).toEqual(afterAnswer);
  answerStudyItem(f.c, f.session.id, b.id, { selectedIds: ['b'] });
  expect(current(f, f.session.id)).toMatchObject({
    status: 'in_progress',
    currentItemId: c.id,
  });
  const final = answerStudyItem(f.c, f.session.id, c.id, {
    selectedIds: ['SECRET_ANSWER'],
  });
  expect(final.session).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    currentItemId: null,
    statistics: {
      answeredEligibleCount: 3,
      unansweredEligibleCount: 0,
      skippedUnansweredCount: 0,
      correctEligibleCount: 2,
      accuracy: 2 / 3,
    },
  });
  expect(current(f, f.session.id)).toEqual(final.session);
  expect(() => skipStudyItem(f.c, f.session.id, c.id)).toThrow('conflict');
  expect(skipTimes(f, f.session.id)).toEqual(times);
});
it('never completes by skipping the last unanswered item, rejects stopped/invalidated skips without writes, and drops excluded skips from order and counts', async () => {
  const f = await fixture();
  const [a, b, c] = f.session.items as [
    (typeof f.session.items)[number],
    (typeof f.session.items)[number],
    (typeof f.session.items)[number],
  ];
  answerStudyItem(f.c, f.session.id, a.id, { selectedIds: ['SECRET_ANSWER'] });
  answerStudyItem(f.c, f.session.id, b.id, { selectedIds: ['b'] });
  const last = skipStudyItem(f.c, f.session.id, c.id);
  expect(last.session).toMatchObject({
    status: 'in_progress',
    completedAt: null,
    currentItemId: c.id,
    statistics: { unansweredEligibleCount: 1, skippedUnansweredCount: 1 },
  });
  expect(resumeSession(f.c, f.session.id)).toEqual(last.session);
  expect(current(f, f.session.id)).toEqual(last.session);
  const untouched = rows(f, f.session.id);
  const s = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  const [x, y, z] = s.items as [
    (typeof s.items)[number],
    (typeof s.items)[number],
    (typeof s.items)[number],
  ];
  skipStudyItem(f.c, s.id, x.id);
  skipStudyItem(f.c, s.id, y.id);
  expect(current(f, s.id).currentItemId).toBe(z.id);
  const before = rows(f, s.id);
  // A currently stopped unanswered item cannot be skipped; no exclusion or skip
  // is saved and the order returns to the first skip.
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[2]!.questionId);
  expect(() => skipStudyItem(f.c, s.id, z.id)).toThrow('conflict');
  expect(rows(f, s.id)).toEqual(before);
  expect(current(f, s.id)).toMatchObject({
    status: 'in_progress',
    currentItemId: x.id,
    statistics: {
      totalItemCount: 3,
      excludedCount: 1,
      eligibleCount: 2,
      unansweredEligibleCount: 2,
      skippedUnansweredCount: 2,
    },
  });
  // A skipped item that is later stopped leaves the order and the skip count.
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[0]!.questionId);
  expect(current(f, s.id)).toMatchObject({
    currentItemId: y.id,
    statistics: { excludedCount: 2, skippedUnansweredCount: 1 },
  });
  expect(() => skipStudyItem(f.c, s.id, x.id)).toThrow('conflict');
  expect(rows(f, s.id)).toEqual(before);
  // Invalidation of the remaining skipped item: all excluded, GET stays
  // in_progress with no eligible items, nothing written.
  f.c.client
    .prepare(
      "update question_versions set invalidated_at=5,invalidated_by=1,invalidation_reason='bad' where id=?",
    )
    .run(f.ids[1]);
  const excluded = current(f, s.id);
  expect(excluded).toMatchObject({
    status: 'in_progress',
    completedAt: null,
    currentItemId: null,
    statistics: {
      excludedCount: 3,
      eligibleCount: 0,
      unansweredEligibleCount: 0,
      skippedUnansweredCount: 0,
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    },
  });
  expect(excluded.items[1]).toEqual({
    id: y.id,
    position: 1,
    state: 'excluded',
    skippedAt: expect.any(Number),
    excludedReason: 'invalidated',
  });
  expect(() => skipStudyItem(f.c, s.id, y.id)).toThrow('conflict');
  expect(rows(f, s.id)).toEqual(before);
  // Only resume persists exclusions and completes; skip times are kept.
  expect(resumeSession(f.c, s.id)).toMatchObject({
    status: 'completed',
    currentItemId: null,
    statistics: { accuracy: null, accuracyStatus: 'no_eligible_items' },
  });
  expect(skipTimes(f, s.id)).toEqual(before.map((row) => row.skipped_at));
  expect(() => skipStudyItem(f.c, s.id, z.id)).toThrow('conflict');
  // The other session's rows were only projected, never written.
  expect(rows(f, f.session.id)).toEqual(untouched);
});
it('denies other owners, cross-session items and missing users, lets a learner skip, and rolls back a failed skip write', async () => {
  const f = await fixture();
  const own = f.session;
  const other = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  expect(() => skipStudyItem(f.c, own.id, other.items[0]!.id)).toThrow(
    'missing',
  );
  expect(() => skipStudyItem(f.c, 999999, own.items[0]!.id)).toThrow('missing');
  f.c.client.exec(
    "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
  );
  f.c.client
    .prepare('update study_sessions set user_id=2 where id=?')
    .run(other.id);
  expect(() => skipStudyItem(f.c, other.id, other.items[0]!.id)).toThrow(
    'missing',
  );
  expect(
    f.c.client
      .prepare(
        'select count(*) n from study_items where skipped_at is not null',
      )
      .get(),
  ).toEqual({ n: 0 });
  f.c.client.exec("update users set role='learner' where id=1");
  expect(skipStudyItem(f.c, own.id, own.items[0]!.id).replayed).toBe(false);
  f.c.client.pragma('foreign_keys = OFF');
  f.c.client.exec('update users set id=3 where id=1');
  expect(() => skipStudyItem(f.c, own.id, own.items[1]!.id)).toThrow(
    'forbidden',
  );
  f.c.client.exec('update users set id=1 where id=3');
  f.c.client.pragma('foreign_keys = ON');
  f.c.client.exec("update users set role='admin' where id=1");
  const before = f.c.client.prepare('select * from study_items').all();
  f.c.client.exec(
    "create trigger fail_skip after update on study_items when new.skipped_at is not null begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() => skipStudyItem(f.c, own.id, own.items[1]!.id)).toThrow();
  expect(f.c.client.prepare('select * from study_items').all()).toEqual(before);
  expect(getSession(f.c, own.id)).toMatchObject({
    status: 'in_progress',
    currentItemId: own.items[1]!.id,
  });
  f.c.client.exec('drop trigger fail_skip');
  expect(
    skipStudyItem(f.c, own.id, own.items[1]!.id).session.currentItemId,
  ).toBe(own.items[2]!.id);
  // GET paths never write.
  const after = f.c.client.prepare('select * from study_items').all();
  getSession(f.c, own.id);
  getStudyItem(f.c, own.id, own.items[0]!.id);
  listSessions(f.c, { limit: 20, status: undefined, before: undefined });
  expect(f.c.client.prepare('select * from study_items').all()).toEqual(after);
});
