import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Connection } from '../db/connection';
import { sourceCreationRequests, sources } from '../db/schema';
import { SourceError } from './source-errors';
import { sourceHash } from './source-input';
import type { sourceInput, sourcePage } from './source-input';
import { requireAdministrator } from './local-admin';

export function createSource(
  connection: Connection,
  input: ReturnType<typeof sourceInput>,
  key: string,
) {
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      const hash = sourceHash(input);
      const prior = tx
        .select()
        .from(sourceCreationRequests)
        .where(
          and(
            eq(sourceCreationRequests.createdBy, user),
            eq(sourceCreationRequests.requestKey, key),
          ),
        )
        .get();
      if (prior) {
        if (prior.requestHash !== hash) throw new SourceError('conflict');
        return { id: prior.sourceId, replayed: true };
      }
      const source = tx
        .insert(sources)
        .values({ ...input, createdBy: user, createdAt: Date.now() })
        .returning({ id: sources.id })
        .get();
      tx.insert(sourceCreationRequests)
        .values({
          createdBy: user,
          requestKey: key,
          requestHash: hash,
          sourceId: source.id,
        })
        .run();
      return { id: source.id, replayed: false };
    },
    { behavior: 'immediate' },
  );
}
export function listSources(
  connection: Connection,
  page: ReturnType<typeof sourcePage>,
) {
  requireAdministrator(connection);
  const before = page.before;
  const rows = connection.db
    .select({
      id: sources.id,
      title: sources.title,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .where(
      before
        ? or(
            lt(sources.createdAt, before.createdAt),
            and(
              eq(sources.createdAt, before.createdAt),
              lt(sources.id, before.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(sources.createdAt), desc(sources.id))
    .limit(page.limit + 1)
    .all();
  const more = rows.length > page.limit;
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: more && last ? `${last.createdAt}:${last.id}` : null,
  };
}
export function getSource(connection: Connection, id: number) {
  requireAdministrator(connection);
  const source = connection.db
    .select()
    .from(sources)
    .where(eq(sources.id, id))
    .get();
  if (!source) throw new SourceError('missing');
  return source;
}
