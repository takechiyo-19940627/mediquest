import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

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
    revision: integer('revision').notNull().default(0),
    publishRequestRevision: integer('publish_request_revision'),
    publishRequestFingerprint: text('publish_request_fingerprint'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
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
    generationRunId: integer('generation_run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    unique('question_version_number_unique').on(
      table.questionId,
      table.versionNo,
    ),
    check('question_version_positive_check', sql`${table.versionNo} >= 1`),
    check('question_quote_boolean_check', sql`${table.quoteVerified} IN (0,1)`),
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
    mode: text('mode', { enum: ['normal'] }).notNull(),
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
    check('study_session_mode_check', sql`${table.mode} = 'normal'`),
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
    excludedReason: text('excluded_reason', { enum: ['stopped'] }),
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
      sql`(${table.excludedReason} IS NULL AND ${table.excludedAt} IS NULL) OR (${table.excludedReason} IS NOT NULL AND ${table.excludedReason} = 'stopped' AND ${table.excludedAt} IS NOT NULL)`,
    ),
  ],
);
