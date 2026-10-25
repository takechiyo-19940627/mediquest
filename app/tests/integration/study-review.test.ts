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
  startReviewSession,
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
// Issue #44 tests publish eight questions so that every parent item kind can
// coexist in one completed session. Position i uses version f.ids[i].
async function fixture() {
  const f = await catalogFixture(8, 8);
  cleanups.push(f.close);
  return f;
}
const CORRECT = ['SECRET_ANSWER'];
const WRONG = ['b'];
const sessionRow = (f: Fixture, id: number) =>
  f.c.client.prepare('select * from study_sessions where id=?').get(id) as
    Record<string, unknown> | undefined;
const itemRows = (f: Fixture, id: number) =>
  f.c.client
    .prepare('select * from study_items where session_id=? order by position')
    .all(id) as Record<string, unknown>[];
const snapshot = (f: Fixture, id: number) => ({
  session: sessionRow(f, id),
  items: itemRows(f, id),
});
const counts = (f: Fixture) => ({
  sessions: (
    f.c.client.prepare('select count(*) n from study_sessions').get() as {
      n: number;
    }
  ).n,
  items: (
    f.c.client.prepare('select count(*) n from study_items').get() as {
      n: number;
    }
  ).n,
});
// Completed fixtures with unanswered items are not produced by the API (answer
// and resume complete only when no eligible unanswered item remains); the SQL
// completion is a boundary device so that unanswered/skipped parents are covered.
const complete = (f: Fixture, id: number) =>
  f.c.client
    .prepare(
      "update study_sessions set status='completed',completed_at=99 where id=?",
    )
    .run(id);
const start = (f: Fixture) =>
  startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
const answer = (f: Fixture, s: number, i: number, selectedIds: string[]) =>
  answerStudyItem(f.c, s, i, { selectedIds });
const review = (f: Fixture, parentId: number, key = randomUUID()) =>
  startReviewSession(f.c, parentId, {}, key);
