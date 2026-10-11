import { and, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { changelogAnnouncements, changelogReceipts } from '@/lib/db/changelogSchema';
import {
  buildChangelogFeed,
  normalizeChangelogDraft,
  serializeChangelogAnnouncement,
  type ChangelogDraft,
} from '@/lib/changelogAnnouncements';

export const Changelog = {
  async findById(id: string) {
    const [entry] = await db.select().from(changelogAnnouncements).where(eq(changelogAnnouncements.id, id)).limit(1);
    return entry ?? null;
  },

  async listAdmin() {
    const entries = await db.select().from(changelogAnnouncements).orderBy(desc(changelogAnnouncements.updatedAt), desc(changelogAnnouncements.id)).limit(100);
    return entries.map(serializeChangelogAnnouncement);
  },

  async feed(userId: string) {
    const now = new Date();
    const rows = await db.select({ entry: changelogAnnouncements, readId: changelogReceipts.changelogId })
      .from(changelogAnnouncements)
      .leftJoin(changelogReceipts, and(
        eq(changelogReceipts.changelogId, changelogAnnouncements.id),
        eq(changelogReceipts.userId, userId),
      ))
      .where(and(isNotNull(changelogAnnouncements.publishedAt), lte(changelogAnnouncements.publishedAt, now)))
      .orderBy(desc(changelogAnnouncements.publishedAt), desc(changelogAnnouncements.id))
      .limit(50);
    return buildChangelogFeed(
      rows.map(({ entry }) => serializeChangelogAnnouncement(entry)),
      new Set(rows.flatMap(({ readId }) => readId ? [readId] : [])),
      now.getTime(),
    );
  },

  async createDraft(content: ChangelogDraft, userId: string) {
    const [entry] = await db.insert(changelogAnnouncements).values({
      ...normalizeChangelogDraft(content),
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    return serializeChangelogAnnouncement(entry);
  },

  async editDraft(id: string, content: ChangelogDraft, userId: string) {
    // The predicate is atomic with the update: publishing concurrently cannot let
    // an editor with only draft access change content that is already live.
    const [entry] = await db.update(changelogAnnouncements).set({
      ...normalizeChangelogDraft(content),
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(and(eq(changelogAnnouncements.id, id), isNull(changelogAnnouncements.publishedAt))).returning();
    return entry ? serializeChangelogAnnouncement(entry) : null;
  },

  async publish(id: string, userId: string) {
    const now = new Date();
    const [entry] = await db.update(changelogAnnouncements).set({
      publishedAt: now,
      publishedBy: userId,
      updatedBy: userId,
      updatedAt: now,
    }).where(and(eq(changelogAnnouncements.id, id), isNull(changelogAnnouncements.publishedAt))).returning();
    // Repeated publish requests keep the existing date and receipt identity.
    const result = entry ?? await this.findById(id);
    return result ? serializeChangelogAnnouncement(result) : null;
  },

  async unpublish(id: string, userId: string) {
    const [entry] = await db.update(changelogAnnouncements).set({
      publishedAt: null,
      publishedBy: null,
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(and(eq(changelogAnnouncements.id, id), isNotNull(changelogAnnouncements.publishedAt))).returning();
    const result = entry ?? await this.findById(id);
    return result ? serializeChangelogAnnouncement(result) : null;
  },

  async markRead(id: string, userId: string) {
    // INSERT ... SELECT keeps drafts private and receipts idempotent. Keeping
    // receipts on unpublish means the same entry never prompts a reader twice.
    await db.insert(changelogReceipts).select(
      db.select({
        userId: sql<string>`${userId}::uuid`.as('user_id'),
        changelogId: changelogAnnouncements.id,
        readAt: sql<Date>`now()`.as('read_at'),
      }).from(changelogAnnouncements).where(and(
        eq(changelogAnnouncements.id, id),
        isNotNull(changelogAnnouncements.publishedAt),
        lte(changelogAnnouncements.publishedAt, new Date()),
      )),
    ).onConflictDoNothing();
    // Always succeed for valid IDs, including entries unpublished while the
    // dialog was open. The response cannot be used to discover draft IDs.
  },
};
