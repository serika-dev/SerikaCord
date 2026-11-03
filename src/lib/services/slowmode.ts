/**
 * Slowmode (a channel's rateLimitPerUser) for every path that posts into a
 * channel: messages, forum posts, polls, forward notes.
 *
 * The wait is a Redis key per channel + user holding when they last posted,
 * so deleting your last message doesn't reset it. Routes check early
 * (`slowmodeWait`, fails fast) and claim right before storing the message
 * (`claimSlowmode`, atomic), so a send refused later (AutoMod, validation) never
 * costs a slot. The stored time is compared with the channel's current setting,
 * so lowering slowmode applies at once. Members with MANAGE_MESSAGES or
 * MANAGE_CHANNELS in the channel (owner, ADMINISTRATOR) aren't slowed
 * (Discord). Threads use their own rateLimitPerUser, permissions from the parent.
 */
import { getRedis } from '@/lib/db/redis';
import { PERMISSION_BITS } from '@/lib/permissions/bits';

export interface SlowmodeChannel {
  id: string;
  serverId?: string | null;
  type?: string | null;
  parentId?: string | null;
  permissionOverwrites?: unknown;
  rateLimitPerUser?: number | null;
}

type Membership = { roles?: string[] | null } | null | undefined;

const BYPASS = PERMISSION_BITS.MANAGE_MESSAGES | PERMISSION_BITS.MANAGE_CHANNELS;

const keyFor = (channelId: string, userId: string) => `slowmode:${channelId.toLowerCase()}:${userId.toLowerCase()}`;

/** Seconds of slowmode that apply to this user here (0: none or exempt). */
async function slowmodeSeconds(channel: SlowmodeChannel, userId: string, membership: Membership): Promise<number> {
  const seconds = Math.floor(Number(channel.rateLimitPerUser) || 0);
  if (seconds <= 0 || !channel.serverId) return 0;
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = await getMemberChannelPermissions(userId, { ...channel, serverId: channel.serverId }, membership).catch(() => 0n);
  if ((perms & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR || (perms & BYPASS) !== 0n) return 0;
  return seconds;
}

/** Seconds left before `lastPostAt` (ms) allows another post under `seconds` of slowmode. */
export function slowmodeRemaining(lastPostAt: number | null, seconds: number, now = Date.now()): number {
  if (!lastPostAt || seconds <= 0) return 0;
  const left = lastPostAt + seconds * 1000 - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Seconds this user must still wait in `channel` (0 = may post). Doesn't claim. */
export async function slowmodeWait(channel: SlowmodeChannel, userId: string, membership?: Membership): Promise<number> {
  const seconds = await slowmodeSeconds(channel, userId, membership);
  const redis = getRedis();
  if (!seconds || !redis) return 0;
  const last = Number(await redis.get(keyFor(channel.id, userId)).catch(() => null)) || null;
  return slowmodeRemaining(last, seconds);
}

/**
 * Takes this user's slot right before the post is stored. Returns 0 when they
 * may post (the slot is now taken), otherwise the seconds left. Atomic against
 * parallel sends. Without Redis it allows the post (the message limiter still applies).
 */
export async function claimSlowmode(channel: SlowmodeChannel, userId: string, membership?: Membership): Promise<number> {
  const seconds = await slowmodeSeconds(channel, userId, membership);
  const redis = getRedis();
  if (!seconds || !redis) return 0;
  const key = keyFor(channel.id, userId);
  const now = Date.now();
  try {
    if ((await redis.set(key, String(now), 'EX', seconds, 'NX')) === 'OK') return 0;
    const last = Number(await redis.get(key)) || null;
    const left = slowmodeRemaining(last, seconds, now);
    if (left > 0) return left;
    // Slowmode was lowered since: the old slot no longer applies.
    await redis.set(key, String(now), 'EX', seconds);
    return 0;
  } catch {
    return 0; // Redis hiccup: don't block sending
  }
}
