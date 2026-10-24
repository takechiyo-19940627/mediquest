import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
