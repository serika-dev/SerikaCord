/**
 * App-wide "channel activity" bus.
 *
 * The per-channel `/stream` SSE only tells a client about the ONE channel it's
 * currently viewing. To drive unread glow / mention badges for every other
 * channel a user can see, we need a single user-level stream that receives a
 * lightweight signal whenever a message lands in ANY channel the user is a
 * member of. That's what this module provides.
 *
 * Cost control: on each message we fan out only to users who currently have an
 * activity stream open AND are members of the message's server. Server member
 * id lists are cached in-memory with a short TTL so a busy channel doesn't
 * trigger a DB read per message.
 */
import { getPublisher } from '@/lib/db';
import { processShared, PROCESS_INSTANCE_ID } from '@/lib/realtime/processShared';
import { config } from '@/lib/config';
import { Channel, ServerMember } from '@/lib/models';
import { db, schema } from '@/lib/db/postgres';
import { inArray } from 'drizzle-orm';
import { BoundedMap } from '@/lib/utils/boundedMap';
import type { MentionNames } from '@/lib/chat/mentionText';

export interface ChannelActivityPayload {
  type: 'channel_activity';
  serverId: string;
  channelId: string;
  channelName?: string;
  messageId: string;
  authorId: string;
  authorName?: string;
  mentionedUserIds: string[];
  mentionEveryone: boolean;
  /** Mentioned role ids (resolved to `roleMentionUserIds` before fan-out). */
  mentionedRoleIds?: string[];
  /** Members holding a mentioned role, so clients can badge role pings. */
  roleMentionUserIds?: string[];
  authorAvatar?: string | null;
  /** Short plain-text preview for desktop notifications (shown only if the user allows previews). */
  preview?: string;
  /** Names for mention markup in `preview` ("@Alice" instead of "@user"). */
  mentionNames?: MentionNames;
  /** Parent category / forum, so per-category notification settings apply. */
  parentId?: string | null;
  createdAt: string; // ISO
}

const MAX_ROLE_MENTION_RECIPIENTS = 5000;

/** Resolve role mentions to member ids (once per message, before fan-out). */
async function resolveRoleMentionUsers(payload: ChannelActivityPayload): Promise<ChannelActivityPayload> {
  const roleIds = payload.mentionedRoleIds ?? [];
  if (roleIds.length === 0 || payload.roleMentionUserIds) return payload;
  try {
    const members = (await ServerMember.find({ serverId: payload.serverId })) as Array<{ userId: string; roles?: string[] | null }>;
    const wanted = new Set(roleIds);
    const ids: string[] = [];
    for (const m of members) {
      if ((m.roles ?? []).some((r) => wanted.has(r))) ids.push(m.userId);
      if (ids.length >= MAX_ROLE_MENTION_RECIPIENTS) break;
    }
    return { ...payload, roleMentionUserIds: ids };
  } catch {
    return payload;
  }
}

const ACTIVITY_BUS = 'sse:activity';
// Carries user-scoped events over the same activity streams: cross-device read
// receipts and unread resets after a deletion. Each instance resolves its own
// connected recipients so payloads stay small (we ship serverId, not a member
// list, for server-wide fan-out).
const USER_FANOUT_BUS = 'sse:user-fanout';
const INSTANCE_ID = PROCESS_INSTANCE_ID;

// userId -> set of raw write callbacks (one per open activity stream / tab).
// Process-wide (see processShared) so publishes from Next's module copy reach
// streams registered by server.ts.
const activeActivityConnections = processShared(
  'activityConnections',
  () => new Map<string, Set<(data: string) => void>>(),
);

/** Register a raw SSE writer for a user. Returns an unregister cleanup. */
export function registerActivityConnection(
  userId: string,
  write: (data: string) => void,
): () => void {
  if (!activeActivityConnections.has(userId)) {
    activeActivityConnections.set(userId, new Set());
  }
  const set = activeActivityConnections.get(userId)!;
  set.add(write);
  return () => {
    set.delete(write);
    if (set.size === 0) activeActivityConnections.delete(userId);
  };
}

