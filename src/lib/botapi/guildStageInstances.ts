/**
 * Stage instances for the Discord-compatible bot API: a live stage channel's
 * topic and privacy level, one per stage channel, in `stage_instances`
 * (created on first use; mirrors drizzle/manual_stage_instances.sql).
 *
 * Permissions (Discord): a stage moderator, i.e. MANAGE_CHANNELS +
 * MUTE_MEMBERS + MOVE_MEMBERS in the channel; send_start_notification also
 * needs MENTION_EVERYONE. Changes are audit-logged (83-85) and emit
 * STAGE_INSTANCE_CREATE / _UPDATE / _DELETE to the bots that can view the
 * channel. Serika sends no "stage started" notification yet, so
 * send_start_notification is only permission-checked.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import { Channel, ServerMember, type IChannel } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason } from '@/lib/audit/auditLog';
import { emitStageInstance } from '@/lib/services/gatewayEvents';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { invalidFormBody } from './errors';
import { parseStageInstanceBody, STAGE_PRIVACY_GUILD_ONLY, toDiscordStageInstance, type StageInstanceRow } from './guildStageInstanceRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;

const t = schema.stageInstances;
const UNKNOWN_STAGE = { code: 10067, message: 'Unknown Stage Instance' };
const UNKNOWN_CHANNEL = { code: 10003, message: 'Unknown Channel' };
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const MISSING_ACCESS = { code: 50001, message: 'Missing Access' };

const g = globalThis as unknown as { __stageInstanceSchema?: Promise<void> | null };

export function ensureStageInstanceSchema(): Promise<void> {
  if (g.__stageInstanceSchema) return g.__stageInstanceSchema;
  g.__stageInstanceSchema = ensureSchema('stage-instances', { tables: { stage_instances: [] } }, async () => {
    await withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS stage_instances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        server_id uuid NOT NULL,
        channel_id uuid NOT NULL,
        topic text NOT NULL,
        privacy_level integer NOT NULL DEFAULT 2,
        discoverable_disabled boolean NOT NULL DEFAULT true,
        guild_scheduled_event_id uuid,
        creator_id uuid,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS stage_instances_channel_id_unique ON stage_instances (channel_id)`,
      sql`CREATE INDEX IF NOT EXISTS stage_instances_server_id_idx ON stage_instances (server_id)`,
    ]);
  }, { attempts: 3 }).catch((err) => {
    g.__stageInstanceSchema = null;
    throw err;
  });
  return g.__stageInstanceSchema;
}

function rowView(r: typeof t.$inferSelect): StageInstanceRow {
  return {
    id: r.id,
    serverId: r.serverId,
    channelId: r.channelId,
    topic: decodeHtmlEntities(r.topic),
    privacyLevel: r.privacyLevel,
    discoverableDisabled: r.discoverableDisabled,
    guildScheduledEventId: r.guildScheduledEventId ?? null,
  };
}

async function findByChannel(channelId: string) {
  const [row] = await db.select().from(t).where(eq(t.channelId, normalizeId(channelId))).limit(1);
  return row ?? null;
}

/** Live stage instances of a guild (GUILD_CREATE `stage_instances`); [] when the table isn't there yet. */
export async function listGuildStageInstances(guildId: string): Promise<Array<ReturnType<typeof toDiscordStageInstance>>> {
  try {
    const rows = await db.select().from(t).where(eq(t.serverId, normalizeId(guildId)));
    return rows.map((r) => toDiscordStageInstance(rowView(r)));
  } catch {
    return [];
  }
}

/** The stage channel plus whether the bot moderates it. */
async function stageChannel(channelId: string, botId: string): Promise<{ ok: true; channel: IChannel & { serverId: string }; perms: bigint } | { ok: false; result: Result }> {
  if (!isValidObjectId(channelId)) return { ok: false, result: { status: 404, body: UNKNOWN_CHANNEL } };
  const { checkChannelAccess, getMemberChannelPermissions } = await import('@/lib/api/channels');
  const { hasAccess, channel } = await checkChannelAccess(botId, channelId);
  if (!channel) return { ok: false, result: { status: 404, body: UNKNOWN_CHANNEL } };
  if (!hasAccess || !channel.serverId) return { ok: false, result: { status: 403, body: MISSING_ACCESS } };
  if (channel.type !== 'stage') return { ok: false, result: { status: 400, body: { code: 50024, message: 'Cannot execute action on this channel type' } } };
  const member = await ServerMember.findOne({ serverId: channel.serverId, userId: botId });
  const perms = applyTimeout(await getMemberChannelPermissions(botId, channel as IChannel & { serverId: string }, member ?? null), member?.communicationDisabledUntil ?? null);
  const moderator = hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, P.MANAGE_CHANNELS | P.MUTE_MEMBERS | P.MOVE_MEMBERS);
  if (!moderator) return { ok: false, result: { status: 403, body: MISSING_PERMISSIONS } };
  return { ok: true, channel: channel as IChannel & { serverId: string }, perms };
}

