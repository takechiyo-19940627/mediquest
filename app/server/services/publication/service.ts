import { eq } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import { questionSets, setItems } from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { ReviewError } from '../review/input';
import { archiveInput, itemsInput, publishInput } from './input';
import { publicationState, selectedItems, validateSelection } from './state';
function nextRevision(revision: number) {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision === Number.MAX_SAFE_INTEGER
  )
    throw new ReviewError('conflict');
  return revision + 1;
}
export function replaceItems(
  connection: Connection,
  id: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      requireAdministrator({ db: tx });
      const input = itemsInput(value);
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, id))
        .get();
      if (!set) throw new ReviewError('missing');
      if (set.status !== 'draft' || set.publishedAt !== null)
        throw new ReviewError('conflict');
      validateSelection(tx, set, input.versionIds);
      const previous = selectedItems(tx, id);
      if (
        previous.length === input.versionIds.length &&
        previous.every(
          (item, index) =>
            item.questionVersionId === input.versionIds[index] &&
            item.position === index,
        )
      )
        return { revision: set.revision, ...publicationState(tx, set) };
      if (input.expectedRevision !== set.revision)
        throw new ReviewError('conflict');
      const revision = nextRevision(set.revision);
      tx.delete(setItems).where(eq(setItems.setId, id)).run();
      for (const [position, questionVersionId] of input.versionIds.entries())
        tx.insert(setItems)
          .values({ setId: id, questionVersionId, position })
          .run();
      tx.update(questionSets)
        .set({ revision })
        .where(eq(questionSets.id, id))
        .run();
      return { revision, ...publicationState(tx, { ...set, revision }) };
    },
    { behavior: 'immediate' },
  );
}
export function publishSet(connection: Connection, id: number, value: unknown) {
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      const input = publishInput(value);
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, id))
        .get();
      if (!set) throw new ReviewError('missing');
      const result = (replayed: boolean) => ({
        id: set.id,
        status: set.status,
        revision: set.revision,
        publishedBy: set.publishedBy,
        publishedAt: set.publishedAt,
        replayed,
      });
      if (
        set.status === 'published' &&
        set.publishedAt !== null &&
        set.publishedBy !== null &&
        set.publishRequestRevision === input.expectedRevision &&
        set.publishRequestFingerprint === input.publishFingerprint
      )
        return result(true);
      if (set.status !== 'draft' || set.publishedAt !== null)
        throw new ReviewError('conflict');
      const items = selectedItems(tx, id);
      if (
        !items.length ||
        items.length > 10 ||
        items.some((item, index) => item.position !== index)
      )
        throw new ReviewError('conflict');
      validateSelection(
        tx,
        set,
        items.map((item) => item.questionVersionId),
      );
      if (
        input.expectedRevision !== set.revision ||
        input.publishFingerprint !==
          publicationState(tx, set).publishFingerprint
      )
        throw new ReviewError('conflict');
      const revision = nextRevision(set.revision);
      const publishedAt = Date.now();
      tx.update(questionSets)
        .set({
          status: 'published',
          publishedBy: user,
          publishedAt,
          revision,
          publishRequestRevision: input.expectedRevision,
          publishRequestFingerprint: input.publishFingerprint,
        })
        .where(eq(questionSets.id, id))
        .run();
      return {
        ...result(false),
        status: 'published' as const,
        publishedBy: user,
        publishedAt,
        revision,
      };
    },
    { behavior: 'immediate' },
  );
}
// Issue #46: the administrator's explicit, one-way stop of a published set.
// Only a published set with a publisher and time moves to archived; the
// publication record, publish request columns, selected items, versions,
// question status and every study session, answer and report stay untouched.
// The first transition bumps the set revision once; a resend of an archived set
// with its publication record is replayed with the saved state. Draft sets,
// published sets without a complete publication record, and archived rows
// lacking one are conflicts. Re-publication is out of scope.
export function archiveSet(connection: Connection, id: number, value: unknown) {
  return connection.db.transaction(
    (tx) => {
      requireAdministrator({ db: tx });
      archiveInput(value);
      const set = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, id))
        .get();
      if (!set) throw new ReviewError('missing');
      const result = (revision: number, replayed: boolean) => ({
        id: set.id,
        status: 'archived' as const,
        revision,
        publishedBy: set.publishedBy,
        publishedAt: set.publishedAt,
        replayed,
      });
      const recorded = set.publishedAt !== null && set.publishedBy !== null;
      if (set.status === 'archived' && recorded)
        return result(set.revision, true);
      if (set.status !== 'published' || !recorded)
        throw new ReviewError('conflict');
      const revision = nextRevision(set.revision);
      tx.update(questionSets)
        .set({ status: 'archived', revision })
        .where(eq(questionSets.id, id))
        .run();
      return result(revision, false);
    },
    { behavior: 'immediate' },
  );
}
