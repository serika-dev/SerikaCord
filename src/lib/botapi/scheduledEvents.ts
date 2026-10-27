/**
 * Guild scheduled events for the Discord-compatible bot API (WP4b), over the
 * same tables, rules and live updates as the web routes
 * (src/lib/api/scheduledEvents.ts, src/lib/chat/scheduledEvents.ts,
 * src/lib/services/scheduledEvents.ts). Events in channels the bot can't see
 * are hidden, like on the web. GUILD_SCHEDULED_EVENT_CREATE / _UPDATE /
 * _DELETE go out through emitEventGateway.
 *
 * Permissions (Discord): CREATE_EVENTS to create (and edit / delete your own),
 * MANAGE_EVENTS for any event.
 */
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { config } from '@/lib/config';
import { Channel, ServerMember, User } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { isValidObjectId } from '@/lib/security';
import { MAX_OPEN_EVENTS_PER_SERVER, canTransition, normalizeEventInput, type EventEntityType, type EventStatus } from '@/lib/chat/scheduledEvents';
import { emitEventGateway, ensureScheduledEventSchema, notifyEventStarted, publishEventsChanged, toDiscordEvent, type ScheduledEventRow } from '@/lib/services/scheduledEvents';
import { toDiscordGuildMember, toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { parseImageDataUri } from './expressionRules';
import { fromDiscordEventBody } from './scheduledEventRules';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent } from '@/lib/audit/auditLog';

type Result = { status: number; body: unknown };

const ev = schema.serverScheduledEvents;
const eu = schema.serverScheduledEventUsers;
const UNKNOWN_EVENT = { code: 10070, message: 'Unknown Guild Scheduled Event' };
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const formError = (path: string, code: string, message: string) => ({ code: 50035, message: 'Invalid Form Body', errors: { [path]: { _errors: [{ code, message }] } } });

async function guildPerms(guildId: string, botId: string) {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}
const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);

/** Rows in channels the bot can view (external events always). */
async function visibleRows(botId: string, rows: ScheduledEventRow[]): Promise<ScheduledEventRow[]> {
  const channelIds = [...new Set(rows.filter((r) => r.entityType !== 'external').map((r) => r.channelId).filter(Boolean) as string[])];
  if (channelIds.length === 0) return rows;
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const allowed = new Map<string, boolean>();
  await Promise.all(channelIds.map(async (id) => {
    const res = await checkChannelAccess(botId, id, { lean: true }).catch(() => ({ hasAccess: false }));
    allowed.set(id, Boolean(res.hasAccess));
  }));
  return rows.filter((r) => r.entityType === 'external' || !r.channelId || allowed.get(r.channelId));
}

async function counts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ eventId: eu.eventId, count: sql<number>`count(*)::int` }).from(eu).where(inArray(eu.eventId, ids)).groupBy(eu.eventId);
  return new Map(rows.map((r) => [r.eventId, Number(r.count) || 0]));
}

/** Discord event objects (creator, recurrence_rule, optional user_count). */
async function views(rows: ScheduledEventRow[], withUserCount: boolean) {
  const [byCount, creators] = await Promise.all([
    withUserCount ? counts(rows.map((r) => r.id)) : Promise.resolve(new Map<string, number>()),
    User.find({ id: { in: [...new Set(rows.map((r) => r.creatorId))] } }).catch(() => []),
  ]);
  const creatorBy = new Map(creators.map((u) => [u.id.toLowerCase(), toDiscordUserRow(u)]));
  return rows.map((r) => ({
    ...toDiscordEvent(r, withUserCount ? byCount.get(r.id) ?? 0 : undefined),
    creator: creatorBy.get(r.creatorId.toLowerCase()) ?? null,
    recurrence_rule: null,
  }));
}

/** Audit-log changes between two versions of an event (Discord keys). */
export function scheduledEventChanges(before: ScheduledEventRow, after: ScheduledEventRow) {
  const pick = (r: ScheduledEventRow) => ({
    name: r.name,
    description: r.description ?? null,
    location: r.location ?? null,
    channel_id: r.channelId ?? null,
    status: r.status,
    scheduled_start_time: r.startAt ? new Date(r.startAt).toISOString() : null,
    scheduled_end_time: r.endAt ? new Date(r.endAt).toISOString() : null,
  });
  const a = pick(before);
  const b = pick(after);
  return (Object.keys(a) as Array<keyof typeof a>).filter((k) => a[k] !== b[k]).map((k) => ({ key: k, old: a[k], new: b[k] }));
}

