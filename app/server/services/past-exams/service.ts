import type { catalogPage } from '../learning-catalog/input';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNotNull, sql, lt, or } from 'drizzle-orm';
import type { Connection } from '../../db/connection';
import {
  pastExams,
  pastExamQuestions,
  pastExamRequests,
  questionSets,
  questions,
  questionVersions,
  setCandidates,
  setItems,
  sources,
} from '../../db/schema';
import { requireAdministrator } from '../local-admin';
import {
  requireLocalLearner,
  getPublishedSet,
  publishedSetFields,
} from '../learning-catalog/service';
import { requestKey } from '../source-input';
import { SourceError } from '../source-errors';
import { pastExamInput } from './input';
type Reader = Pick<Connection['db'], 'select'>;
export function isPastExam(db: Reader, id: number) {
  return !!db
    .select({ id: pastExams.setId })
    .from(pastExams)
    .where(eq(pastExams.setId, id))
    .get();
}
export function rejectPastExamMutation(db: Reader, id: number) {
  if (isPastExam(db, id)) throw new SourceError('conflict');
}
const fields = {
  publishedAt: questionSets.publishedAt,
  availableQuestionCount: publishedSetFields.availableQuestionCount,
  id: questionSets.id,
  title: questionSets.title,
  revision: questionSets.revision,
  status: questionSets.status,
  examName: pastExams.examName,
  year: pastExams.year,
  subject: pastExams.subject,
  sourceReference: pastExams.sourceReference,
  questionCount: sql<number>`(select count(*) from set_items where set_id=question_sets.id)`,
};
export function listPastExams(
  connection: Connection,
  admin = false,
  page: ReturnType<typeof catalogPage> = { limit: 20, before: undefined },
) {
  return connection.db.transaction((tx) => {
    if (admin) requireAdministrator({ db: tx });
    else requireLocalLearner({ db: tx });
    // Only current editions appear; old editions remain addressable to administrators
    // and through the owner's fixed study history.
    const before = page.before;
    const rows = tx
      .select(fields)
      .from(pastExams)
      .innerJoin(questionSets, eq(pastExams.setId, questionSets.id))
      .where(
        and(
          eq(questionSets.status, 'published'),
          isNotNull(questionSets.publishedAt),
          isNotNull(questionSets.publishedBy),
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
type ExamMetadata = ReturnType<typeof listPastExams>['items'][number];
type ExamQuestion = ReturnType<typeof pastExamInput>['questions'][number] & {
  originalQuestionVersionId: number;
  unavailable: boolean;
};
export function getPastExam(
  connection: Connection,
  id: number,
  admin: true,
): ExamMetadata & { questions: ExamQuestion[] };
export function getPastExam(
  connection: Connection,
  id: number,
  admin?: false,
): ExamMetadata & ReturnType<typeof getPublishedSet>;
export function getPastExam(connection: Connection, id: number, admin = false) {
  return connection.db.transaction((tx) => {
    if (admin) requireAdministrator({ db: tx });
    else requireLocalLearner({ db: tx });
    const row = tx
      .select(fields)
      .from(pastExams)
      .innerJoin(questionSets, eq(pastExams.setId, questionSets.id))
      .where(eq(pastExams.setId, id))
      .get();
    if (!row || (!admin && row.status !== 'published'))
      throw new SourceError('missing');
    if (!admin) return { ...row, ...getPublishedSet(connection, id) };
    const saved = tx
      .select({
        number: pastExamQuestions.questionNumber,
        version: questionVersions,
        questionStatus: questions.status,
      })
      .from(setItems)
      .innerJoin(
        questionVersions,
        eq(questionVersions.id, setItems.questionVersionId),
      )
      .innerJoin(questions, eq(questions.id, questionVersions.questionId))
      .innerJoin(
        pastExamQuestions,
        eq(pastExamQuestions.questionVersionId, questionVersions.id),
      )
      .where(eq(setItems.setId, id))
      .orderBy(setItems.position)
      .all();
    return {
      ...row,
      questions: saved.map(({ number, version, questionStatus }) => ({
        originalQuestionVersionId: version.id,
        unavailable:
          questionStatus !== 'active' || version.invalidatedAt !== null,
        questionNumber: number,
        body: version.body,
        choices: version.choicesJson,
        answerIds: version.answerIdsJson,
        explanation: version.explanation,
      })),
    };
  });
}
export function savePastExam(
  connection: Connection,
  value: unknown,
  key: unknown,
  sourceSetId?: number,
) {
  const input = pastExamInput(value, sourceSetId !== undefined);
  const normalizedKey = requestKey(key);
  if (
    sourceSetId !== undefined &&
    (!Number.isSafeInteger(sourceSetId) || sourceSetId < 1)
  )
    throw new SourceError('invalid');
  const hash = createHash('sha256')
    .update(JSON.stringify([sourceSetId ?? null, input]))
    .digest('hex');
  return connection.db.transaction(
    (tx) => {
      const user = requireAdministrator({ db: tx });
      const prior = tx
        .select()
        .from(pastExamRequests)
        .where(
          and(
            eq(pastExamRequests.requestedBy, user),
            eq(pastExamRequests.requestKey, normalizedKey),
          ),
        )
        .get();
      if (prior) {
        if (prior.requestHash !== hash) throw new SourceError('conflict');
        return { setId: prior.setId, replayed: true };
      }
      const previous =
        sourceSetId === undefined
          ? undefined
          : tx
              .select()
              .from(questionSets)
              .where(eq(questionSets.id, sourceSetId))
              .get();
      if (sourceSetId !== undefined) {
        if (!previous || !isPastExam(tx, sourceSetId))
          throw new SourceError('missing');
        if (
          previous.status !== 'published' ||
          previous.publishedAt === null ||
          previous.publishedBy === null ||
          previous.revision !== input.revision
        )
          throw new SourceError('conflict');
      }
      const now = Date.now();
      const title = `${input.examName} ${input.year} ${input.subject}`;
      // Internal provenance container satisfies the existing relation without requiring
      // a textbook or invented quotation. Revisions retain logical question identities.
      const source = previous
        ? { id: previous.sourceId }
        : tx
            .insert(sources)
            .values({ title, body: '', createdBy: user, createdAt: now })
            .returning()
            .get();
      const set = tx
        .insert(questionSets)
        .values({
          sourceId: source.id,
          title,
          status: 'published',
          createdBy: user,
          publishedBy: user,
          publishedAt: now,
          createdAt: now,
          ...(previous
            ? {
                supersedesSetId: previous.id,
                supersedesRevision: previous.revision,
              }
            : {}),
        })
        .returning()
        .get();
      tx.insert(pastExams)
        .values({
          setId: set.id,
          examName: input.examName,
          year: input.year,
          subject: input.subject,
          sourceReference: input.sourceReference,
        })
        .run();
      input.questions.forEach((q, position) => {
        const original =
          q.originalQuestionVersionId === undefined
            ? undefined
            : tx
                .select({ version: questionVersions, question: questions })
                .from(setItems)
                .innerJoin(
                  questionVersions,
                  eq(questionVersions.id, setItems.questionVersionId),
                )
                .innerJoin(
                  questions,
                  eq(questions.id, questionVersions.questionId),
                )
                .where(
                  and(
                    eq(setItems.setId, sourceSetId!),
                    eq(questionVersions.id, q.originalQuestionVersionId),
                  ),
                )
                .get();
        if (
          q.originalQuestionVersionId !== undefined &&
          (!original || original.question.sourceId !== source.id)
        )
          throw new SourceError('conflict');
        const question =
          original?.question ??
          tx
            .insert(questions)
            .values({ sourceId: source.id, status: 'active', createdAt: now })
            .returning()
            .get();
        const latest = original
          ? tx
              .select({ versionNo: questionVersions.versionNo })
              .from(questionVersions)
              .where(eq(questionVersions.questionId, question.id))
              .orderBy(desc(questionVersions.versionNo))
              .get()
          : undefined;
        const version = tx
          .insert(questionVersions)
          .values({
            questionId: question.id,
            versionNo: latest ? latest.versionNo + 1 : 1,
            body: q.body,
            choicesJson: q.choices,
            answerIdsJson: q.answerIds,
            explanation: q.explanation,
            quote: '',
            quoteVerified: false,
            ...(original
              ? {
                  derivedFromVersionId: original.version.id,
                  invalidatedAt: original.version.invalidatedAt,
                  invalidatedBy: original.version.invalidatedBy,
                  invalidationReason: original.version.invalidationReason,
                }
              : { manualCreatedBy: user }),
            reviewedBy: user,
            reviewedAt: now,
            createdAt: now,
          })
          .returning()
          .get();
        tx.insert(pastExamQuestions)
          .values({
            questionVersionId: version.id,
            questionNumber: q.questionNumber,
          })
          .run();
        tx.insert(setCandidates)
          .values({
            setId: set.id,
            questionId: question.id,
            questionVersionId: version.id,
          })
          .run();
        tx.insert(setItems)
          .values({ setId: set.id, questionVersionId: version.id, position })
          .run();
      });
      if (previous)
        tx.update(questionSets)
          .set({ status: 'archived', revision: previous.revision + 1 })
          .where(eq(questionSets.id, previous.id))
          .run();
      tx.insert(pastExamRequests)
        .values({
          requestedBy: user,
          requestKey: normalizedKey,
          requestHash: hash,
          setId: set.id,
          createdAt: now,
        })
        .run();
      return { setId: set.id, replayed: false };
    },
    { behavior: 'immediate' },
  );
}