export async function createStageInstanceForBot(botId: string, body: unknown, headers: Headers): Promise<Result> {
  const parsed = parseStageInstanceBody(body, { create: true });
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const f = parsed.fields;
  const ch = await stageChannel(f.channelId!, botId);
  if (!ch.ok) return ch.result;
  if (f.sendStartNotification && !(hasPermission(ch.perms, P.ADMINISTRATOR) || hasPermission(ch.perms, P.MENTION_EVERYONE))) {
    return { status: 403, body: MISSING_PERMISSIONS };
  }
  const guildId = ch.channel.serverId;
  if (f.guildScheduledEventId) {
    const { ensureScheduledEventSchema } = await import('@/lib/services/scheduledEvents');
    await ensureScheduledEventSchema();
    const ev = schema.serverScheduledEvents;
    const [event] = isValidObjectId(f.guildScheduledEventId)
      ? await db.select().from(ev).where(and(eq(ev.id, normalizeId(f.guildScheduledEventId)), eq(ev.serverId, normalizeId(guildId)))).limit(1)
      : [];
    if (!event || event.entityType !== 'stage' || !event.channelId || normalizeId(event.channelId) !== normalizeId(ch.channel.id)) {
      return { status: 400, body: invalidFormBody([{ path: 'guild_scheduled_event_id', code: 'GUILD_SCHEDULED_EVENT_INVALID', message: 'Unknown stage event for this channel.' }]) };
    }
  }
  await ensureStageInstanceSchema();
  const [row] = await db.insert(t).values({
    serverId: normalizeId(guildId),
    channelId: normalizeId(ch.channel.id),
    topic: sanitizeInput(f.topic!),
    privacyLevel: f.privacyLevel ?? STAGE_PRIVACY_GUILD_ONLY,
    discoverableDisabled: true,
    guildScheduledEventId: f.guildScheduledEventId ? normalizeId(f.guildScheduledEventId) : null,
    creatorId: normalizeId(botId),
  }).onConflictDoNothing().returning();
  if (!row) return { status: 400, body: { code: 150006, message: 'The Stage is already open' } };
  const view = toDiscordStageInstance(rowView(row));
  audit({
    serverId: guildId, userId: botId, actionType: AuditLogEvent.STAGE_INSTANCE_CREATE, targetId: row.id,
    changes: [{ key: 'topic', new: view.topic }, { key: 'privacy_level', new: view.privacy_level }],
    options: { channel_id: ch.channel.id }, reason: auditReason(headers['x-audit-log-reason']),
  });
  void emitStageInstance('STAGE_INSTANCE_CREATE', guildId, ch.channel.id, view);
  return { status: 200, body: view };
}

export async function getStageInstanceForBot(channelId: string): Promise<Result> {
  const channel = isValidObjectId(channelId) ? await Channel.findById(channelId) : null;
  if (!channel) return { status: 404, body: UNKNOWN_CHANNEL };
  if (channel.type !== 'stage') return { status: 404, body: UNKNOWN_STAGE };
  const row = await findByChannel(channelId).catch(() => null);
  if (!row) return { status: 404, body: UNKNOWN_STAGE };
  return { status: 200, body: toDiscordStageInstance(rowView(row)) };
}

export async function updateStageInstanceForBot(channelId: string, botId: string, body: unknown, headers: Headers): Promise<Result> {
  const ch = await stageChannel(channelId, botId);
  if (!ch.ok) return ch.result;
  const row = await findByChannel(channelId).catch(() => null);
  if (!row) return { status: 404, body: UNKNOWN_STAGE };
  const parsed = parseStageInstanceBody(body, { create: false });
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const patch: Partial<typeof t.$inferInsert> = {};
  if (parsed.fields.topic !== undefined) patch.topic = sanitizeInput(parsed.fields.topic);
  if (parsed.fields.privacyLevel !== undefined) patch.privacyLevel = parsed.fields.privacyLevel;
  const before = toDiscordStageInstance(rowView(row));
  if (Object.keys(patch).length === 0) return { status: 200, body: before };
  const [updated] = await db.update(t).set({ ...patch, updatedAt: new Date() }).where(eq(t.id, row.id)).returning();
  if (!updated) return { status: 404, body: UNKNOWN_STAGE };
  const view = toDiscordStageInstance(rowView(updated));
  const changes = (['topic', 'privacy_level'] as const)
    .filter((k) => before[k] !== view[k])
    .map((k) => ({ key: k, old: before[k], new: view[k] }));
  if (changes.length > 0) {
    audit({ serverId: ch.channel.serverId, userId: botId, actionType: AuditLogEvent.STAGE_INSTANCE_UPDATE, targetId: row.id, changes, options: { channel_id: ch.channel.id }, reason: auditReason(headers['x-audit-log-reason']) });
    void emitStageInstance('STAGE_INSTANCE_UPDATE', ch.channel.serverId, ch.channel.id, view);
  }
  return { status: 200, body: view };
}

export async function deleteStageInstanceForBot(channelId: string, botId: string, headers: Headers): Promise<Result> {
  const ch = await stageChannel(channelId, botId);
  if (!ch.ok) return ch.result;
  const row = await findByChannel(channelId).catch(() => null);
  if (!row) return { status: 404, body: UNKNOWN_STAGE };
  await db.delete(t).where(eq(t.id, row.id));
  const view = toDiscordStageInstance(rowView(row));
  audit({ serverId: ch.channel.serverId, userId: botId, actionType: AuditLogEvent.STAGE_INSTANCE_DELETE, targetId: row.id, changes: [{ key: 'topic', old: view.topic }], options: { channel_id: ch.channel.id }, reason: auditReason(headers['x-audit-log-reason']) });
  void emitStageInstance('STAGE_INSTANCE_DELETE', ch.channel.serverId, ch.channel.id, view);
  return { status: 204, body: '' };
}
