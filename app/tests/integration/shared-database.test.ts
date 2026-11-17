import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../server/db/connection';
import {
  createDatabaseManager,
  serverDatabase,
  getSharedDatabase,
} from '../../server/db/shared';
import { migrateDatabase } from '../../server/db/migrate';
import { seedAdministrator } from '../../server/db/seed';
import { createSource } from '../../server/services/sources';
import {
  generateQuestions,
  generationStatus,
} from '../../server/services/generation/service';
import { output, sourceText } from '../fixtures/generation';

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
}));

const directories: string[] = [];
const managers: ReturnType<typeof createDatabaseManager>[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-shared-'));
  directories.push(directory);
  const path = join(directory, 'db.sqlite');
  const connect = vi.fn(() => openDatabase({ MEDIQUEST_DB_PATH: path }));
  const manager = createDatabaseManager(connect);
  managers.push(manager);
  return { manager, connect, path };
}
afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it('opens lazily, reuses the connection after rollback, and closes once', () => {
  const { manager, connect, path } = fixture();
  expect(connect).not.toHaveBeenCalled();
  const connection = manager.get();
  const close = vi.spyOn(connection, 'close');
  connection.client.exec('CREATE TABLE records (value TEXT NOT NULL)');
  expect(() =>
    connection.db.transaction(() => {
      connection.client
        .prepare('INSERT INTO records VALUES (?)')
        .run('rollback');
      throw new Error('abort');
    }),
  ).toThrow('abort');
  expect(connection.client.inTransaction).toBe(false);
  expect(connection.client.prepare('SELECT * FROM records').all()).toEqual([]);
  for (let index = 0; index < 10; index++) {
    expect(manager.get()).toBe(connection);
    manager
      .get()
      .client.prepare('INSERT INTO records VALUES (?)')
      .run(String(index));
  }
  expect(connect).toHaveBeenCalledTimes(1);
  expect(connection.client.pragma('busy_timeout', { simple: true })).toBe(1000);
  expect(connection.client.pragma('journal_mode', { simple: true })).toBe(
    'delete',
  );
  manager.close();
  manager.close();
  expect(close).toHaveBeenCalledTimes(1);
  expect(connection.client.open).toBe(false);
  expect(() => manager.get()).toThrow('lifetime has ended');
  const independent = openDatabase({ MEDIQUEST_DB_PATH: path });
  try {
    expect(
      independent.client.prepare('SELECT * FROM records').all(),
    ).toHaveLength(10);
  } finally {
    independent.close();
  }
});

it('does not cache failed initialization and keeps test lifetimes isolated', () => {
  const first = fixture();
  first.connect.mockImplementationOnce(() => {
    throw new Error('initialization failed');
  });
  expect(() => first.manager.get()).toThrow('initialization failed');
  const a = first.manager.get();
  const b = fixture().manager.get();
  expect(first.connect).toHaveBeenCalledTimes(2);
  expect(a).not.toBe(b);
  a.client.exec('CREATE TABLE isolated (id INTEGER)');
  expect(() => b.client.prepare('SELECT * FROM isolated')).toThrow();
  first.manager.close();
  expect(b.client.open).toBe(true);
});

it('does not open on shutdown before first access', () => {
  const { manager, connect } = fixture();
  manager.close();
  expect(() => manager.get()).toThrow('lifetime has ended');
  expect(connect).not.toHaveBeenCalled();
});

it('reuses the same server owner across module re-evaluation', async () => {
  const first = await import('../../server/db/shared');
  vi.resetModules();
  const reloaded = await import('../../server/db/shared');
  expect(reloaded.serverDatabase).toBe(first.serverDatabase);
});

it('shares generation access without holding a transaction over provider waits', async () => {
  const { path } = fixture();
  vi.stubEnv('MEDIQUEST_DB_PATH', path);
  try {
    const connection = getSharedDatabase();
    migrateDatabase(
      connection,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    seedAdministrator(connection);
    createSource(connection, { title: '教材', body: sourceText }, randomUUID());
    const request = {
      sourceId: 1,
      requestedCount: 1,
      title: '共有',
      requestKey: randomUUID(),
    };
    const provider = vi.fn(async () => {
      expect(connection.client.inTransaction).toBe(false);
      await Promise.resolve();
      expect(getSharedDatabase()).toBe(connection);
      return { kind: 'success' as const, output: output(1) };
    });
    const config = { model: 'test-only-model', promptVersion: 'test-v1' };
    const run = await generateQuestions(request, config, provider);
    expect(run.status).toBe('succeeded');
    expect((await generateQuestions(request, config, provider)).id).toBe(
      run.id,
    );
    expect(generationStatus(run.id).status).toBe('succeeded');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(connection.client.open).toBe(true);
    const plugin = (await import('../../server/plugins/database')).default;
    const hook = vi.fn<(name: string, callback: () => void) => void>();
    await plugin({ hooks: { hook } } as unknown as Parameters<
      typeof plugin
    >[0]);
    expect(hook).toHaveBeenCalledWith('close', expect.any(Function));
    hook.mock.calls[0]![1]();
    expect(connection.client.open).toBe(false);
    expect(() => generationStatus(run.id)).toThrow();
  } finally {
    serverDatabase.close();
    vi.unstubAllEnvs();
  }
});

it('closes the actual client when initialization fails after opening SQLite', () => {
  const { manager } = fixture();
  const pragma = vi
    .spyOn(Database.prototype, 'pragma')
    .mockImplementationOnce(() => {
      throw new Error('pragma failure');
    });
  try {
    expect(() => manager.get()).toThrow('pragma failure');
    expect((pragma.mock.contexts[0] as Database.Database).open).toBe(false);
    expect(manager.get().client.open).toBe(true);
  } finally {
    pragma.mockRestore();
  }
});
