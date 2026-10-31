import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch } from '@nuxt/test-utils/e2e';
import { setupSharedHttpServer } from '../fixtures/http-server';
import { manualFixture } from '../fixtures/manual';
import { candidate } from '../fixtures/generation';
const f = manualFixture();
describe('manual creation without configured AI', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3215,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3215',
      MEDIQUEST_GENERATION_ENABLED: 'false',
      ANTHROPIC_API_KEY: '',
    },
  });
  afterAll(f.close);
  const post = (
    body: unknown = { title: '手動', questions: [candidate()] },
    key: string = randomUUID(),
    headers: Record<string, string> = {},
  ) =>
    fetch('/api/admin/sources/1/manual-sets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  it('returns 201/200 receipts, 409 mismatches, and no-store without AI calls', async () => {
    const key = randomUUID();
    const body = { title: '手動', questions: [candidate()] };
    const created = await post(body, key);
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const receipt = await created.json();
    expect(receipt).toEqual({ setId: expect.any(Number), replayed: false });
    const repeated = await post(body, key);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ ...receipt, replayed: true });
    expect((await post({ ...body, title: '変更' }, key)).status).toBe(409);
    expect(
      f.c.client.prepare('select count(*) as n from generation_runs').get(),
    ).toEqual({ n: 0 });
  });
  it('enforces request, origin and administrator boundaries before mutation', async () => {
    expect((await post({ title: '空', questions: [] })).status).toBe(400);
    expect((await post(undefined, 'bad-key')).status).toBe(400);
    expect(
      (await post(undefined, randomUUID(), { 'content-type': 'text/plain' }))
        .status,
    ).toBe(415);
    expect(
      (
        await post(undefined, randomUUID(), {
          origin: 'https://foreign.invalid',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post({
          title: 'large',
          questions: [{ ...candidate(), body: 'x'.repeat(600000) }],
        })
      ).status,
    ).toBe(413);
    f.c.client.exec("update users set role='learner' where id=1");
    try {
      expect((await post()).status).toBe(403);
    } finally {
      f.c.client.exec("update users set role='admin' where id=1");
    }
    const response = await fetch('/api/admin/sources/999/manual-sets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({ title: '不存在', questions: [candidate()] }),
    });
    expect(response.status).toBe(404);
  });
  it('rolls back receipt/storage failure and returns no private SQL details', async () => {
    const before = f.c.client
      .prepare('select count(*) as n from question_sets')
      .get();
    f.c.client.exec(
      "create trigger fail_receipt before insert on manual_set_requests begin select raise(abort,'PRIVATE_SQL'); end",
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
