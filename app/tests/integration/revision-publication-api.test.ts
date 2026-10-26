import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { setupSharedHttpServer } from '../fixtures/http-server';
import { publishedSourceFixture } from '../fixtures/published-revision';
import { getSet, confirmVersion } from '../../server/services/review/service';
import { createRevision } from '../../server/services/revisions/service';
import {
  publishSet,
  replaceItems,
} from '../../server/services/publication/service';
const f = await publishedSourceFixture();
const PORT = 3212;
const json = (body: unknown, method = 'POST', headers = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const base = (id: number) => `/api/admin/sets/${id}`;
const detail = (id: number) => getSet(f.c, id);
const input = (id: number) => ({
  expectedRevision: detail(id).revision,
  publishFingerprint: detail(id).publishFingerprint,
  confirmed: true,
});
const draft = async () => {
  const r = await fetch(
    `${base(f.run.setId)}/revisions`,
    json({
      expectedRevision: f.detail().revision,
      requestKey: randomUUID(),
      title: 'revision',
      description: '',
    }),
  );
  expect(r.status).toBe(201);
  return (await r.json()).id as number;
};
const publish = (id: number, body = input(id)) =>
  fetch(`${base(id)}/publish`, json(body));
const start = (setId: number, key = randomUUID()) =>
  fetch('/api/sessions', json({ setId }, 'POST', { 'idempotency-key': key }));

describe('atomic revision publication HTTP', async () => {
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
  it('COWs, confirms, adopts, publishes exactly once and preserves fixed session answers across restart', async () => {
    const key = randomUUID();
    const started = await start(f.run.setId, key);
    expect(started.status).toBe(201);
    const session = (await started.json()).session;
    const answerUrl = `/api/sessions/${session.id}/items/${session.items[0].id}/answer`;
    expect((await fetch(answerUrl, json({ selectedIds: ['b'] }))).status).toBe(
      200,
    );
    const saved = await (await fetch(`/api/sessions/${session.id}`)).json();
    const versions = f.c.client
      .prepare('select * from question_versions order by id')
      .all();
    const id = await draft();
    const v = detail(id).candidates[0]!;
    const edited = await fetch(
      `${base(id)}/versions/${v.id}/content`,
      json(
        {
          expectedRevision: detail(id).revision,
          expectedFingerprint: v.fingerprint,
          body: 'replacement',
          choices: v.choices,
          answerIds: v.answerIds,
          explanation: v.explanation,
          quote: 'unmatched quote',
        },
        'PUT',
      ),
    );
    expect(edited.status).toBe(200);
    const child = await edited.json();
    expect((await publish(id)).status).toBe(409);
    expect(
      (
        await fetch(
          `${base(id)}/versions/${child.id}/review`,
          json(
            {
              fingerprint: child.fingerprint,
              confirmed: true,
              acknowledgeQuoteMismatch: true,
            },
            'PUT',
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base(id)}/items`,
          json(
            {
              expectedRevision: detail(id).revision,
              versionIds: [child.id],
            },
            'PUT',
          ),
        )
      ).status,
    ).toBe(200);
    const body = input(id);
    const responses = await Promise.all([publish(id, body), publish(id, body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results[0].publishedAt).toBe(results[1].publishedAt);
    expect(responses[0]!.headers.get('cache-control')).toContain('no-store');
    expect((await (await fetch(base(f.run.setId))).json()).status).toBe(
      'archived',
    );
    expect((await (await fetch(base(id))).json()).status).toBe('published');
    expect((await fetch(`/api/sets/${f.run.setId}`)).status).toBe(404);
    expect((await fetch(`/api/sets/${id}`)).status).toBe(200);
    const catalog = await (await fetch('/api/sets')).json();
    expect(catalog.items.map((s: { id: number }) => s.id)).toContain(id);
    expect(catalog.items.map((s: { id: number }) => s.id)).not.toContain(
      f.run.setId,
    );
    expect((await start(f.run.setId)).status).toBe(404);
    expect((await start(f.run.setId, key)).status).toBe(200);
    expect((await start(id)).status).toBe(201);
    expect(await (await fetch(`/api/sessions/${session.id}`)).json()).toEqual(
      saved,
    );
    expect(
      (
        await fetch(
          `/api/sessions/${session.id}/items/${session.items[1].id}/skip`,
          json({}),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `/api/sessions/${session.id}/items/${session.items[1].id}/answer`,
          json({ selectedIds: ['a'] }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `/api/sessions/${session.id}/items/${session.items[0].id}/reports`,
          json({ message: 'old session remains usable' }),
        )
      ).status,
    ).toBe(201);
    expect(
      f.c.client
        .prepare('select * from question_versions where id<=? order by id')
        .all(f.ids.at(-1)),
    ).toEqual(versions);
    expect((await fetch(`${base(id)}/archive`, json({}))).status).toBe(200);
    await startServer();
    const replay = await publish(id, body);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      status: 'archived',
      replayed: true,
    });
  });
  it('allows only one sibling even after archiving its winner', async () => {
    // A fresh published source is the previous winner's successor.
    const parent = f.c.client
      .prepare(
        'select id from question_sets where supersedes_set_id=? order by id limit 1',
      )
      .get(f.run.setId) as { id: number };
    const make = (id: number) =>
      createRevision(f.c, id, {
        requestKey: randomUUID(),
        expectedRevision: detail(id).revision,
        title: 'sibling',
        description: '',
      }).id;
    const a = make(parent.id),
      b = make(parent.id);
    const responses = await Promise.all([publish(a), publish(b)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = responses[0]!.status === 201 ? a : b;
    const loser = winner === a ? b : a;
    expect(detail(loser)).toMatchObject({ status: 'draft', publishedAt: null });
    expect((await fetch(`/api/sets/${loser}`)).status).toBe(404);
    expect((await fetch(`${base(winner)}/archive`, json({}))).status).toBe(200);
    expect((await publish(loser)).status).toBe(409);
  });
  // Isolated source/question for every order; no dependency on race winners.
  for (const operation of [
    'archive',
    'start',
    'stop',
    'invalidate',
    'edit',
  ] as const) {
    for (const order of ['before', 'after', 'concurrent'] as const) {
      it(`publication versus ${operation} (${order}) is serialized`, async () => {
        const generated = await f.generate();
        const sourceId = generated.setId;
        for (const v of detail(sourceId).candidates)
          confirmVersion(f.c, sourceId, v.id, {
            fingerprint: v.fingerprint,
            confirmed: true,
            acknowledgeQuoteMismatch: true,
          });
        replaceItems(f.c, sourceId, {
          expectedRevision: 0,
          versionIds: [detail(sourceId).candidates[0]!.id],
        });
        publishSet(f.c, sourceId, input(sourceId));
        const created = await fetch(
          `${base(sourceId)}/revisions`,
          json({
            requestKey: randomUUID(),
            expectedRevision: detail(sourceId).revision,
            title: 'race',
            description: '',
          }),
        );
        expect(created.status).toBe(201);
        const id = (await created.json()).id as number;
        const d = detail(id),
          v = d.candidates[0]!;
        let reportId: number | undefined;
        if (operation === 'invalidate') {
          const session = (await (await start(sourceId)).json()).session;
          const report = await fetch(
            `/api/sessions/${session.id}/items/${session.items[0].id}/reports`,
            json({ message: 'race report' }),
          );
          expect(report.status).toBe(201);
          reportId = (await report.json()).id;
        }
        const body = input(id);
        const mutation = () => {
          if (operation === 'archive')
            return fetch(`${base(sourceId)}/archive`, json({}));
          if (operation === 'start') return start(sourceId);
          if (operation === 'stop')
            return fetch(`/api/admin/questions/${v.questionId}/stop`, json({}));
          if (operation === 'invalidate')
            return fetch(
              `/api/admin/reports/${reportId}/resolution`,
              json({ decision: 'confirmed', note: 'race' }, 'PUT'),
            );
          return fetch(
            `${base(id)}/versions/${v.id}/content`,
            json(
              {
                expectedRevision: d.revision,
                expectedFingerprint: v.fingerprint,
                body: 'racing edit',
                choices: v.choices,
                answerIds: v.answerIds,
                explanation: v.explanation,
                quote: v.quote,
              },
              'PUT',
            ),
          );
        };
        let publication: Response, changed: Response;
        if (order === 'before') {
          changed = await mutation();
          publication = await publish(id, body);
        } else if (order === 'after') {
          publication = await publish(id, body);
          changed = await mutation();
        } else
          [publication, changed] = await Promise.all([
            publish(id, body),
            mutation(),
          ]);
        expect([201, 409]).toContain(publication.status);
        if (operation === 'start') {
          expect(publication.status).toBe(201);
          expect(
            order === 'before' ? [201] : order === 'after' ? [404] : [201, 404],
          ).toContain(changed.status);
          if (changed.status === 201)
            expect((await changed.json()).session.items).toHaveLength(1);
        } else if (operation !== 'edit') {
          expect(changed.status).toBe(200);
          if (order === 'before') expect(publication.status).toBe(409);
          if (order === 'after') expect(publication.status).toBe(201);
        }
        if (operation === 'edit') {
          expect([
            [201, 409],
            [409, 200],
          ]).toContainEqual([publication.status, changed.status]);
          if (order === 'before') expect(publication.status).toBe(409);
          if (order === 'after') expect(publication.status).toBe(201);
        }
        expect(detail(id).status).toBe(
          publication.status === 201 ? 'published' : 'draft',
        );
        expect(detail(sourceId).status).toBe(
          publication.status === 201 || operation === 'archive'
            ? 'archived'
            : 'published',
        );
        expect(detail(sourceId).revision).toBe(
          2 + (publication.status === 201 || operation === 'archive' ? 1 : 0),
        );
      });
    }
  }
  it('rejects unauthorized revision publication and safely rolls back storage failure', async () => {
    const generated = await f.generate();
    const sourceId = generated.setId;
    for (const v of detail(sourceId).candidates)
      confirmVersion(f.c, sourceId, v.id, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: true,
      });
    replaceItems(f.c, sourceId, {
      expectedRevision: 0,
      versionIds: [detail(sourceId).candidates[0]!.id],
    });
    publishSet(f.c, sourceId, input(sourceId));
    const id = createRevision(f.c, sourceId, {
      requestKey: randomUUID(),
      expectedRevision: detail(sourceId).revision,
      title: 'failure',
      description: '',
    }).id;
    const body = input(id);
    const snapshot = () =>
      f.c.client.prepare('select * from question_sets order by id').all();
    const before = snapshot();
    expect(
      (
        await fetch(
          `${base(id)}/publish`,
          json(body, 'POST', { origin: 'http://outside.invalid' }),
        )
      ).status,
    ).toBe(403);
    f.c.client.exec("update users set role='learner' where id=1");
    try {
      expect((await publish(id, body)).status).toBe(403);
    } finally {
      f.c.client.exec("update users set role='admin' where id=1");
    }
    f.c.client.pragma('foreign_keys=OFF');
    f.c.client.exec('update users set id=999 where id=1');
    try {
      expect((await publish(id, body)).status).toBe(403);
    } finally {
      f.c.client.exec('update users set id=1 where id=999');
      f.c.client.pragma('foreign_keys=ON');
    }
    expect(snapshot()).toEqual(before);
    f.c.client.exec(
      `create trigger fail_atomic before update of status on question_sets when new.id=${sourceId} and new.status='archived' begin select raise(abort,'PRIVATE_SQL'); end`,
    );
    try {
      const failed = await publish(id, body);
      expect(failed.status).toBe(500);
      expect(failed.headers.get('cache-control')).toContain('no-store');
      expect(await failed.text()).not.toMatch(
        /PRIVATE_SQL|sqlite|stack|question_sets/,
      );
      expect(snapshot()).toEqual(before);
      expect(JSON.stringify(getServerLogs())).not.toMatch(
        /PRIVATE_SQL|question_sets/,
      );
    } finally {
      f.c.client.exec('drop trigger fail_atomic');
    }
    expect((await publish(id, body)).status).toBe(201);
  });
});
