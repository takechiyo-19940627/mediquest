import { setupSharedHttpServer } from '../fixtures/http-server';
import { request } from 'node:http';
import { describe, it, expect, afterAll } from 'vitest';
import { fetch, startServer, getServerLogs } from '@nuxt/test-utils/e2e';
import { fileURLToPath } from 'node:url';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
const f = await catalogFixture();
const detail = `/api/sets/${f.run.setId}`;
function rawStatus(
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:3199${path}`,
      { headers },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
        response.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const keys = [
  'id',
  'title',
  'description',
  'publishedAt',
  'availableQuestionCount',
];
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const marker of [...privateMarkers, f.database])
    expect(text).not.toContain(marker);
}
describe('local learning catalog HTTP', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    port: 3199,
    env: {
      MEDIQUEST_DB_PATH: f.database,
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3199',
    },
  });
  afterAll(f.close);
  it('allows admin and learner to read only the explicit DTO while learner remains forbidden from administration', async () => {
    for (const role of ['admin', 'learner']) {
      f.c.client.prepare('update users set role=? where id=1').run(role);
      const list = await fetch('/api/sets');
      expect(list.status).toBe(200);
      expect(list.headers.get('cache-control')).toBe('no-store');
      const page = await list.json();
      expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor']);
      expect(page.items).toHaveLength(1);
      expect(Object.keys(page.items[0]).sort()).toEqual([...keys].sort());
      expect(page.items[0].availableQuestionCount).toBe(2);
      noSecrets(page);
      const response = await fetch(detail);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const data = await response.json();
      expect(Object.keys(data).sort()).toEqual([...keys, 'canStart'].sort());
      expect(data.canStart).toBe(true);
      noSecrets(data);
    }
    for (const path of [
      '/api/admin/sources',
      `/api/admin/sets/${f.run.setId}`,
      '/api/admin/sets',
    ])
      expect((await fetch(path)).status).toBe(403);
    f.c.client.exec("update users set role='admin'");
  });
  it('uses indistinguishable 404s and validates ids, limits, cursor namespaces and unknown identity inputs', async () => {
    const bodies = [];
    for (const id of [f.draftId, f.archivedId, 999999]) {
      const response = await fetch(`/api/sets/${id}`);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      bodies.push(await response.json());
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    noSecrets(bodies);
    for (const path of [
      '/api/sets/0',
      '/api/sets/1.1',
      '/api/sets?limit=101',
      '/api/sets?limit=0',
      '/api/sets?before=123:1',
      '/api/sets?before=published:1:0',
      '/api/sets?role=admin',
      '/api/sets?userId=1',
    ])
      expect((await fetch(path)).status).toBe(400);
  });
  it('applies stopping immediately, keeps zero-count publications, and pages with stable published cursors', async () => {
    f.c.client.exec("update questions set status='stopped'");
    expect(await (await fetch(detail)).json()).toMatchObject({
      availableQuestionCount: 0,
      canStart: false,
    });
    expect((await (await fetch('/api/sets')).json()).items).toHaveLength(1);
    f.c.client.exec("update questions set status='active'");
    f.c.client.exec(
      "update question_sets set status='published',published_at=100,published_by=1",
    );
    const first = await (await fetch('/api/sets?limit=1')).json();
    expect(first.items[0].id).toBe(f.archivedId);
    const second = await (
      await fetch(
        `/api/sets?limit=1&before=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    expect(second.items[0].id).toBe(f.draftId);
    f.c.client
      .prepare("update question_sets set status='archived' where id=?")
      .run(f.archivedId);
    expect((await fetch(`/api/sets/${f.archivedId}`)).status).toBe(404);
  });
  it('rejects missing users and invalid local boundaries on both endpoints', async () => {
    const paths = ['/api/sets', detail];
    f.c.client.pragma('foreign_keys = OFF');
    f.c.client.exec('update users set id=2 where id=1');
    for (const path of paths) expect((await fetch(path)).status).toBe(403);
    f.c.client.exec('update users set id=1 where id=2');
    f.c.client.pragma('foreign_keys = ON');
    const boundaryHeaders: Record<string, string>[] = [
      { origin: 'http://untrusted.invalid' },
      { host: 'untrusted.invalid' },
    ];
    for (const path of paths)
      for (const headers of boundaryHeaders)
        expect(await rawStatus(path, headers)).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'false' } });
    for (const path of paths) expect((await fetch(path)).status).toBe(403);
    await startServer({ env: { MEDIQUEST_LOCAL_MODE: 'true' } });
  });
  it('closes failed reads and emits only safe 500 errors without private content in logs', async () => {
    f.c.client.exec('alter table question_versions rename to hidden_versions');
    for (const path of ['/api/sets', detail]) {
      const response = await fetch(path);
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body.error.code).toBe('internal');
      expect(JSON.stringify(body)).not.toMatch(
        /SQL|sqlite|stack|hidden_versions/,
      );
      noSecrets(body);
    }
    f.c.client.exec('alter table hidden_versions rename to question_versions');
    expect((await fetch(detail)).status).toBe(200);
    noSecrets(getServerLogs());
  });
});
