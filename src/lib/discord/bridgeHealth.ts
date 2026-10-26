import { getRedis } from '@/lib/db/redis';
import { BoundedMap } from '@/lib/utils/boundedMap';

/**
 * Per-link bridge health for the settings Status tab: when a message last
 * crossed in each direction, and the last failure (e.g. the Discord webhook was
 * deleted). Kept in Redis (one hash per server, 30-day expiry) so every app
 * instance reports the same thing; the bot runs on the leader instance only.
 *
 * Successful mirrors are throttled to one write per link and direction every
 * 30 seconds; failures are written immediately.
 */

export type BridgeHealthErrorCode =
  | 'webhook_missing'
  | 'missing_permissions'
  | 'rate_limited'
  | 'discord_error';

export interface BridgeLinkHealth {
  lastInboundAt?: string;
  lastOutboundAt?: string;
  error?: { code: BridgeHealthErrorCode; status?: number; at: string };
}

const HEALTH_TTL_SECONDS = 30 * 24 * 60 * 60;
const SUCCESS_THROTTLE_MS = 30_000;
const lastWrite = new BoundedMap<string, number>(5000);

function key(serverId: string): string {
  return `discordbridge:health:${serverId.toLowerCase()}`;
}

async function update(serverId: string, serikaChannelId: string, mutate: (h: BridgeLinkHealth) => BridgeLinkHealth): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const field = serikaChannelId.toLowerCase();
    const raw = await redis.hget(key(serverId), field);
    let current: BridgeLinkHealth = {};
    try { current = raw ? (JSON.parse(raw) as BridgeLinkHealth) : {}; } catch { current = {}; }
    await redis.hset(key(serverId), field, JSON.stringify(mutate(current)));
    await redis.expire(key(serverId), HEALTH_TTL_SECONDS);
  } catch {
    /* health is best-effort */
  }
}

/** A message crossed the bridge on this link. Clears any stored error. */
export function recordBridgeSuccess(serverId: string, serikaChannelId: string, direction: 'inbound' | 'outbound'): void {
  const throttleKey = `${serverId}:${serikaChannelId}:${direction}`.toLowerCase();
  const now = Date.now();
  const prev = lastWrite.get(throttleKey);
  if (prev !== undefined && now - prev < SUCCESS_THROTTLE_MS) return;
  lastWrite.set(throttleKey, now);
  const at = new Date(now).toISOString();
  void update(serverId, serikaChannelId, (h) => ({
    ...h,
    ...(direction === 'inbound' ? { lastInboundAt: at } : { lastOutboundAt: at }),
    error: undefined,
  }));
}

export function recordBridgeError(serverId: string, serikaChannelId: string, code: BridgeHealthErrorCode, status?: number): Promise<void> {
  // The next success must be written even inside the throttle window, to clear this error.
  lastWrite.delete(`${serverId}:${serikaChannelId}:outbound`.toLowerCase());
  lastWrite.delete(`${serverId}:${serikaChannelId}:inbound`.toLowerCase());
  return update(serverId, serikaChannelId, (h) => ({ ...h, error: { code, ...(status ? { status } : {}), at: new Date().toISOString() } }));
}

export async function clearBridgeError(serverId: string, serikaChannelId: string): Promise<void> {
  await update(serverId, serikaChannelId, (h) => ({ ...h, error: undefined }));
}

export async function readBridgeHealth(serverId: string): Promise<Record<string, BridgeLinkHealth>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const all = await redis.hgetall(key(serverId));
    const out: Record<string, BridgeLinkHealth> = {};
    for (const [field, raw] of Object.entries(all)) {
      try { out[field] = JSON.parse(raw) as BridgeLinkHealth; } catch { /* skip */ }
    }
    return out;
  } catch {
    return {};
  }
}

// ── Bot presence ────────────────────────────────────────────────────────────

const BOT_KEY = 'discordbridge:bot';
const BOT_TTL_SECONDS = 150;
// Set alongside the heartbeat with a long TTL: tells "the bot stopped" apart
// from "the running bot is a build that never reports" (e.g. production on an
// older release while canary shows the new Status tab).
const BOT_SEEN_KEY = 'discordbridge:bot:seen';
const BOT_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Called by the bridge bot on READY and every minute while connected. */
export function recordBotHeartbeat(username: string | null): void {
  const redis = getRedis();
  if (!redis) return;
  const value = JSON.stringify({ at: new Date().toISOString(), username });
  void redis.set(BOT_KEY, value, 'EX', BOT_TTL_SECONDS).catch(() => {});
  void redis.set(BOT_SEEN_KEY, value, 'EX', BOT_SEEN_TTL_SECONDS).catch(() => {});
}

/**
 * `online` is null when no bot has ever reported in: the bridge may well be
 * running, just on an instance whose build doesn't send heartbeats yet.
 */
export async function readBotHeartbeat(): Promise<{ online: boolean | null; at: string | null; username: string | null }> {
  const redis = getRedis();
  if (!redis) return { online: null, at: null, username: null };
  try {
    const [raw, seen] = await Promise.all([redis.get(BOT_KEY), redis.get(BOT_SEEN_KEY)]);
    if (!raw) {
      if (!seen) return { online: null, at: null, username: null };
      const last = JSON.parse(seen) as { at?: string; username?: string | null };
      return { online: false, at: last.at ?? null, username: last.username ?? null };
    }
    const parsed = JSON.parse(raw) as { at?: string; username?: string | null };
    return { online: true, at: parsed.at ?? null, username: parsed.username ?? null };
  } catch {
    return { online: null, at: null, username: null };
  }
}

export async function clearBridgeHealth(serverId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(key(serverId)).catch(() => {});
}
