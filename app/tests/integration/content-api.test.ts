import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, setup, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { publicationFixture } from '../fixtures/publication';
import { candidate, sourceText } from '../fixtures/generation';
import { confirmVersion, getSet } from '../../server/services/review/service';
// Issue #48 HTTP contract:
// PUT /api/admin/sets/:setId/versions/:versionId/content with the complete
// content plus expectedRevision/expectedFingerprint.
const f = await publicationFixture();
const PORT = 3208;
type Candidate = {
  id: number;
  questionId: number;
  body: string;
  choices: { id: string; label: string }[];
  answerIds: string[];
  explanation: string;
  quote: string;
  quoteVerified: boolean;
  reviewedBy: number | null;
  reviewedAt: number | null;
  fingerprint: string;
};
type Detail = {
  id: number;
  status: string;
  revision: number;
  publishedAt: number | null;
  publishFingerprint: string;
  items: { versionId: number; position: number }[];
  candidates: Candidate[];
};
const json = (
  body: unknown,
  method = 'PUT',
  headers: Record<string, string> = {},
) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const contentPath = (setId: number | string, versionId: number | string) =>
  `/api/admin/sets/${setId}/versions/${versionId}/content`;
const putContent = (
  setId: number | string,
  versionId: number | string,
  body: unknown,
) => fetch(contentPath(setId, versionId), json(body));
const confirm = (setId: number, versionId: number, body: unknown) =>
  fetch(`/api/admin/sets/${setId}/versions/${versionId}/review`, json(body));
const publish = (setId: number, body: unknown) =>
  fetch(`/api/admin/sets/${setId}/publish`, json(body, 'POST'));
const putItems = (setId: number, body: unknown) =>
  fetch(`/api/admin/sets/${setId}/items`, json(body));
const admin = async (setId: number): Promise<Detail> =>
  (await fetch(`/api/admin/sets/${setId}`)).json();
const publishRequest = (d: Detail) => ({
  expectedRevision: d.revision,
  publishFingerprint: d.publishFingerprint,
  confirmed: true,
});
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
const snapshot = () =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      f.c.client.prepare(`select * from ${table} order by id`).all(),
    ]),
  );
