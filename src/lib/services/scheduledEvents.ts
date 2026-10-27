// Server side of scheduled events and announcement follows: the boot-time
// schema ensure, event views, live updates, and the status sweeper that starts
// and completes events on time (and tells interested users an event started).
// Pure rules: lib/chat/scheduledEvents.ts. Routes: lib/api/scheduledEvents.ts
// and lib/api/announcements.ts.
//
//   sweeper (every 30s, every instance): atomic UPDATE ... WHERE status = <from>
//   RETURNING, so each transition (and its notification) happens exactly once
//   across instances without a leader lock.
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { Channel, User } from '@/lib/models';
import { processShared } from '@/lib/realtime/processShared';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { pickServerActiveEvent, type RailEventCandidate, type ServerActiveEvent } from '@/lib/chat/serverEventBadge';
import {
  DEFAULT_ACTIVE_MS,
  DISCORD_ENTITY_TYPE,
  DISCORD_EVENT_STATUS,
  STARTING_SOON_MS,
  startNotifyRecipients,
  type EventEntityType,
  type EventStatus,
} from '@/lib/chat/scheduledEvents';

export type ScheduledEventRow = typeof schema.serverScheduledEvents.$inferSelect;

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_scheduled_events_announcements.sql. Additive +
// idempotent, with the same lock_timeout guard as the other boot DDL.
const g = globalThis as unknown as { __scheduledEventSchema?: Promise<boolean> | null };

