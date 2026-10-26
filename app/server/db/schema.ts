import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['admin', 'learner'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('users_role_check', sql`${table.role} IN ('admin', 'learner')`),
  ],
);

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at').notNull(),
});

export const sourceCreationRequests = sqliteTable(
  'source_creation_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestKey: text('request_key').notNull(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
  },
  (table) => [
    unique('source_request_user_key_unique').on(
      table.createdBy,
      table.requestKey,
    ),
  ],
);

export const questionSets = sqliteTable(
  'question_sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', {
      enum: ['draft', 'published', 'archived'],
    }).notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    publishedBy: integer('published_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    publishedAt: integer('published_at'),
    supersedesSetId: integer('supersedes_set_id').references(
      (): AnySQLiteColumn => questionSets.id,
      { onDelete: 'restrict' },
    ),
    supersedesRevision: integer('supersedes_revision'),
    revision: integer('revision').notNull().default(0),
    publishRequestRevision: integer('publish_request_revision'),
    publishRequestFingerprint: text('publish_request_fingerprint'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check(
      'question_sets_supersedes_check',
      sql`(${table.supersedesSetId} IS NULL AND ${table.supersedesRevision} IS NULL) OR (${table.supersedesSetId} IS NOT NULL AND ${table.supersedesRevision} IS NOT NULL)`,
    ),
    uniqueIndex('question_sets_published_successor_unique')
      .on(table.supersedesSetId)
      .where(sql`${table.publishedAt} IS NOT NULL`),
    check(
      'question_sets_status_check',
      sql`${table.status} IN ('draft','published','archived')`,
    ),
  ],
);

export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    setId: integer('set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    requestedCount: integer('requested_count').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    status: text('status', {
      enum: ['running', 'succeeded', 'failed', 'unknown'],
    }).notNull(),
    errorCode: text('error_code', {
      enum: [
        'provider_failed',
        'provider_unknown',
        'invalid_output',
        'storage_failed',
      ],
    }),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    unique('generation_run_user_key_unique').on(
      table.requestedBy,
      table.requestKey,
    ),
    check(
      'generation_runs_status_check',
      sql`${table.status} IN ('running','succeeded','failed','unknown')`,
    ),
    check(
      'generation_runs_count_check',
      sql`${table.requestedCount} BETWEEN 1 AND 10`,
    ),
    check(
      'generation_runs_error_check',
      sql`${table.errorCode} IS NULL OR ${table.errorCode} IN ('provider_failed','provider_unknown','invalid_output','storage_failed')`,
    ),
  ],
);

export const questions = sqliteTable(
  'questions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'stopped'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check(
      'questions_status_check',
      sql`${table.status} IN ('active','stopped')`,
    ),
  ],
);

export const questionVersions = sqliteTable(
  'question_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    versionNo: integer('version_no').notNull(),
    body: text('body').notNull(),
    choicesJson: text('choices_json', { mode: 'json' })
      .$type<{ id: string; label: string }[]>()
      .notNull(),
    answerIdsJson: text('answer_ids_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    explanation: text('explanation').notNull(),
    quote: text('quote').notNull(),
    quoteVerified: integer('quote_verified', { mode: 'boolean' }).notNull(),
    reviewedBy: integer('reviewed_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    reviewedAt: integer('reviewed_at'),
    invalidatedAt: integer('invalidated_at'),
    invalidatedBy: integer('invalidated_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    invalidationReason: text('invalidation_reason'),
    generationRunId: integer('generation_run_id').references(
      () => generationRuns.id,
      { onDelete: 'restrict' },
    ),
    derivedFromVersionId: integer('derived_from_version_id').references(
      (): AnySQLiteColumn => questionVersions.id,
      { onDelete: 'restrict' },
    ),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    unique('question_version_id_question_unique').on(
      table.id,
      table.questionId,
    ),
    check(
      'question_version_provenance_check',
      sql`(${table.generationRunId} IS NOT NULL AND ${table.derivedFromVersionId} IS NULL) OR (${table.generationRunId} IS NULL AND ${table.derivedFromVersionId} IS NOT NULL)`,
    ),
    unique('question_version_number_unique').on(
      table.questionId,
      table.versionNo,
    ),
    check(
      'question_invalidation_check',
      sql`(${table.invalidatedAt} IS NULL AND ${table.invalidatedBy} IS NULL AND ${table.invalidationReason} IS NULL) OR (${table.invalidatedAt} IS NOT NULL AND ${table.invalidatedBy} IS NOT NULL AND ${table.invalidationReason} IS NOT NULL)`,
    ),
    check('question_version_positive_check', sql`${table.versionNo} >= 1`),
    check('question_quote_boolean_check', sql`${table.quoteVerified} IN (0,1)`),
  ],
);

// Material identity and same-question ancestry require service validation.
// Stage 1 exposes no revision-request or derived-version creation API.
export const setCandidates = sqliteTable(
  'set_candidates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    questionId: integer('question_id').notNull(),
    questionVersionId: integer('question_version_id').notNull(),
  },
  (table) => [
    unique('set_candidate_question_unique').on(table.setId, table.questionId),
    unique('set_candidate_version_unique').on(
      table.setId,
      table.questionVersionId,
    ),
    foreignKey({
      columns: [table.questionVersionId, table.questionId],
      foreignColumns: [questionVersions.id, questionVersions.questionId],
    }).onDelete('restrict'),
  ],
);

export const setRevisionRequests = sqliteTable(
  'set_revision_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestKey: text('request_key').notNull(),
    sourceSetId: integer('source_set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    sourceRevision: integer('source_revision').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    createdSetId: integer('created_set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    unique('set_revision_request_user_key_unique').on(
      table.requestedBy,
      table.requestKey,
    ),
  ],
);

export const setItems = sqliteTable(
  'set_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    questionVersionId: integer('question_version_id')
      .notNull()
      .references(() => questionVersions.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.setId, table.questionVersionId],
      foreignColumns: [setCandidates.setId, setCandidates.questionVersionId],
    }).onDelete('restrict'),
    unique('set_item_position_unique').on(table.setId, table.position),
    unique('set_item_version_unique').on(table.setId, table.questionVersionId),
    check('set_item_position_check', sql`${table.position} >= 0`),
  ],
);