/** Whether this user has an open activity stream (any tab) on this instance. */
export function hasActivityConnection(userId: string): boolean {
  return (activeActivityConnections.get(userId)?.size ?? 0) > 0;
}

function emitLocal(userIds: string[], payload: ChannelActivityPayload) {
  // Clients get a per-recipient `mentionedRole` flag instead of the member list.
  const { roleMentionUserIds, ...rest } = payload;
  const roleSet = new Set(roleMentionUserIds ?? []);
  const plain = `data: ${JSON.stringify({ ...rest, mentionedRole: false })}\n\n`;
  const pinged = `data: ${JSON.stringify({ ...rest, mentionedRole: true })}\n\n`;
  for (const userId of userIds) {
    const writers = activeActivityConnections.get(userId);
    if (!writers) continue;
    const encoded = roleSet.has(userId) ? pinged : plain;
    writers.forEach((write) => {
      try {
        write(encoded);
      } catch {
        writers.delete(write);
      }
    });
    if (writers.size === 0) activeActivityConnections.delete(userId);
  }
}

/** Generic local emit of an arbitrary user-scoped payload (read receipts etc). */
function emitToUsers(userIds: string[], payload: Record<string, unknown>) {
  const encoded = `data: ${JSON.stringify(payload)}\n\n`;
  for (const userId of userIds) {
    const writers = activeActivityConnections.get(userId);
    if (!writers) continue;
    writers.forEach((write) => {
      try {
        write(encoded);
      } catch {
        writers.delete(write);
      }
    });
    if (writers.size === 0) activeActivityConnections.delete(userId);
  }
}

// ── Server-member id cache (bounds DB load under message bursts) ────────────
const MEMBER_CACHE_TTL_MS = 30_000;
const memberCache = processShared(
  'activityMemberCache',
  () => new BoundedMap<string, { ids: Set<string>; expires: number }>(500),
);

async function getServerMemberIds(serverId: string): Promise<Set<string>> {
  const cached = memberCache.get(serverId);
  if (cached && cached.expires > Date.now()) return cached.ids;
  const members = await ServerMember.find({ serverId });
  const ids = new Set<string>(members.map((m: { userId: string }) => m.userId));
  memberCache.set(serverId, { ids, expires: Date.now() + MEMBER_CACHE_TTL_MS });
  return ids;
}

/**
 * Invalidate the member cache for a server (call on join/leave/kick/ban).
 * The cache is per-process, so the invalidation is also fanned out to other
 * instances over the activity bus.
 */
export function invalidateServerMemberCache(serverId: string): void {
  memberCache.delete(serverId);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(ACTIVITY_BUS, JSON.stringify({ originId: INSTANCE_ID, invalidateMembers: serverId }))
      .catch(() => { /* best-effort cross-instance invalidation */ });
  }
}

/**
 * Deliver a channel-activity signal to every connected member of the server
 * (this instance), then fan out over Redis so other instances do the same.
 */
export async function notifyChannelActivity(input: ChannelActivityPayload): Promise<void> {
  const payload = await resolveRoleMentionUsers(input);
  // Mobile push for pinged users who aren't in the app (no-op without FCM).
  void import('@/lib/services/pushNotifications')
    .then((m) => m.pushChannelActivity(payload))
    .catch(() => { /* best-effort */ });
  await deliverLocally(payload);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(ACTIVITY_BUS, JSON.stringify({ originId: INSTANCE_ID, payload }))
      .catch(() => { /* best-effort cross-instance fan-out */ });
  }
}

