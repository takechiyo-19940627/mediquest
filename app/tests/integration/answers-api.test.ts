import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture } from '../fixtures/catalog';
const f = await catalogFixture();
f.c.client
  .prepare(
    'update question_versions set choices_json=?,answer_ids_json=? where id=?',
  )
  .run(
    '[{"id":"SECRET_ANSWER","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"}]',
    '["SECRET_ANSWER","b"]',
    f.ids[0],
  );
let session: { id: number; items: { id: number }[] };
const path = (s: number, i: number) => `/api/sessions/${s}/items/${i}`;
const answer = (s: number, i: number, body: unknown) =>
  fetch(`${path(s, i)}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const create = async () =>
  (
    await (
      await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({ setId: f.run.setId }),
      })
    ).json()
  ).session;
function noFeedback(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /feedback|answerIds|isCorrect|answeredAt|SECRET_EXPLANATION|SECRET_QUOTE|SECRET_SOURCE/,
  );
}
function rawStatus(url: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end('{"selectedIds":["b"]}');
  });
}
describe('answer confirmation HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3201,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3201',
    },
  });
  afterAll(f.close);
  it('keeps feedback absent before answer, then atomically accepts concurrent equivalent sets and restores saved feedback after restart', async () => {
    session = await create();
    const a = session.items[0]!.id;
    const before = await (await fetch(path(session.id, a))).json();
    expect(Object.keys(before).sort()).toEqual(
      ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
    );
    expect(before.requiredSelectionCount).toBe(2);
    noFeedback(before);
    const responses = await Promise.all([
      answer(session.id, a, { selectedIds: ['b', 'SECRET_ANSWER'] }),
      answer(session.id, a, { selectedIds: ['SECRET_ANSWER', 'b'] }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies[0].item).toEqual(bodies[1].item);
    expect(bodies.map((b) => b.replayed).sort()).toEqual([false, true]);
    expect(Object.keys(bodies[0]).sort()).toEqual([
      'item',
      'replayed',
      'session',
    ]);
    expect(Object.keys(bodies[0].item).sort()).toEqual(
      [
        'id',
        'position',
        'body',
        'choices',
        'requiredSelectionCount',
        'feedback',
      ].sort(),
    );
    expect(Object.keys(bodies[0].item.feedback).sort()).toEqual(
      [
        'selectedIds',
        'isCorrect',
        'answeredAt',
        'answerIds',
        'explanation',
        'quote',
      ].sort(),
    );
    expect(bodies[0].item.feedback.isCorrect).toBe(true);
    expect(bodies[0].session.statistics.accuracy).toBe(0.5);
    expect(bodies[0].session.currentItemId).toBe(session.items[1]!.id);
    await startServer();
    expect(await (await fetch(path(session.id, a))).json()).toEqual(
      bodies[0].item,
    );
    noFeedback(
      await (await fetch(path(session.id, session.items[1]!.id))).json(),
    );
  });
  it('commits one of competing different answers and keeps its timestamp through completion and resend', async () => {
    const b = session.items[1]!.id;
    const results = await Promise.all([
      answer(session.id, b, { selectedIds: ['SECRET_ANSWER'] }),
      answer(session.id, b, { selectedIds: ['b'] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = await results.find((r) => r.status === 200)!.json();
    expect(winner.session.status).toBe('completed');
    expect(winner.session.statistics.accuracy).toBe(
      winner.session.statistics.correctEligibleCount / 2,
    );
    const replay = await (
      await answer(session.id, b, {
        selectedIds: winner.item.feedback.selectedIds,
      })
    ).json();
    expect(replay.item).toEqual(winner.item);
    expect(replay.session.completedAt).toBe(winner.session.completedAt);
    expect(
      (
        await (
          await fetch(`/api/sessions/${session.id}/resume`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).json()
      ).completedAt,
    ).toBe(winner.session.completedAt);
  });
  it('rejects malformed, spoofed, foreign and stopped answers without revealing feedback', async () => {
    const s = await create();
    const a = s.items[0].id;
    for (const body of [
      { selectedIds: ['b'] },
      { selectedIds: ['b', 'b'] },
      { selectedIds: ['b', 'unknown'] },
      { selectedIds: ['b', 'SECRET_ANSWER'], isCorrect: true },
      { selectedIds: ['b', 'SECRET_ANSWER'], userId: 2 },
    ]) {
      const r = await answer(s.id, a, body);
      expect(r.status).toBe(400);
      noFeedback(await r.json());
    }
    expect(
      (
        await fetch(`${path(s.id, a)}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await answer(s.id, a, {
          selectedIds: ['b'],
          padding: 'x'.repeat(512 * 1024),
        })
      ).status,
    ).toBe(413);
    const cross = await answer(s.id, session.items[0]!.id, {
      selectedIds: ['b'],
    });
    expect(cross.status).toBe(404);
    noFeedback(await cross.json());
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    f.c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(s.id);
    expect((await answer(s.id, a, { selectedIds: ['b'] })).status).toBe(404);
    expect((await fetch(path(s.id, a))).status).toBe(404);
    const stopped = await create();
    f.c.client.exec("update questions set status='stopped'");
    const rejected = await answer(stopped.id, stopped.items[0].id, {
      selectedIds: ['b', 'SECRET_ANSWER'],
    });
    expect(rejected.status).toBe(409);
    noFeedback(await rejected.json());
    const untouched = f.c.client
      .prepare('select answered_at,excluded_at from study_items where id=?')
      .get(stopped.items[0].id);
    expect(untouched).toEqual({ answered_at: null, excluded_at: null });
    const before = f.c.client
      .prepare('select * from study_items where session_id=?')
      .all(stopped.id);
    const state = await (await fetch(`/api/sessions/${stopped.id}`)).json();
    expect(state.statistics).toMatchObject({
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    });
    expect(
      f.c.client
        .prepare('select * from study_items where session_id=?')
        .all(stopped.id),
    ).toEqual(before);
    const resumed = await (
      await fetch(`/api/sessions/${stopped.id}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).json();
    expect(resumed.status).toBe('completed');
    expect(resumed.statistics.accuracy).toBeNull();
    // An ordinary stop never hides or regrades an answer already saved by its owner.
    expect(
      (await (await fetch(path(session.id, session.items[0]!.id))).json())
        .feedback.isCorrect,
    ).toBe(true);
    f.c.client.exec("update questions set status='active'");
  });
  it('allows learner answers in archived sessions but rejects missing user and invalid local boundaries', async () => {
    const s = await create();
    f.c.client.exec("update users set role='learner' where id=1");
    f.c.client
      .prepare("update question_sets set status='archived' where id=?")
      .run(f.run.setId);
    expect(
      (
        await answer(s.id, s.items[0].id, {
          selectedIds: ['b', 'SECRET_ANSWER'],
        })
      ).status,
    ).toBe(200);
    expect((await fetch('/api/admin/sets')).status).toBe(403);
    for (const headers of [
      { origin: 'http://bad.invalid' } as Record<string, string>,
      { host: 'bad.invalid' },
    ])
      expect(
        await rawStatus(
          `http://127.0.0.1:3201${path(s.id, s.items[1].id)}/answer`,
          headers,
        ),
      ).toBe(403);
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect(
      (await answer(s.id, s.items[1].id, { selectedIds: ['b'] })).status,
    ).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect(
      (await answer(s.id, s.items[1].id, { selectedIds: ['b'] })).status,
    ).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
    f.c.client.exec("update users set role='admin' where id=1");
    f.c.client
      .prepare("update question_sets set status='published' where id=?")
      .run(f.run.setId);
  });
  it('returns safe 500 and rolls back a failure after answer and exclusion updates', async () => {
    const s = await create();
    f.c.client
      .prepare("update questions set status='stopped' where id=?")
      .run(f.detail().candidates[1]!.questionId);
    f.c.client.exec(
      "create trigger fail_http_answer after update on study_sessions begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const r = await answer(s.id, s.items[0].id, {
      selectedIds: ['b', 'SECRET_ANSWER'],
    });
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    noFeedback(body);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SQL|sqlite|stack/);
    expect(
      f.c.client
        .prepare(
          'select count(*) n from study_items where session_id=? and (answered_at is not null or excluded_at is not null)',
        )
        .get(s.id),
    ).toEqual({ n: 0 });
    f.c.client.exec('drop trigger fail_http_answer');
    expect(JSON.stringify(getServerLogs())).not.toMatch(
      /PRIVATE_SQL|SECRET_EXPLANATION|SECRET_QUOTE|SECRET_SOURCE/,
    );
  });
});
