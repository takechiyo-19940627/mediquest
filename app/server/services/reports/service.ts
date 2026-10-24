import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  issueReports,
  questionVersions,
  questions,
  studyItems,
  studySessions,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import { requireLocalLearner } from '../learning-catalog/service';
import { SourceError } from '../source-errors';
import type { sourcePage } from '../source-input';
import { reportInput } from './input';
const reportFields = {
  id: issueReports.id,
  message: issueReports.message,
  status: issueReports.status,
  createdAt: issueReports.createdAt,
};
export function createReport(
  connection: Connection,
  sessionId: number,
  itemId: number,
  value: unknown,
) {
  return connection.db.transaction(
    (tx) => {
      const user = requireLocalLearner({ db: tx });
      const input = reportInput(value);
      const item = tx
        .select({ versionId: studyItems.questionVersionId })
        .from(studyItems)
        .innerJoin(studySessions, eq(studyItems.sessionId, studySessions.id))
        .where(
          and(
            eq(studyItems.id, itemId),
            eq(studySessions.id, sessionId),
            eq(studySessions.userId, user),
          ),
        )
        .get();
      if (!item) throw new SourceError('missing');
      const existing = tx
        .select(reportFields)
        .from(issueReports)
        .where(
          and(
            eq(issueReports.reportedBy, user),
            eq(issueReports.questionVersionId, item.versionId),
            eq(issueReports.status, 'open'),
          ),
        )
        .get();
      if (existing) return { ...existing, replayed: true };
      const report = tx
        .insert(issueReports)
        .values({
          reportedBy: user,
          questionVersionId: item.versionId,
          studyItemId: itemId,
          message: input.message,
          status: 'open',
          createdAt: Date.now(),
        })
        .returning(reportFields)
        .get();
      return { ...report, replayed: false };
    },
    { behavior: 'immediate' },
  );
}
export function listReports(
  connection: Connection,
  page: ReturnType<typeof sourcePage>,
) {
  requireAdministrator(connection);
  const before = page.before;
  const rows = connection.db
    .select({ ...reportFields, versionId: issueReports.questionVersionId })
    .from(issueReports)
    .where(
      and(
        eq(issueReports.status, 'open'),
        before
          ? or(
              lt(issueReports.createdAt, before.createdAt),
              and(
                eq(issueReports.createdAt, before.createdAt),
                lt(issueReports.id, before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(issueReports.createdAt), desc(issueReports.id))
    .limit(page.limit + 1)
    .all();
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > page.limit && last ? `${last.createdAt}:${last.id}` : null,
  };
}
export function getReport(connection: Connection, id: number) {
  requireAdministrator(connection);
  const report = connection.db
    .select({
      ...reportFields,
      versionId: issueReports.questionVersionId,
      version: {
        id: questionVersions.id,
        body: questionVersions.body,
        choices: questionVersions.choicesJson,
        answerIds: questionVersions.answerIdsJson,
        explanation: questionVersions.explanation,
        quote: questionVersions.quote,
        sourceId: questions.sourceId,
      },
    })
    .from(issueReports)
    .innerJoin(
      questionVersions,
      eq(issueReports.questionVersionId, questionVersions.id),
    )
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .where(eq(issueReports.id, id))
    .get();
  if (!report) throw new SourceError('missing');
  return report;
}
