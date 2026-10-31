import { rejectPastExamMutation } from '../past-exams/service';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  setCandidates,
  setItems,
  setRevisionRequests,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { selectedItems, versionForSet } from '../publication/state';
import { ReviewError } from '../review/input';
import { revisionFingerprint, revisionInput } from './input';

export function createRevision(
  connection: Connection,
  setId: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      rejectPastExamMutation(tx, setId);
      const input = revisionInput(value);
      const requestFingerprint = revisionFingerprint(setId, input);
      const dto = (
        set: typeof questionSets.$inferSelect,
        replayed: boolean,
      ) => ({
        id: set.id,
        status: set.status,
        revision: set.revision,
        sourceId: set.sourceId,
        supersedesSetId: set.supersedesSetId,
        supersedesRevision: set.supersedesRevision,
        replayed,
      });
      const receipt = tx
        .select()
        .from(setRevisionRequests)
        .where(
          and(
            eq(setRevisionRequests.requestedBy, user),
            eq(setRevisionRequests.requestKey, input.requestKey),
          ),
        )
        .get();
      if (receipt) {
        if (receipt.requestFingerprint !== requestFingerprint)
          throw new ReviewError('conflict');
        const saved = tx
          .select()
          .from(questionSets)
          .where(eq(questionSets.id, receipt.createdSetId))
          .get();
        if (!saved) throw new ReviewError('conflict');
        return dto(saved, true);
      }
      const source = tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.id, setId))
        .get();
      if (!source) throw new ReviewError('missing');
      if (
        !['published', 'archived'].includes(source.status) ||
        source.publishedAt === null ||
        source.publishedBy === null ||
        source.revision !== input.expectedRevision
      )
        throw new ReviewError('conflict');
      const successor = tx
        .select({ id: questionSets.id })
        .from(questionSets)
        .where(
          and(
            eq(questionSets.supersedesSetId, setId),
            isNotNull(questionSets.publishedAt),
          ),
        )
        .get();
      if (successor) throw new ReviewError('conflict', successor.id);
      const items = selectedItems(tx, setId);
      if (!items.length || items.length > 10) throw new ReviewError('conflict');
      const questions = new Set<number>();
      const versions = items.map((item, index) => {
        if (item.position !== index) throw new ReviewError('conflict');
        let row;
        try {
          row = versionForSet(tx, source, item.questionVersionId);
        } catch (error) {
          if (error instanceof ReviewError) throw new ReviewError('conflict');
          throw error;
        }
        if (
          questions.has(row.question.id) ||
          (row.version.generationRunId !== null &&
            row.run?.status !== 'succeeded')
        )
          throw new ReviewError('conflict');
        questions.add(row.question.id);
        return row.version;
      });
      const now = Date.now();
      const draft = tx
        .insert(questionSets)
        .values({
          sourceId: source.sourceId,
          title: input.title,
          description: input.description,
          status: 'draft',
          createdBy: user,
          createdAt: now,
          supersedesSetId: source.id,
          supersedesRevision: source.revision,
        })
        .returning()
        .get();
      versions.forEach((version, position) => {
        tx.insert(setCandidates)
          .values({
            setId: draft.id,
            questionId: version.questionId,
            questionVersionId: version.id,
          })
          .run();
        tx.insert(setItems)
          .values({ setId: draft.id, questionVersionId: version.id, position })
          .run();
      });
      tx.insert(setRevisionRequests)
        .values({
          requestedBy: user,
          requestKey: input.requestKey,
          sourceSetId: setId,
          sourceRevision: source.revision,
          requestFingerprint,
          createdSetId: draft.id,
          createdAt: now,
        })
        .run();
      return dto(draft, false);
    },
    { behavior: 'immediate' },
  );
}