export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    setId: integer('set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['in_progress', 'completed'] }).notNull(),
    mode: text('mode', { enum: ['normal', 'review'] }).notNull(),
    // Issue #44: a review session stores its direct parent (the session whose
    // wrong answers it re-asks). Normal sessions have no parent.
    parentSessionId: integer('parent_session_id').references(
      (): AnySQLiteColumn => studySessions.id,
      { onDelete: 'restrict' },
    ),
    startRequestKey: text('start_request_key').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [
    unique('study_session_user_request_unique').on(
      table.userId,
      table.startRequestKey,
    ),
    check(
      'study_session_status_check',
      sql`${table.status} IN ('in_progress','completed')`,
    ),
    check(
      'study_session_mode_check',
      sql`${table.mode} IN ('normal','review')`,
    ),
    check(
      'study_session_parent_check',
      sql`(${table.mode} = 'normal' AND ${table.parentSessionId} IS NULL) OR (${table.mode} = 'review' AND ${table.parentSessionId} IS NOT NULL AND ${table.parentSessionId} <> ${table.id})`,
    ),
  ],
);
export const studyItems = sqliteTable(
  'study_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => studySessions.id, { onDelete: 'restrict' }),
    questionVersionId: integer('question_version_id')
      .notNull()
      .references(() => questionVersions.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    selectedIdsJson: text('selected_ids_json', { mode: 'json' }).$type<
      string[]
    >(),
    isCorrect: integer('is_correct', { mode: 'boolean' }),
    answeredAt: integer('answered_at'),
    // Issue #41: the owner's explicit skip. Stays unanswered; kept after answering.
    skippedAt: integer('skipped_at'),
    excludedReason: text('excluded_reason', {
      enum: ['stopped', 'invalidated'],
    }),
    excludedAt: integer('excluded_at'),
  },
  (table) => [
    unique('study_item_position_unique').on(table.sessionId, table.position),
    unique('study_item_version_unique').on(
      table.sessionId,
      table.questionVersionId,
    ),
    check('study_item_position_check', sql`${table.position} >= 0`),
    check(
      'study_item_correct_check',
      sql`${table.isCorrect} IS NULL OR ${table.isCorrect} IN (0,1)`,
    ),
    check(
      'study_item_excluded_check',
      sql`(${table.excludedReason} IS NULL AND ${table.excludedAt} IS NULL) OR (${table.excludedReason} IS NOT NULL AND ${table.excludedReason} IN ('stopped','invalidated') AND ${table.excludedAt} IS NOT NULL)`,
    ),
  ],
);

export const issueReports = sqliteTable(
  'issue_reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    reportedBy: integer('reported_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    questionVersionId: integer('question_version_id')
      .notNull()
      .references(() => questionVersions.id, { onDelete: 'restrict' }),
    studyItemId: integer('study_item_id')
      .notNull()
      .references(() => studyItems.id, { onDelete: 'restrict' }),
    message: text('message').notNull(),
    resolvedBy: integer('resolved_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    resolutionNote: text('resolution_note'),
    resolvedAt: integer('resolved_at'),
    status: text('status', {
      enum: ['open', 'confirmed', 'dismissed'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check(
      'issue_report_resolution_check',
      sql`(${table.resolvedBy} IS NULL AND ${table.resolutionNote} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.resolvedBy} IS NOT NULL AND ${table.resolutionNote} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    uniqueIndex('issue_report_open_user_version_unique')
      .on(table.reportedBy, table.questionVersionId)
      .where(sql`${table.status} = 'open'`),
    check(
      'issue_report_status_check',
      sql`${table.status} IN ('open','confirmed','dismissed')`,
    ),
  ],
);
