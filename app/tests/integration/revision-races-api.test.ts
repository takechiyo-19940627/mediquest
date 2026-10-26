import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch } from '@nuxt/test-utils/e2e';
import { setupSharedHttpServer } from '../fixtures/http-server';
import { publicationFixture } from '../fixtures/publication';
import { getSet } from '../../server/services/review/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';

const f = await publicationFixture(6);
replaceItems(f.c, f.run.setId, { expectedRevision: 0, versionIds: f.ids });
const source = f.detail();
publishSet(f.c, source.id, {
  expectedRevision: source.revision,
  publishFingerprint: source.publishFingerprint,
  confirmed: true,
});
const PORT = 3211;
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
// Reads use the fixture connection; HTTP handlers open separate connections to
// this same temporary DB in the Nuxt server process. No service writes below.
const row = (id: number) =>
  f.c.client
    .prepare('select * from question_versions where id=?')
    .get(id) as Record<string, unknown>;
const versions = () =>
  f.c.client.prepare('select * from question_versions order by id').all();
const answers = () =>
  f.c.client
    .prepare(
      'select id,question_version_id,selected_ids_json,is_correct,answered_at from study_items order by id',
    )
    .all();
const detail = (id: number) => getSet(f.c, id);
type Detail = ReturnType<typeof detail>;
type Candidate = Detail['candidates'][number];
const base = (id: number) => `/api/admin/sets/${id}`;
const edit = (d: Detail, v: Candidate) =>
  fetch(
    `${base(d.id)}/versions/${v.id}/content`,
    json(
      {
        expectedRevision: d.revision,
        expectedFingerprint: v.fingerprint,
        body: 'COW regression edit',
        choices: v.choices,
        answerIds: v.answerIds,
        explanation: v.explanation,
        quote: v.quote,
      },
      'PUT',
    ),
  );
const confirm = (id: number, v: Candidate) =>
  fetch(
    `${base(id)}/versions/${v.id}/review`,
    json(
      {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: true,
      },
      'PUT',
    ),
  );
const adopt = (id: number, versionId: number) =>
  fetch(
    `${base(id)}/items`,
    json(
      { expectedRevision: detail(id).revision, versionIds: [versionId] },
      'PUT',
    ),
  );
async function refusedPublication(id: number, d = detail(id)) {
  expect(
    (
      await fetch(
        `${base(id)}/publish`,
        json({
          expectedRevision: d.revision,
          publishFingerprint: d.publishFingerprint,
          confirmed: true,
        }),
      )
    ).status,
  ).toBe(409);
  expect(detail(id).status).toBe('draft');
  expect((await fetch(`/api/sets/${id}`)).status).toBe(404);
}

