import { openDatabase } from './connection';
import type { Connection } from './connection';

// One owner per server lifetime. Tests and maintenance commands use openDatabase.
export function createDatabaseManager(
  connect: () => Connection = openDatabase,
) {
  let connection: Connection | undefined;
  let closed = false;
  return {
    get(): Connection {
      if (closed) throw new Error('Database lifetime has ended');
      // Do not cache failed initialization: openDatabase cleans up before throwing.
      connection ??= connect();
      return connection;
    },
    close() {
      closed = true;
      if (connection?.client.open) connection.close();
      connection = undefined;
    },
  };
}

type Manager = ReturnType<typeof createDatabaseManager>;
const key = Symbol.for('mediquest.server.database');
const registry = globalThis as typeof globalThis & { [key]?: Manager };
// Re-evaluating the module in the same realm must not orphan an open connection.
export const serverDatabase = (registry[key] ??= createDatabaseManager());
export function getSharedDatabase() {
  return serverDatabase.get();
}
