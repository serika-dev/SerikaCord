// Server scheduled events (Discord "Events"), mounted at /api.
//
//   GET   /servers/:serverId/scheduled-events                    upcoming + live events you can see
//   GET   /servers/:serverId/scheduled-events/:eventId           one event (any status)
//   POST  /servers/:serverId/scheduled-events                    create (CREATE_EVENTS / MANAGE_EVENTS)
//   PATCH /servers/:serverId/scheduled-events/:eventId           edit, or { status } start / end / cancel
//   POST  /servers/:serverId/scheduled-events/cover              upload a cover image (multipart `file`)
//   PUT   /servers/:serverId/scheduled-events/:eventId/users/@me  mark Interested
//   DELETE /servers/:serverId/scheduled-events/:eventId/users/@me remove Interested
//   GET   /servers/:serverId/scheduled-events/:eventId/users     who is interested
//
// Pure rules: lib/chat/scheduledEvents.ts. Schema, views, sweeper and
// notifications: lib/services/scheduledEvents.ts.
import { Elysia, t } from 'elysia';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { config } from '@/lib/config';
import { Channel, Server, ServerMember, User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { PERMISSION_BITS, hasPermission } from '@/lib/permissions/bits';
import {
  MAX_OPEN_EVENTS_PER_SERVER,
  canTransition,
  normalizeEventInput,
  sortEvents,
  type EventEntityType,
  type EventStatus,
  type StoredEventFields,
} from '@/lib/chat/scheduledEvents';
import {
  buildEventViews,
  emitEventGateway,
  ensureScheduledEventSchema,
  notifyEventStarted,
  publishEventsChanged,
  type ScheduledEventRow,
} from '@/lib/services/scheduledEvents';

type Cookie = Record<string, { value?: unknown }>;
type Fail = { status: number; error: string };

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

const sameId = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ev = schema.serverScheduledEvents;
const eu = schema.serverScheduledEventUsers;

type Access = { perms: bigint; canCreate: boolean; canManage: boolean; isOwner: boolean };

/** The viewer's server-wide permissions, or a failure when they aren't a member. */
async function serverAccess(userId: string, serverId: string): Promise<Access | Fail> {
  const server = await Server.findById(serverId);
  if (!server) return { status: 404, error: 'Server not found' };
  const isOwner = sameId(server.ownerId, userId);
  const membership = isOwner ? null : await ServerMember.findOne({ serverId, userId });
  if (!isOwner && !membership) return { status: 403, error: 'You are not a member of this server' };
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = isOwner ? -1n : await getMemberChannelPermissions(userId, { serverId }, membership);
  const canManage = isOwner || hasPermission(perms, PERMISSION_BITS.MANAGE_EVENTS);
  const canCreate = canManage || hasPermission(perms, PERMISSION_BITS.CREATE_EVENTS);
  return { perms, canCreate, canManage, isOwner };
}

/** Channel events are only shown to people who can see the channel. */
async function visibleRows(userId: string, rows: ScheduledEventRow[]): Promise<ScheduledEventRow[]> {
  const channelIds = [...new Set(rows.map((r) => r.channelId).filter(Boolean) as string[])];
  if (channelIds.length === 0) return rows;
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const allowed = new Map<string, boolean>();
  await Promise.all(channelIds.map(async (id) => {
    const res = await checkChannelAccess(userId, id, { lean: true }).catch(() => ({ hasAccess: false }));
    allowed.set(id, Boolean(res.hasAccess));
  }));
  return rows.filter((r) => !r.channelId || r.entityType === 'external' || allowed.get(r.channelId));
}

async function loadEvent(serverId: string, eventId: string): Promise<ScheduledEventRow | null> {
  if (!isValidObjectId(eventId)) return null;
  const [row] = await db.select().from(ev).where(and(eq(ev.id, eventId), eq(ev.serverId, serverId))).limit(1);
  return row ?? null;
}

/** A voice / stage channel of this server the user can see, for a channel event. */
async function checkEventChannel(userId: string, serverId: string, entityType: EventEntityType, channelId: string | null): Promise<Fail | null> {
  if (entityType === 'external' || !channelId) return null;
  const channel = await Channel.findById(channelId);
  if (!channel || !sameId(channel.serverId, serverId)) return { status: 400, error: 'Channel not found' };
  if (channel.type !== entityType) {
    return { status: 400, error: entityType === 'stage' ? 'Choose a stage channel' : 'Choose a voice channel' };
  }
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(userId, channelId, { lean: true }).catch(() => ({ hasAccess: false }));
  if (!access.hasAccess) return { status: 403, error: 'You cannot see that channel' };
  return null;
}

function storedFields(row: ScheduledEventRow): StoredEventFields {
  return {
    name: row.name,
    description: row.description ?? null,
    entityType: (row.entityType as EventEntityType) || 'voice',
    channelId: row.channelId ?? null,
    location: row.location ?? null,
    image: row.image ?? null,
    startAt: new Date(row.startAt),
    endAt: row.endAt ? new Date(row.endAt) : null,
    status: (row.status as EventStatus) || 'scheduled',
  };
}

const imagePrefixes = () => [config.CDN_URL].filter(Boolean) as string[];

async function limited(userId: string): Promise<Fail | null> {
  const rl = await checkRateLimit('scheduledEvent', userId);
  return rl.success ? null : { status: 429, error: 'You are doing that too quickly' };
}

export const scheduledEventRoutes = new Elysia({ prefix: '/servers' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .get('/:serverId/scheduled-events', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!(await ensureScheduledEventSchema())) return { events: [], canCreate: access.canCreate, canManage: access.canManage };
    const rows = await db.select().from(ev)
      .where(and(eq(ev.serverId, params.serverId), inArray(ev.status, ['scheduled', 'active'])))
      .orderBy(asc(ev.startAt))
      .limit(MAX_OPEN_EVENTS_PER_SERVER);
    const views = await buildEventViews(await visibleRows(user.id, rows), user.id);
    set.headers['cache-control'] = 'no-store';
    return { events: sortEvents(views), canCreate: access.canCreate, canManage: access.canManage };
  })
  .get('/:serverId/scheduled-events/:eventId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    await ensureScheduledEventSchema();
    const row = await loadEvent(params.serverId, params.eventId);
    const visible = row ? await visibleRows(user.id, [row]) : [];
    if (!row || visible.length === 0) { set.status = 404; return { error: 'Event not found' }; }
    const [view] = await buildEventViews(visible, user.id);
    return { event: view, canManage: access.canManage || (access.canCreate && sameId(row.creatorId, user.id)) };
  })
  .post('/:serverId/scheduled-events', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.canCreate) { set.status = 403; return { error: 'You do not have permission to create events' }; }
    const rl = await limited(user.id);
    if (rl) { set.status = rl.status; return { error: rl.error }; }
    if (!(await ensureScheduledEventSchema())) { set.status = 503; return { error: 'Events are unavailable right now' }; }
    const parsed = normalizeEventInput((body ?? {}) as Record<string, unknown>, { imagePrefixes: imagePrefixes() });
    if ('error' in parsed) { set.status = 400; return { error: parsed.error }; }
    const input = parsed.value;
    const chanFail = await checkEventChannel(user.id, params.serverId, input.entityType, input.channelId);
    if (chanFail) { set.status = chanFail.status; return { error: chanFail.error }; }
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(ev)
      .where(and(eq(ev.serverId, params.serverId), inArray(ev.status, ['scheduled', 'active'])));
    if (Number(count) >= MAX_OPEN_EVENTS_PER_SERVER) { set.status = 400; return { error: 'This server has too many upcoming events' }; }
    const now = new Date();
    const [row] = await db.insert(ev).values({
      serverId: params.serverId,
      creatorId: user.id,
      name: input.name,
      description: input.description,
      entityType: input.entityType,
      channelId: input.channelId,
      location: input.location,
      image: input.image,
      status: 'scheduled',
      startAt: input.startAt,
      endAt: input.endAt,
      createdAt: now,
      updatedAt: now,
    }).returning();
    // The creator is interested in their own event (as in Discord).
    await db.insert(eu).values({ eventId: row.id, userId: user.id }).onConflictDoNothing();
    emitEventGateway('CREATE', row);
    void publishEventsChanged(params.serverId, row.id);
    const [view] = await buildEventViews([row], user.id);
    return { event: view };
  }, { body: t.Record(t.String(), t.Any()) })
  .patch('/:serverId/scheduled-events/:eventId', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    await ensureScheduledEventSchema();
    const row = await loadEvent(params.serverId, params.eventId);
    if (!row) { set.status = 404; return { error: 'Event not found' }; }
    const mayManage = access.canManage || (access.canCreate && sameId(row.creatorId, user.id));
    if (!mayManage) { set.status = 403; return { error: 'You do not have permission to manage this event' }; }
    const rl = await limited(user.id);
    if (rl) { set.status = rl.status; return { error: rl.error }; }
    const input = (body ?? {}) as Record<string, unknown>;
    const { status: requestedStatus, ...fields } = input;
    const from = (row.status as EventStatus) || 'scheduled';
    const now = new Date();
    const patch: Partial<typeof ev.$inferInsert> = { updatedAt: now };

    const editing = Object.keys(fields).length > 0;
    if (editing) {
      if (from !== 'scheduled' && from !== 'active') { set.status = 400; return { error: 'This event has ended' }; }
      const parsed = normalizeEventInput(fields, { existing: storedFields(row), imagePrefixes: imagePrefixes(), now: now.getTime() });
      if ('error' in parsed) { set.status = 400; return { error: parsed.error }; }
      const v = parsed.value;
      if (from === 'active' && (v.entityType !== row.entityType || !sameId(v.channelId, row.channelId))) {
        set.status = 400;
        return { error: 'You cannot move an event that already started' };
      }
      if (!sameId(v.channelId, row.channelId) || v.entityType !== row.entityType) {
        const chanFail = await checkEventChannel(user.id, params.serverId, v.entityType, v.channelId);
        if (chanFail) { set.status = chanFail.status; return { error: chanFail.error }; }
      }
      Object.assign(patch, {
        name: v.name, description: v.description, entityType: v.entityType, channelId: v.channelId,
        location: v.location, image: v.image, startAt: v.startAt, endAt: v.endAt,
      });
    }

    let to: EventStatus | null = null;
    if (requestedStatus !== undefined) {
      if (typeof requestedStatus !== 'string' || !canTransition(from, requestedStatus as EventStatus)) {
        set.status = 400;
        return { error: 'That status change is not allowed' };
      }
      to = requestedStatus as EventStatus;
      patch.status = to;
      if (to === 'active') patch.startedAt = now;
    }
    if (!editing && !to) { set.status = 400; return { error: 'Nothing to change' }; }

    // Only apply when the status is still what we read (the sweeper may have moved it).
    const [updated] = await db.update(ev).set(patch)
      .where(and(eq(ev.id, row.id), eq(ev.status, from)))
      .returning();
    if (!updated) { set.status = 409; return { error: 'The event changed, try again' }; }
    emitEventGateway(to === 'canceled' ? 'DELETE' : 'UPDATE', updated);
    void publishEventsChanged(params.serverId, updated.id);
    if (to === 'active') void notifyEventStarted(updated, user.id);
    const [view] = await buildEventViews([updated], user.id);
    return { event: view };
  }, { body: t.Record(t.String(), t.Any()) })
  .post('/:serverId/scheduled-events/cover', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.canCreate) { set.status = 403; return { error: 'You do not have permission to create events' }; }
    const rl = await checkRateLimit('upload', user.id);
    if (!rl.success) { set.status = 429; return { error: 'Upload rate limited', retryAfter: rl.retryAfter }; }
    const file = (body as { file?: File }).file;
    if (!file) { set.status = 400; return { error: 'No file provided' }; }
    if (!(config.ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }
    if (file.size > config.MAX_BANNER_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${Math.round(config.MAX_BANNER_SIZE / 1024 / 1024)}MB.` };
    }
    try {
      const { storage } = await import('@/lib/services/storage');
      const result = await storage.uploadFromFormData(file, 'event-covers', { serverId: params.serverId });
      return { url: result.url };
    } catch (err) {
      console.error('[events] cover upload failed:', err);
      set.status = 500;
      return { error: 'Failed to upload the cover image' };
    }
  }, { body: t.Object({ file: t.File() }) })
  .put('/:serverId/scheduled-events/:eventId/users/@me', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const rl = await limited(user.id);
    if (rl) { set.status = rl.status; return { error: rl.error }; }
    await ensureScheduledEventSchema();
    const row = await loadEvent(params.serverId, params.eventId);
    if (!row || (await visibleRows(user.id, [row])).length === 0) { set.status = 404; return { error: 'Event not found' }; }
    if (row.status !== 'scheduled' && row.status !== 'active') { set.status = 400; return { error: 'This event has ended' }; }
    const inserted = await db.insert(eu).values({ eventId: row.id, userId: user.id }).onConflictDoNothing().returning();
    if (inserted.length > 0) {
      void publishEventsChanged(params.serverId, row.id);
      void import('@/lib/services/gatewayEvents')
        .then(({ emitGuildScheduledEvent }) => emitGuildScheduledEvent('GUILD_SCHEDULED_EVENT_USER_ADD', row.serverId, {
          guild_scheduled_event_id: row.id, user_id: user.id, guild_id: row.serverId,
        }))
        .catch(() => {});
    }
    return { success: true };
  })
  .delete('/:serverId/scheduled-events/:eventId/users/@me', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const rl = await limited(user.id);
    if (rl) { set.status = rl.status; return { error: rl.error }; }
    await ensureScheduledEventSchema();
    const row = await loadEvent(params.serverId, params.eventId);
    if (!row) { set.status = 404; return { error: 'Event not found' }; }
    const removed = await db.delete(eu).where(and(eq(eu.eventId, row.id), eq(eu.userId, user.id))).returning();
    if (removed.length > 0) {
      void publishEventsChanged(params.serverId, row.id);
      void import('@/lib/services/gatewayEvents')
        .then(({ emitGuildScheduledEvent }) => emitGuildScheduledEvent('GUILD_SCHEDULED_EVENT_USER_REMOVE', row.serverId, {
          guild_scheduled_event_id: row.id, user_id: user.id, guild_id: row.serverId,
        }))
        .catch(() => {});
    }
    return { success: true };
  })
  .get('/:serverId/scheduled-events/:eventId/users', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user.id, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    await ensureScheduledEventSchema();
    const row = await loadEvent(params.serverId, params.eventId);
    if (!row || (await visibleRows(user.id, [row])).length === 0) { set.status = 404; return { error: 'Event not found' }; }
    const rows = await db.select({ userId: eu.userId }).from(eu).where(eq(eu.eventId, row.id)).orderBy(asc(eu.createdAt)).limit(100);
    const ids = rows.map((r) => r.userId);
    if (ids.length === 0) return { users: [] };
    const [users, members] = await Promise.all([
      User.find({ id: { in: ids } }).catch(() => []),
      ServerMember.find({ serverId: params.serverId, userId: { in: ids } }).catch(() => []),
    ]);
    const nickBy = new Map(members.map((m) => [m.userId.toLowerCase(), m.nickname ?? null]));
    const byId = new Map(users.map((u) => [u.id.toLowerCase(), u]));
    return {
      users: ids.map((id) => byId.get(id.toLowerCase())).filter(Boolean).map((u) => ({
        id: u!.id,
        username: u!.username,
        displayName: nickBy.get(u!.id.toLowerCase()) || u!.displayName || null,
        avatar: u!.avatar ?? null,
      })),
    };
  });