// Mixed parent: 0 correct, 1 wrong, 2 unanswered (completed by SQL), 3 skipped
// only, 4 wrong then question stopped, 5 wrong then version invalidated,
// 6 wrong with a saved exclusion, 7 wrong. Only positions 1 and 7 are eligible.
function mixedParent(f: Fixture) {
  const s = start(f);
  const [i0, i1, , i3, i4, i5, i6, i7] = s.items.map((item) => item.id) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  answer(f, s.id, i0, CORRECT);
  answer(f, s.id, i1, WRONG);
  skipStudyItem(f.c, s.id, i3);
  for (const id of [i4, i5, i6, i7]) answer(f, s.id, id, WRONG);
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[4]!.questionId);
  f.c.client
    .prepare(
      "update question_versions set invalidated_at=5,invalidated_by=1,invalidation_reason='bad' where id=?",
    )
    .run(f.ids[5]);
  f.c.client
    .prepare(
      "update study_items set excluded_reason='stopped',excluded_at=6 where id=?",
    )
    .run(i6);
  return s;
}
const nullAnswer = {
  selected_ids_json: null,
  is_correct: null,
  answered_at: null,
  skipped_at: null,
  excluded_reason: null,
  excluded_at: null,
};
it('creates a review only from the completed parent’s obtainable wrong answers, keeps their versions and positions, and never writes the parent', async () => {
  const f = await fixture();
  const parent = mixedParent(f);
  expect(getSession(f.c, parent.id).status).toBe('in_progress');
  const untouched = counts(f);
  // A parent that is not completed cannot be reviewed.
  expect(() => review(f, parent.id)).toThrow('conflict');
  expect(counts(f)).toEqual(untouched);
  complete(f, parent.id);
  const before = snapshot(f, parent.id);
  const key = randomUUID();
  const first = review(f, parent.id, key);
  expect(first.replayed).toBe(false);
  const child = first.session;
  expect(child).toMatchObject({
    setId: f.run.setId,
    status: 'in_progress',
    mode: 'review',
    parentSessionId: parent.id,
    completedAt: null,
    currentItemId: child.items[0]!.id,
    statistics: {
      totalItemCount: 2,
      excludedCount: 0,
      eligibleCount: 2,
      answeredEligibleCount: 0,
      unansweredEligibleCount: 2,
      skippedUnansweredCount: 0,
      correctEligibleCount: 0,
      accuracy: 0,
      accuracyStatus: 'available',
    },
  });
  expect(child.id).not.toBe(parent.id);
  // Parent positions are kept (non-contiguous), every item starts unanswered.
  expect(child.items).toEqual([
    {
      id: expect.any(Number),
      position: 1,
      state: 'unanswered',
      skippedAt: null,
    },
    {
      id: expect.any(Number),
      position: 7,
      state: 'unanswered',
      skippedAt: null,
    },
  ]);
  expect(itemRows(f, child.id)).toEqual([
    {
      id: child.items[0]!.id,
      session_id: child.id,
      question_version_id: f.ids[1],
      position: 1,
      ...nullAnswer,
    },
    {
      id: child.items[1]!.id,
      session_id: child.id,
      question_version_id: f.ids[7],
      position: 7,
      ...nullAnswer,
    },
  ]);
  expect(sessionRow(f, child.id)).toMatchObject({
    user_id: 1,
    set_id: f.run.setId,
    status: 'in_progress',
    mode: 'review',
    parent_session_id: parent.id,
    start_request_key: key,
    completed_at: null,
  });
  // The parent's rows, including grades, skip, exclusion and completion, are unchanged.
  expect(snapshot(f, parent.id)).toEqual(before);
  expect(getSession(f.c, child.id)).toEqual(child);
  // The child's unanswered item DTO hides the parent's grade and the answer.
  const dto = getStudyItem(f.c, child.id, child.items[0]!.id);
  expect(Object.keys(dto).sort()).toEqual(
    ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
  );
  // Same key: the saved child, nothing re-selected or created.
  const created = counts(f);
  expect(review(f, parent.id, key)).toEqual({ ...first, replayed: true });
  expect(counts(f)).toEqual(created);
  // Another key is another review of the same parent.
  const second = review(f, parent.id).session;
  expect(second.id).not.toBe(child.id);
  expect(second.items.map((item) => item.position)).toEqual([1, 7]);
  const listed = listSessions(f.c, {
    limit: 20,
    status: undefined,
    before: undefined,
  }).items;
  expect(listed.find((item) => item.id === child.id)).toMatchObject({
    mode: 'review',
    parentSessionId: parent.id,
    status: 'in_progress',
    currentItemId: child.currentItemId,
    statistics: child.statistics,
  });
  expect(listed.find((item) => item.id === parent.id)).toMatchObject({
    mode: 'normal',
    parentSessionId: null,
  });
  expect(snapshot(f, parent.id)).toEqual(before);
});
it('keeps start keys apart across modes and parents, rejects bad input, foreign or missing parents, and creates nothing for an all-correct parent', async () => {
  const f = await fixture();
  const a = mixedParent(f);
  complete(f, a.id);
  const b = start(f);
  answer(f, b.id, b.items[0]!.id, WRONG);
  complete(f, b.id);
  const keyA = randomUUID();
  review(f, a.id, keyA);
  const after = counts(f);
  // Same key, another parent.
  expect(() => review(f, b.id, keyA)).toThrow('conflict');
  // A review key is never replayed as a normal start, and vice versa.
  expect(() => startSession(f.c, { setId: f.run.setId }, keyA)).toThrow(
    'conflict',
  );
  const normalKey = randomUUID();
  const normal = startSession(f.c, { setId: f.run.setId }, normalKey).session;
  expect(() => review(f, a.id, normalKey)).toThrow('conflict');
  // Input and key validation happen before any ownership lookup.
  expect(() =>
    startReviewSession(f.c, a.id, { userId: 1 }, randomUUID()),
  ).toThrow('invalid');
  expect(() =>
    startReviewSession(f.c, 999999, { parentSessionId: a.id }, randomUUID()),
  ).toThrow('invalid');
  expect(() => startReviewSession(f.c, a.id, {}, 'not-a-key')).toThrow(
    'invalid',
  );
  expect(() => review(f, 999999)).toThrow('missing');
  f.c.client.exec(
    "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
  );
  f.c.client
    .prepare('update study_sessions set user_id=2 where id=?')
    .run(b.id);
  expect(() => review(f, b.id)).toThrow('missing');
  f.c.client
    .prepare('update study_sessions set user_id=1 where id=?')
    .run(b.id);
  // Every answer correct: no target, no empty session. (New sessions after
  // mixedParent exclude its stopped and invalidated versions, hence 6 items.)
  const c = start(f);
  expect(c.items.length).toBe(6);
  for (const item of c.items) answer(f, c.id, item.id, CORRECT);
  expect(getSession(f.c, c.id).status).toBe('completed');
  expect(() => review(f, c.id)).toThrow('conflict');
  expect(counts(f)).toEqual({
    sessions: after.sessions + 2,
    items: after.items + normal.items.length + c.items.length,
  });
});
it('replays saved reviews after archiving or later exclusion but refuses new ones, and treats versions outside the published collection as conflicts', async () => {
  const f = await fixture();
  const parent = mixedParent(f);
  complete(f, parent.id);
  const key = randomUUID();
  const first = review(f, parent.id, key);
  const after = counts(f);
  f.c.client
    .prepare("update question_sets set status='archived' where id=?")
    .run(f.run.setId);
  expect(review(f, parent.id, key)).toEqual({ ...first, replayed: true });
  expect(() => review(f, parent.id)).toThrow('conflict');
  f.c.client
    .prepare("update question_sets set status='published' where id=?")
    .run(f.run.setId);
  // A wrong answer whose version left the published collection is an
  // integrity conflict rather than a silent skip.
  f.c.client
    .prepare('delete from set_items where set_id=? and question_version_id=?')
    .run(f.run.setId, f.ids[1]);
  expect(() => review(f, parent.id)).toThrow('conflict');
  f.c.client
    .prepare(
      'insert into set_items(set_id,question_version_id,position) values(?,?,1)',
    )
    .run(f.run.setId, f.ids[1]);
  // Later stop/invalidation of the remaining targets: the saved review is
  // replayed with the current exclusion projected, a new review has no target.
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[1]!.questionId);
  f.c.client
    .prepare(
      "update question_versions set invalidated_at=5,invalidated_by=1,invalidation_reason='bad' where id=?",
    )
    .run(f.ids[7]);
  const replay = review(f, parent.id, key);
  expect(replay.replayed).toBe(true);
  expect(replay.session).toMatchObject({
    id: first.session.id,
    status: 'in_progress',
    currentItemId: null,
    statistics: {
      excludedCount: 2,
      eligibleCount: 0,
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    },
  });
  expect(() => review(f, parent.id)).toThrow('conflict');
  expect(counts(f)).toEqual(after);
});
it('lets the child be answered, skipped, resumed and reviewed again without touching the parent, serves a learner, and rolls back a failed creation', async () => {
  const f = await fixture();
  const parent = mixedParent(f);
  complete(f, parent.id);
  const before = snapshot(f, parent.id);
  const child = review(f, parent.id).session;
  const [x, y] = child.items as [
    (typeof child.items)[number],
    (typeof child.items)[number],
  ];
  expect(skipStudyItem(f.c, child.id, x.id).session.currentItemId).toBe(y.id);
  const wrong = answer(f, child.id, x.id, WRONG);
  expect(wrong.item).toMatchObject({ feedback: { isCorrect: false } });
  const done = answer(f, child.id, y.id, CORRECT);
  expect(done.session).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    parentSessionId: parent.id,
    statistics: { correctEligibleCount: 1, accuracy: 0.5 },
  });
  expect(resumeSession(f.c, child.id)).toEqual(done.session);
  expect(snapshot(f, parent.id)).toEqual(before);
  // The child's own wrong answer can be reviewed again; only the direct parent is stored.
  const grandchild = review(f, child.id).session;
  expect(grandchild).toMatchObject({
    mode: 'review',
    parentSessionId: child.id,
    status: 'in_progress',
  });
  expect(grandchild.items.map((item) => item.position)).toEqual([1]);
  expect(itemRows(f, grandchild.id)).toEqual([
    expect.objectContaining({ question_version_id: f.ids[1], position: 1 }),
  ]);
  expect(getSession(f.c, grandchild.id).parentSessionId).toBe(child.id);
  expect(getSession(f.c, child.id)).toEqual(done.session);
  expect(snapshot(f, parent.id)).toEqual(before);
  // A learner reviews their own session; a missing user is forbidden.
  f.c.client.exec("update users set role='learner' where id=1");
  expect(review(f, parent.id).replayed).toBe(false);
  f.c.client.pragma('foreign_keys = OFF');
  f.c.client.exec('update users set id=3 where id=1');
  expect(() => review(f, parent.id)).toThrow('forbidden');
  f.c.client.exec('update users set id=1 where id=3');
  f.c.client.pragma('foreign_keys = ON');
  f.c.client.exec("update users set role='admin' where id=1");
  // Item insert failure: no session, no items, parent untouched.
  const saved = counts(f);
  f.c.client.exec(
    "create trigger fail_review after insert on study_items when new.position=7 begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() => review(f, parent.id)).toThrow();
  expect(counts(f)).toEqual(saved);
  expect(snapshot(f, parent.id)).toEqual(before);
  f.c.client.exec('drop trigger fail_review');
  expect(review(f, parent.id).session.items.map((i) => i.position)).toEqual([
    1, 7,
  ]);
});
