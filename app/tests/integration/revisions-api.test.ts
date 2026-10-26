import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer } from '@nuxt/test-utils/e2e';
import { setupSharedHttpServer } from '../fixtures/http-server';
import { publishedSourceFixture } from '../fixtures/published-revision';
import { getSet } from '../../server/services/review/service';
const f = await publishedSourceFixture();
const PORT = 3210;
const json = (body: unknown, method = 'POST', headers = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const url = `/api/admin/sets/${f.run.setId}/revisions`;
const input = () => ({
  requestKey: randomUUID(),
  expectedRevision: f.detail().revision,
  title: '改訂',
  description: '',
});
describe('revision HTTP', async () => {
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
  it('creates, replays, retrieves, edits, confirms and adopts and refuses publication with stale expectations', async () => {
    const body = input();
    const [first, second] = await Promise.all([
      fetch(url, json(body)),
      fetch(url, json(body)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const created = await first.json();
    expect((await second.json()).id).toBe(created.id);
    expect(first.headers.get('cache-control')).toContain('no-store');
    const base = `/api/admin/sets/${created.id}`;
    const d = await (await fetch(base)).json();
    const v = d.candidates[0];
    const old = f.c.client
      .prepare('select * from question_versions where id=?')
      .get(v.id);
    const edit = {
      expectedRevision: d.revision,
      expectedFingerprint: v.fingerprint,
      body: 'HTTP edited',
      choices: v.choices,
      answerIds: v.answerIds,
      explanation: v.explanation,
      quote: 'quote mismatch',
    };
    const endpoint = `${base}/versions/${v.id}/content`;
    const attempts = await Promise.all([
      fetch(endpoint, json(edit, 'PUT')),
      fetch(endpoint, json({ ...edit, body: 'competing edit' }, 'PUT')),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = await attempts.find((r) => r.status === 200)!.json();
    expect(saved.id).not.toBe(v.id);
    expect(
      f.c.client
        .prepare('select * from question_versions where id=?')
        .get(v.id),
    ).toEqual(old);
    expect((await fetch(endpoint, json(edit, 'PUT'))).status).toBe(409);
    const review = {
      fingerprint: saved.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    };
    const reviewUrl = `${base}/versions/${saved.id}/review`;
    expect((await fetch(reviewUrl, json(review, 'PUT'))).status).toBe(409);
    expect(
      (
        await fetch(
          reviewUrl,
          json({ ...review, acknowledgeQuoteMismatch: true }, 'PUT'),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/items`,
          json(
            { expectedRevision: saved.revision, versionIds: [saved.id] },
            'PUT',
          ),
        )
      ).status,
    ).toBe(200);
    const ready = d; // Before COW/adoption: stale publication expectations.
    expect(
      (
        await fetch(
          `${base}/publish`,
          json({
            expectedRevision: ready.revision,
            publishFingerprint: ready.publishFingerprint,
            confirmed: true,
          }),
        )
      ).status,
    ).toBe(409);
    expect((await fetch(`/api/sets/${created.id}`)).status).toBe(404);
    await startServer();
    expect((await (await fetch(url, json(body))).json()).id).toBe(created.id);
    expect(getSet(f.c, created.id).items[0]!.versionId).toBe(saved.id);
  });
  it('serializes edits against confirmation and adoption and numbers sibling drafts independently', async () => {
    const create = async () => {
      const response = await fetch(url, json(input()));
      expect(response.status).toBe(201);
      return (await response.json()).id as number;
    };
    const detail = async (id: number) =>
      (await fetch(`/api/admin/sets/${id}`)).json();
    const edit = (d: Awaited<ReturnType<typeof detail>>, body: string) => {
      const v = d.candidates[0];
      return fetch(
        `/api/admin/sets/${d.id}/versions/${v.id}/content`,
        json(
          {
            expectedRevision: d.revision,
            expectedFingerprint: v.fingerprint,
            body,
            choices: v.choices,
            answerIds: v.answerIds,
            explanation: v.explanation,
            quote: v.quote,
          },
          'PUT',
        ),
      );
    };
    const left = await detail(await create());
    const right = await detail(await create());
    const original = f.c.client
      .prepare('select * from question_versions where id=?')
      .get(left.candidates[0].id);
    const maximum = f.c.client
      .prepare(
        'select max(version_no) as n from question_versions where question_id=(select question_id from question_versions where id=?)',
      )
      .get(left.candidates[0].id) as { n: number };
    const siblings = await Promise.all([
      edit(left, 'left'),
      edit(right, 'right'),
    ]);
    expect(siblings.map((r) => r.status)).toEqual([200, 200]);
    const saved = await Promise.all(siblings.map((r) => r.json()));
    // Either transaction may allocate first; both must get distinct consecutive numbers.
    expect(saved.map((v) => v.versionNo).sort((a, b) => a - b)).toEqual([
      maximum.n + 1,
      maximum.n + 2,
    ]);
    expect(new Set(saved.map((v) => v.id)).size).toBe(2);
    expect(
      f.c.client
        .prepare('select * from question_versions where id=?')
        .get(left.candidates[0].id),
    ).toEqual(original);
    const current = await detail(left.id);
    const v = current.candidates.find(
      (v: { id: number }) => v.id === saved[0].id,
    );
    // Confirmation first succeeds and is cleared by the subsequent edit;
    // editing first makes the old fingerprint conflict.
    const confirmation = await Promise.all([
      edit({ ...current, candidates: [v] }, 'after confirmation race'),
      fetch(
        `/api/admin/sets/${left.id}/versions/${v.id}/review`,
        json(
          {
            fingerprint: v.fingerprint,
            confirmed: true,
            acknowledgeQuoteMismatch: true,
          },
          'PUT',
        ),
      ),
    ]);
    expect(confirmation[0]!.status).toBe(200);
    expect([200, 409]).toContain(confirmation[1]!.status);
    const afterConfirm = await detail(left.id);
    expect(
      afterConfirm.candidates.find(
        (candidate: { id: number }) => candidate.id === v.id,
      ).reviewedBy,
    ).toBeNull();
    // A changed adoption order increments revision. Exactly one operation wins:
    // adoption first makes edit stale; edit first removes the old candidate,
    // so adopting that old ID returns the existing membership 404.
    const adoptDraft = await detail(await create());
    const adoption = await Promise.all([
      edit(adoptDraft, 'adoption race'),
      fetch(
        `/api/admin/sets/${adoptDraft.id}/items`,
        json(
          {
            expectedRevision: adoptDraft.revision,
            versionIds: adoptDraft.items
              .map((i: { versionId: number }) => i.versionId)
              .reverse(),
          },
          'PUT',
        ),
      ),
    ]);
    expect([
      [200, 404],
      [409, 200],
    ]).toContainEqual(adoption.map((r) => r.status));
    const afterAdopt = await detail(adoptDraft.id);
    expect(afterAdopt.revision).toBe(adoptDraft.revision + 1);
    const editedId =
      adoption[0]!.status === 200 ? (await adoption[0]!.json()).id : null;
    const expectedIds =
      adoption[0]!.status === 200
        ? adoptDraft.items.map((i: { versionId: number }) =>
            i.versionId === adoptDraft.candidates[0].id
              ? editedId
              : i.versionId,
          )
        : adoptDraft.items
            .map((i: { versionId: number }) => i.versionId)
            .reverse();
    expect(
      afterAdopt.items.map((i: { versionId: number }) => i.versionId),
    ).toEqual(expectedIds);
    const catalog = await (await fetch('/api/sets')).json();
    expect(catalog.items.map((set: { id: number }) => set.id)).toEqual([
      f.run.setId,
    ]);
    expect(
      (
        await fetch('/api/sessions', {
          ...json({ setId: left.id }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
        })
      ).status,
    ).toBe(404);
  });
  it('serializes revision creation against archive without following the new source revision', async () => {
    const body = input();
    const [creation, archive] = await Promise.all([
      fetch(url, json(body)),
      fetch(`/api/admin/sets/${f.run.setId}/archive`, json({})),
    ]);
    expect(archive.status).toBe(200);
    expect([201, 409]).toContain(creation.status);
    expect(f.detail().status).toBe('archived');
    expect(f.detail().revision).toBe(body.expectedRevision + 1);
    const receipts = f.c.client
      .prepare('select * from set_revision_requests where request_key=?')
      .all(body.requestKey);
    if (creation.status === 201) {
      const created = await creation.json();
      expect(created.supersedesRevision).toBe(body.expectedRevision);
      expect(receipts).toHaveLength(1);
      const replay = await fetch(url, json(body));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        id: created.id,
        replayed: true,
      });
    } else {
      expect(receipts).toEqual([]);
      expect((await fetch(url, json(body))).status).toBe(409);
    }
  });
  it('inherits input, local-admin and safe failure boundaries', async () => {
    expect(
      (await fetch(url, json({ ...input(), status: 'published' }))).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          url,
          json(input(), 'POST', { origin: 'http://untrusted.invalid' }),
        )
      ).status,
    ).toBe(403);
    const learnerRequest = input();
    f.c.client.exec("update users set role='learner' where id=1");
    try {
      expect((await fetch(url, json(learnerRequest))).status).toBe(403);
    } finally {
      f.c.client.exec("update users set role='admin' where id=1");
    }
    f.c.client.exec(
      "create trigger fail_revision before insert on set_revision_requests begin select raise(abort,'PRIVATE_SQL'); end",
    );
    try {
      const before = f.c.client
        .prepare('select * from question_sets order by id')
        .all();
      const response = await fetch(url, json(input()));
      expect(response.status).toBe(500);
      expect(await response.text()).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
      expect(
        f.c.client.prepare('select * from question_sets order by id').all(),
      ).toEqual(before);
    } finally {
      f.c.client.exec('drop trigger fail_revision');
    }
  });
});
