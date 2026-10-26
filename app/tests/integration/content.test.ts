import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { publicationFixture } from '../fixtures/publication';
import { catalogFixture } from '../fixtures/catalog';
import { candidate } from '../fixtures/generation';
import {
  confirmVersion,
  getSet,
  updateVersionContent,
} from '../../server/services/review/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
import { startSession } from '../../server/services/study/service';
// Issue #48: full content replacement of one candidate of a never-published
// draft set, with quote recheck, confirmation reset and revision bump.
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
type Connection = Awaited<ReturnType<typeof publicationFixture>>['c'];
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
function snapshot(c: Connection) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      c.client.prepare(`select * from ${table} order by id`).all(),
    ]),
  );
}
type Candidate = ReturnType<typeof getSet>['candidates'][number];
// The edit body for a candidate as the client last saw it.
function edit(
  revision: number,
  v: Candidate,
  patch: Partial<ReturnType<typeof candidate>> = {},
) {
  return {
    expectedRevision: revision,
    expectedFingerprint: v.fingerprint,
    body: v.body,
    choices: v.choices,
    answerIds: v.answerIds,
    explanation: v.explanation,
    quote: v.quote,
    ...patch,
  };
}
const publishRequest = (d: ReturnType<typeof getSet>) => ({
  expectedRevision: d.revision,
  publishFingerprint: d.publishFingerprint,
  confirmed: true,
});
async function fixture() {
  const f = await publicationFixture();
  cleanups.push(f.close);
  return f;
}
it('edits an adopted confirmed candidate: rechecks the quote, clears the confirmation, bumps the revision, keeps the selection and blocks publication until reconfirmed', async () => {
  const { c, run, ids, detail } = await fixture();
  replaceItems(c, run.setId, {
    expectedRevision: 0,
    versionIds: [ids[1]!, ids[0]!],
  });
  const before = snapshot(c);
  const d = detail();
  expect(d.revision).toBe(1);
  const stale = publishRequest(d);
  const v = d.candidates.find((x) => x.id === ids[0])!;
  expect(v).toMatchObject({ reviewedBy: 1, quoteVerified: true });
  const result = updateVersionContent(
    c,
    run.setId,
    v.id,
    edit(1, v, {
      ...candidate('修正した問題'),
      quote: '教材にない引用',
    }),
  );
  expect(result).toMatchObject({
    id: v.id,
    questionId: v.questionId,
    versionNo: v.versionNo,
    body: '修正した問題',
    quote: '教材にない引用',
    quoteVerified: false,
    reviewedBy: null,
    reviewedAt: null,
    revision: 2,
    changed: true,
  });
  expect(Object.keys(result).sort()).toEqual(
    [
      'id',
      'questionId',
      'versionNo',
      'body',
      'choices',
      'answerIds',
      'explanation',
      'quote',
      'quoteVerified',
      'reviewedBy',
      'reviewedAt',
      'fingerprint',
      'revision',
      'changed',
    ].sort(),
  );
  expect(result.fingerprint).not.toBe(v.fingerprint);
  const after = snapshot(c);
  const changedOnly = (
    s: ReturnType<typeof snapshot>,
    table: string,
    id: number,
    columns: string[],
  ) =>
    (s[table] as Record<string, unknown>[]).map((row) =>
      row.id === id
        ? { ...row, ...Object.fromEntries(columns.map((k) => [k, undefined])) }
        : row,
    );
  // Only the target version's content/quote/confirmation columns and the set
  // revision differ; set_items ids/positions, siblings, runs, questions and the
  // source keep every byte.
  const versionColumns = [
    'body',
    'choices_json',
    'answer_ids_json',
    'explanation',
    'quote',
    'quote_verified',
    'reviewed_by',
    'reviewed_at',
  ];
  expect(changedOnly(after, 'question_versions', v.id, versionColumns)).toEqual(
    changedOnly(before, 'question_versions', v.id, versionColumns),
  );
  expect(changedOnly(after, 'question_sets', run.setId, ['revision'])).toEqual(
    changedOnly(before, 'question_sets', run.setId, ['revision']),
  );
  for (const table of tables.filter(
    (t) => !['question_versions', 'question_sets'].includes(t),
  ))
    expect(after[table]).toEqual(before[table]);
  const edited = detail();
  expect(edited.revision).toBe(2);
  expect(edited.items.map((i) => [i.versionId, i.position])).toEqual([
    [ids[1], 0],
    [ids[0], 1],
  ]);
  expect(edited.candidates.find((x) => x.id === v.id)).toMatchObject({
    body: '修正した問題',
    quoteVerified: false,
    reviewedBy: null,
    reviewedAt: null,
    fingerprint: result.fingerprint,
  });
  expect(edited.publishFingerprint).not.toBe(d.publishFingerprint);
  // The old publish request and a fresh one both fail until reconfirmation.
  expect(() => publishSet(c, run.setId, stale)).toThrow('conflict');
  expect(() => publishSet(c, run.setId, publishRequest(edited))).toThrow(
    'conflict',
  );
  // The stale confirmation of the old content is refused; the new content
  // needs the quote mismatch acknowledgement, then publication succeeds.
  expect(() =>
    confirmVersion(c, run.setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    }),
  ).toThrow('conflict');
  expect(() =>
    confirmVersion(c, run.setId, v.id, {
      fingerprint: result.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    }),
  ).toThrow('conflict');
  expect(
    confirmVersion(c, run.setId, v.id, {
      fingerprint: result.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    }).reviewedBy,
  ).toBe(1);
  expect(detail().revision).toBe(2);
  expect(publishSet(c, run.setId, publishRequest(detail()))).toMatchObject({
    status: 'published',
    revision: 3,
  });
  // Published content is fixed: no further edit of any candidate of the set.
  const published = snapshot(c);
  for (const id of ids)
    expect(() =>
      updateVersionContent(
        c,
        run.setId,
        id,
        edit(
          3,
          detail().candidates.find((x) => x.id === id)!,
          {
            body: '公開後の修正',
          },
        ),
      ),
    ).toThrow('conflict');
  expect(snapshot(c)).toEqual(published);
});
it('edits an unadopted candidate, treats identical content at the current revision as a no-op, and refuses stale revision, stale fingerprint and ABA replays', async () => {
  const { c, run, ids, detail } = await fixture();
  const v = detail().candidates.find((x) => x.id === ids[2])!;
  const before = snapshot(c);
  // Identical content at the current revision: nothing changes, including the
  // confirmation and the revision.
  const noop = updateVersionContent(c, run.setId, v.id, edit(0, v));
  expect(noop).toMatchObject({
    id: v.id,
    body: v.body,
    quoteVerified: true,
    reviewedBy: 1,
    reviewedAt: v.reviewedAt,
    fingerprint: v.fingerprint,
    revision: 0,
    changed: false,
  });
  expect(snapshot(c)).toEqual(before);
  // Identical content with a stale revision or fingerprint is a conflict.
  for (const value of [
    { ...edit(0, v), expectedRevision: 1 },
    { ...edit(0, v), expectedFingerprint: 'a'.repeat(64) },
    { ...edit(0, v, { body: '別の問題' }), expectedRevision: 1 },
  ]) {
    expect(() => updateVersionContent(c, run.setId, v.id, value)).toThrow(
      'conflict',
    );
    expect(snapshot(c)).toEqual(before);
  }
  // A -> B -> A: the content fingerprint returns to its first value, but the
  // revision has moved twice.
  const toB = updateVersionContent(
    c,
    run.setId,
    v.id,
    edit(0, v, { body: 'B の問題' }),
  );
  expect(toB).toMatchObject({ revision: 1, changed: true, reviewedBy: null });
  expect(toB.fingerprint).not.toBe(v.fingerprint);
  const backToA = updateVersionContent(c, run.setId, v.id, {
    ...edit(1, v),
    expectedFingerprint: toB.fingerprint,
  });
  expect(backToA).toMatchObject({
    revision: 2,
    changed: true,
    fingerprint: v.fingerprint,
    body: v.body,
    reviewedBy: null,
  });
  const afterABA = snapshot(c);
  // The original B request (revision 0, first fingerprint) must not revive B,
  // and a resend of A with the old revision is also refused.
  expect(() =>
    updateVersionContent(c, run.setId, v.id, edit(0, v, { body: 'B の問題' })),
  ).toThrow('conflict');
  expect(() => updateVersionContent(c, run.setId, v.id, edit(0, v))).toThrow(
    'conflict',
  );
  expect(() => updateVersionContent(c, run.setId, v.id, edit(1, v))).toThrow(
    'conflict',
  );
  expect(snapshot(c)).toEqual(afterABA);
  // The current pair with identical content is again a no-op.
  expect(updateVersionContent(c, run.setId, v.id, edit(2, v))).toMatchObject({
    revision: 2,
    changed: false,
    reviewedBy: null,
  });
  expect(snapshot(c)).toEqual(afterABA);
  // Set items were never touched; the edited candidate was never adopted.
  expect(detail().items).toEqual([]);
  expect(detail().revision).toBe(2);
  // Confirmation after the edit works with the new (here: restored) fingerprint
  // and does not move the revision.
  expect(
    confirmVersion(c, run.setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    }).reviewedBy,
  ).toBe(1);
  expect(detail().revision).toBe(2);
});
it('rejects forbidden states and separates publication/history-referenced and invalidated draft edits', async () => {
  const f = await catalogFixture();
  cleanups.push(f.close);
  const { c } = f;
  const published = getSet(c, f.run.setId);
  const draft = getSet(c, f.draftId);
  const archived = getSet(c, f.archivedId);
  const dv = draft.candidates[0]!;
  const before = snapshot(c);
  // Input validation precedes any lookup.
  expect(() =>
    updateVersionContent(c, 999999, 1, { ...edit(0, dv), reviewedBy: 1 }),
  ).toThrow('invalid');
  expect(() =>
    updateVersionContent(c, f.draftId, dv.id, { ...edit(0, dv), id: dv.id }),
  ).toThrow('invalid');
  // Missing set, missing version and a version of another set are 404.
  expect(() => updateVersionContent(c, 999999, dv.id, edit(0, dv))).toThrow(
    'missing',
  );
  expect(() => updateVersionContent(c, f.draftId, 999999, edit(0, dv))).toThrow(
    'missing',
  );
  expect(() =>
    updateVersionContent(c, f.run.setId, dv.id, edit(0, dv)),
  ).toThrow('missing');
  // Every candidate of a published set (adopted or not) and of an archived set.
  for (const v of published.candidates)
    expect(() =>
      updateVersionContent(
        c,
        f.run.setId,
        v.id,
        edit(published.revision, v, { body: '公開後の修正' }),
      ),
    ).toThrow('conflict');
  for (const v of archived.candidates)
    expect(() =>
      updateVersionContent(
        c,
        f.archivedId,
        v.id,
        edit(archived.revision, v, { body: '停止後の修正' }),
      ),
    ).toThrow('conflict');
  expect(snapshot(c)).toEqual(before);
  const assertCopy = () => {
    const original = c.client
      .prepare('select * from question_versions where id=?')
      .get(dv.id);
    c.client.exec('savepoint test_copy');
    try {
      const result = updateVersionContent(
        c,
        f.draftId,
        dv.id,
        edit(0, dv, { body: '修正' }),
      );
      expect(result.id).not.toBe(dv.id);
      expect(
        c.client
          .prepare('select * from question_versions where id=?')
          .get(dv.id),
      ).toEqual(original);
    } finally {
      c.client.exec('rollback to test_copy; release test_copy');
    }
  };
  // A draft candidate referenced by another set with a publication record
  // (published or archived) or by any study item must separate from the old row.
  const session = startSession(c, { setId: f.run.setId }, randomUUID()).session;
  const withSession = snapshot(c);
  const insertItem = c.client.prepare(
    'insert into set_items(set_id,question_version_id,position) values(?,?,?)',
  );
  for (const [setId, restore] of [
    [
      f.run.setId,
      () =>
        c.client.exec(
          `delete from set_items where set_id=${f.run.setId} and position=5`,
        ),
    ],
    [
      f.archivedId,
      () => c.client.exec(`delete from set_items where set_id=${f.archivedId}`),
    ],
  ] as const) {
    c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(setId, dv.id);
    insertItem.run(setId, dv.id, 5);
    assertCopy();
    restore();
    c.client
      .prepare(
        'delete from set_candidates where set_id=? and question_version_id=?',
      )
      .run(setId, dv.id);
    expect(snapshot(c)).toEqual(withSession);
  }
  c.client
    .prepare(
      'insert into study_items(session_id,question_version_id,position) values(?,?,?)',
    )
    .run(session.id, dv.id, 9);
  assertCopy();
  c.client.exec(`delete from study_items where position=9`);
  expect(snapshot(c)).toEqual(withSession);
  // State conflicts of the candidate itself.
  for (const [change, restore] of [
    [
      `update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='x' where id=${dv.id}`,
      `update question_versions set invalidated_at=null,invalidated_by=null,invalidation_reason=null where id=${dv.id}`,
    ],
    [
      `update questions set status='stopped' where id=${dv.questionId}`,
      `update questions set status='active' where id=${dv.questionId}`,
    ],
    [
      `update generation_runs set status='failed' where set_id=${f.draftId}`,
      `update generation_runs set status='succeeded' where set_id=${f.draftId}`,
    ],
    [
      `update question_versions set reviewed_by=1,reviewed_at=null where id=${dv.id}`,
      `update question_versions set reviewed_by=null,reviewed_at=null where id=${dv.id}`,
    ],
    [
      `update question_sets set status='published' where id=${f.draftId}`,
      `update question_sets set status='draft' where id=${f.draftId}`,
    ],
    [
      `update question_sets set published_at=1 where id=${f.draftId}`,
      `update question_sets set published_at=null where id=${f.draftId}`,
    ],
  ]) {
    c.client.exec(change!);
    if (change!.includes('invalidated_at=1')) assertCopy();
    else {
      expect(() =>
        updateVersionContent(
          c,
          f.draftId,
          dv.id,
          edit(0, dv, { body: '修正' }),
        ),
      ).toThrow('conflict');
    }
    c.client.exec(restore!);
    expect(snapshot(c)).toEqual(withSession);
  }
  // Source association mismatch of the question.
  const other = c.client
    .prepare(
      "insert into sources(title,body,created_by,created_at) values('別教材','別',1,1)",
    )
    .run();
  c.client
    .prepare('update questions set source_id=? where id=?')
    .run(other.lastInsertRowid, dv.questionId);
  expect(() =>
    updateVersionContent(c, f.draftId, dv.id, edit(0, dv, { body: '修正' })),
  ).toThrow('conflict');
  c.client
    .prepare('update questions set source_id=1 where id=?')
    .run(dv.questionId);
  c.client.exec(`delete from sources where id=${other.lastInsertRowid}`);
  expect(snapshot(c)).toEqual(withSession);
  // Only an administrator edits.
  c.client.exec("update users set role='learner' where id=1");
  expect(() =>
    updateVersionContent(c, f.draftId, dv.id, edit(0, dv, { body: '修正' })),
  ).toThrow('forbidden');
  c.client.exec("update users set role='admin' where id=1");
  c.client.pragma('foreign_keys = OFF');
  c.client.exec('update users set id=2 where id=1');
  expect(() =>
    updateVersionContent(c, f.draftId, dv.id, edit(0, dv, { body: '修正' })),
  ).toThrow('forbidden');
  c.client.exec('update users set id=1 where id=2');
  c.client.pragma('foreign_keys = ON');
  expect(snapshot(c)).toEqual(withSession);
  // The draft candidate itself is still editable once nothing references it.
  expect(
    updateVersionContent(c, f.draftId, dv.id, edit(0, dv, { body: '修正' })),
  ).toMatchObject({ changed: true, revision: 1, quoteVerified: false });
});
it('serializes against confirmation in both orders and rolls back a failed update entirely', async () => {
  const { c, run, detail } = await fixture();
  const d = detail();
  const [a, b] = d.candidates as [Candidate, Candidate];
  // Confirmation first, then an edit: the edit clears it.
  expect(a.reviewedBy).toBe(1);
  const edited = updateVersionContent(
    c,
    run.setId,
    a.id,
    edit(0, a, { body: '確認後の修正' }),
  );
  expect(edited).toMatchObject({ reviewedBy: null, revision: 1 });
  // Edit first, then the confirmation of the old content: refused; the new
  // fingerprint confirms, the revision stays.
  expect(() =>
    confirmVersion(c, run.setId, a.id, {
      fingerprint: a.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    }),
  ).toThrow('conflict');
  expect(detail().candidates.find((x) => x.id === a.id)!.reviewedAt).toBeNull();
  expect(
    confirmVersion(c, run.setId, a.id, {
      fingerprint: edited.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    }).reviewedBy,
  ).toBe(1);
  expect(detail().revision).toBe(1);
  // A failing set revision update rolls back the already written content and
  // confirmation reset; a failing version update rolls back as well.
  const before = snapshot(c);
  for (const trigger of [
    "create trigger fail_edit before update of revision on question_sets begin select raise(abort,'PRIVATE_SQL'); end",
    "create trigger fail_edit before update of body on question_versions begin select raise(abort,'PRIVATE_SQL'); end",
  ]) {
    c.client.exec(trigger);
    expect(() =>
      updateVersionContent(
        c,
        run.setId,
        b.id,
        edit(1, b, { body: '失敗する修正' }),
      ),
    ).toThrow();
    expect(snapshot(c)).toEqual(before);
    expect(detail().candidates.find((x) => x.id === b.id)).toMatchObject({
      body: b.body,
      reviewedBy: 1,
      fingerprint: b.fingerprint,
    });
    expect(detail().revision).toBe(1);
    c.client.exec('drop trigger fail_edit');
  }
  // The revision moves exactly once across the failures and the success.
  expect(
    updateVersionContent(
      c,
      run.setId,
      b.id,
      edit(1, b, { body: '失敗後の修正' }),
    ),
  ).toMatchObject({ revision: 2, changed: true, reviewedBy: null });
  expect(detail().revision).toBe(2);
});