// A fresh draft set of the fixture source with unconfirmed candidates.
async function draftSet() {
  const run = await f.generate();
  return { setId: run.setId, detail: await admin(run.setId) };
}
function confirmAll(setId: number) {
  for (const v of getSet(f.c, setId).candidates)
    confirmVersion(f.c, setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    });
}
function rawStatus(route: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:${PORT}${route}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}
describe('candidate content edit HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: PORT,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: `http://127.0.0.1:${PORT}`,
    },
  });
  afterAll(f.close);
  it('edits a confirmed adopted candidate, clears its confirmation, keeps the selection, refuses the stale publish, then reconfirms and publishes', async () => {
    const setId = f.run.setId;
    expect(
      (
        await putItems(setId, {
          expectedRevision: 0,
          versionIds: [f.ids[1], f.ids[0]],
        })
      ).status,
    ).toBe(200);
    const d = await admin(setId);
    expect(d.revision).toBe(1);
    const stale = publishRequest(d);
    const v = d.candidates.find((x) => x.id === f.ids[0])!;
    expect(v.reviewedBy).toBe(1);
    const response = await putContent(
      setId,
      v.id,
      edit(d.revision, v, {
        ...candidate('修正済みの問題'),
        quote: sourceText,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result).toMatchObject({
      id: v.id,
      questionId: v.questionId,
      body: '修正済みの問題',
      quoteVerified: true,
      reviewedBy: null,
      reviewedAt: null,
      revision: 2,
      changed: true,
    });
    expect(result.fingerprint).not.toBe(v.fingerprint);
    const edited = await admin(setId);
    expect(edited).toMatchObject({ status: 'draft', revision: 2 });
    expect(edited.items.map((i) => [i.versionId, i.position])).toEqual(
      d.items.map((i) => [i.versionId, i.position]),
    );
    expect(edited.publishFingerprint).not.toBe(d.publishFingerprint);
    expect(edited.candidates.find((x) => x.id === v.id)).toMatchObject({
      body: '修正済みの問題',
      reviewedBy: null,
      reviewedAt: null,
      fingerprint: result.fingerprint,
    });
    expect((await publish(setId, stale)).status).toBe(409);
    expect((await publish(setId, publishRequest(edited))).status).toBe(409);
    expect(
      (
        await confirm(setId, v.id, {
          fingerprint: v.fingerprint,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await confirm(setId, v.id, {
          fingerprint: result.fingerprint,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect((await admin(setId)).revision).toBe(2);
    expect(
      (await publish(setId, publishRequest(await admin(setId)))).status,
    ).toBe(201);
    const published = await admin(setId);
    expect(published).toMatchObject({ status: 'published', revision: 3 });
    // Published: no candidate of the set, adopted or not, can be edited.
    const before = snapshot();
    for (const c of published.candidates)
      expect(
        (
          await putContent(
            setId,
            c.id,
            edit(published.revision, c, { body: '公開後の修正' }),
          )
        ).status,
      ).toBe(409);
    expect(snapshot()).toEqual(before);
    // The learner catalog serves the published content, never the draft one.
    const learner = await (await fetch(`/api/sets/${setId}`)).json();
    expect(JSON.stringify(learner)).not.toContain('公開後の修正');
  });
  it('rejects malformed input, identity fields, foreign and missing candidates, media type, size and stale pairs without writing or logging content', async () => {
    const { setId, detail } = await draftSet();
    const v = detail.candidates[0]!;
    const base = edit(detail.revision, v, candidate('SECRET_INVALID_BODY'));
    const before = snapshot();
    for (const body of [
      null,
      [],
      'content',
      {},
      { ...base, id: v.id },
      { ...base, questionId: v.questionId },
      { ...base, reviewedBy: 1 },
      { ...base, quoteVerified: true },
      { ...base, sourceId: 1 },
      { ...base, generationRunId: 1 },
      { ...base, expectedRevision: -1 },
      { ...base, expectedRevision: '0' },
      { ...base, expectedFingerprint: 'g'.repeat(64) },
      { ...base, body: '' },
      { ...base, body: 'x'.repeat(10001) },
      { ...base, choices: [base.choices[0]] },
      { ...base, choices: [...base.choices, { id: 'a', label: '重複' }] },
      { ...base, answerIds: [] },
      { ...base, answerIds: ['z'] },
      { ...base, answerIds: ['a', 'a'] },
    ]) {
      const r = await putContent(setId, v.id, body);
      expect(r.status).toBe(400);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await r.json()).error.code).toBe('invalid');
    }
    expect(
      (await fetch(contentPath(setId, v.id), json('{"expectedRevision":')))
        .status,
    ).toBe(400);
    for (const id of ['0', 'abc', '1.5', '-1']) {
      expect((await putContent(setId, id, base)).status).toBe(400);
      expect((await putContent(id, v.id, base)).status).toBe(400);
    }
    expect(
      (
        await fetch(contentPath(setId, v.id), {
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify(base),
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await putContent(setId, v.id, {
          ...base,
          padding: 'x'.repeat(512 * 1024),
        })
      ).status,
    ).toBe(413);
    // Validation precedes the lookup; missing set/version and a version of
    // another set are 404.
    expect((await putContent(999999, v.id, { ...base, id: 1 })).status).toBe(
      400,
    );
    expect((await putContent(999999, v.id, base)).status).toBe(404);
    expect((await putContent(setId, 999999, base)).status).toBe(404);
    expect((await putContent(f.run.setId, v.id, base)).status).toBe(404);
    // Stale revision or fingerprint, even with identical content.
    for (const body of [
      { ...edit(detail.revision, v), expectedRevision: detail.revision + 1 },
      { ...edit(detail.revision, v), expectedFingerprint: 'a'.repeat(64) },
      { ...base, expectedRevision: detail.revision + 1 },
    ]) {
      const r = await putContent(setId, v.id, body);
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe('conflict');
    }
    expect(snapshot()).toEqual(before);
    expect((await admin(setId)).revision).toBe(detail.revision);
    expect(JSON.stringify(getServerLogs())).not.toContain(
      'SECRET_INVALID_BODY',
    );
  });
  it('serializes competing edits, edit against confirmation and publish in every order, prevents ABA replay and keeps the saved content across restart', async () => {
    // Two different edits from the same base: exactly one is saved.
    const { setId, detail } = await draftSet();
    const [v, w] = detail.candidates as [Candidate, Candidate];
    const competing = await Promise.all([
      putContent(setId, v.id, edit(0, v, { body: '変更A' })),
      putContent(setId, v.id, edit(0, v, { body: '変更B' })),
    ]);
    expect(competing.map((r) => r.status).sort()).toEqual([200, 409]);
    let d = await admin(setId);
    expect(d.revision).toBe(1);
    const saved = d.candidates.find((x) => x.id === v.id)!;
    expect(['変更A', '変更B']).toContain(saved.body);
    expect(saved.reviewedAt).toBeNull();
    // Confirmation against an edit of the same candidate, concurrently: the
    // edit matches the current pair, the confirmation either lands first and is
    // cleared or arrives with a stale fingerprint; the candidate ends
    // unconfirmed with the new content either way.
    const pair = await Promise.all([
      confirm(setId, w.id, { fingerprint: w.fingerprint, confirmed: true }),
      putContent(setId, w.id, edit(1, w, { body: '確認と競合する修正' })),
    ]);
    expect(pair[1].status).toBe(200);
    expect([200, 409]).toContain(pair[0].status);
    d = await admin(setId);
    expect(d.revision).toBe(2);
    expect(d.candidates.find((x) => x.id === w.id)).toMatchObject({
      body: '確認と競合する修正',
      reviewedBy: null,
      reviewedAt: null,
    });
    // Sequential: confirm then edit clears; edit then stale confirm is 409 and
    // the new fingerprint confirms without moving the revision.
    const edited = d.candidates.find((x) => x.id === w.id)!;
    expect(
      (
        await confirm(setId, w.id, {
          fingerprint: edited.fingerprint,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    const again = await putContent(
      setId,
      w.id,
      edit(2, { ...edited }, { body: '確認後の修正' }),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      reviewedBy: null,
      revision: 3,
      changed: true,
    });
    expect(
      (
        await confirm(setId, w.id, {
          fingerprint: edited.fingerprint,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    d = await admin(setId);
    const latest = d.candidates.find((x) => x.id === w.id)!;
    expect(latest.reviewedAt).toBeNull();
    expect(
      (
        await confirm(setId, w.id, {
          fingerprint: latest.fingerprint,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect((await admin(setId)).revision).toBe(3);
    // A -> B -> A on v: the fingerprint returns, the revision does not.
    const current = (await admin(setId)).candidates.find((x) => x.id === v.id)!;
    const toB = await (
      await putContent(setId, v.id, edit(3, current, { body: 'ABA中間' }))
    ).json();
    expect(toB).toMatchObject({ revision: 4, changed: true });
    const backToA = await (
      await putContent(setId, v.id, {
        ...edit(4, current),
        expectedFingerprint: toB.fingerprint,
      })
    ).json();
    expect(backToA).toMatchObject({
      revision: 5,
      changed: true,
      fingerprint: current.fingerprint,
      body: current.body,
    });
    const afterABA = snapshot();
    expect(
      (await putContent(setId, v.id, edit(3, current, { body: 'ABA中間' })))
        .status,
    ).toBe(409);
    expect((await putContent(setId, v.id, edit(3, current))).status).toBe(409);
    expect((await putContent(setId, v.id, edit(4, current))).status).toBe(409);
    const noop = await putContent(setId, v.id, edit(5, current));
    expect(noop.status).toBe(200);
    expect(await noop.json()).toMatchObject({
      revision: 5,
      changed: false,
      fingerprint: current.fingerprint,
    });
    expect(snapshot()).toEqual(afterABA);
    // Publish against an edit, concurrently: either the publish lands and the
    // edit is refused, or the edit lands and the publish is stale.
    const p = await draftSet();
    confirmAll(p.setId);
    expect(
      (
        await putItems(p.setId, {
          expectedRevision: 0,
          versionIds: [p.detail.candidates[0]!.id],
        })
      ).status,
    ).toBe(200);
    const pd = await admin(p.setId);
    const target = pd.candidates[0]!;
    const race = await Promise.all([
      publish(p.setId, publishRequest(pd)),
      putContent(
        p.setId,
        target.id,
        edit(pd.revision, target, { body: '公開と競合する修正' }),
      ),
    ]);
    const statuses = race.map((r) => r.status);
    const after = await admin(p.setId);
    if (statuses[0] === 201) {
      expect(statuses[1]).toBe(409);
      expect(after.status).toBe('published');
      expect(after.candidates[0]!.body).toBe(target.body);
      expect(after.candidates[0]!.reviewedBy).toBe(1);
    } else {
      expect(statuses).toEqual([409, 200]);
      expect(after.status).toBe('draft');
      expect(after.candidates[0]).toMatchObject({
        body: '公開と競合する修正',
        reviewedBy: null,
      });
      expect(after.items.map((i) => [i.versionId, i.position])).toEqual(
        pd.items.map((i) => [i.versionId, i.position]),
      );
    }
    // Sequential: edit first makes the old publish stale and the fresh one
    // unconfirmed; publish first makes the edit a conflict.
    const q = await draftSet();
    confirmAll(q.setId);
    await putItems(q.setId, {
      expectedRevision: 0,
      versionIds: [q.detail.candidates[0]!.id],
    });
    const qd = await admin(q.setId);
    const qv = qd.candidates[0]!;
    expect(
      (
        await putContent(
          q.setId,
          qv.id,
          edit(qd.revision, qv, { body: '公開前の修正' }),
        )
      ).status,
    ).toBe(200);
    expect((await publish(q.setId, publishRequest(qd))).status).toBe(409);
    expect(
      (await publish(q.setId, publishRequest(await admin(q.setId)))).status,
    ).toBe(409);
    expect((await admin(q.setId)).status).toBe('draft');
    const r = await draftSet();
    confirmAll(r.setId);
    await putItems(r.setId, {
      expectedRevision: 0,
      versionIds: [r.detail.candidates[0]!.id],
    });
    const rd = await admin(r.setId);
    expect((await publish(r.setId, publishRequest(rd))).status).toBe(201);
    const rv = (await admin(r.setId)).candidates[0]!;
    const published = snapshot();
    expect(
      (
        await putContent(
          r.setId,
          rv.id,
          edit(rd.revision + 1, rv, { body: '公開後の修正' }),
        )
      ).status,
    ).toBe(409);
    expect(snapshot()).toEqual(published);
    // Restart: the saved edits, confirmations and revisions persist.
    await startServer();
    const persisted = await admin(setId);
    expect(persisted.revision).toBe(5);
    expect(persisted.candidates.find((x) => x.id === v.id)).toMatchObject({
      body: current.body,
      fingerprint: current.fingerprint,
      reviewedAt: null,
    });
    expect(persisted.candidates.find((x) => x.id === w.id)).toMatchObject({
      body: '確認後の修正',
      reviewedBy: 1,
    });
    expect(snapshot()).toEqual(published);
  });
  it('requires the local administrator at the write boundary, returns a safe 500 with full rollback, opens no learner path and never logs content', async () => {
    const { setId, detail } = await draftSet();
    const v = detail.candidates[0]!;
    const body = edit(detail.revision, v, candidate('SECRET_EDIT_BODY'));
    const before = snapshot();
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await putContent(setId, v.id, body)).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    expect((await putContent(setId, v.id, body)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    for (const headers of [
      { origin: 'http://untrusted.invalid' } as Record<string, string>,
      { host: 'untrusted.invalid' },
    ])
      expect(await rawStatus(contentPath(setId, v.id), headers)).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await putContent(setId, v.id, body)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    expect(snapshot()).toEqual(before);
    // The learner API never sees the draft set, before or after an edit.
    expect((await fetch(`/api/sets/${setId}`)).status).toBe(404);
    const list = await (await fetch('/api/sets')).json();
    expect(list.items.map((i: { id: number }) => i.id)).not.toContain(setId);
    // A failing revision update rolls back the content and confirmation reset.
    f.c.client.exec(
      "create trigger fail_edit before update of revision on question_sets begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const failed = await putContent(setId, v.id, body);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    const text = await failed.text();
    expect(JSON.parse(text).error.code).toBe('internal');
    expect(text).not.toMatch(/PRIVATE_SQL|sqlite|stack|SECRET_/);
    expect(snapshot()).toEqual(before);
    f.c.client.exec('drop trigger fail_edit');
    const ok = await putContent(setId, v.id, {
      ...body,
      body: '障害復旧後の修正',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      revision: detail.revision + 1,
      changed: true,
    });
    expect((await fetch(`/api/sets/${setId}`)).status).toBe(404);
    expect(JSON.stringify(getServerLogs())).not.toMatch(
      /PRIVATE_SQL|SECRET_EDIT_BODY|障害復旧後の修正/,
    );
  });
});
