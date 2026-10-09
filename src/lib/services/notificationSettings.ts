// Per-user notification settings (Discord-style levels, mutes, @everyone and
// role suppression) for servers, channels, categories and DMs. One JSON row per
// user in `user_notification_settings`; the shape and all the decision logic
// live in src/lib/notifications/levels.ts and are shared with the client.
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  applyOverridePatch,
  sanitizeSettingsDoc,
  serverDefaultLevel,
  type NotificationLevel,
  type NotificationScope,
  type NotificationSettingsDoc,
} from '@/lib/notifications/levels';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_user_notification_settings.sql. Additive + idempotent.
// A brand-new table takes no locks on shared tables, but keep the same
// lock_timeout guard as the other boot DDL so a stuck catalog lock can never
// stall startup.
const g = globalThis as unknown as { __notificationSettingsSchema?: Promise<void> | null };

export function ensureNotificationSettingsSchema(): Promise<void> {
  if (g.__notificationSettingsSchema) return g.__notificationSettingsSchema;
  g.__notificationSettingsSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "user_notification_settings" (
            "user_id" uuid PRIMARY KEY NOT NULL,
            "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
            "updated_at" timestamp DEFAULT now()
          )`);
        });
        return;
      } catch (err) {
        console.error(
          `[notifications] Ensuring notification settings schema failed (attempt ${attempt}):`,
          (err as Error)?.message ?? err,
        );
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__notificationSettingsSchema = null;
  })();
  return g.__notificationSettingsSchema;
}

const table = schema.userNotificationSettings;

/** The user's settings (empty document when they never changed anything). */
export async function getNotificationSettings(userId: string): Promise<NotificationSettingsDoc> {
  await ensureNotificationSettingsSchema();
  const [row] = await db.select().from(table).where(eq(table.userId, normalizeId(userId))).limit(1);
  return sanitizeSettingsDoc(row?.settings ?? {});
}

/**
 * Patch one server or channel entry. Read-modify-write under a row lock so two
 * quick changes from different devices can't drop each other.
 */
export async function patchNotificationSettings(
  userId: string,
  scope: NotificationScope,
  id: string,
  patch: Record<string, unknown> | null,
): Promise<NotificationSettingsDoc> {
  await ensureNotificationSettingsSchema();
  const uid = normalizeId(userId);
  return db.transaction(async (tx) => {
    await tx.insert(table).values({ userId: uid, settings: {} }).onConflictDoNothing();
    const [row] = await tx.select().from(table).where(eq(table.userId, uid)).for('update');
    const current = sanitizeSettingsDoc(row?.settings ?? {});
    const next = applyOverridePatch(current, scope, id, patch);
    await tx.update(table).set({ settings: next, updatedAt: new Date() }).where(eq(table.userId, uid));
    return next;
  });
}

/** Each joined server's default notification level (`servers.default_notifications`). */
export async function getServerDefaultLevels(serverIds: string[]): Promise<Record<string, NotificationLevel>> {
  if (serverIds.length === 0) return {};
  const rows = await db
    .select({ id: schema.servers.id, defaultNotifications: schema.servers.defaultNotifications })
    .from(schema.servers)
    .where(inArray(schema.servers.id, serverIds));
  const out: Record<string, NotificationLevel> = {};
  for (const r of rows) out[r.id] = serverDefaultLevel(r.defaultNotifications);
  return out;
}
