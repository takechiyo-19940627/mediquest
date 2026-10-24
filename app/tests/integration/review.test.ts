import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import { generateQuestions } from '../../server/services/generation/service';
import {
  getSet,
  listSets,
  confirmVersion,
} from '../../server/services/review/service';
import { output, sourceText } from '../fixtures/generation';
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0))
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors);
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mediquest-review-'));
  const env = { MEDIQUEST_DB_PATH: join(dir, 'test.sqlite') };
  const c = openDatabase(env);
  cleanups.push(() => {
    try {
      c.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  migrateDatabase(c, fileURLToPath(new URL('../../drizzle', import.meta.url)));
  seedAdministrator(c);
  createSource(c, { title: '教材', body: sourceText }, randomUUID());
  const generate = () =>
    generateQuestions(
      {
        sourceId: 1,
        title: 'セット',
        requestedCount: 2,
        requestKey: randomUUID(),
      },
      { model: 'test', promptVersion: 'v1' },
      async () => ({ kind: 'success', output: output(2) }),
      () => openDatabase(env),
    );
  const run = await generate();
  const set = getSet(c, run.setId);
  const v = set.candidates[0]!;
  const input = {
    fingerprint: v.fingerprint,
    confirmed: true,
    acknowledgeQuoteMismatch: false,
  };
  return { c, run, v, input, generate };
}
it('lists finite candidate counts without answers and confirms once without publishing', async () => {
  const { c, run, v, input, generate } = await fixture();
  await generate();
  const page = listSets(c, { limit: 1, before: undefined });
  expect(page.items[0]).toMatchObject({ candidateCount: 2, reviewedCount: 0 });
  expect(page.items[0]).not.toHaveProperty('body');
  expect(page.nextCursor).not.toBeNull();
  const [time, id] = page.nextCursor!.split(':');
  expect(
    listSets(c, {
      limit: 1,
      before: { createdAt: Number(time), id: Number(id) },
    }).items[0]!.id,
  ).toBe(run.setId);
  expect(v.reviewedAt).toBeNull();
  const first = confirmVersion(c, run.setId, v.id, input);
  expect(confirmVersion(c, run.setId, v.id, input)).toEqual(first);
  expect(getSet(c, run.setId)).toMatchObject({
    status: 'draft',
    publishedBy: null,
    publishedAt: null,
  });
  expect(getSet(c, run.setId).candidates[0]).toMatchObject({
    reviewedBy: 1,
    reviewedAt: first.reviewedAt,
  });
});
it('rejects stale content, wrong set, stopped or invalid candidates, terminal runs and nondraft sets without updates', async () => {
  const { c, run, v, input, generate } = await fixture();
  const other = await generate();
  expect(() => confirmVersion(c, other.setId, v.id, input)).toThrow('missing');
  expect(() =>
    confirmVersion(c, run.setId, v.id, {
      ...input,
      fingerprint: 'a'.repeat(64),
    }),
  ).toThrow('conflict');
  for (const [update, restore] of [
    [
      "update questions set status='stopped'",
      "update questions set status='active'",
    ],
    [
      "update question_versions set answer_ids_json='[]'",
      'update question_versions set answer_ids_json=\'["a"]\'',
    ],
    [
      "update generation_runs set status='failed'",
      "update generation_runs set status='succeeded'",
    ],
    [
      "update question_sets set status='published'",
      "update question_sets set status='draft'",
    ],
  ]) {
    c.client.exec(update!);
    expect(() => confirmVersion(c, run.setId, v.id, input)).toThrow('conflict');
    c.client.exec(restore!);
  }
  expect(
    c.client
      .prepare(
        'select count(*) n from question_versions where reviewed_at is not null',
      )
      .get(),
  ).toEqual({ n: 0 });
});
it('rechecks quotation, requires acknowledgement, and rolls back database errors', async () => {
  const { c, run, v } = await fixture();
  c.client
    .prepare('update question_versions set quote=? where id=?')
    .run('教材にない引用', v.id);
  const current = getSet(c, run.setId).candidates[0]!;
  expect(current.quoteVerified).toBe(false);
  const input = {
    fingerprint: current.fingerprint,
    confirmed: true,
    acknowledgeQuoteMismatch: false,
  };
  expect(() => confirmVersion(c, run.setId, v.id, input)).toThrow('conflict');
  c.client.exec(
    "create trigger reject_review after update on question_versions begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() =>
    confirmVersion(c, run.setId, v.id, {
      ...input,
      acknowledgeQuoteMismatch: true,
    }),
  ).toThrow();
  expect(getSet(c, run.setId).candidates[0]!.reviewedAt).toBeNull();
  c.client.exec('drop trigger reject_review');
  expect(
    confirmVersion(c, run.setId, v.id, {
      ...input,
      acknowledgeQuoteMismatch: true,
    }).reviewedBy,
  ).toBe(1);
});

it('rejects implicit service confirmation and inconsistent source association', async () => {
  const { c, run, v, input } = await fixture();
  expect(() =>
    confirmVersion(c, run.setId, v.id, { ...input, confirmed: false }),
  ).toThrow('invalid');
  const other = createSource(c, { title: '別教材', body: '別' }, randomUUID());
  c.client
    .prepare('update questions set source_id=? where id=?')
    .run(other.id, v.questionId);
  expect(() => getSet(c, run.setId)).toThrow('conflict');
  expect(() => confirmVersion(c, run.setId, v.id, input)).toThrow('conflict');
  expect(
    c.client
      .prepare('select reviewed_at from question_versions where id=?')
      .get(v.id),
  ).toEqual({ reviewed_at: null });
});
