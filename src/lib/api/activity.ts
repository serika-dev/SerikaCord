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
import { ServerMember } from '@/lib/models';
import { BoundedMap } from '@/lib/utils/boundedMap';

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
  createdAt: string; // ISO
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

function emitLocal(userIds: string[], payload: ChannelActivityPayload) {
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

/** Invalidate the member cache for a server (call on join/leave/kick/ban). */
export function invalidateServerMemberCache(serverId: string): void {
  memberCache.delete(serverId);
}

/**
 * Deliver a channel-activity signal to every connected member of the server
 * (this instance), then fan out over Redis so other instances do the same.
 */
export async function notifyChannelActivity(payload: ChannelActivityPayload): Promise<void> {
  await deliverLocally(payload);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(ACTIVITY_BUS, JSON.stringify({ originId: INSTANCE_ID, payload }))
      .catch(() => { /* best-effort cross-instance fan-out */ });
  }
}

async function deliverLocally(payload: ChannelActivityPayload): Promise<void> {
  const connectedUserIds = [...activeActivityConnections.keys()];
  if (connectedUserIds.length === 0 || !payload.serverId) return;
  const memberIds = await getServerMemberIds(payload.serverId);
  const recipients = connectedUserIds.filter(
    (id) => id !== payload.authorId && memberIds.has(id),
  );
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
  await deliverUserFanout(target, payload);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(USER_FANOUT_BUS, JSON.stringify({ originId: INSTANCE_ID, target, payload }))
      .catch(() => { /* best-effort cross-instance fan-out */ });
  }
}

/** Notify a user's own open sessions that a channel was read (cross-device). */
export function notifyReadState(userId: string, channelId: string, lastReadAt: string): void {
  void fanoutToUsers({ userIds: [userId] }, { type: 'read_state', channelId, lastReadAt });
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
): void {
  void fanoutToUsers(target, { type: 'unread_reset', channelId, lastMessageAt });
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
      const { originId, payload } = JSON.parse(raw) as { originId: string; payload: ChannelActivityPayload };
      if (originId === INSTANCE_ID) return; // already delivered locally
      void deliverLocally(payload);
    } catch (err) {
      console.error('Activity SSE bridge: bad payload', err);
    }
  });
  console.log(`✅ Activity SSE bridge subscribed to ${ACTIVITY_BUS}, ${USER_FANOUT_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}