async function loadEvent(guildId: string, eventId: string): Promise<ScheduledEventRow | null> {
  if (!isValidObjectId(eventId)) return null;
  const [row] = await db.select().from(ev).where(and(eq(ev.id, eventId), eq(ev.serverId, guildId))).limit(1);
  return row ?? null;
}

/** For GET /invites/{code}?guild_scheduled_event_id=... */
export async function loadDiscordScheduledEvent(guildId: string, eventId: string) {
  if (!(await ensureScheduledEventSchema())) return null;
  const row = await loadEvent(guildId, eventId);
  if (!row) return null;
  const [view] = await views([row], false);
  return view;
}

export async function listBotEvents(guildId: string, botId: string, withUserCount: boolean): Promise<Result> {
  if (!(await ensureScheduledEventSchema())) return { status: 200, body: [] };
  const rows = await db.select().from(ev)
    .where(and(eq(ev.serverId, guildId), inArray(ev.status, ['scheduled', 'active'])))
    .orderBy(asc(ev.startAt))
    .limit(MAX_OPEN_EVENTS_PER_SERVER);
  return { status: 200, body: await views(await visibleRows(botId, rows), withUserCount) };
}

export async function getBotEvent(guildId: string, eventId: string, botId: string, withUserCount: boolean): Promise<Result> {
  await ensureScheduledEventSchema();
  const row = await loadEvent(guildId, eventId);
  if (!row || (await visibleRows(botId, [row])).length === 0) return { status: 404, body: UNKNOWN_EVENT };
  const [view] = await views([row], withUserCount);
  return { status: 200, body: view };
}

/** A voice / stage channel of the guild the bot can use for an event (Discord's per-type channel permissions). */
async function checkEventChannel(botId: string, guildId: string, entityType: EventEntityType, channelId: string | null): Promise<Result | null> {
  if (entityType === 'external' || !channelId) return null;
  const channel = await Channel.findById(channelId);
  if (!channel || !same(channel.serverId, guildId)) return { status: 400, body: formError('channel_id', 'GUILD_SCHEDULED_EVENT_INVALID_CHANNEL', 'Unknown channel.') };
  if (channel.type !== entityType) return { status: 400, body: formError('channel_id', 'GUILD_SCHEDULED_EVENT_CHANNEL_TYPE', entityType === 'stage' ? 'Must be a stage channel.' : 'Must be a voice channel.') };
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = applyTimeout(await getMemberChannelPermissions(botId, channel as typeof channel & { serverId: string }, member ?? null), member?.communicationDisabledUntil ?? null);
  const need = entityType === 'stage'
    ? P.VIEW_CHANNEL | P.MANAGE_CHANNELS | P.MUTE_MEMBERS | P.MOVE_MEMBERS
    : P.VIEW_CHANNEL | P.CONNECT;
  if (!has(perms, need)) return { status: 403, body: MISSING_PERMISSIONS };
  return null;
}

async function uploadCover(guildId: string, botId: string, image: unknown): Promise<{ ok: true; url: string | null } | { ok: false; result: Result }> {
  if (image === null) return { ok: true, url: null };
  const parsed = parseImageDataUri(image, config.MAX_BANNER_SIZE);
  if (!parsed.ok) return { ok: false, result: { status: 400, body: formError('image', parsed.code, parsed.message) } };
  try {
    const { storage } = await import('@/lib/services/storage');
    const ext = parsed.kind === 'image/jpeg' ? 'jpg' : parsed.kind.split('/')[1];
    const res = await storage.upload({
      category: 'event-covers',
      contentType: parsed.kind === 'image/apng' ? 'image/png' : parsed.kind,
      data: parsed.bytes,
      size: parsed.bytes.length,
      filename: `cover.${ext}`,
      serverId: guildId,
      scanUserId: botId,
    });
    return { ok: true, url: res.url };
  } catch (err) {
    if ((err as { name?: string })?.name === 'ContentBlockedError') return { ok: false, result: { status: 403, body: { code: 20009, message: 'Explicit content cannot be sent to the desired recipient(s)' } } };
    return { ok: false, result: { status: 400, body: formError('image', 'IMAGE_INVALID', 'Invalid image data') } };
  }
}

