import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const changelogAnnouncements = pgTable('changelog_announcements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  version: text('version'),
  body: text('body').notNull(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('changelog_announcements_published_idx').on(table.publishedAt, table.id),
  check('changelog_announcements_title_check', sql`char_length(btrim(${table.title})) BETWEEN 1 AND 120`),
  check('changelog_announcements_version_check', sql`${table.version} IS NULL OR char_length(${table.version}) <= 32`),
  check('changelog_announcements_body_check', sql`char_length(btrim(${table.body})) BETWEEN 1 AND 30000`),
]);

// Receipts are keyed by entry, not publication time: republishing never resets them.
export const changelogReceipts = pgTable('changelog_receipts', {
  userId: uuid('user_id').notNull(),
  changelogId: uuid('changelog_id').notNull().references(() => changelogAnnouncements.id),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.changelogId] })]);
