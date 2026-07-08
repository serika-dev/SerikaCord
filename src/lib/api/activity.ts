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
import { randomUUID } from 'crypto';
import { getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { ServerMember } from '@/lib/models';

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
const INSTANCE_ID = randomUUID();

// userId -> set of raw write callbacks (one per open activity stream / tab).
const activeActivityConnections = new Map<string, Set<(data: string) => void>>();

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

// ── Server-member id cache (bounds DB load under message bursts) ────────────
const MEMBER_CACHE_TTL_MS = 30_000;
const memberCache = new Map<string, { ids: Set<string>; expires: number }>();

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

/** Subscribe this process to the activity bus for cross-instance delivery. */
export async function startActivitySSEBridge(): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('Activity SSE bridge Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('Activity SSE bridge connect failed:', err.message));
  await sub.subscribe(ACTIVITY_BUS);
  sub.on('message', (_ch: string, raw: string) => {
    try {
      const { originId, payload } = JSON.parse(raw) as { originId: string; payload: ChannelActivityPayload };
      if (originId === INSTANCE_ID) return; // already delivered locally
      void deliverLocally(payload);
    } catch (err) {
      console.error('Activity SSE bridge: bad payload', err);
    }
  });
  console.log(`✅ Activity SSE bridge subscribed to ${ACTIVITY_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}