export async function createBotEvent(guildId: string, botId: string, body: Record<string, unknown>): Promise<Result> {
  const perms = await guildPerms(guildId, botId);
  if (!has(perms, P.CREATE_EVENTS) && !has(perms, P.MANAGE_EVENTS)) return { status: 403, body: MISSING_PERMISSIONS };
  const mapped = fromDiscordEventBody(body, { create: true });
  if (!mapped.ok) return { status: 400, body: mapped.error };
  if (!(await ensureScheduledEventSchema())) return { status: 503, body: { code: 0, message: '503: Service Unavailable' } };
  // Validate everything first; the cover is uploaded last so a refused event leaves no file behind.
  const { image: rawImage, ...fields } = mapped.fields;
  const parsed = normalizeEventInput(fields, { imagePrefixes: [config.CDN_URL] });
  if ('error' in parsed) return { status: 400, body: { code: 50035, message: `Invalid Form Body (${parsed.error})`, errors: {} } };
  const input = parsed.value;
  const chan = await checkEventChannel(botId, guildId, input.entityType, input.channelId);
  if (chan) return chan;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(ev)
    .where(and(eq(ev.serverId, guildId), inArray(ev.status, ['scheduled', 'active'])));
  if (Number(count) >= MAX_OPEN_EVENTS_PER_SERVER) return { status: 400, body: { code: 30038, message: 'Maximum number of guild scheduled events reached' } };
  if (rawImage !== undefined && rawImage !== null) {
    const cover = await uploadCover(guildId, botId, rawImage);
    if (!cover.ok) return cover.result;
    input.image = cover.url;
  }
  const now = new Date();
  const [row] = await db.insert(ev).values({
    serverId: guildId, creatorId: botId, name: input.name, description: input.description,
    entityType: input.entityType, channelId: input.channelId, location: input.location, image: input.image,
    status: 'scheduled', startAt: input.startAt, endAt: input.endAt, createdAt: now, updatedAt: now,
  }).returning();
  emitEventGateway('CREATE', row);
  void publishEventsChanged(guildId, row.id);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.GUILD_SCHEDULED_EVENT_CREATE, targetId: row.id, changes: [{ key: 'name', new: row.name }] });
  const [view] = await views([row], false);
  return { status: 200, body: view };
}

export async function updateBotEvent(guildId: string, eventId: string, botId: string, body: Record<string, unknown>): Promise<Result> {
  await ensureScheduledEventSchema();
  const row = await loadEvent(guildId, eventId);
  if (!row || (await visibleRows(botId, [row])).length === 0) return { status: 404, body: UNKNOWN_EVENT };
  const perms = await guildPerms(guildId, botId);
  const mayManage = has(perms, P.MANAGE_EVENTS) || (has(perms, P.CREATE_EVENTS) && same(row.creatorId, botId));
  if (!mayManage) return { status: 403, body: MISSING_PERMISSIONS };
  const mapped = fromDiscordEventBody(body, { create: false, existingEntityType: row.entityType as EventEntityType });
  if (!mapped.ok) return { status: 400, body: mapped.error };
  const { status: requestedStatus, image: rawImage, ...fields } = mapped.fields;
  const from = (row.status as EventStatus) || 'scheduled';
  const now = new Date();
  const patch: Partial<typeof ev.$inferInsert> = { updatedAt: now };
  // A new cover is uploaded only after everything else validated (below).
  const coverChange = 'image' in mapped.fields;
  if (coverChange && rawImage === null) fields.image = null;
  const editing = Object.keys(fields).length > 0 || coverChange;
  if (editing) {
    if (from !== 'scheduled' && from !== 'active') return { status: 400, body: { code: 180000, message: 'Cannot update a finished event' } };
    const parsed = normalizeEventInput(fields, {
      existing: {
        name: row.name, description: row.description ?? null, entityType: (row.entityType as EventEntityType) || 'voice',
        channelId: row.channelId ?? null, location: row.location ?? null, image: row.image ?? null,
        startAt: new Date(row.startAt), endAt: row.endAt ? new Date(row.endAt) : null, status: from,
      },
      imagePrefixes: [config.CDN_URL],
      now: now.getTime(),
    });
    if ('error' in parsed) return { status: 400, body: { code: 50035, message: `Invalid Form Body (${parsed.error})`, errors: {} } };
    const v = parsed.value;
    if (from === 'active' && (v.entityType !== row.entityType || !same(v.channelId, row.channelId))) {
      return { status: 400, body: { code: 50035, message: 'Invalid Form Body (an active event cannot move)', errors: {} } };
    }
    if (!same(v.channelId, row.channelId) || v.entityType !== row.entityType) {
      const chan = await checkEventChannel(botId, guildId, v.entityType, v.channelId);
      if (chan) return chan;
    }
    Object.assign(patch, { name: v.name, description: v.description, entityType: v.entityType, channelId: v.channelId, location: v.location, image: v.image, startAt: v.startAt, endAt: v.endAt });
  }
  let to: EventStatus | null = null;
  if (requestedStatus !== undefined) {
    if (!canTransition(from, requestedStatus as EventStatus)) return { status: 400, body: { code: 180000, message: 'Invalid status transition' } };
    to = requestedStatus as EventStatus;
    patch.status = to;
    if (to === 'active') patch.startedAt = now;
  }
  if (!editing && !to) {
    const [view] = await views([row], false);
    return { status: 200, body: view };
  }
  if (coverChange && rawImage !== null && rawImage !== undefined) {
    const cover = await uploadCover(guildId, botId, rawImage);
    if (!cover.ok) return cover.result;
    patch.image = cover.url;
  }
  const [updated] = await db.update(ev).set(patch).where(and(eq(ev.id, row.id), eq(ev.status, from))).returning();
  if (!updated) return { status: 409, body: { code: 0, message: 'The event changed, try again' } };
  emitEventGateway('UPDATE', updated);
  void publishEventsChanged(guildId, updated.id);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.GUILD_SCHEDULED_EVENT_UPDATE, targetId: updated.id, changes: scheduledEventChanges(row, updated) });
  if (to === 'active') void notifyEventStarted(updated, botId);
  const [view] = await views([updated], false);
  return { status: 200, body: view };
}

