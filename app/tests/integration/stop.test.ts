import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import { stopQuestion } from '../../server/services/questions/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
import { confirmVersion, getSet } from '../../server/services/review/service';
import {
  getPublishedSet,
  listPublishedSets,
} from '../../server/services/learning-catalog/service';
import {
  answerStudyItem,
  getSession,
  getStudyItem,
  resumeSession,
  skipStudyItem,
  startReviewSession,
  startSession,
} from '../../server/services/study/service';
import { listSessions } from '../../server/services/study/history';
import {
  createReport,
  resolveReport,
} from '../../server/services/reports/service';
// Issue #50: the administrator's explicit one-way stop of a logical question.
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
async function fixture() {
  const f = await catalogFixture();
  cleanups.push(f.close);
  return f;
}
const CORRECT = ['SECRET_ANSWER'];
const WRONG = ['b'];
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
function snapshot(f: Fixture) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      f.c.client.prepare(`select * from ${table} order by id`).all(),
    ]),
  );
}
// Only questions.status of the one stopped question may differ.
function stoppedOnly(
  f: Fixture,
  before: ReturnType<typeof snapshot>,
  id: number,
) {
  const after = snapshot(f);
  const rows = (s: ReturnType<typeof snapshot>) =>
    (s.questions as Record<string, unknown>[]).map((row) =>
      row.id === id ? { ...row, status: undefined } : row,
    );
  expect(rows(after)).toEqual(rows(before));
  for (const table of tables.filter((t) => t !== 'questions'))
    expect(after[table]).toEqual(before[table]);
}
const questionStatus = (f: Fixture, id: number) =>
  (
    f.c.client.prepare('select status from questions where id=?').get(id) as {
      status: string;
    }
  ).status;
const itemRow = (f: Fixture, id: number) =>
  f.c.client.prepare('select * from study_items where id=?').get(id) as Record<
    string,
    unknown
  >;
const sessionRow = (f: Fixture, id: number) =>
  f.c.client
    .prepare('select * from study_sessions where id=?')
    .get(id) as Record<string, unknown>;
