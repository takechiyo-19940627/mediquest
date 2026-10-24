import { isAbsolute, resolve } from 'node:path';

export function databasePath(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.MEDIQUEST_DB_PATH;
  if (
    !value ||
    value.trim() !== value ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new Error('MEDIQUEST_DB_PATH must be an absolute filesystem path');
  }
  return resolve(value);
}
