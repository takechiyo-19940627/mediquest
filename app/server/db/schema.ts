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
