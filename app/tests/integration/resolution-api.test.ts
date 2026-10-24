import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { setup, fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { catalogFixture } from '../fixtures/catalog';
import { startSession } from '../../server/services/study/service';
import { createReport } from '../../server/services/reports/service';
const f = await catalogFixture();
const session = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
const make = (index = 0) =>
  createReport(f.c, session.id, session.items[index]!.id, { message: '指摘' });
const path = (id: number) => `/api/admin/reports/${id}/resolution`;
const resolve = (id: number, decision = 'confirmed', note = '理由') =>
  fetch(path(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, note }),
  });
const answer = (index: number) =>
  fetch(
    `/api/sessions/${session.id}/items/${session.items[index]!.id}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedIds: ['SECRET_ANSWER'] }),
    },
  );
let report = make();
describe('admin report resolution HTTP', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    port: 3203,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3203',
    },
  });
  afterAll(f.close);
  it('checks admin, missing users, local headers and body before resolution', async () => {
    f.c.client.exec("update users set role='learner' where id=1");
    expect((await resolve(report.id)).status).toBe(403);
    f.c.client.exec("update users set role='admin' where id=1");
    for (const body of [
      '{',
      JSON.stringify({ decision: 'confirmed', note: 'x', resolvedBy: 2 }),
      JSON.stringify({ decision: 'open', note: 'x' }),
      JSON.stringify({ decision: 'confirmed', note: ' ' }),
    ])
      expect(
        (
          await fetch(path(report.id), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body,
          })
        ).status,
      ).toBe(400);
    expect(
      (await resolve(report.id, 'confirmed', 'x'.repeat(512 * 1024))).status,
    ).toBe(413);
    expect((await resolve(999999)).status).toBe(404);
    for (const headers of [
      { host: 'bad.invalid' },
      { origin: 'http://bad.invalid' },
    ] as Record<string, string>[]) {
      const status = await new Promise<number>((done, reject) => {
        const req = request(
          `http://127.0.0.1:3203${path(report.id)}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...headers },
          },
          (res) => {
            res.resume();
            res.on('end', () => done(res.statusCode!));
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end('{"decision":"confirmed","note":"x"}');
      });
      expect(status).toBe(403);
    }
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    expect((await resolve(report.id)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    expect((await resolve(report.id)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
  });
  it('dismisses once under same/competing resends without changing version or study state', async () => {
    const snapshot = () =>
      ['study_items', 'study_sessions', 'question_versions', 'set_items'].map(
        (t) => f.c.client.prepare(`select * from ${t}`).all(),
      );
    const before = snapshot();
    const responses = await Promise.all([
      resolve(report.id, 'dismissed', ' 問題なし '),
      resolve(report.id, 'dismissed', '問題なし'),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.map((v) => v.replayed).sort()).toEqual([false, true]);
    expect(bodies[0]).toEqual({ ...bodies[1], replayed: bodies[0].replayed });
    expect(snapshot()).toEqual(before);
    expect((await resolve(report.id, 'confirmed', '問題なし')).status).toBe(
      409,
    );
    report = make();
    const results = await Promise.all([
      resolve(report.id, 'dismissed', 'first'),
      resolve(report.id, 'dismissed', 'different'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(snapshot()).toEqual(before);
    report = make();
  });
  it('rolls back report and version on a storage error without leaking details', async () => {
    f.c.client.exec(
      "create trigger fail_resolution before update of invalidated_at on question_versions begin select raise(abort,'PRIVATE_SQL'); end",
    );
    const r = await resolve(report.id);
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await r.json())).not.toMatch(
      /PRIVATE_SQL|SECRET|sqlite|stack/,
    );
    expect(
      f.c.client
        .prepare('select status,resolved_at from issue_reports where id=?')
        .get(report.id),
    ).toEqual({ status: 'open', resolved_at: null });
    f.c.client.exec('drop trigger fail_resolution');
    expect(JSON.stringify(getServerLogs())).not.toMatch(/PRIVATE_SQL|SECRET/);
  });
  it('serializes answer/start with invalidation, hides feedback afterwards and preserves the original saved answer', async () => {
    const newStart = fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({ setId: f.run.setId }),
    });
    const results = await Promise.all([
      answer(0),
      resolve(report.id),
      newStart,
    ]);
    expect([200, 409]).toContain(results[0]!.status);
    expect(results[1]!.status).toBe(200);
    expect(results[2]!.status).toBe(201);
    const resolved = await results[1]!.json();
    const created = await results[2]!.json();
    for (const item of created.session.items) {
      const got = await (
        await fetch(`/api/sessions/${created.session.id}/items/${item.id}`)
      ).json();
      if (item.position === 0)
        expect(got).toMatchObject({
          state: 'excluded',
          excludedReason: 'invalidated',
        });
    }
    const before = f.c.client
      .prepare(
        'select selected_ids_json,is_correct,answered_at from study_items where id=?',
      )
      .get(session.items[0]!.id) as { answered_at: number | null };
    const dto = await (
      await fetch(`/api/sessions/${session.id}/items/${session.items[0]!.id}`)
    ).json();
    expect(dto).toEqual({
      id: session.items[0]!.id,
      position: 0,
      state: 'excluded',
      excludedReason: 'invalidated',
    });
    expect(JSON.stringify(dto)).not.toMatch(/SECRET|feedback|answerIds/);
    const replay = await answer(0);
    expect(replay.status).toBe(before.answered_at === null ? 409 : 200);
    expect(
      f.c.client
        .prepare(
          'select selected_ids_json,is_correct,answered_at from study_items where id=?',
        )
        .get(session.items[0]!.id),
    ).toEqual(before);
    await startServer();
    expect(await (await resolve(report.id)).json()).toEqual({
      ...resolved,
      replayed: true,
    });
    const detail = await (
      await fetch(`/api/admin/reports/${report.id}`)
    ).json();
    expect(detail).toMatchObject({
      resolvedAt: resolved.resolvedAt,
      resolvedBy: 1,
      version: {
        invalidatedAt: resolved.resolvedAt,
        invalidatedBy: 1,
        invalidationReason: '理由',
      },
    });
    const second = make(1);
    expect((await resolve(second.id)).status).toBe(200);
    const catalog = await (await fetch(`/api/sets/${f.run.setId}`)).json();
    expect(catalog).toMatchObject({
      canStart: false,
      availableQuestionCount: 0,
    });
    const state = await (await fetch(`/api/sessions/${session.id}`)).json();
    expect(state.statistics).toMatchObject({
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    });
    const resumed = await (
      await fetch(`/api/sessions/${session.id}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).json();
    expect(resumed.status).toBe('completed');
  });
  it('keeps first invalidation through concurrent independent reports for the same version', async () => {
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'other','learner',1)",
    );
    const otherSession = f.c.client
      .prepare(
        "insert into study_sessions(user_id,set_id,status,mode,start_request_key,started_at) values(2,?,'in_progress','normal','other',1) returning id",
      )
      .get(f.run.setId) as { id: number };
    const item = f.c.client
      .prepare(
        'insert into study_items(session_id,question_version_id,position) values(?,?,0) returning id',
      )
      .get(otherSession.id, f.ids[0]) as { id: number };
    const otherReport = f.c.client
      .prepare(
        "insert into issue_reports(reported_by,question_version_id,study_item_id,message,status,created_at) values(2,?,?,'other','open',1) returning id",
      )
      .get(f.ids[0], item.id) as { id: number };
    const own = make();
    const before = f.c.client
      .prepare('select * from question_versions where id=?')
      .get(f.ids[0]);
    const results = await Promise.all([
      resolve(own.id, 'confirmed', 'new own reason'),
      resolve(otherReport.id, 'confirmed', 'other reason'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      f.c.client
        .prepare('select * from question_versions where id=?')
        .get(f.ids[0]),
    ).toEqual(before);
    expect(
      f.c.client
        .prepare(
          'select answered_at,selected_ids_json,excluded_at from study_items where id=?',
        )
        .get(item.id),
    ).toEqual({
      answered_at: null,
      selected_ids_json: null,
      excluded_at: null,
    });
  });
});
