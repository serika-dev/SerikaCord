/**
 * Who may receive a bot gateway event (see `audience` on GatewayDispatch in
 * ./gatewayEvents.ts and the routing rules in src/lib/gateway/routing.ts).
 *
 * - DM / group DM: the bot accounts among the channel's recipients. Humans are
 *   never listed, so an all-human DM is never published on the bot bus.
 * - Guild channel: the bot members of the server that can view the channel,
 *   using the same per-user resolution as the app (listViewableServerChannels:
 *   membership, private threads, rules screening, VIEW_CHANNEL after
 *   overwrites). Computed once per server for all of its bots and cached; a
 *   channel the snapshot doesn't know (created after it) triggers a recompute.
 * - Guild permission audiences (audit log, AutoMod rules): bot members whose
 *   server-wide permissions include a bit (VIEW_AUDIT_LOG, MANAGE_SERVER).
 *
 * Caches are process-wide (processShared, so the Bun and Next module copies
 * share them and invalidation reaches both), expire after AUDIENCE_TTL_MS, and
 * are dropped early by invalidateServerAudience() on membership, role and
 * overwrite changes. Concurrent lookups for one key share one in-flight query.
 *
 * Errors resolve to an empty audience: these events are default-deny.
 */
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import { hasPermission } from '@/lib/permissions/bits';

const AUDIENCE_TTL_MS = 10_000;

interface ServerSnapshot {
  at: number;
  /** Every channel id of the server when the snapshot was taken. */
  channelIds: Set<string>;
  /** Bot id -> channel ids it can view. */
  viewers: Map<string, Set<string>>;
}

const serverSnapshots = processShared('gatewayAudience:servers', () => new BoundedMap<string, ServerSnapshot>(5000));
const permAudiences = processShared('gatewayAudience:perms', () => new BoundedMap<string, { at: number; ids: string[] }>(5000));
const inflight = processShared('gatewayAudience:inflight', () => new Map<string, Promise<unknown>>());

const lower = (id: string) => String(id).toLowerCase();

/** Share one in-flight computation per key. */
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Drop cached audiences of a server (membership, role or overwrite change). */
export function invalidateServerAudience(serverId: string | null | undefined): void {
  if (!serverId) return;
  const sid = lower(serverId);
  const previous = serverSnapshots.get(sid);
  serverSnapshots.delete(sid);
  for (const key of [...permAudiences.keys()]) if (key.startsWith(`${sid}:`)) permAudiences.delete(key);
  if (previous && previous.viewers.size > 0) scheduleThreadListSync(serverId, previous);
}

// ─── THREAD_LIST_SYNC on gaining access ────────────────────
// Discord sends THREAD_LIST_SYNC when a bot gains access to a channel: the
// active threads it can now see there. An invalidation (role, overwrite or
// membership change) keeps the snapshot it dropped; shortly after, the fresh
// snapshot is diffed per bot and each bot that can now view new thread
// parents gets their active threads. Bots without a previous snapshot
// (new to the guild) got GUILD_CREATE instead.
const syncTimers = processShared('gatewayAudience:threadSync', () => new Map<string, { timer: ReturnType<typeof setTimeout>; previous: ServerSnapshot }>());
const THREAD_SYNC_DEBOUNCE_MS = 1_500;

function scheduleThreadListSync(serverId: string, previous: ServerSnapshot): void {
  const sid = lower(serverId);
  const pending = syncTimers.get(sid);
  if (pending) clearTimeout(pending.timer);
  // Keep the oldest "before" across a burst of invalidations.
  const before = pending?.previous ?? previous;
  const timer = setTimeout(() => {
    syncTimers.delete(sid);
    void runThreadListSync(serverId, before).catch(() => {});
  }, THREAD_SYNC_DEBOUNCE_MS);
  (timer as { unref?: () => void }).unref?.();
  syncTimers.set(sid, { timer, previous: before });
}

async function runThreadListSync(serverId: string, previous: ServerSnapshot): Promise<void> {
  const sid = lower(serverId);
  const { Channel } = await import('@/lib/models');
  const channels = await Channel.find({ serverId });
  const threadParents = new Set(['text', 'announcement', 'forum', 'media']);
  const byId = new Map(channels.map((c: { id: string }) => [lower(c.id), c]));
  const snap = await once(`server:${sid}`, async () => {
    const s = await computeServerSnapshot(serverId);
    serverSnapshots.set(sid, s);
    return s;
  });
  const { emitThreadListSync } = await import('./gatewayEvents');
  for (const [botId, visible] of snap.viewers) {
    const before = previous.viewers.get(botId);
    if (!before) continue;
    const gained = [...visible].filter((id) => !before.has(id) && threadParents.has(String((byId.get(id) as { type?: string } | undefined)?.type)));
    if (gained.length === 0) continue;
    const gainedSet = new Set(gained);
    const threads = channels.filter((c: { id: string; parentId?: string | null; type?: string | null; archived?: boolean | null }) =>
      (c.type === 'public_thread' || c.type === 'private_thread') && !c.archived
      && !!c.parentId && gainedSet.has(lower(c.parentId)) && visible.has(lower(c.id)));
    const ids = gained.map((id) => (byId.get(id) as { id: string }).id);
    await emitThreadListSync({ guildId: serverId, botId, channelIds: ids, threads });
  }
}

