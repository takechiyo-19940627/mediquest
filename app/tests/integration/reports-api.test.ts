import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
import { startSession } from '../../server/services/study/service';
const f = await catalogFixture();
const create = () =>
  startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
const post = (s: number, i: number, message: unknown = '確認してください') =>
  fetch(`/api/sessions/${s}/items/${i}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
const snapshot = () =>
  [
    'study_sessions',
    'study_items',
    'questions',
    'question_versions',
    'question_sets',
    'set_items',
  ].map((t) => f.c.client.prepare(`select * from ${t}`).all());
let reportId: number;
describe('issue reporting HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3202,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3202',
    },
  });
  afterAll(f.close);
  it('keeps one immutable report across competing sessions/messages and restart without exposing or changing study data', async () => {
    const a = create(),
      b = create();
    const before = snapshot();
    const responses = await Promise.all([
      post(a.id, a.items[0]!.id, '最初の指摘'),
      post(b.id, b.items[0]!.id, '別の指摘'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const values = await Promise.all(responses.map((r) => r.json()));
    const original = values.find((v) => !v.replayed);
    reportId = original.id;
    expect(values.find((v) => v.replayed)).toEqual({
      ...original,
      replayed: true,
    });
    expect(Object.keys(original).sort()).toEqual(
      ['id', 'message', 'status', 'createdAt', 'replayed'].sort(),
    );
    for (const marker of privateMarkers)
      expect(JSON.stringify(values)).not.toContain(marker);
    expect(snapshot()).toEqual(before);
    expect(
      f.c.client.prepare('select count(*) n from issue_reports').get(),
    ).toEqual({ n: 1 });
    const saved = f.c.client.prepare('select * from issue_reports').all();
    await startServer();
    expect(await (await post(b.id, b.items[0]!.id, '変更不可')).json()).toEqual(
      { ...original, replayed: true },
    );
    expect(f.c.client.prepare('select * from issue_reports').all()).toEqual(
      saved,
    );
    expect((await post(a.id, a.items[1]!.id)).status).toBe(201);
  });
  it('validates input and ownership before replay, including cross-session and missing items', async () => {
    const a = create(),
      b = create();
    for (const message of ['', ' ', 1, '😀'.repeat(2001)])
      expect((await post(a.id, a.items[0]!.id, message)).status).toBe(400);
    const url = `/api/sessions/${a.id}/items/${a.items[0]!.id}/reports`;
    for (const body of [
      '{',
      JSON.stringify({ message: 'a', reportedBy: 2 }),
      JSON.stringify({ message: 'a', questionVersionId: 1 }),
    ])
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        ).status,
      ).toBe(400);
    expect(
      (await post(a.id, a.items[0]!.id, 'x'.repeat(512 * 1024))).status,
    ).toBe(413);
    expect((await post(a.id, b.items[0]!.id)).status).toBe(404);
    expect((await post(a.id, 999999)).status).toBe(404);
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
    );
    f.c.client
      .prepare('update study_sessions set user_id=2 where id=?')
      .run(a.id);
    expect((await post(a.id, a.items[0]!.id)).status).toBe(404);
  });
  it('accepts answered/completed, stopped and persistently excluded items without mutating any learning state', async () => {
    const a = create();
    f.c.client
      .prepare(
        'update study_items set selected_ids_json=\'["b"]\',is_correct=0,answered_at=17 where id=?',
      )
      .run(a.items[0]!.id);
    f.c.client
      .prepare(
        "update study_items set excluded_reason='stopped',excluded_at=18 where id=?",
      )
      .run(a.items[1]!.id);
    f.c.client
      .prepare(
        "update study_sessions set status='completed',completed_at=19 where id=?",
      )
      .run(a.id);
    f.c.client.exec("update questions set status='stopped'");
    const before = snapshot();
    for (const item of a.items)
      expect((await post(a.id, item.id)).status).toBe(200);
    expect(snapshot()).toEqual(before);
    f.c.client.exec("update questions set status='active'");
  });
  it('restricts bounded open list and fixed-version details to administrators', async () => {
    const list = await (await fetch('/api/admin/reports?limit=1')).json();
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).toBeTypeOf('string');
    const next = await (
      await fetch(`/api/admin/reports?limit=1&before=${list.nextCursor}`)
    ).json();
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(list.items[0].id);
    expect(next.nextCursor).toBeNull();
    expect(Object.keys(list.items[0]).sort()).toEqual(
      ['id', 'message', 'status', 'createdAt', 'versionId'].sort(),
    );
    const detailResponse = await fetch(`/api/admin/reports/${reportId}`);
    expect(detailResponse.headers.get('cache-control')).toBe('no-store');
    const detail = await detailResponse.json();
    expect(detail.version.body).toBe('SECRET_BODY');
    expect(detail.version.answerIds).toEqual(['SECRET_ANSWER']);
    expect(Object.keys(detail.version).sort()).toEqual(
      [
        'id',
        'body',
        'choices',
        'answerIds',
        'explanation',
        'quote',
        'sourceId',
        'invalidatedAt',
        'invalidatedBy',
        'invalidationReason',
      ].sort(),
    );
    expect((await fetch('/api/admin/reports/99999')).status).toBe(404);
    for (const query of [
      'limit=101',
      'limit=0',
      'before=x',
      'status=confirmed',
    ])
      expect((await fetch(`/api/admin/reports?${query}`)).status).toBe(400);
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await fetch('/api/admin/reports')).status).toBe(403);
    expect((await fetch(`/api/admin/reports/${reportId}`)).status).toBe(403);
    const a = create();
    expect((await post(a.id, a.items[0]!.id)).status).toBe(200);
    f.c.client.exec("update users set role='admin' where id=1");
    f.c.client.exec("update issue_reports set status='dismissed'");
    expect(await (await fetch('/api/admin/reports')).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    expect((await fetch(`/api/admin/reports/${reportId}`)).status).toBe(200);
  });
  it('rejects forged local headers and missing users and accepts the Unicode boundary as a learner', async () => {
    const a = create();
    f.c.client.exec("update users set role='learner' where id=1");
    const r = await post(a.id, a.items[0]!.id, '😀'.repeat(2000));
    expect(r.status).toBe(201);
    expect((await r.json()).message).toBe('😀'.repeat(2000));
    for (const headers of [
      { host: 'bad.invalid' },
      { origin: 'http://bad.invalid' },
    ] as Record<string, string>[]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          `http://127.0.0.1:3202/api/sessions/${a.id}/items/${a.items[0]!.id}/reports`,
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
        req.end('{"message":"test"}');
      });
      expect(status).toBe(403);
    }
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=3 where id=1');
    expect((await post(a.id, a.items[0]!.id)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=3');
    f.c.client.pragma('foreign_keys = ON');
    f.c.client.exec(
      "update users set role='admin' where id=1; update issue_reports set status='dismissed'",
    );
  });
  it('rolls back insert failures, redacts errors and fails closed on local mode', async () => {
    const a = create();
    const before = snapshot();
    f.c.client.exec(
      "create trigger report_failure after insert on issue_reports begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const r = await post(a.id, a.items[0]!.id);
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await r.json())).not.toMatch(
      /PRIVATE_SQL|sqlite|stack|SECRET/,
    );
    expect(snapshot()).toEqual(before);
    expect(
      f.c.client
        .prepare("select count(*) n from issue_reports where status='open'")
        .get(),
    ).toEqual({ n: 0 });
    f.c.client.exec('drop trigger report_failure');
    expect(JSON.stringify(getServerLogs())).not.toMatch(/PRIVATE_SQL|SECRET/);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await post(a.id, a.items[0]!.id)).status).toBe(403);
    expect((await fetch('/api/admin/reports')).status).toBe(403);
  });
});
