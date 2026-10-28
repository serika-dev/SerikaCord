/**
 * Background checks that post real YouTube upload / Twitch go-live
 * notifications for servers with the integration on.
 *
 * - YouTube: every 10 minutes, the public feed of each configured channel
 *   (deduplicated across servers, cached 5 minutes).
 * - Twitch: every 2 minutes when Twitch API credentials are set, one Helix
 *   request per 100 channels.
 *
 * One instance at a time runs a pass (Redis lock, canary and prod share
 * Redis). What was already announced is kept per server in Redis; the first
 * look at a channel only records a baseline, so turning an integration on (or
 * deploying this) never posts old uploads or a stream already in progress.
 *
 * Off with INTEGRATION_NOTIFICATIONS_DISABLED=1.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import {
  newYouTubeEntries,
  parseTwitchLogin,
  parseYouTubeChannelInput,
  readIntegrationConfig,
  shouldAnnounceTwitch,
  youTubeRefKey,
  type IntegrationConfig,
  type IntegrationKind,
  type TwitchSeenState,
  type YouTubeSeenState,
} from './notifications';

const YOUTUBE_INTERVAL_MS = 10 * 60_000;
const TWITCH_INTERVAL_MS = 2 * 60_000;
const MAX_SERVERS_PER_PASS = 2000;
const MAX_YOUTUBE_CHANNELS_PER_PASS = 300;
const YOUTUBE_CONCURRENCY = 4;
const STATE_TTL_SECONDS = 60 * 24 * 3600;

const g = globalThis as unknown as {
  __integrationPollerStarted?: boolean;
  __integrationPollerRunning?: Partial<Record<IntegrationKind, boolean>>;
};

interface ServerTarget {
  serverId: string;
  config: IntegrationConfig;
}

function stateKey(serverId: string, kind: IntegrationKind): string {
  return `integrations:seen:${serverId}:${kind}`;
}

async function readState<T>(serverId: string, kind: IntegrationKind): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(stateKey(serverId, kind));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeState(serverId: string, kind: IntegrationKind, state: object): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(stateKey(serverId, kind), JSON.stringify(state), 'EX', STATE_TTL_SECONDS).catch(() => {});
}

async function withLock<T>(kind: IntegrationKind, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  const key = `integrations:poller:lock:${kind}`;
  const token = randomUUID();
  const got = await redis.set(key, token, 'PX', ttlMs, 'NX').catch(() => null);
  if (got !== 'OK') return null;
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, key, token,
    ).catch(() => {});
  }
}

/** Servers with this integration on and a channel + notification channel set. */
async function loadTargets(kind: IntegrationKind): Promise<ServerTarget[]> {
  const rows = await db
    .select({ id: schema.servers.id, settings: schema.servers.settings })
    .from(schema.servers)
    .where(sql`(${schema.servers.settings} -> 'integrations' ->> ${kind}) = 'true'`)
    .limit(MAX_SERVERS_PER_PASS);
  const out: ServerTarget[] = [];
  for (const row of rows) {
    const config = readIntegrationConfig((row.settings as { integrations?: unknown } | null)?.integrations, kind);
    if (!config.enabled || !config.channelInput || !config.notifyChannelId) continue;
    out.push({ serverId: row.id, config });
  }
  return out;
}

async function announce(target: ServerTarget, item: import('./notifications').IntegrationItem): Promise<boolean> {
  const { loadNotificationChannel, postIntegrationNotification } = await import('./post');
  const channel = await loadNotificationChannel(target.serverId, target.config.notifyChannelId);
  if (!channel) return false;
  try {
    await postIntegrationNotification({ channel, item, mention: target.config.mention, template: target.config.template });
    return true;
  } catch (err) {
    console.error(`[integrations] Posting a ${item.kind} notification in server ${target.serverId} failed:`, (err as Error)?.message ?? err);
    return false;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item).catch(() => {});
    }
  });
  await Promise.all(workers);
}

/** One YouTube pass. Exported for manual runs and tests of the wiring. */
export async function youTubePass(): Promise<{ channels: number; posted: number }> {
  const targets = await loadTargets('youtube');
  const byChannel = new Map<string, { input: string; targets: ServerTarget[] }>();
  for (const t of targets) {
    const ref = parseYouTubeChannelInput(t.config.channelInput);
    if (!ref) continue;
    const key = youTubeRefKey(ref);
    const group = byChannel.get(key) ?? { input: t.config.channelInput, targets: [] };
    group.targets.push(t);
    byChannel.set(key, group);
  }
  const { fetchLatestYouTubeItem, youTubeItem } = await import('./sources');
  let posted = 0;
  const groups = [...byChannel.entries()].slice(0, MAX_YOUTUBE_CHANNELS_PER_PASS);
  await mapLimit(groups, YOUTUBE_CONCURRENCY, async ([key, group]) => {
    let result: Awaited<ReturnType<typeof fetchLatestYouTubeItem>>;
    try {
      result = await fetchLatestYouTubeItem(group.input);
    } catch {
      return; // channel gone / YouTube unreachable: try again next pass
    }
    const latest = result.feed.entries[0];
    for (const target of group.targets) {
      const state = await readState<YouTubeSeenState>(target.serverId, 'youtube');
      const fresh = newYouTubeEntries(result.feed.entries, state, key);
      for (const entry of fresh) {
        if (await announce(target, youTubeItem(entry, result.feed, result.channel))) posted++;
      }
      if (!state || state.channel !== key || state.lastVideoId !== latest.videoId) {
        await writeState(target.serverId, 'youtube', {
          channel: key,
          lastVideoId: latest.videoId,
          lastPublishedAt: latest.publishedAt,
        } satisfies YouTubeSeenState);
      }
    }
  });
  return { channels: groups.length, posted };
}

