// Server audit log: records moderation and settings actions (Discord's audit
// log) into `server_audit_logs`, reads them back with filters for the
// settings UI and the bot API, and tells bots about new entries
// (GUILD_AUDIT_LOG_ENTRY_CREATE). Recording is best-effort: a failing write is
// logged and never fails the action that triggered it.
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getPublisher } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  legacyAdminLogToAudit,
  mergeAuditEntries,
  type AuditChange,
  type AuditEntryShape,
} from '@/lib/audit/auditLog';

const table = schema.serverAuditLogs;
const g = globalThis as unknown as { __auditLogSchema?: Promise<void> | null };

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_server_audit_logs.sql. Additive + idempotent; a new
// table takes no locks on shared tables, but keep the lock_timeout guard like
// the other boot DDL so a stuck catalog lock can never stall startup.
export function ensureAuditLogSchema(): Promise<void> {
  if (g.__auditLogSchema) return g.__auditLogSchema;
  g.__auditLogSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "server_audit_logs" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            "server_id" uuid NOT NULL,
            "user_id" uuid,
            "action_type" integer NOT NULL,
            "target_id" text,
            "changes" jsonb DEFAULT '[]'::jsonb,
            "options" jsonb,
            "reason" text,
            "created_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_audit_logs_server_created_idx" ON "server_audit_logs" ("server_id", "created_at")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_audit_logs_server_action_idx" ON "server_audit_logs" ("server_id", "action_type", "created_at")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_audit_logs_server_user_idx" ON "server_audit_logs" ("server_id", "user_id", "created_at")`);
        });
        return;
      } catch (err) {
        console.error(`[audit] Ensuring server_audit_logs schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__auditLogSchema = null;
  })();
  return g.__auditLogSchema;
}

export interface AuditRecordInput {
  serverId: string;
  /** Who did it (null for the system). */
  userId: string | null;
  actionType: number;
  targetId?: string | null;
  changes?: AuditChange[];
  options?: Record<string, unknown> | null;
  reason?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDiscordEntry(e: AuditEntryShape) {
  return {
    id: e.id,
    action_type: e.actionType,
    user_id: e.userId,
    target_id: e.targetId,
    reason: e.reason ?? undefined,
    options: e.options ?? undefined,
    changes: e.changes.map((c) => ({ key: c.key, old_value: c.old, new_value: c.new })),
    created_at: e.createdAt,
  };
}

/** Writes one audit entry. Never throws; returns the stored entry or null. */
export async function recordAudit(input: AuditRecordInput): Promise<AuditEntryShape | null> {
  try {
    if (!input.serverId) return null;
    await ensureAuditLogSchema();
    const serverId = normalizeId(input.serverId);
    const userId = input.userId && UUID_RE.test(normalizeId(input.userId)) ? normalizeId(input.userId) : null;
    const [row] = await db.insert(table).values({
      serverId,
      userId,
      actionType: input.actionType,
      targetId: input.targetId ?? null,
      changes: input.changes ?? [],
      options: input.options ?? null,
      reason: input.reason ?? null,
    }).returning();
    if (!row) return null;
    const entry = rowToEntry(row);
    // Bots with GUILD_MODERATION hear about it (Discord sends this only to
    // bots with VIEW_AUDIT_LOG; the gateway filters by intent).
    try {
      const pub = getPublisher();
      if (pub) {
        await pub.publish('gateway:dispatch', JSON.stringify({
          t: 'GUILD_AUDIT_LOG_ENTRY_CREATE',
          guildId: serverId,
          intent: 1 << 2,
          d: { guild_id: serverId, ...toDiscordEntry(entry) },
        }));
      }
    } catch {
      /* best-effort */
    }
    return entry;
  } catch (err) {
    console.error('[audit] Failed to record audit log entry:', (err as Error)?.message ?? err);
    return null;
  }
}

/** Fire-and-forget form for route handlers. */
export function audit(input: AuditRecordInput): void {
  void recordAudit(input);
}

function rowToEntry(row: typeof table.$inferSelect): AuditEntryShape {
  return {
    id: row.id,
    actionType: row.actionType,
    userId: row.userId ?? null,
    targetId: row.targetId ?? null,
    changes: Array.isArray(row.changes) ? (row.changes as AuditChange[]) : [],
    options: (row.options as Record<string, unknown> | null) ?? null,
    reason: row.reason ?? null,
    createdAt: (row.createdAt ? new Date(row.createdAt) : new Date(0)).toISOString(),
  };
}

export interface AuditQuery {
  userId?: string | null;
  actionType?: number | null;
  /** ISO timestamp cursor: only entries older than this. */
  before?: string | null;
  limit?: number;
}

/** Newest-first audit entries for a server, including legacy admin_logs rows. */
export async function listAuditLogs(serverId: string, q: AuditQuery = {}): Promise<AuditEntryShape[]> {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
  const sid = normalizeId(serverId);
  const beforeDate = q.before ? new Date(q.before) : null;
  const validBefore = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
  const filterUser = q.userId && UUID_RE.test(normalizeId(q.userId)) ? normalizeId(q.userId) : null;

  let current: AuditEntryShape[] = [];
  try {
    await ensureAuditLogSchema();
    const conds = [eq(table.serverId, sid)];
    if (filterUser) conds.push(eq(table.userId, filterUser));
    if (typeof q.actionType === 'number') conds.push(eq(table.actionType, q.actionType));
    if (validBefore) conds.push(lt(table.createdAt, validBefore));
    const rows = await db.select().from(table).where(and(...conds)).orderBy(desc(table.createdAt)).limit(limit);
    current = rows.map(rowToEntry);
  } catch (err) {
    console.error('[audit] Failed to read audit log:', (err as Error)?.message ?? err);
  }

  // Bans / kicks / timeouts recorded before the audit table existed.
  let legacy: AuditEntryShape[] = [];
  try {
    const conds = [
      eq(schema.adminLogs.targetType, 'server'),
      eq(schema.adminLogs.targetId, sid),
      inArray(schema.adminLogs.action, ['ban_user', 'unban_user', 'timeout_member']),
    ];
    if (filterUser) conds.push(eq(schema.adminLogs.adminId, filterUser));
    if (validBefore) conds.push(lt(schema.adminLogs.createdAt, validBefore));
    const rows = await db.select().from(schema.adminLogs).where(and(...conds)).orderBy(desc(schema.adminLogs.createdAt)).limit(limit);
    legacy = rows
      .map((r) => legacyAdminLogToAudit({
        id: r.id,
        adminId: r.adminId,
        action: r.action,
        reason: r.reason,
        details: (r.details as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt,
      }))
      .filter((e): e is AuditEntryShape => !!e)
      .filter((e) => typeof q.actionType !== 'number' || e.actionType === q.actionType);
  } catch {
    /* legacy rows are optional */
  }

  return mergeAuditEntries(current, legacy, limit);
}

export { toDiscordEntry };
