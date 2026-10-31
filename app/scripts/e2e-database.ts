import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionKey = 'MEDIQUEST_E2E_SESSION';

// Only the creator has cleanup authority. Child processes receive a descriptor
// for database access, never a directory to recursively delete.
export async function withE2eDatabase<T>(
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'mediquest-e2e-'));
  try {
    const token = randomUUID();
    writeFileSync(join(directory, '.owner'), token, {
      flag: 'wx',
      mode: 0o600,
    });
    const env = { ...process.env };
    delete env.MEDIQUEST_E2E_DB;
    env[sessionKey] = JSON.stringify({ directory, token });
    return await run(env);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function e2eDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[sessionKey];
  if (!raw) throw new Error('Run E2E through npm run test:e2e.');
  const session: unknown = JSON.parse(raw);
  if (
    typeof session !== 'object' ||
    session === null ||
    !('directory' in session) ||
    typeof session.directory !== 'string' ||
    !('token' in session) ||
    typeof session.token !== 'string' ||
    !session.token ||
    readFileSync(join(session.directory, '.owner'), 'utf8') !== session.token
  ) {
    throw new Error('Invalid E2E database session.');
  }
  return join(session.directory, 'test.sqlite');
}