/** Bot recipients of a DM or group DM ([] when unknown, not a DM, or no bots). */
export async function dmAudience(channelId: string): Promise<string[]> {
  try {
    const { Channel, User } = await import('@/lib/models');
    const channel = await Channel.findById(channelId);
    if (!channel || (channel.type !== 'dm' && channel.type !== 'group_dm')) return [];
    const recipients = ((channel.recipientIds || []) as string[]).map(String);
    if (recipients.length === 0) return [];
    // Both keys are in the User.find whitelist.
    const bots = await User.find({ id: { in: recipients }, isBot: true });
    return bots.filter((u: { isBot?: boolean | null }) => u.isBot === true).map((u: { id: string }) => u.id);
  } catch (err) {
    console.error('gatewayAudience: dm lookup failed', (err as Error)?.message);
    return [];
  }
}

async function computeServerSnapshot(serverId: string): Promise<ServerSnapshot> {
  const { Channel, ServerMember } = await import('@/lib/models');
  const [botIds, channels] = await Promise.all([
    ServerMember.findBotUserIds(serverId),
    Channel.find({ serverId }),
  ]);
  const viewers = new Map<string, Set<string>>();
  if (botIds.length > 0) {
    const { listViewableServerChannels } = await import('@/lib/api/channels');
    await Promise.all(botIds.map(async (botId) => {
      const visible = await listViewableServerChannels(botId, serverId);
      viewers.set(botId, new Set((visible ?? []).map((c) => lower(c.id))));
    }));
  }
  return { at: Date.now(), channelIds: new Set(channels.map((c: { id: string }) => lower(c.id))), viewers };
}

async function serverSnapshot(serverId: string, channelId: string): Promise<ServerSnapshot> {
  const sid = lower(serverId);
  const hit = serverSnapshots.get(sid);
  if (hit && Date.now() - hit.at < AUDIENCE_TTL_MS && hit.channelIds.has(lower(channelId))) return hit;
  return once(`server:${sid}`, async () => {
    const snap = await computeServerSnapshot(serverId);
    serverSnapshots.set(sid, snap);
    return snap;
  });
}

/** Bot user ids in `serverId` that can view `channelId`. */
export async function guildChannelBotAudience(channelId: string, serverId: string): Promise<string[]> {
  try {
    const snap = await serverSnapshot(serverId, channelId);
    const cid = lower(channelId);
    const ids: string[] = [];
    for (const [botId, visible] of snap.viewers) if (visible.has(cid)) ids.push(botId);
    return ids;
  } catch (err) {
    console.error('gatewayAudience: guild lookup failed', (err as Error)?.message);
    return [];
  }
}

/**
 * Which channels each bot member of `serverId` can view right now: bot id ->
 * lower-cased channel ids. Reuses a fresh cached snapshot, otherwise computes
 * one. Callers that compare before/after a mutation (CHANNEL_CREATE/DELETE when
 * overwrites grant or remove view) take one copy before and, after
 * invalidateServerAudience(), one after. Errors give an empty map.
 */
export async function serverChannelViewers(serverId: string): Promise<Map<string, Set<string>>> {
  try {
    const sid = lower(serverId);
    const hit = serverSnapshots.get(sid);
    const snap = hit && Date.now() - hit.at < AUDIENCE_TTL_MS
      ? hit
      : await once(`server:${sid}`, async () => {
        const fresh = await computeServerSnapshot(serverId);
        serverSnapshots.set(sid, fresh);
        return fresh;
      });
    return new Map([...snap.viewers].map(([bot, ids]) => [bot, new Set(ids)]));
  } catch (err) {
    console.error('gatewayAudience: viewer snapshot failed', (err as Error)?.message);
    return new Map();
  }
}

/** Bot members of `serverId` whose server-wide permissions include `bit` (owner and ADMINISTRATOR included). */
export async function guildPermissionBotAudience(serverId: string, bit: bigint): Promise<string[]> {
  const key = `${lower(serverId)}:${bit.toString()}`;
  const hit = permAudiences.get(key);
  if (hit && Date.now() - hit.at < AUDIENCE_TTL_MS) return hit.ids;
  try {
    return await once(`perm:${key}`, async () => {
      const { ServerMember } = await import('@/lib/models');
      const { getMemberChannelPermissions } = await import('@/lib/api/channels');
      const botIds = await ServerMember.findBotUserIds(serverId);
      const checks = await Promise.all(botIds.map(async (botId) => {
        const perms = await getMemberChannelPermissions(botId, { serverId });
        return hasPermission(perms, bit) ? botId : null;
      }));
      const ids = checks.filter((id): id is string => !!id);
      permAudiences.set(key, { at: Date.now(), ids });
      return ids;
    });
  } catch (err) {
    console.error('gatewayAudience: permission lookup failed', (err as Error)?.message);
    return [];
  }
}

/** Audience for an event in `channelId` (guild channel when `serverId` is set, else DM). */
export function channelAudience(channelId: string, serverId: string | null | undefined): Promise<string[]> {
  return serverId ? guildChannelBotAudience(channelId, serverId) : dmAudience(channelId);
}
