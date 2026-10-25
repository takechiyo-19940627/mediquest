import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  lstatSync,
  realpathSync,
  mkdtempSync,
  chmodSync,
  linkSync,
  rmSync,
} from 'node:fs';
import { dirname, basename, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databasePath } from './path.ts';
import * as schema from './schema.ts';
import { migrateDatabase } from './migrate.ts';

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);
const schemaQuery =
  "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";

function absolute(path: string) {
  return databasePath({ MEDIQUEST_DB_PATH: path });
}
function absent(path: string) {
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Occupied path');
}
function destination(path: string) {
  const output = absolute(path);
  // Reject symlinks anywhere in the parent chain, including dangling links.
  let parent = dirname(output);
  while (true) {
    if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
      throw new Error('Invalid parent');
    if (parent === parse(parent).root) break;
    parent = dirname(parent);
  }
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    absent(output + suffix);
  return join(realpathSync(dirname(output)), basename(output));
}

export function inspectDatabase(client: Database.Database) {
  if (
    JSON.stringify(client.pragma('integrity_check')) !==
      '[{"integrity_check":"ok"}]' ||
    (client.pragma('foreign_key_check') as unknown[]).length
  )
    throw new Error('Invalid database');
  const expected = readMigrationFiles({ migrationsFolder }).map((m) => ({
    hash: m.hash,
    created_at: m.folderMillis,
  }));
  const actual = client
    .prepare(
      'SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at',
    )
    .all();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Unsupported migrations');
  // Validate actual schema too: a matching journal alone does not prove compatibility.
  const reference = new Database(':memory:');
  try {
    migrateDatabase(
      {
        client: reference,
        db: drizzle(reference, { schema }),
        close: () => reference.close(),
      },
      migrationsFolder,
    );
    if (
      JSON.stringify(client.prepare(schemaQuery).all()) !==
      JSON.stringify(reference.prepare(schemaQuery).all())
    )
      throw new Error('Unsupported schema');
  } finally {
    reference.close();
  }
}

export interface CopyDependencies {
  open?: (path: string) => Database.Database;
  backup?: (source: Database.Database, path: string) => Promise<unknown>;
}

// Publish only a fully verified, closed database. link() is atomic and never
// replaces an existing destination, including when two CLI processes race.
export async function copyDatabase(
  input: string,
  output: string,
  dependencies: CopyDependencies = {},
) {
  let source: Database.Database | undefined;
  let target: Database.Database | undefined;
  let temporary: string | undefined;
  let stage = 'input invalid';
  let failure: Error | undefined;
  try {
    const path = absolute(input);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      throw new Error();
    const open =
      dependencies.open ??
      ((p: string) => new Database(p, { readonly: true, fileMustExist: true }));
    source = open(path);
    inspectDatabase(source);
    stage = 'output rejected';
    const finalPath = destination(output);
    if (realpathSync(path) === finalPath) throw new Error();
    temporary = mkdtempSync(join(dirname(finalPath), '.mediquest-backup-'));
    chmodSync(temporary, 0o700);
    const staging = join(temporary, 'database.sqlite');
    stage = 'failed';
    await (dependencies.backup ?? ((db, p) => db.backup(p)))(source, staging);
    chmodSync(staging, 0o600);
    stage = 'verification failed';
    target = open(staging);
    inspectDatabase(target);
    const tables = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      const query = `SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`;
      if (
        JSON.stringify(source.prepare(query).get()) !==
        JSON.stringify(target.prepare(query).get())
      )
        throw new Error();
    }
    stage = 'close failed';
    target.close();
    target = undefined;
    source.close();
    source = undefined;
    stage = 'output rejected';
    destination(finalPath);
    linkSync(staging, finalPath);
  } catch {
    failure = new Error(`Database ${stage}`);
  } finally {
    try {
      try {
        target?.close();
      } finally {
        source?.close();
      }
    } catch {
      failure = new Error('Database close failed');
    } finally {
      if (temporary) {
        try {
          rmSync(temporary, { recursive: true, force: true });
        } catch {
          failure = new Error('Database cleanup failed');
        }
      }
    }
  }
  if (failure) throw failure;
}
