import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import { questionSets, users } from '../../db/schema';
import { SourceError } from '../source-errors';
import type { catalogPage } from './input';
export function requireLocalLearner(connection: {
  db: Pick<Connection['db'], 'select'>;
}) {
  const user = connection.db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, 1))
    .get();
  if (!user || !['admin', 'learner'].includes(user.role))
    throw new SourceError('forbidden');
  return user.id;
}
export class CatalogMissing extends Error {}
const published = and(
  eq(questionSets.status, 'published'),
  isNotNull(questionSets.publishedBy),
  isNotNull(questionSets.publishedAt),
);
// Keep the public DTO explicit. Never reuse administrative candidate responses.
const fields = {
  id: questionSets.id,
  title: questionSets.title,
  description: questionSets.description,
  publishedAt: questionSets.publishedAt,
  availableQuestionCount: sql<number>`(select count(distinct q.id) from set_items i join question_versions v on i.question_version_id=v.id join questions q on v.question_id=q.id join set_candidates c on c.set_id=i.set_id and c.question_version_id=v.id and c.question_id=v.question_id left join generation_runs r on v.generation_run_id=r.id where i.set_id=question_sets.id and q.status='active' and q.source_id=question_sets.source_id and ((v.generation_run_id is not null and r.source_id=question_sets.source_id and r.status='succeeded') or (v.generation_run_id is null and exists(select 1 from question_versions parent where parent.id=v.derived_from_version_id and parent.question_id=v.question_id))) and v.invalidated_at is null and v.reviewed_by is not null and v.reviewed_at is not null)`,
};
export function listPublishedSets(
  connection: Connection,
  page: ReturnType<typeof catalogPage>,
) {
  return connection.db.transaction((tx) => {
    requireLocalLearner({ db: tx });
    const before = page.before;
    const rows = tx
      .select(fields)
      .from(questionSets)
      .where(
        and(
          published,
          before
            ? or(
                lt(questionSets.publishedAt, before.publishedAt),
                and(
                  eq(questionSets.publishedAt, before.publishedAt),
                  lt(questionSets.id, before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(questionSets.publishedAt), desc(questionSets.id))
      .limit(page.limit + 1)
      .all();
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > page.limit && last
          ? `published:${last.publishedAt}:${last.id}`
          : null,
    };
  });
}
export function getPublishedSet(connection: Connection, id: number) {
  return connection.db.transaction((tx) => {
    requireLocalLearner({ db: tx });
    const row = tx
      .select(fields)
      .from(questionSets)
      .where(and(published, eq(questionSets.id, id)))
      .get();
    if (!row) throw new CatalogMissing();
    return { ...row, canStart: row.availableQuestionCount > 0 };
  });
}