function hasOverwrites(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

async function deliverLocally(payload: ChannelActivityPayload): Promise<void> {
  const connectedUserIds = [...activeActivityConnections.keys()];
  if (connectedUserIds.length === 0 || !payload.serverId) return;
  const memberIds = await getServerMemberIds(payload.serverId);
  let recipients = connectedUserIds.filter(
    (id) => id !== payload.authorId && memberIds.has(id),
  );
  if (recipients.length === 0) return;
  // Channels with permission overwrites, private threads, and public threads in
  // a restricted parent (threads inherit the parent's visibility, which
  // checkChannelAccess resolves): only members who
  // can actually see the channel may learn about its activity (name, author,
  // @everyone pings). Open channels skip this per-recipient check.
  const channel = await Channel.findById(payload.channelId).catch(() => null);
  // Threads: only members hear about activity (Discord). Authors and anyone
  // they @mention join the thread before this runs (channels.ts send route).
  if (channel && (channel.type === 'public_thread' || channel.type === 'private_thread')) {
    const members = new Set(((channel.threadMemberIds || []) as string[]).map((id) => id.toLowerCase()));
    recipients = recipients.filter((id) => members.has(id.toLowerCase()));
    if (recipients.length === 0) return;
  }
  let restricted = !!channel && (channel.type === 'private_thread' || hasOverwrites(channel.permissionOverwrites));
  if (channel && !restricted && channel.type === 'public_thread' && channel.parentId) {
    const parent = await Channel.findById(channel.parentId).catch(() => null);
    restricted = !parent || hasOverwrites(parent.permissionOverwrites);
  }
  if (restricted) {
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const allowed = await Promise.all(
      recipients.map((id) => checkChannelAccess(id, payload.channelId).then((r) => r.hasAccess).catch(() => false)),
    );
    recipients = recipients.filter((_, i) => allowed[i]);
  }
  if (recipients.length > 0) emitLocal(recipients, payload);
}

/**
 * Target for a user-scoped fan-out: either explicit user ids (DMs, the acting
 * user's own devices) or every connected member of a server.
 */
type FanoutTarget = { userIds?: string[]; serverId?: string };

async function deliverUserFanout(target: FanoutTarget, payload: Record<string, unknown>): Promise<void> {
  let recipients: string[];
  if (target.serverId) {
    const memberIds = await getServerMemberIds(target.serverId);
    recipients = [...activeActivityConnections.keys()].filter((id) => memberIds.has(id));
  } else {
    recipients = (target.userIds || []).filter((id) => activeActivityConnections.has(id));
  }
  if (recipients.length > 0) emitToUsers(recipients, payload);
}

/**
 * Deliver a user-scoped event (read receipt / unread reset) to the targeted
 * users' activity streams on every instance. Powers live cross-device read sync
 * and clearing unread when the causing message is deleted.
 */
export async function fanoutToUsers(target: FanoutTarget, payload: Record<string, unknown>): Promise<void> {
  // Every DM message (user sends, bots, system DMs) signals through here:
  // also push it to the recipients' phones when they aren't in the app.
  if (payload.type === 'dm_activity' && target.userIds?.length) {
    const recipients = target.userIds;
    void import('@/lib/services/pushNotifications')
      .then((m) => m.pushDmActivity(recipients, payload as Parameters<typeof m.pushDmActivity>[1]))
      .catch(() => { /* best-effort */ });
  }
  await deliverUserFanout(target, payload);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(USER_FANOUT_BUS, JSON.stringify({ originId: INSTANCE_ID, target, payload }))
      .catch(() => { /* best-effort cross-instance fan-out */ });
  }
}

/** Notify a user's own open sessions that a channel was read (cross-device). */
export function notifyReadState(
  userId: string,
  channelId: string,
  lastReadAt: string,
  lastReadMessageId?: string | null,
): void {
  void fanoutToUsers(
    { userIds: [userId] },
    { type: 'read_state', channelId, lastReadAt, lastReadMessageId: lastReadMessageId ?? null },
  );
}