export async function deleteBotEvent(guildId: string, eventId: string, botId: string): Promise<Result> {
  await ensureScheduledEventSchema();
  const row = await loadEvent(guildId, eventId);
  if (!row || (await visibleRows(botId, [row])).length === 0) return { status: 404, body: UNKNOWN_EVENT };
  const perms = await guildPerms(guildId, botId);
  const mayManage = has(perms, P.MANAGE_EVENTS) || (has(perms, P.CREATE_EVENTS) && same(row.creatorId, botId));
  if (!mayManage) return { status: 403, body: MISSING_PERMISSIONS };
  await db.delete(eu).where(eq(eu.eventId, row.id));
  await db.delete(ev).where(and(eq(ev.id, row.id), eq(ev.serverId, guildId)));
  emitEventGateway('DELETE', row);
  void publishEventsChanged(guildId, row.id);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.GUILD_SCHEDULED_EVENT_DELETE, targetId: row.id, changes: [{ key: 'name', old: row.name }] });
  return { status: 204, body: '' };
}

/** GET .../users: interested users by user id, `before` / `after` user ids, limit 1..100. */
export async function listBotEventUsers(guildId: string, eventId: string, botId: string, q: { withMember: boolean; limit?: unknown; before?: string | null; after?: string | null }): Promise<Result> {
  await ensureScheduledEventSchema();
  const row = await loadEvent(guildId, eventId);
  if (!row || (await visibleRows(botId, [row])).length === 0) return { status: 404, body: UNKNOWN_EVENT };
  const n = Number(q.limit);
  const limit = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 100;
  const conds = [eq(eu.eventId, row.id)];
  const before = q.before && isValidObjectId(q.before) ? q.before.toLowerCase() : null;
  const after = q.after && isValidObjectId(q.after) ? q.after.toLowerCase() : null;
  if (after) conds.push(gt(eu.userId, after));
  else if (before) conds.push(lt(eu.userId, before));
  // `before` pages backwards: take the closest ones, then return ascending.
  const ordered = await db.select({ userId: eu.userId }).from(eu).where(and(...conds))
    .orderBy(before && !after ? sql`${eu.userId} DESC` : asc(eu.userId)).limit(limit);
  const ids = ordered.map((r) => r.userId).sort();
  if (ids.length === 0) return { status: 200, body: [] };
  const [users, members] = await Promise.all([
    User.find({ id: { in: ids } }).catch(() => []),
    q.withMember ? ServerMember.find({ serverId: guildId, userId: { in: ids } }).catch(() => []) : Promise.resolve([]),
  ]);
  const userBy = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  const memberBy = new Map(members.map((m) => [m.userId.toLowerCase(), m]));
  return {
    status: 200,
    body: ids.filter((id) => userBy.has(id.toLowerCase())).map((id) => {
      const u = userBy.get(id.toLowerCase())!;
      const m = memberBy.get(id.toLowerCase());
      return {
        guild_scheduled_event_id: row.id,
        user: toDiscordUserRow(u),
        ...(q.withMember && m ? { member: toDiscordGuildMember(m, null) } : {}),
      };
    }),
  };
}