export function ensureScheduledEventSchema(): Promise<boolean> {
  if (g.__scheduledEventSchema) return g.__scheduledEventSchema;
  g.__scheduledEventSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "server_scheduled_events" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "server_id" uuid NOT NULL,
            "creator_id" uuid NOT NULL,
            "name" text NOT NULL,
            "description" text,
            "entity_type" text NOT NULL DEFAULT 'voice',
            "channel_id" uuid,
            "location" text,
            "image" text,
            "status" text NOT NULL DEFAULT 'scheduled',
            "start_at" timestamp NOT NULL,
            "end_at" timestamp,
            "started_at" timestamp,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_scheduled_events_server_status_idx" ON "server_scheduled_events" ("server_id", "status")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_scheduled_events_status_start_idx" ON "server_scheduled_events" ("status", "start_at")`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "server_scheduled_event_users" (
            "event_id" uuid NOT NULL,
            "user_id" uuid NOT NULL,
            "created_at" timestamp DEFAULT now(),
            PRIMARY KEY ("event_id", "user_id")
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "server_scheduled_event_users_user_idx" ON "server_scheduled_event_users" ("user_id")`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "channel_follows" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "source_channel_id" uuid NOT NULL,
            "source_server_id" uuid NOT NULL,
            "target_channel_id" uuid NOT NULL,
            "target_server_id" uuid NOT NULL,
            "webhook_id" uuid NOT NULL,
            "creator_id" uuid NOT NULL,
            "created_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "channel_follows_source_target_idx" ON "channel_follows" ("source_channel_id", "target_channel_id")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "channel_follows_target_idx" ON "channel_follows" ("target_channel_id")`);
        });
        return true;
      } catch (err) {
        console.error(`[events] Ensuring scheduled event schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__scheduledEventSchema = null;
    return false;
  })();
  return g.__scheduledEventSchema;
}

// ─── Views ────────────────────────────────────────────────────────────────────
export interface ScheduledEventView {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  entityType: EventEntityType;
  channelId: string | null;
  channelName: string | null;
  location: string | null;
  image: string | null;
  status: EventStatus;
  startAt: string;
  endAt: string | null;
  creatorId: string;
  creator: { id: string; username: string; displayName: string | null; avatar: string | null } | null;
  userCount: number;
  interested: boolean;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Client views of `rows` for one viewer (interested counts, creator, channel names). */
export async function buildEventViews(rows: ScheduledEventRow[], viewerId: string | null): Promise<ScheduledEventView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const eu = schema.serverScheduledEventUsers;
  const creatorIds = [...new Set(rows.map((r) => r.creatorId))];
  const channelIds = [...new Set(rows.map((r) => r.channelId).filter(Boolean) as string[])];
  const [counts, mine, creators, channels] = await Promise.all([
    db.select({ eventId: eu.eventId, count: sql<number>`count(*)::int` }).from(eu).where(inArray(eu.eventId, ids)).groupBy(eu.eventId),
    viewerId
      ? db.select({ eventId: eu.eventId }).from(eu).where(and(inArray(eu.eventId, ids), eq(eu.userId, viewerId)))
      : Promise.resolve([] as Array<{ eventId: string }>),
    User.find({ id: { in: creatorIds } }).catch(() => []),
    channelIds.length ? Channel.find({ id: { in: channelIds } }).catch(() => []) : Promise.resolve([]),
  ]);
  const countBy = new Map(counts.map((c) => [c.eventId, Number(c.count) || 0]));
  const mineSet = new Set(mine.map((m) => m.eventId));
  const creatorBy = new Map(creators.map((u) => [u.id.toLowerCase(), u]));
  const channelBy = new Map(channels.map((c) => [c.id.toLowerCase(), c]));
  return rows.map((r) => {
    const creator = creatorBy.get(r.creatorId.toLowerCase());
    const channel = r.channelId ? channelBy.get(r.channelId.toLowerCase()) : undefined;
    return {
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      description: r.description ?? null,
      entityType: (r.entityType as EventEntityType) || 'voice',
      channelId: r.channelId ?? null,
      channelName: channel?.name ?? null,
      location: r.location ?? null,
      image: r.image ?? null,
      status: (r.status as EventStatus) || 'scheduled',
      startAt: iso(r.startAt)!,
      endAt: iso(r.endAt),
      creatorId: r.creatorId,
      creator: creator
        ? { id: creator.id, username: creator.username, displayName: creator.displayName ?? null, avatar: creator.avatar ?? null }
        : null,
      userCount: countBy.get(r.id) ?? 0,
      interested: mineSet.has(r.id),
    };
  });
}

/** Discord-shaped guild scheduled event (bot gateway). */
export function toDiscordEvent(r: ScheduledEventRow, userCount?: number) {
  const entityType = (r.entityType as EventEntityType) || 'voice';
  return {
    id: r.id,
    guild_id: r.serverId,
    channel_id: entityType === 'external' ? null : r.channelId,
    creator_id: r.creatorId,
    name: r.name,
    description: r.description ?? null,
    scheduled_start_time: iso(r.startAt),
    scheduled_end_time: iso(r.endAt),
    privacy_level: 2,
    status: DISCORD_EVENT_STATUS[(r.status as EventStatus) || 'scheduled'] ?? 1,
    entity_type: DISCORD_ENTITY_TYPE[entityType],
    entity_id: null,
    entity_metadata: entityType === 'external' ? { location: r.location ?? '' } : null,
    image: r.image ?? null,
    ...(userCount !== undefined ? { user_count: userCount } : {}),
  };
}

// ─── Server rail badge (/@me/servers `activeEvent`) ─────────────────────────
// One indexed query for every server the viewer is in that isn't cached:
// live events plus scheduled ones starting within the "soon" window. Rows are
// cached per server for a short TTL (process-wide, dropped on any change by
// publishEventsChanged), then filtered per viewer by channel visibility, the
// same rule as the events list (visibleRows in api/scheduledEvents.ts).
type RailRow = RailEventCandidate & { serverId: string; channelId: string | null; entityType: string };

const RAIL_CACHE_TTL_MS = 20_000;
const RAIL_ACCESS_TTL_MS = 60_000;
const railEventCache = processShared('scheduledEvents:railCache', () => new BoundedMap<string, { at: number; rows: RailRow[] }>(20_000));
const railAccessCache = processShared('scheduledEvents:railAccess', () => new BoundedMap<string, { at: number; ok: boolean }>(20_000));
let railFailureLogged = false;

async function railCandidates(serverIds: string[], now: number): Promise<RailRow[]> {
  const out: RailRow[] = [];
  const missing: string[] = [];
  for (const id of serverIds) {
    const hit = railEventCache.get(id.toLowerCase());
    if (hit && now - hit.at < RAIL_CACHE_TTL_MS) out.push(...hit.rows);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const ev = schema.serverScheduledEvents;
  const horizon = new Date(now + STARTING_SOON_MS);
  const rows = await db
    .select({
      id: ev.id,
      serverId: ev.serverId,
      name: ev.name,
      status: ev.status,
      startAt: ev.startAt,
      channelId: ev.channelId,
      entityType: ev.entityType,
    })
    .from(ev)
    .where(and(
      inArray(ev.serverId, missing),
      or(eq(ev.status, 'active'), and(eq(ev.status, 'scheduled'), lte(ev.startAt, horizon))),
    ));
  const byServer = new Map<string, RailRow[]>(missing.map((id) => [id.toLowerCase(), []]));
  for (const r of rows) {
    const key = String(r.serverId).toLowerCase();
    const row: RailRow = { ...r, serverId: key, channelId: r.channelId ?? null };
    const list = byServer.get(key);
    if (list) list.push(row);
    else byServer.set(key, [row]);
    out.push(row);
  }
  for (const [key, list] of byServer) railEventCache.set(key, { at: now, rows: list });
  return out;
}

async function canSeeEventChannel(userId: string, channelId: string, now: number): Promise<boolean> {
  const key = `${userId.toLowerCase()}:${channelId.toLowerCase()}`;
  const hit = railAccessCache.get(key);
  if (hit && now - hit.at < RAIL_ACCESS_TTL_MS) return hit.ok;
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const res = await checkChannelAccess(userId, channelId, { lean: true }).catch(() => ({ hasAccess: false }));
  const ok = Boolean(res.hasAccess);
  railAccessCache.set(key, { at: now, ok });
  return ok;
}

/**
 * Per server (lower-case id): the live event, else the next one starting
 * within the hour, that this user can see. Servers without one are absent.
 * Never throws (no table yet / DB hiccup: no badges).
 */
export async function activeEventsForServers(userId: string, serverIds: string[]): Promise<Map<string, ServerActiveEvent>> {
  const result = new Map<string, ServerActiveEvent>();
  if (serverIds.length === 0) return result;
  try {
    const now = Date.now();
    const rows = await railCandidates(serverIds, now);
    if (rows.length === 0) return result;
    const gated = [...new Set(rows.filter((r) => r.channelId && r.entityType !== 'external').map((r) => r.channelId as string))];
    const allowed = new Map<string, boolean>();
    await Promise.all(gated.map(async (id) => { allowed.set(id, await canSeeEventChannel(userId, id, now)); }));
    const byServer = new Map<string, RailRow[]>();
    for (const r of rows) {
      if (r.channelId && r.entityType !== 'external' && !allowed.get(r.channelId)) continue;
      const list = byServer.get(r.serverId);
      if (list) list.push(r);
      else byServer.set(r.serverId, [r]);
    }
    for (const [serverId, list] of byServer) {
      const pick = pickServerActiveEvent(list, now);
      if (pick) result.set(serverId, pick);
    }
  } catch (err) {
    // Polled every ~25s per client: log the first failure, not every poll.
    if (!railFailureLogged) {
      railFailureLogged = true;
      console.error('[events] rail summary failed:', (err as Error)?.message ?? err);
    }
  }
  return result;
}

// ─── Live updates ─────────────────────────────────────────────────────────────
/** Tell every connected member of the server to refresh its events. */
export async function publishEventsChanged(serverId: string, eventId: string): Promise<void> {
  // This instance's rail summary is stale now (others expire within the TTL).
  railEventCache.delete(serverId.toLowerCase());
  try {
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ serverId }, { type: 'scheduled_event_update', serverId, eventId });
  } catch (err) {
    console.error('[events] live update failed:', (err as Error)?.message ?? err);
  }
}

export function emitEventGateway(t: 'CREATE' | 'UPDATE' | 'DELETE', row: ScheduledEventRow): void {
  void import('@/lib/services/gatewayEvents')
    .then(({ emitGuildScheduledEvent }) => emitGuildScheduledEvent(`GUILD_SCHEDULED_EVENT_${t}`, row.serverId, toDiscordEvent(row)))
    .catch(() => {});
}

/** The interested users of an event. */
export async function interestedUserIds(eventId: string, limit = 5000): Promise<string[]> {
  const eu = schema.serverScheduledEventUsers;
  const rows = await db.select({ userId: eu.userId }).from(eu).where(eq(eu.eventId, eventId)).limit(limit);
  return rows.map((r) => r.userId);
}

/**
 * An event just went live: the in-app notification (activity stream) and a
 * push to phones not in the app, for everyone who marked it Interested.
 */
export async function notifyEventStarted(row: ScheduledEventRow, actorId?: string | null): Promise<void> {
  try {
    const recipients = startNotifyRecipients(await interestedUserIds(row.id), actorId);
    if (recipients.length === 0) return;
    const [server] = await db
      .select({ name: schema.servers.name, icon: schema.servers.icon })
      .from(schema.servers)
      .where(eq(schema.servers.id, row.serverId))
      .limit(1);
    const route = row.channelId && row.entityType !== 'external'
      ? `/channels/${row.serverId}/${row.channelId}`
      : `/channels/${row.serverId}?event=${row.id}`;
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ userIds: recipients }, {
      type: 'scheduled_event_start',
      serverId: row.serverId,
      serverName: server?.name ?? '',
      serverIcon: server?.icon ?? null,
      eventId: row.id,
      name: row.name,
      route,
    });
    const { pushServerNotice } = await import('@/lib/services/pushNotifications');
    pushServerNotice(recipients, {
      // Push text is built without the recipient's locale (as for messages).
      title: row.name,
      body: server?.name ? `Event starting now in ${server.name}` : 'Event starting now',
      route,
      tag: `event-${row.id}`,
    });
  } catch (err) {
    console.error('[events] start notification failed:', (err as Error)?.message ?? err);
  }
}

// ─── Status sweeper ───────────────────────────────────────────────────────────
const sweeper = processShared('scheduledEvents:sweeper', () => ({
  timer: null as ReturnType<typeof setInterval> | null,
  running: false,
}));

const SWEEP_INTERVAL_MS = 30_000;

/** One pass: start due events, complete finished ones. Exactly-once per row. */
export async function sweepScheduledEvents(now: Date = new Date()): Promise<void> {
  const ev = schema.serverScheduledEvents;
  const staleCutoff = new Date(now.getTime() - DEFAULT_ACTIVE_MS);
  const finished = or(
    and(isNotNull(ev.endAt), lte(ev.endAt, now)),
    and(isNull(ev.endAt), lte(ev.startAt, staleCutoff), or(isNull(ev.startedAt), lte(ev.startedAt, staleCutoff))),
  );
  // Missed entirely (the app was down for the whole window): straight to completed.
  const skipped = await db.update(ev)
    .set({ status: 'completed', updatedAt: now })
    .where(and(eq(ev.status, 'scheduled'), lte(ev.startAt, now), finished))
    .returning();
  const started = await db.update(ev)
    .set({ status: 'active', startedAt: now, updatedAt: now })
    .where(and(eq(ev.status, 'scheduled'), lte(ev.startAt, now)))
    .returning();
  const completed = await db.update(ev)
    .set({ status: 'completed', updatedAt: now })
    .where(and(eq(ev.status, 'active'), finished))
    .returning();
  for (const row of [...skipped, ...completed]) {
    emitEventGateway('UPDATE', row);
    await publishEventsChanged(row.serverId, row.id);
  }
  for (const row of started) {
    emitEventGateway('UPDATE', row);
    await publishEventsChanged(row.serverId, row.id);
    await notifyEventStarted(row, null);
  }
}

export function startScheduledEventSweeper(): void {
  if (sweeper.timer) return;
  const tick = async () => {
    if (sweeper.running) return;
    sweeper.running = true;
    try {
      if (!(await ensureScheduledEventSchema())) return;
      await sweepScheduledEvents();
    } catch (err) {
      console.error('[events] sweep failed:', (err as Error)?.message ?? err);
    } finally {
      sweeper.running = false;
    }
  };
  sweeper.timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
  (sweeper.timer as { unref?: () => void }).unref?.();
}