/**
 * Notify affected users that a channel's unread should be re-evaluated after a
 * deletion. `lastMessageAt` is the timestamp of the newest remaining message
 * (null if the channel is now empty); clients roll their activity marker back to
 * it so a badge left by a since-deleted message clears.
 */
export function notifyUnreadReset(
  target: FanoutTarget,
  channelId: string,
  lastMessageAt: string | null,
  /** The deleted messages, so clients drop exactly their badges. */
  deleted?: Array<{ id: string; at: string | null }>,
): void {
  void fanoutToUsers(target, { type: 'unread_reset', channelId, lastMessageAt, ...(deleted?.length ? { deleted } : {}) });
}

/**
 * An edit removed these users' mention from a message: their badges and
 * Inbox entries for it go.
 */
export function notifyMentionRetract(userIds: string[], channelId: string, messageId: string): void {
  if (userIds.length === 0) return;
  void fanoutToUsers({ userIds }, { type: 'mention_retract', channelId, messageId });
}

/**
 * The user's own message reads the conversation up to it (Discord: sending
 * marks the channel read) — on every device, also when the sending tab isn't
 * focused. Fire-and-forget.
 */
export function ackOwnMessage(userId: string, channelId: string, messageId: string, createdAt: Date | string | null | undefined): void {
  void (async () => {
    const at = createdAt ? new Date(createdAt) : new Date();
    if (Number.isNaN(at.getTime())) return;
    const { ChannelReadState } = await import('@/lib/models/ChannelReadState');
    const row = await ChannelReadState.ack(userId, channelId, messageId, at);
    if (!row) return; // an equal or newer marker already exists
    const lastReadAt = row.lastReadAt instanceof Date ? row.lastReadAt.toISOString() : String(row.lastReadAt ?? at.toISOString());
    notifyReadState(userId, channelId, lastReadAt, row.lastReadMessageId ?? messageId);
  })().catch((err: Error) => console.error('Own-message read ack failed:', err?.message));
}

/**
 * Server-side presence heartbeat: every user with an open activity stream
 * (any tab, on this instance) is "here". Browsers freeze or throttle timers in
 * background tabs, so the client's own 30s heartbeat can stop while the app is
 * still open and connected — that showed people offline. One UPDATE per tick.
 */
const PRESENCE_TOUCH_MS = 30_000;
export function startPresenceKeepalive(): () => void {
  const timer = setInterval(() => {
    const ids = [...activeActivityConnections.keys()];
    if (ids.length === 0) return;
    void db
      .update(schema.users)
      .set({ presenceLastHeartbeatAt: new Date() })
      .where(inArray(schema.users.id, ids))
      .catch((err: Error) => console.error('Presence keepalive failed:', err.message));
  }, PRESENCE_TOUCH_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/** Subscribe this process to the activity + user-fanout buses. */
export async function startActivitySSEBridge(): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('Activity SSE bridge Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('Activity SSE bridge connect failed:', err.message));
  await sub.subscribe(ACTIVITY_BUS, USER_FANOUT_BUS);
  sub.on('message', (channel: string, raw: string) => {
    try {
      if (channel === USER_FANOUT_BUS) {
        const { originId, target, payload } = JSON.parse(raw) as {
          originId: string; target: FanoutTarget; payload: Record<string, unknown>;
        };
        if (originId === INSTANCE_ID) return; // already delivered locally
        void deliverUserFanout(target, payload);
        return;
      }
      const { originId, payload, invalidateMembers } = JSON.parse(raw) as {
        originId: string; payload?: ChannelActivityPayload; invalidateMembers?: string;
      };
      if (originId === INSTANCE_ID) return; // already delivered locally
      if (invalidateMembers) {
        memberCache.delete(invalidateMembers);
        return;
      }
      if (payload) void deliverLocally(payload);
    } catch (err) {
      console.error('Activity SSE bridge: bad payload', err);
    }
  });
  console.log(`✅ Activity SSE bridge subscribed to ${ACTIVITY_BUS}, ${USER_FANOUT_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}
