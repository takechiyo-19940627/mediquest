import { and, eq } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import { questions } from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { ReviewError } from '../review/input';
import { stopInput } from './input';
// Issue #50: the administrator's explicit, one-way stop of one logical question
// across every version. Only questions.status moves from active to stopped;
// the versions (content, confirmation, invalidation), the sets (status,
// revision, selection), the source and every study session, answer, skip and
// report stay untouched. The existing catalog/start/review/answer/skip/resume
// and publication rules already read questions.status, so stopping takes
// effect through them without writing to any history. A resend of a stopped
// question is replayed with the saved state; a missing question is missing.
// No reason/by/at columns exist in the design, so none are saved, and
// restarting a stopped question is out of scope.
export function stopQuestion(
  connection: Connection,
  id: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      requireAdministrator({ db: tx });
      stopInput(value);
      const question = tx
        .select({ id: questions.id, status: questions.status })
        .from(questions)
        .where(eq(questions.id, id))
        .get();
      if (!question) throw new ReviewError('missing');
      const result = (replayed: boolean) => ({
        id: question.id,
        status: 'stopped' as const,
        replayed,
      });
      if (question.status === 'stopped') return result(true);
      const updated = tx
        .update(questions)
        .set({ status: 'stopped' })
        .where(and(eq(questions.id, id), eq(questions.status, 'active')))
        .run();
      if (updated.changes !== 1) throw new Error('storage');
      return result(false);
    },
    { behavior: 'immediate' },
  );
}
