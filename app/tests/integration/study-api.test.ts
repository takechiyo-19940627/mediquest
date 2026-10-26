import { setupSharedHttpServer } from '../fixtures/http-server';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture } from '../fixtures/catalog';
const f = await catalogFixture();
let sessionId: number;
let itemId: number;
let key: string;
const start = (setId = f.run.setId, requestKey = key, extra = {}) =>
  fetch('/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': requestKey,
    },
    body: JSON.stringify({ setId, ...extra }),
  });
const resume = (id = sessionId, body: unknown = {}) =>
  fetch(`/api/sessions/${id}/resume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
function privateFields(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /answerIds|answer_ids|isCorrect|is_correct|explanation|quote|reviewedBy|generationRun|questionVersion|SECRET_EXPLANATION|SECRET_QUOTE|SECRET_SOURCE/,
  );
  expect(text).not.toContain(f.database);
}
function rawStatus(path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(`http://127.0.0.1:3200${path}`, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
describe('study session HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3200,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3200',
    },
  });
  afterAll(f.close);
  it('starts once under concurrent retry and returns only safe session/item DTOs across server restart', async () => {
    key = randomUUID();
    const responses = await Promise.all([start(), start()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies[0].session).toEqual(bodies[1].session);
    sessionId = bodies[0].session.id;
    itemId = bodies[0].session.items[0].id;
    privateFields(bodies);
    expect(
      f.c.client.prepare('select count(*) n from study_sessions').get(),
    ).toEqual({ n: 1 });
    expect(
      f.c.client.prepare('select count(*) n from study_items').get(),
    ).toEqual({ n: 2 });
    const response = await fetch(`/api/sessions/${sessionId}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const session = await response.json();
    expect(Object.keys(session).sort()).toEqual(
      [
        'id',
        'setId',
        'status',
        'mode',
        'parentSessionId',
        'startedAt',
        'completedAt',
        'items',
        'currentItemId',
        'statistics',
      ].sort(),
    );
    expect(session).toMatchObject({ mode: 'normal', parentSessionId: null });
    const item = await (
      await fetch(`/api/sessions/${sessionId}/items/${itemId}`)
    ).json();
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    expect(item.requiredSelectionCount).toBe(1);
    expect(item.choices.map((c: { id: string }) => c.id)).toEqual([
      'SECRET_ANSWER',
      'b',
    ]);
    privateFields(item);
    await startServer();
    expect(await (await fetch(`/api/sessions/${sessionId}`)).json()).toEqual(
      session,
    );
    expect(
      await (await fetch(`/api/sessions/${sessionId}/items/${itemId}`)).json(),
    ).toEqual(item);
  });
  it('rejects spoofing, malformed/oversize input and cross-session or foreign ownership', async () => {
    expect((await start(f.run.setId, randomUUID(), { userId: 2 })).status).toBe(
      400,
    );
    expect((await start(f.run.setId, 'invalid')).status).toBe(400);
    expect(
      (
        await start(f.run.setId, randomUUID(), {
          padding: 'x'.repeat(512 * 1024),
        })
      ).status,
    ).toBe(413);
    expect((await resume(sessionId, { userId: 1 })).status).toBe(400);
    expect((await fetch('/api/sessions/0')).status).toBe(400);
    expect((await start(f.draftId, key)).status).toBe(409);
    expect((await start(f.draftId, randomUUID())).status).toBe(404);
    const other = await (await start(f.run.setId, randomUUID())).json();
    expect(
      (
        await fetch(
          `/api/sessions/${sessionId}/items/${other.session.items[0].id}`,
        )
      ).status,
    ).toBe(404);
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    f.c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(other.session.id);
    const missing = await (await fetch('/api/sessions/999999')).json();
    const foreign = await (
      await fetch(`/api/sessions/${other.session.id}`)
    ).json();
    expect(foreign).toEqual(missing);
    expect((await resume(other.session.id)).status).toBe(404);
    expect(
      (
        await fetch(
          `/api/sessions/${other.session.id}/items/${other.session.items[0].id}`,
        )
      ).status,
    ).toBe(404);
  });
  it('supports learner while keeping local and management boundaries closed', async () => {
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await start(f.run.setId, randomUUID())).status).toBe(201);
    expect((await fetch(`/api/sessions/${sessionId}`)).status).toBe(200);
    expect((await resume()).status).toBe(200);
    expect((await fetch('/api/admin/sets')).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    for (const headers of [
      { origin: 'http://bad.invalid' } as Record<string, string>,
      { host: 'bad.invalid' },
    ])
      expect(await rawStatus(`/api/sessions/${sessionId}`, headers)).toBe(403);
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect((await start()).status).toBe(403);
    expect((await fetch(`/api/sessions/${sessionId}`)).status).toBe(403);
    expect((await resume()).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await start()).status).toBe(403);
    expect((await fetch(`/api/sessions/${sessionId}`)).status).toBe(403);
    expect((await resume()).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
  });
  it('keeps archived sessions and projects stopped items without GET writes, persisting exclusions only on resume', async () => {
    f.c.client
      .prepare("update question_sets set status='archived' where id=?")
      .run(f.run.setId);
    expect((await start()).status).toBe(200);
    expect((await start(f.run.setId, randomUUID())).status).toBe(404);
    f.c.client.exec("update questions set status='stopped'");
    const before = f.c.client.prepare('select * from study_items').all();
    const session = await (await fetch(`/api/sessions/${sessionId}`)).json();
    expect(session.currentItemId).toBeNull();
    expect(
      await (await fetch(`/api/sessions/${sessionId}/items/${itemId}`)).json(),
    ).toEqual({ id: itemId, position: 0, state: 'excluded' });
    expect(f.c.client.prepare('select * from study_items').all()).toEqual(
      before,
    );
    const first = await (await resume()).json();
    expect(first).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
      currentItemId: null,
    });
    const saved = f.c.client.prepare('select * from study_items').all();
    await resume();
    expect(f.c.client.prepare('select * from study_items').all()).toEqual(
      saved,
    );
    f.c.client.exec("update questions set status='active'");
    expect(
      (await (await fetch(`/api/sessions/${sessionId}/items/${itemId}`)).json())
        .state,
    ).toBe('excluded');
    privateFields(first);
  });
  it('returns safe storage failure with no partial session or leaked internal data', async () => {
    f.c.client
      .prepare("update question_sets set status='published' where id=?")
      .run(f.run.setId);
    const before = f.c.client
      .prepare('select count(*) n from study_sessions')
      .get();
    f.c.client.exec(
      "create trigger fail_http_study after insert on study_items when new.position=1 begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const response = await start(f.run.setId, randomUUID());
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.error.code).toBe('internal');
    privateFields(body);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    expect(
      f.c.client.prepare('select count(*) n from study_sessions').get(),
    ).toEqual(before);
    f.c.client.exec('drop trigger fail_http_study');
    privateFields(getServerLogs());
  });
});
