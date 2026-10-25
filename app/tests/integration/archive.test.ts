import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import {
  archiveSet,
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
import { getSet } from '../../server/services/review/service';
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
// Issue #46: the administrator's explicit one-way archive of a published set.
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
// Every row of every table. The archive transition may change only
// question_sets.status and question_sets.revision of the archived set.
function snapshot(f: Fixture) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      f.c.client.prepare(`select * from ${table} order by id`).all(),
    ]),
  );
}
function setRow(f: Fixture, id: number) {
  return f.c.client
    .prepare('select * from question_sets where id=?')
    .get(id) as Record<string, unknown>;
}
// Only question_sets.status/revision of the one archived set may differ.
function archivedOnly(
  f: Fixture,
  before: ReturnType<typeof snapshot>,
  id: number,
) {
  const after = snapshot(f);
  const rows = (s: ReturnType<typeof snapshot>) =>
    (s.question_sets as Record<string, unknown>[]).map((row) =>
      row.id === id ? { ...row, status: undefined, revision: undefined } : row,
    );
  expect(rows(after)).toEqual(rows(before));
  for (const table of tables.filter((t) => t !== 'question_sets'))
    expect(after[table]).toEqual(before[table]);
}
const savedPublishRequest = (f: Fixture) => {
  const row = setRow(f, f.run.setId);
  return {
    expectedRevision: row.publish_request_revision as number,
    publishFingerprint: row.publish_request_fingerprint as string,
    confirmed: true,
  };
};
it('archives a published set once, replays the archived state, and rejects drafts, missing sets and incomplete publication records without writing', async () => {
  const f = await fixture();
  const published = setRow(f, f.run.setId);
  expect(published.status).toBe('published');
  const before = snapshot(f);
  // Input validation precedes the lookup: identity, state and revision are
  // never chosen by the client.
  for (const value of [
    null,
    [],
    { status: 'archived' },
    { userId: 1 },
    { revision: 1 },
  ])
    expect(() => archiveSet(f.c, f.run.setId, value)).toThrow('invalid');
  expect(() => archiveSet(f.c, 999999, { userId: 1 })).toThrow('invalid');
  expect(() => archiveSet(f.c, 999999, {})).toThrow('missing');
  expect(() => archiveSet(f.c, f.draftId, {})).toThrow('conflict');
  expect(snapshot(f)).toEqual(before);
  const first = archiveSet(f.c, f.run.setId, {});
  expect(first).toEqual({
    id: f.run.setId,
    status: 'archived',
    revision: (published.revision as number) + 1,
    publishedBy: published.published_by,
    publishedAt: published.published_at,
    replayed: false,
  });
  archivedOnly(f, before, f.run.setId);
  const row = setRow(f, f.run.setId);
  expect(row).toMatchObject({
    status: 'archived',
    revision: first.revision,
    published_by: published.published_by,
    published_at: published.published_at,
    publish_request_revision: published.publish_request_revision,
    publish_request_fingerprint: published.publish_request_fingerprint,
  });
  // The replay returns the saved state and bumps nothing.
  const afterFirst = snapshot(f);
  expect(archiveSet(f.c, f.run.setId, {})).toEqual({
    ...first,
    replayed: true,
  });
  expect(snapshot(f)).toEqual(afterFirst);
  // The fixture's SQL-archived set has a publication record: replayed as is.
  const archivedRow = setRow(f, f.archivedId);
  expect(archiveSet(f.c, f.archivedId, {})).toEqual({
    id: f.archivedId,
    status: 'archived',
    revision: archivedRow.revision,
    publishedBy: 1,
    publishedAt: 1,
    replayed: true,
  });
  expect(snapshot(f)).toEqual(afterFirst);
  // Incomplete publication records are conflicts whichever status they carry.
  for (const [status, column] of [
    ['published', 'published_by'],
    ['published', 'published_at'],
    ['archived', 'published_by'],
    ['archived', 'published_at'],
  ] as const) {
    f.c.client
      .prepare(`update question_sets set status=?,${column}=null where id=?`)
      .run(status, f.archivedId);
    expect(() => archiveSet(f.c, f.archivedId, {})).toThrow('conflict');
    expect(setRow(f, f.archivedId)).toMatchObject({
      status,
      revision: archivedRow.revision,
    });
  }
  f.c.client
    .prepare(
      "update question_sets set status='archived',published_by=1,published_at=1 where id=?",
    )
    .run(f.archivedId);
  // Administration still reads the archived set with its fixed selection.
  const detail = getSet(f.c, f.run.setId);
  expect(detail).toMatchObject({
    status: 'archived',
    revision: first.revision,
    publishedBy: published.published_by,
    publishedAt: published.published_at,
  });
  expect(detail.items.map((item) => item.versionId)).toEqual(f.ids.slice(0, 2));
  expect(detail.candidates).toHaveLength(3);
  // Only an administrator archives; a learner or a missing user is forbidden.
  f.c.client.exec("update users set role='learner' where id=1");
  expect(() => archiveSet(f.c, f.run.setId, {})).toThrow('forbidden');
  f.c.client.pragma('foreign_keys = OFF');
  f.c.client.exec('update users set id=2 where id=1');
  expect(() => archiveSet(f.c, f.run.setId, {})).toThrow('forbidden');
  f.c.client.exec('update users set id=1 where id=2');
  f.c.client.pragma('foreign_keys = ON');
  f.c.client.exec("update users set role='admin' where id=1");
  expect(snapshot(f)).toEqual(afterFirst);
});
it('hides the archived set from the catalog, refuses new normal and review starts, replays saved keys and keeps saved sessions usable', async () => {
  const f = await fixture();
  const normalKey = randomUUID();
  const reviewKey = randomUUID();
  const started = startSession(f.c, { setId: f.run.setId }, normalKey);
  const parent = started.session;
  expect(parent.items).toHaveLength(2);
  for (const item of parent.items)
    answerStudyItem(f.c, parent.id, item.id, { selectedIds: WRONG });
  expect(getSession(f.c, parent.id).status).toBe('completed');
  const review = startReviewSession(f.c, parent.id, {}, reviewKey);
  const child = review.session;
  expect(child.items.map((item) => item.position)).toEqual([0, 1]);
  const publishRequest = savedPublishRequest(f);
  expect(publishSet(f.c, f.run.setId, publishRequest).replayed).toBe(true);
  const before = snapshot(f);
  const result = archiveSet(f.c, f.run.setId, {});
  expect(result.replayed).toBe(false);
  archivedOnly(f, before, f.run.setId);
  // Catalog: gone from the list, detail is missing.
  expect(
    listPublishedSets(f.c, { limit: 100, before: undefined }).items,
  ).toEqual([]);
  expect(() => getPublishedSet(f.c, f.run.setId)).toThrow();
  // New starts are refused the existing way; saved keys replay.
  expect(() => startSession(f.c, { setId: f.run.setId }, randomUUID())).toThrow(
    'missing',
  );
  expect(() => startReviewSession(f.c, parent.id, {}, randomUUID())).toThrow(
    'conflict',
  );
  const sessionsBefore = snapshot(f).study_sessions;
  expect(startSession(f.c, { setId: f.run.setId }, normalKey)).toEqual({
    session: getSession(f.c, parent.id),
    replayed: true,
  });
  expect(startReviewSession(f.c, parent.id, {}, reviewKey)).toEqual({
    ...review,
    replayed: true,
  });
  expect(snapshot(f).study_sessions).toEqual(sessionsBefore);
  // The old publish request no longer re-publishes.
  expect(() => publishSet(f.c, f.run.setId, publishRequest)).toThrow(
    'conflict',
  );
  expect(() =>
    replaceItems(f.c, f.run.setId, {
      expectedRevision: result.revision,
      versionIds: [],
    }),
  ).toThrow('conflict');
  expect(setRow(f, f.run.setId).status).toBe('archived');
  // The saved review keeps working: item GET, skip, answer, resume, history.
  const parentBefore = {
    session: f.c.client
      .prepare('select * from study_sessions where id=?')
      .get(parent.id),
    items: f.c.client
      .prepare('select * from study_items where session_id=? order by position')
      .all(parent.id),
  };
  const [x, y] = child.items as [
    (typeof child.items)[number],
    (typeof child.items)[number],
  ];
  expect(Object.keys(getStudyItem(f.c, child.id, x.id)).sort()).toEqual(
    ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
  );
  expect(skipStudyItem(f.c, child.id, x.id).session.currentItemId).toBe(y.id);
  expect(
    answerStudyItem(f.c, child.id, y.id, { selectedIds: CORRECT }).item,
  ).toMatchObject({ feedback: { isCorrect: true } });
  const done = answerStudyItem(f.c, child.id, x.id, { selectedIds: WRONG });
  expect(done.session).toMatchObject({
    status: 'completed',
    parentSessionId: parent.id,
    statistics: { correctEligibleCount: 1, eligibleCount: 2 },
  });
  expect(resumeSession(f.c, child.id)).toEqual(done.session);
  expect(resumeSession(f.c, parent.id)).toEqual(getSession(f.c, parent.id));
  const listed = listSessions(f.c, {
    limit: 20,
    status: undefined,
    before: undefined,
  }).items;
  expect(listed.map((item) => item.id).sort()).toEqual(
    [parent.id, child.id].sort(),
  );
  expect(listed.find((item) => item.id === parent.id)).toMatchObject({
    status: 'completed',
    statistics: { correctEligibleCount: 0, eligibleCount: 2 },
  });
  expect({
    session: f.c.client
      .prepare('select * from study_sessions where id=?')
      .get(parent.id),
    items: f.c.client
      .prepare('select * from study_items where session_id=? order by position')
      .all(parent.id),
  }).toEqual(parentBefore);
  // Stopping alone does not stop or invalidate questions.
  expect(
    f.c.client
      .prepare(
        "select count(*) n from questions where status<>'active' union all select count(*) from question_versions where invalidated_at is not null",
      )
      .all(),
  ).toEqual([{ n: 0 }, { n: 0 }]);
  // A review of the completed child is refused as well: no new start at all.
  expect(() => startReviewSession(f.c, child.id, {}, randomUUID())).toThrow(
    'conflict',
  );
});
it('rolls back a failed archive and leaves every table unchanged', async () => {
  const f = await fixture();
  const before = snapshot(f);
  f.c.client.exec(
    "create trigger fail_archive before update of status on question_sets when new.status='archived' begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() => archiveSet(f.c, f.run.setId, {})).toThrow();
  expect(snapshot(f)).toEqual(before);
  expect(setRow(f, f.run.setId)).toMatchObject({
    status: 'published',
    revision: (before.question_sets as Record<string, unknown>[]).find(
      (row) => row.id === f.run.setId,
    )!.revision,
  });
  f.c.client.exec('drop trigger fail_archive');
  expect(archiveSet(f.c, f.run.setId, {}).replayed).toBe(false);
  archivedOnly(f, before, f.run.setId);
  // The revision moves exactly once across the failure and the success.
  expect(setRow(f, f.run.setId).revision).toBe(
    ((before.question_sets as Record<string, unknown>[]).find(
      (row) => row.id === f.run.setId,
    )!.revision as number) + 1,
  );
});