/** One Twitch pass (needs Twitch API credentials). */
export async function twitchPass(): Promise<{ channels: number; posted: number }> {
  const { fetchTwitchStreams, fetchTwitchUsers, twitchApiConfigured, twitchLiveItem } = await import('./sources');
  if (!twitchApiConfigured()) return { channels: 0, posted: 0 };
  const targets = await loadTargets('twitch');
  const byLogin = new Map<string, ServerTarget[]>();
  for (const t of targets) {
    const login = parseTwitchLogin(t.config.channelInput);
    if (!login) continue;
    byLogin.set(login, [...(byLogin.get(login) ?? []), t]);
  }
  if (byLogin.size === 0) return { channels: 0, posted: 0 };
  const logins = [...byLogin.keys()];
  const streams = await fetchTwitchStreams(logins);
  const liveLogins = [...streams.keys()];
  const users = liveLogins.length ? await fetchTwitchUsers(liveLogins).catch(() => new Map()) : new Map();
  let posted = 0;
  const now = Date.now();
  for (const [login, group] of byLogin) {
    const stream = streams.get(login);
    for (const target of group) {
      const state = await readState<TwitchSeenState>(target.serverId, 'twitch');
      if (!stream) {
        // Offline: only record a baseline for a channel we haven't seen.
        if (!state || state.channel !== login) {
          await writeState(target.serverId, 'twitch', { channel: login, lastStreamId: null, notifiedAt: null } satisfies TwitchSeenState);
        }
        continue;
      }
      const announceIt = shouldAnnounceTwitch(stream.id, state, login, now);
      let notifiedAt = state?.channel === login ? state.notifiedAt : null;
      if (announceIt && (await announce(target, twitchLiveItem(stream, users.get(login))))) {
        posted++;
        notifiedAt = new Date(now).toISOString();
      }
      if (!state || state.channel !== login || state.lastStreamId !== stream.id || notifiedAt !== state.notifiedAt) {
        await writeState(target.serverId, 'twitch', { channel: login, lastStreamId: stream.id, notifiedAt } satisfies TwitchSeenState);
      }
    }
  }
  return { channels: logins.length, posted };
}

async function tick(kind: IntegrationKind, intervalMs: number): Promise<void> {
  const running = (g.__integrationPollerRunning ??= {});
  if (running[kind]) return;
  running[kind] = true;
  try {
    const result = await withLock(kind, Math.max(60_000, intervalMs - 10_000), () => (kind === 'youtube' ? youTubePass() : twitchPass()));
    if (result && result.posted > 0) console.log(`[integrations] ${kind}: checked ${result.channels} channel(s), posted ${result.posted} notification(s).`);
  } catch (err) {
    console.error(`[integrations] ${kind} check failed:`, (err as Error)?.message ?? err);
  } finally {
    running[kind] = false;
  }
}

/** Called once from server.ts. */
export function startIntegrationPoller(env: Record<string, string | undefined> = process.env): void {
  if (g.__integrationPollerStarted) return;
  g.__integrationPollerStarted = true;
  const off = env.INTEGRATION_NOTIFICATIONS_DISABLED;
  if (off === '1' || off === 'true') {
    console.log('[integrations] YouTube / Twitch notifications are off (INTEGRATION_NOTIFICATIONS_DISABLED is set).');
    return;
  }
  const schedule = (kind: IntegrationKind, intervalMs: number, firstDelayMs: number) => {
    const first = setTimeout(() => {
      void tick(kind, intervalMs);
      const timer = setInterval(() => { void tick(kind, intervalMs); }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    }, firstDelayMs);
    (first as { unref?: () => void }).unref?.();
  };
  // Start a little after boot so deploys stay light.
  schedule('youtube', YOUTUBE_INTERVAL_MS, 2 * 60_000 + Math.floor(Math.random() * 60_000));
  schedule('twitch', TWITCH_INTERVAL_MS, 90_000 + Math.floor(Math.random() * 30_000));
}
