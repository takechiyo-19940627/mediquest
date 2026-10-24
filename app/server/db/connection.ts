import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { databasePath } from './path.ts';
import * as schema from './schema.ts';

// Explicit construction only: importing this module never opens or migrates a DB.
export function openDatabase(
  env: Record<string, string | undefined> = process.env,
) {
  const client = new Database(databasePath(env));
  try {
    client.pragma('foreign_keys = ON');
    const db = drizzle(client, { schema });
    return { db, client, close: () => client.close() };
  } catch (error) {
    client.close();
    throw error;
  }
}
export type Connection = ReturnType<typeof openDatabase>;
