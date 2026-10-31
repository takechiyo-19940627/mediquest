import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch } from '@nuxt/test-utils/e2e';
import { setupSharedHttpServer } from '../fixtures/http-server';
import { manualFixture } from '../fixtures/manual';
import { pastExamInputFixture } from '../fixtures/past-exams';
const f = manualFixture();
describe('past paper registration API', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3216,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3216',
      MEDIQUEST_GENERATION_ENABLED: 'false',
      ANTHROPIC_API_KEY: '',
    },
  });
  afterAll(f.close);
  const post = (
    body: unknown = pastExamInputFixture(),
    key: string = randomUUID(),
    headers: Record<string, string> = {},
    path = '/api/admin/past-exams',
  ) =>
    fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  it('creates once, exposes answers only to administrators, and revises with stale detection', async () => {
    const key = randomUUID();
    const created = await post(undefined, key);
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const { setId } = await created.json();
    expect((await post(undefined, key)).status).toBe(200);
    expect(
      (await post({ ...pastExamInputFixture(), subject: 'different' }, key))
        .status,
    ).toBe(409);
    for (const path of ['/api/past-exams', `/api/past-exams/${setId}`]) {
      const response = await fetch(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain('answerIds');
    }
    const admin = await fetch(`/api/admin/past-exams/${setId}`);
    expect((await admin.json()).questions[0].answerIds).toEqual(['a']);
    const revisionKey = randomUUID();
    const revisionPath = `/api/admin/past-exams/${setId}/revisions`;
    const revision = { ...pastExamInputFixture(), revision: 0 };
    expect((await post(revision, revisionKey, {}, revisionPath)).status).toBe(
      201,
    );
    expect((await post(revision, revisionKey, {}, revisionPath)).status).toBe(
      200,
    );
    expect((await post(revision, randomUUID(), {}, revisionPath)).status).toBe(
      409,
    );
    expect((await fetch(`/api/past-exams/${setId}`)).status).toBe(404);
    expect((await fetch('/api/past-exams?before=bad')).status).toBe(400);
    expect((await fetch('/api/admin/past-exams?limit=101')).status).toBe(400);
  });
  it('serializes concurrent creation and revision requests without duplicate editions', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      post(undefined, key),
      post(undefined, key),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const receipts = await Promise.all(responses.map((r) => r.json()));
    expect(receipts[0].setId).toBe(receipts[1].setId);
    const path = `/api/admin/past-exams/${receipts[0].setId}/revisions`;
    const revision = { ...pastExamInputFixture(), revision: 0 };
    const edits = await Promise.all([
      post(revision, randomUUID(), {}, path),
      post(revision, randomUUID(), {}, path),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('enforces admin, origin, body limits and immutable metadata boundaries', async () => {
    expect(
      (await post({ ...pastExamInputFixture(), confirmed: false })).status,
    ).toBe(400);
    expect((await post(undefined, 'bad')).status).toBe(400);
    expect(
      (
        await post(undefined, randomUUID(), {
          origin: 'https://foreign.invalid',
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(undefined, randomUUID(), { 'content-type': 'text/plain' }))
        .status,
    ).toBe(415);
    expect(
      (
        await post({
          ...pastExamInputFixture(),
          sourceReference: 'x'.repeat(600000),
        })
      ).status,
    ).toBe(413);
    f.c.client.exec("update users set role='learner' where id=1");
    try {
      expect((await post()).status).toBe(403);
      expect((await fetch('/api/admin/past-exams')).status).toBe(403);
      expect((await fetch('/api/admin/past-exams/1')).status).toBe(403);
      expect((await fetch('/api/past-exams')).status).toBe(200);
    } finally {
      f.c.client.exec("update users set role='admin' where id=1");
    }
  });
  it('sanitizes database failures and never leaves partially published papers', async () => {
    const before = f.c.client
      .prepare('select count(*) as n from question_sets')
      .get();
    f.c.client.exec(
      "create trigger fail_receipt before insert on past_exam_requests begin select raise(abort,'PRIVATE_SQL'); end",
    );
    try {
      const response = await post();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('PRIVATE_SQL');
      expect(
        f.c.client.prepare('select count(*) as n from question_sets').get(),
      ).toEqual(before);
    } finally {
      f.c.client.exec('drop trigger fail_receipt');
    }
  });
});