// The published set holds q0 (position 0, f.ids[0]) and q1 (position 1,
// f.ids[1]). q0 receives a second version: the draft set's first candidate is
// re-parented to q0 as version 2 (the publication.test.ts technique), confirmed
// and adopted into the draft, so one logical question spans a published version
// and an unpublished adopted candidate while q1 is a separate question.
function twoVersions(f: Fixture) {
  const q0 = f.detail().candidates[0]!.questionId;
  const q1 = f.detail().candidates[1]!.questionId;
  const v2 = getSet(f.c, f.draftId).candidates[0]!.id;
  f.c.client
    .prepare(
      'update question_versions set question_id=?,version_no=2 where id=?',
    )
    .run(q0, v2);
  const candidate = getSet(f.c, f.draftId).candidates.find((v) => v.id === v2)!;
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
  expect(
    f.c.client
      .prepare(
        'select id from question_versions where question_id=? order by id',
      )
      .all(q0),
  ).toEqual([{ id: f.ids[0] }, { id: v2 }]);
  return { q0, q1, v2, publishRequest };
}
it('stops an active question once, replays the stopped state, and rejects malformed input, missing questions and non-administrators without writing', async () => {
  const f = await fixture();
  const { q0, q1 } = twoVersions(f);
  const before = snapshot(f);
  // Input validation precedes the lookup: identity, state and reason are never
  // chosen by the client.
  for (const value of [
    null,
    [],
    'stop',
    { status: 'stopped' },
    { userId: 1 },
    { reason: 'x' },
  ])
    expect(() => stopQuestion(f.c, q0, value)).toThrow('invalid');
  expect(() => stopQuestion(f.c, 999999, { userId: 1 })).toThrow('invalid');
  expect(() => stopQuestion(f.c, 999999, {})).toThrow('missing');
  // Only an administrator stops; a learner or a missing user is forbidden.
  f.c.client.exec("update users set role='learner' where id=1");
  expect(() => stopQuestion(f.c, q0, {})).toThrow('forbidden');
  f.c.client.pragma('foreign_keys = OFF');
  f.c.client.exec('update users set id=2 where id=1');
  expect(() => stopQuestion(f.c, q0, {})).toThrow('forbidden');
  f.c.client.exec('update users set id=1 where id=2');
  f.c.client.pragma('foreign_keys = ON');
  f.c.client.exec("update users set role='admin' where id=1");
  expect(snapshot(f)).toEqual(before);
  const first = stopQuestion(f.c, q0, {});
  expect(first).toEqual({ id: q0, status: 'stopped', replayed: false });
  stoppedOnly(f, before, q0);
  expect(questionStatus(f, q0)).toBe('stopped');
  expect(questionStatus(f, q1)).toBe('active');
  // The replay returns the saved state and writes nothing.
  const afterFirst = snapshot(f);
  expect(stopQuestion(f.c, q0, {})).toEqual({ ...first, replayed: true });
  expect(snapshot(f)).toEqual(afterFirst);
  // A question stopped outside the API is replayed as stopped as well.
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(q1);
  expect(stopQuestion(f.c, q1, {})).toEqual({
    id: q1,
    status: 'stopped',
    replayed: true,
  });
  expect(
    f.c.client
      .prepare(
        'select count(*) n from question_versions where invalidated_at is not null',
      )
      .get(),
  ).toEqual({ n: 0 });
});
it('removes every version of the stopped question from the catalog, new starts, reviews and adoption while keeping saved answers, grades and the other question', async () => {
  const f = await fixture();
  const { q0, q1, v2, publishRequest } = twoVersions(f);
  const setId = f.run.setId;
  const start = () => startSession(f.c, { setId }, randomUUID()).session;
  const byPosition = (s: ReturnType<typeof getSession>, position: number) =>
    s.items.find((item) => item.position === position)!.id;
  // Before the stop: n1 answered q0 (wrong) and left q1 open; n2 answered q1
  // (wrong) and skipped q0; p1 (both wrong) has a saved review r1; p2 (both
  // wrong) has no review yet; p3 is wrong only on q0.
  const n1 = start();
  answerStudyItem(f.c, n1.id, byPosition(n1, 0), { selectedIds: WRONG });
  const n2 = start();
  answerStudyItem(f.c, n2.id, byPosition(n2, 1), { selectedIds: WRONG });
  skipStudyItem(f.c, n2.id, byPosition(n2, 0));
  const completed = (wrongPositions: number[]) => {
    const s = start();
    for (const item of s.items)
      answerStudyItem(f.c, s.id, item.id, {
        selectedIds: wrongPositions.includes(item.position) ? WRONG : CORRECT,
      });
    expect(getSession(f.c, s.id).status).toBe('completed');
    return s;
  };
  const p1 = completed([0, 1]);
  const r1Key = randomUUID();
  const r1 = startReviewSession(f.c, p1.id, {}, r1Key).session;
  expect(r1.items.map((item) => item.position)).toEqual([0, 1]);
  const p2 = completed([0, 1]);
  const p3 = completed([0]);
  const n1Before = getSession(f.c, n1.id);
  expect(getPublishedSet(f.c, setId)).toMatchObject({
    availableQuestionCount: 2,
    canStart: true,
  });
  const before = snapshot(f);
  expect(stopQuestion(f.c, q0, {})).toEqual({
    id: q0,
    status: 'stopped',
    replayed: false,
  });
  stoppedOnly(f, before, q0);
  // Catalog: the set stays listed with one fewer available question.
  expect(
    listPublishedSets(f.c, { limit: 100, before: undefined }).items,
  ).toMatchObject([{ id: setId, availableQuestionCount: 1 }]);
  expect(getPublishedSet(f.c, setId)).toMatchObject({
    availableQuestionCount: 1,
    canStart: true,
  });
  // New normal starts carry only q1; new reviews drop q0's wrong answer.
  const fresh = start();
  expect(fresh.items.map((item) => item.position)).toEqual([1]);
  const r2 = startReviewSession(f.c, p2.id, {}, randomUUID()).session;
  expect(r2.items.map((item) => item.position)).toEqual([1]);
  expect(() => startReviewSession(f.c, p3.id, {}, randomUUID())).toThrow(
    'conflict',
  );
  // Saved key replays project the current state without re-selecting.
  const r1Replay = startReviewSession(f.c, p1.id, {}, r1Key);
  expect(r1Replay).toEqual({ session: getSession(f.c, r1.id), replayed: true });
  expect(r1Replay.session.items).toEqual([
    { id: byPosition(r1, 0), position: 0, state: 'excluded', skippedAt: null },
    {
      id: byPosition(r1, 1),
      position: 1,
      state: 'unanswered',
      skippedAt: null,
    },
  ]);
  // Answered q0 keeps its grade and feedback; unanswered q0 is excluded and
  // refuses answer and skip; q1 stays answerable.
  expect(getSession(f.c, n1.id)).toEqual(n1Before);
  expect(getStudyItem(f.c, n1.id, byPosition(n1, 0))).toMatchObject({
    feedback: { selectedIds: WRONG, isCorrect: false, answerIds: CORRECT },
  });
  expect(
    answerStudyItem(f.c, n1.id, byPosition(n1, 0), { selectedIds: WRONG })
      .replayed,
  ).toBe(true);
  expect(getStudyItem(f.c, n2.id, byPosition(n2, 0))).toEqual({
    id: byPosition(n2, 0),
    position: 0,
    state: 'excluded',
  });
  expect(getSession(f.c, n2.id)).toMatchObject({
    status: 'in_progress',
    currentItemId: null,
    statistics: {
      excludedCount: 1,
      eligibleCount: 1,
      unansweredEligibleCount: 0,
      skippedUnansweredCount: 0,
    },
  });
  for (const action of [
    () =>
      answerStudyItem(f.c, n2.id, byPosition(n2, 0), { selectedIds: WRONG }),
    () => skipStudyItem(f.c, n2.id, byPosition(n2, 0)),
    () =>
      answerStudyItem(f.c, r1.id, byPosition(r1, 0), { selectedIds: CORRECT }),
    () => skipStudyItem(f.c, r1.id, byPosition(r1, 0)),
  ])
    expect(action).toThrow('conflict');
  expect(itemRow(f, byPosition(n2, 0))).toMatchObject({
    selected_ids_json: null,
    is_correct: null,
    answered_at: null,
    excluded_reason: null,
    excluded_at: null,
  });
  expect(
    answerStudyItem(f.c, r1.id, byPosition(r1, 1), { selectedIds: CORRECT })
      .session,
  ).toMatchObject({
    status: 'completed',
    statistics: { correctEligibleCount: 1, eligibleCount: 1, accuracy: 1 },
  });
  // GET and history never write; resume saves the exclusion once and completes
  // the all-excluded session.
  const projected = snapshot(f);
  getSession(f.c, n2.id);
  getStudyItem(f.c, n2.id, byPosition(n2, 0));
  listSessions(f.c, { limit: 20, status: undefined, before: undefined });
  expect(snapshot(f)).toEqual(projected);
  expect(sessionRow(f, n2.id).completed_at).toBeNull();
  const resumed = resumeSession(f.c, n2.id);
  expect(resumed).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    statistics: { correctEligibleCount: 0, eligibleCount: 1 },
  });
  expect(itemRow(f, byPosition(n2, 0))).toMatchObject({
    excluded_reason: 'stopped',
    excluded_at: expect.any(Number),
    answered_at: null,
  });
  const saved = snapshot(f);
  expect(resumeSession(f.c, n2.id)).toEqual(resumed);
  expect(snapshot(f)).toEqual(saved);
  // Adoption and publication of q0's unpublished version are refused; the
  // other question's versions and the published set are untouched.
  expect(() =>
    replaceItems(f.c, f.draftId, { expectedRevision: 1, versionIds: [v2] }),
  ).toThrow('conflict');
  expect(() => publishSet(f.c, f.draftId, publishRequest)).toThrow('conflict');
  expect(getSet(f.c, f.draftId)).toMatchObject({
    status: 'draft',
    revision: 1,
  });
  expect(getSet(f.c, setId)).toMatchObject({ status: 'published' });
  expect(
    f.c.client
      .prepare(
        'select question_id,version_no,body,reviewed_by,invalidated_at from question_versions where question_id in (?,?) order by id',
      )
      .all(q0, q1),
  ).toEqual(
    (before.question_versions as Record<string, unknown>[])
      .filter((row) => row.question_id === q0 || row.question_id === q1)
      .map((row) => ({
        question_id: row.question_id,
        version_no: row.version_no,
        body: row.body,
        reviewed_by: row.reviewed_by,
        invalidated_at: row.invalidated_at,
      })),
  );
  expect(questionStatus(f, q1)).toBe('active');
  // An invalidation of the stopped question's published version wins over the
  // stop: the answered item is excluded as invalidated, the saved exclusion
  // reason of n2 stays stopped in the row but the projection says invalidated.
  const report = createReport(f.c, n1.id, byPosition(n1, 0), {
    message: '不備',
  });
  resolveReport(f.c, report.id, { decision: 'confirmed', note: '誤り' });
  expect(getStudyItem(f.c, n1.id, byPosition(n1, 0))).toEqual({
    id: byPosition(n1, 0),
    position: 0,
    state: 'excluded',
    excludedReason: 'invalidated',
  });
  expect(getStudyItem(f.c, n2.id, byPosition(n2, 0))).toMatchObject({
    state: 'excluded',
    excludedReason: 'invalidated',
  });
  expect(itemRow(f, byPosition(n1, 0))).toMatchObject({
    selected_ids_json: JSON.stringify(WRONG),
    is_correct: 0,
    answered_at: expect.any(Number),
  });
  // Stopping the other question too leaves the set listed with nothing to start.
  stopQuestion(f.c, q1, {});
  expect(getPublishedSet(f.c, setId)).toMatchObject({
    availableQuestionCount: 0,
    canStart: false,
  });
  expect(
    listPublishedSets(f.c, { limit: 100, before: undefined }).items.map(
      (item) => item.id,
    ),
  ).toEqual([setId]);
  expect(() => startSession(f.c, { setId }, randomUUID())).toThrow('conflict');
  expect(() => startReviewSession(f.c, p2.id, {}, randomUUID())).toThrow(
    'conflict',
  );
  expect(getSession(f.c, fresh.id)).toMatchObject({
    status: 'in_progress',
    currentItemId: null,
  });
  expect(resumeSession(f.c, fresh.id).status).toBe('completed');
  expect(
    f.c.client.prepare('select count(*) n from study_sessions').get(),
  ).toEqual({ n: 8 });
});
it('rolls back a failed stop and leaves every table unchanged', async () => {
  const f = await fixture();
  const { q0 } = twoVersions(f);
  const before = snapshot(f);
  f.c.client.exec(
    "create trigger fail_stop before update of status on questions when new.status='stopped' begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() => stopQuestion(f.c, q0, {})).toThrow();
  expect(snapshot(f)).toEqual(before);
  expect(questionStatus(f, q0)).toBe('active');
  f.c.client.exec('drop trigger fail_stop');
  expect(stopQuestion(f.c, q0, {}).replayed).toBe(false);
  stoppedOnly(f, before, q0);
  expect(questionStatus(f, q0)).toBe('stopped');
});
