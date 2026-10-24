import { expect, it, afterEach } from 'vitest';
import { publicationFixture } from '../fixtures/publication';
import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
import { confirmVersion } from '../../server/services/review/service';
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const fn of cleanups.splice(0))
    try {
      fn();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors);
});
async function fixture() {
  const f = await publicationFixture();
  cleanups.push(f.close);
  return f;
}
it('saves ordered subsets atomically, treats current identical state as no-op, and prevents ABA revival', async () => {
  const { c, run, ids, detail } = await fixture();
  const first = replaceItems(c, run.setId, {
    expectedRevision: 0,
    versionIds: [ids[1], ids[0]],
  });
  expect(first.revision).toBe(1);
  expect(detail().items.map((i) => i.versionId)).toEqual([ids[1], ids[0]]);
  expect(
    replaceItems(c, run.setId, {
      expectedRevision: 0,
      versionIds: [ids[1], ids[0]],
    }),
  ).toEqual(first);
  const second = replaceItems(c, run.setId, {
    expectedRevision: 1,
    versionIds: [ids[0]],
  });
  expect(second.publishFingerprint).not.toBe(first.publishFingerprint);
  expect(() =>
    replaceItems(c, run.setId, {
      expectedRevision: 0,
      versionIds: [ids[1], ids[0]],
    }),
  ).toThrow('conflict');
  c.client.exec(
    "create trigger fail_second after insert on set_items when new.position=1 begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() =>
    replaceItems(c, run.setId, { expectedRevision: 2, versionIds: ids }),
  ).toThrow();
  expect(detail().revision).toBe(2);
  expect(detail().items.map((i) => i.versionId)).toEqual([ids[0]]);
});
it('publishes only the fingerprinted reviewed set once and protects history and referenced review metadata', async () => {
  const { c, run, ids, detail } = await fixture();
  expect(() =>
    publishSet(c, run.setId, {
      expectedRevision: 0,
      publishFingerprint: detail().publishFingerprint,
      confirmed: true,
    }),
  ).toThrow('conflict');
  replaceItems(c, run.setId, { expectedRevision: 0, versionIds: [ids[1]] });
  const request = {
    expectedRevision: 1,
    publishFingerprint: detail().publishFingerprint,
    confirmed: true,
  };
  const first = publishSet(c, run.setId, request);
  expect(first).toMatchObject({
    status: 'published',
    revision: 2,
    publishedBy: 1,
    replayed: false,
  });
  expect(publishSet(c, run.setId, request)).toEqual({
    ...first,
    replayed: true,
  });
  expect(() =>
    publishSet(c, run.setId, { ...request, expectedRevision: 2 }),
  ).toThrow('conflict');
  expect(() =>
    replaceItems(c, run.setId, { expectedRevision: 2, versionIds: [] }),
  ).toThrow('conflict');
  const v = detail().candidates[1]!;
  const confirmation = {
    fingerprint: v.fingerprint,
    confirmed: true,
    acknowledgeQuoteMismatch: false,
  };
  expect(() => confirmVersion(c, run.setId, v.id, confirmation)).toThrow(
    'conflict',
  );
  c.client.exec("update question_sets set status='archived'");
  expect(() =>
    replaceItems(c, run.setId, { expectedRevision: 2, versionIds: [] }),
  ).toThrow('conflict');
  expect(() => publishSet(c, run.setId, request)).toThrow('conflict');
  // Even a fixture reverting status cannot erase the publication history guard.
  c.client.exec("update question_sets set status='draft'");
  expect(() => confirmVersion(c, run.setId, v.id, confirmation)).toThrow(
    'conflict',
  );
  expect(detail().publishedAt).toBe(first.publishedAt);
});
it('revalidates candidate review, status, format and logical identity before selection and publish', async () => {
  const { c, run, ids, detail, generate } = await fixture();
  const other = await generate();
  expect(() =>
    replaceItems(c, other.setId, { expectedRevision: 0, versionIds: [ids[0]] }),
  ).toThrow('missing');
  replaceItems(c, run.setId, { expectedRevision: 0, versionIds: [ids[0]] });
  const request = {
    expectedRevision: 1,
    publishFingerprint: detail().publishFingerprint,
    confirmed: true,
  };
  for (const [change, restore] of [
    [
      'update question_versions set reviewed_by=null',
      'update question_versions set reviewed_by=1',
    ],
    [
      "update questions set status='stopped'",
      "update questions set status='active'",
    ],
    [
      "update question_versions set answer_ids_json='[]'",
      'update question_versions set answer_ids_json=\'["a"]\'',
    ],
  ]) {
    c.client.exec(change!);
    expect(() => publishSet(c, run.setId, request)).toThrow('conflict');
    expect(() =>
      replaceItems(c, run.setId, { expectedRevision: 1, versionIds: [ids[0]] }),
    ).toThrow('conflict');
    c.client.exec(restore!);
  }
  c.client
    .prepare(
      'update question_versions set question_id=?,version_no=2 where id=?',
    )
    .run(detail().candidates[0]!.questionId, ids[1]);
  expect(() =>
    replaceItems(c, run.setId, {
      expectedRevision: 1,
      versionIds: [ids[0], ids[1]],
    }),
  ).toThrow('conflict');
  expect(detail().status).toBe('draft');
});
it('enforces selection DB constraints and protects versions referenced by another historical set', async () => {
  const { c, run, ids, detail, generate } = await fixture();
  const other = await generate();
  const insert = c.client.prepare(
    'insert into set_items(set_id,question_version_id,position) values(?,?,?)',
  );
  insert.run(run.setId, ids[0], 0);
  for (const row of [
    [run.setId, ids[1], 0],
    [run.setId, ids[0], 1],
    [run.setId, ids[1], -1],
    [99999, ids[1], 0],
    [run.setId, 99999, 1],
  ])
    expect(() => insert.run(...row)).toThrow();
  insert.run(other.setId, ids[0], 0);
  c.client
    .prepare(
      "update question_sets set status='archived',published_at=123,published_by=1 where id=?",
    )
    .run(other.setId);
  const v = detail().candidates[0]!;
  expect(() =>
    confirmVersion(c, run.setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    }),
  ).toThrow('conflict');
});

it('detects valid content/review metadata changes and permits explicitly acknowledged quote mismatches', async () => {
  const { c, run, ids, detail } = await fixture();
  replaceItems(c, run.setId, { expectedRevision: 0, versionIds: [ids[0]] });
  const initial = {
    expectedRevision: 1,
    publishFingerprint: detail().publishFingerprint,
    confirmed: true,
  };
  c.client
    .prepare('update question_versions set body=? where id=?')
    .run('変更した有効な問題', ids[0]);
  expect(() => publishSet(c, run.setId, initial)).toThrow('conflict');
  const changed = {
    ...initial,
    publishFingerprint: detail().publishFingerprint,
  };
  c.client
    .prepare(
      'update question_versions set reviewed_at=reviewed_at+1 where id=?',
    )
    .run(ids[0]);
  expect(() => publishSet(c, run.setId, changed)).toThrow('conflict');
  c.client
    .prepare(
      'update question_versions set quote=?,reviewed_by=null,reviewed_at=null where id=?',
    )
    .run('教材にない引用', ids[0]);
  const v = detail().candidates[0]!;
  expect(v.quoteVerified).toBe(false);
  confirmVersion(c, run.setId, v.id, {
    fingerprint: v.fingerprint,
    confirmed: true,
    acknowledgeQuoteMismatch: true,
  });
  expect(
    publishSet(c, run.setId, {
      ...initial,
      publishFingerprint: detail().publishFingerprint,
    }).status,
  ).toBe('published');
});
