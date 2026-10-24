import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import type { Connection } from '../db/connection';
import { users } from '../db/schema';
import { SourceError } from './source-errors';

export function localOrigin(env: Record<string, string | undefined>) {
  if (env.MEDIQUEST_LOCAL_MODE !== 'true') throw new SourceError('forbidden');
  let url: URL;
  try {
    url = new URL(env.MEDIQUEST_LOCAL_ORIGIN ?? '');
  } catch {
    throw new SourceError('forbidden');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new SourceError('forbidden');
  return url;
}
export function requireAdministrator(connection: {
  db: Pick<Connection['db'], 'select'>;
}) {
  const user = connection.db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, 1))
    .get();
  if (!user || user.role !== 'admin') throw new SourceError('forbidden');
  return user.id;
}

export function requireLocalRequest(
  env: Record<string, string | undefined>,
  request: { remoteAddress?: string; host?: string; origin?: string },
) {
  const canonical = localOrigin(env);
  const address = request.remoteAddress ?? '';
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  const loopback =
    address === '::1' || (isIP(ipv4) === 4 && ipv4.startsWith('127.'));
  if (
    !loopback ||
    request.host !== canonical.host ||
    (request.origin !== undefined && request.origin !== canonical.origin)
  )
    throw new SourceError('forbidden');
}
