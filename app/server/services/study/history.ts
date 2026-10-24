import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  questionSets,
  questionVersions,
  questions,
  studyItems,
  studySessions,
} from '../../db/schema';
import { requireLocalLearner } from '../learning-catalog/service';
import { itemState, statistics } from './answers';
import type { historyQuery } from './input';
type Reader = Pick<Connection['db'], 'select'>;
// Keep the history DTO explicit: no items, choices, answers, explanations,
// quotes, source text, generation data, or user data. setTitle is the current
// set title; no title snapshot is stored.
const fields = {
  id: studySessions.id,
  setId: studySessions.setId,
  setTitle: questionSets.title,
  status: studySessions.status,
  mode: studySessions.mode,
  startedAt: studySessions.startedAt,
  completedAt: studySessions.completedAt,
};
// Project only the sessions on the returned page, reusing the same item state
// and statistics definitions as the single-session GET. Never writes.
type ItemProgress = {
  id: number;
  state: ReturnType<typeof itemState>;
  isCorrect: boolean | null;
};
function progress(db: Reader, sessionIds: number[]) {
  const grouped = new Map<number, ItemProgress[]>();
  if (!sessionIds.length) return grouped;
  const rows = db
    .select({
      sessionId: studyItems.sessionId,
      id: studyItems.id,
      answeredAt: studyItems.answeredAt,
      excludedAt: studyItems.excludedAt,
      isCorrect: studyItems.isCorrect,
      questionStatus: questions.status,
      invalidatedAt: questionVersions.invalidatedAt,
    })
    .from(studyItems)
    .innerJoin(
      questionVersions,
      eq(studyItems.questionVersionId, questionVersions.id),
    )
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .where(inArray(studyItems.sessionId, sessionIds))
    .orderBy(studyItems.sessionId, studyItems.position)
    .all();
  for (const row of rows) {
    const list = grouped.get(row.sessionId) ?? [];
    list.push({
      id: row.id,
      state: itemState(row, row.questionStatus, row.invalidatedAt),
      isCorrect: row.isCorrect,
    });
    grouped.set(row.sessionId, list);
  }
  return grouped;
}
export function listSessions(
  connection: Connection,
  page: ReturnType<typeof historyQuery>,
) {
  return connection.db.transaction((tx) => {
    const userId = requireLocalLearner({ db: tx });
    const before = page.before;
    const rows = tx
      .select(fields)
      .from(studySessions)
      .innerJoin(questionSets, eq(studySessions.setId, questionSets.id))
      .where(
        and(
          eq(studySessions.userId, userId),
          page.status ? eq(studySessions.status, page.status) : undefined,
          before
            ? or(
                lt(studySessions.startedAt, before.startedAt),
                and(
                  eq(studySessions.startedAt, before.startedAt),
                  lt(studySessions.id, before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(studySessions.startedAt), desc(studySessions.id))
      .limit(page.limit + 1)
      .all();
    const sessions = rows.slice(0, page.limit);
    const last = sessions.at(-1);
    const states = progress(
      tx,
      sessions.map((session) => session.id),
    );
    return {
      items: sessions.map((session) => {
        const items = states.get(session.id) ?? [];
        return {
          ...session,
          currentItemId:
            items.find((item) => item.state === 'unanswered')?.id ?? null,
          statistics: statistics(items),
        };
      }),
      nextCursor:
        rows.length > page.limit && last
          ? `study:${last.startedAt}:${last.id}`
          : null,
    };
  });
}