describe('revision COW versus logical stop and version invalidation HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: PORT,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: `http://127.0.0.1:${PORT}`,
    },
  });
  afterAll(f.close);
  const cases = (['invalidated', 'stopped'] as const).flatMap((kind, k) =>
    (['before', 'after', 'concurrent'] as const).map((order, i) => ({
      kind,
      order,
      index: k * 3 + i,
    })),
  );
  // Each case owns a distinct logical question. Awaited requests force both
  // serialization orders; concurrent requests accept either transaction winner.
  for (const { kind, order, index } of cases) {
    it(`${kind} ${order} COW preserves version boundaries and history`, async () => {
      const original = source.candidates[index]!;
      const old = row(original.id);
      const start = await fetch('/api/sessions', {
        ...json({ setId: source.id }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
      });
      expect(start.status).toBe(201);
      const session = (await start.json()).session;
      const item = session.items.find(
        (v: { position: number }) => v.position === index,
      );
      const itemUrl = `/api/sessions/${session.id}/items/${item.id}`;
      expect(
        (
          await fetch(
            `${itemUrl}/answer`,
            json({ selectedIds: original.answerIds }),
          )
        ).status,
      ).toBe(200);
      const answeredBefore = await (await fetch(itemUrl)).json();
      // Stop preserves answered feedback, while unanswered items are excluded.
      // Invalidation excludes both. Exercise each without conflating the rules.
      let exclusionUrl = itemUrl;
      if (kind === 'stopped') {
        const pending = await fetch('/api/sessions', {
          ...json({ setId: source.id }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
        });
        expect(pending.status).toBe(201);
        const pendingSession = (await pending.json()).session;
        const pendingItem = pendingSession.items.find(
          (v: { position: number }) => v.position === index,
        );
        exclusionUrl = `/api/sessions/${pendingSession.id}/items/${pendingItem.id}`;
      }
      const savedAnswers = answers();
      const report = async () => {
        const response = await fetch(
          `${itemUrl}/reports`,
          json({ message: 'old version report' }),
        );
        expect(response.status).toBe(201);
        return (await response.json()).id as number;
      };
      const reportId = kind === 'invalidated' ? await report() : null;
      const resolve = (id: number, note: string) =>
        fetch(
          `/api/admin/reports/${id}/resolution`,
          json({ decision: 'confirmed', note }, 'PUT'),
        );
      const mutation = () =>
        kind === 'stopped'
          ? fetch(`/api/admin/questions/${original.questionId}/stop`, json({}))
          : resolve(reportId!, 'first reason');
      const created = await fetch(
        `${base(source.id)}/revisions`,
        json({
          requestKey: randomUUID(),
          expectedRevision: f.detail().revision,
          title: 'race draft',
          description: '',
        }),
      );
      expect(created.status).toBe(201);
      const draftId = (await created.json()).id as number;
      const before = detail(draftId);
      const v = before.candidates.find((v) => v.id === original.id)!;
      const beforeVersions = versions();
      let changed: Response;
      let excludedBeforeEdit: unknown;
      if (order === 'before') {
        expect((await mutation()).status).toBe(200);
        excludedBeforeEdit = await (await fetch(exclusionUrl)).json();
        expect(excludedBeforeEdit).toMatchObject({
          state: 'excluded',
          ...(kind === 'invalidated' ? { excludedReason: kind } : {}),
        });
        changed = await edit(before, v);
      } else if (order === 'after') {
        changed = await edit(before, v);
        expect((await mutation()).status).toBe(200);
      } else {
        const pair = await Promise.all([mutation(), edit(before, v)]);
        expect(pair[0].status).toBe(200);
        changed = pair[1];
      }
      const rejected = kind === 'stopped' && order === 'before';
      if (kind === 'stopped' && order === 'concurrent')
        expect([200, 409]).toContain(changed.status);
      else expect(changed.status).toBe(rejected ? 409 : 200);
      if (changed.status === 409) {
        expect(versions()).toEqual(beforeVersions);
        const unchanged = detail(draftId);
        expect(unchanged.revision).toBe(before.revision);
        expect(unchanged.candidates.map((c) => c.id)).toEqual(
          before.candidates.map((c) => c.id),
        );
        expect(unchanged.items.map((i) => [i.versionId, i.position])).toEqual(
          before.items.map((i) => [i.versionId, i.position]),
        );
      } else {
        const result = await changed.json();
        expect(result.id).not.toBe(original.id);
        const child = detail(draftId).candidates.find(
          (c) => c.id === result.id,
        )!;
        expect(row(child.id)).toMatchObject({
          question_id: original.questionId,
          derived_from_version_id: original.id,
          reviewed_by: null,
          reviewed_at: null,
          invalidated_at: null,
          invalidated_by: null,
          invalidation_reason: null,
        });
        expect(detail(draftId).revision).toBe(before.revision + 1);
        expect(
          detail(draftId).items.map((i) => [i.versionId, i.position]),
        ).toEqual(
          before.items.map((i) => [
            i.versionId === original.id ? child.id : i.versionId,
            i.position,
          ]),
        );
        // Even a clean child cannot be adopted until explicitly confirmed.
        expect((await adopt(draftId, child.id)).status).toBe(409);
        await refusedPublication(draftId);
        if (kind === 'stopped') {
          expect((await confirm(draftId, child)).status).toBe(409);
          expect((await edit(detail(draftId), child)).status).toBe(409);
        } else {
          // A later report still targets the historical version and must retain
          // the first reason, excluded history and the untouched clean child.
          const invalidated = row(original.id);
          const cleanChild = row(child.id);
          const excluded = await (await fetch(itemUrl)).json();
          expect(excluded).toMatchObject({
            state: 'excluded',
            excludedReason: 'invalidated',
          });
          const later = await report();
          expect((await resolve(later, 'later reason')).status).toBe(200);
          expect(await (await fetch(itemUrl)).json()).toEqual(excluded);
          expect(row(original.id)).toEqual(invalidated);
          expect(row(child.id)).toEqual(cleanChild);
          for (const id of [reportId!, later])
            expect(
              f.c.client
                .prepare(
                  'select question_version_id,status from issue_reports where id=?',
                )
                .get(id),
            ).toEqual({
              question_version_id: original.id,
              status: 'confirmed',
            });
          expect((await confirm(draftId, child)).status).toBe(200);
          expect((await adopt(draftId, child.id)).status).toBe(200);
        }
      }
      if (kind === 'invalidated') {
        expect(row(original.id)).toEqual({
          ...old,
          invalidated_at: expect.any(Number),
          invalidated_by: 1,
          invalidation_reason: 'first reason',
        });
      } else {
        expect(row(original.id)).toEqual(old);
        expect(
          f.c.client
            .prepare('select status from questions where id=?')
            .get(original.questionId),
        ).toEqual({ status: 'stopped' });
      }
      expect(await (await fetch(exclusionUrl)).json()).toMatchObject({
        state: 'excluded',
        ...(kind === 'invalidated' ? { excludedReason: kind } : {}),
      });
      if (order === 'before')
        expect(await (await fetch(exclusionUrl)).json()).toEqual(
          excludedBeforeEdit,
        );
      if (kind === 'stopped')
        expect(await (await fetch(itemUrl)).json()).toEqual(answeredBefore);
      expect(answers()).toEqual(savedAnswers);
      await refusedPublication(draftId, before);
    });
  }
});
