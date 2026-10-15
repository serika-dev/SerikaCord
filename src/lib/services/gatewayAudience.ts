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
  serverSnapshots.delete(sid);
  for (const key of [...permAudiences.keys()]) if (key.startsWith(`${sid}:`)) permAudiences.delete(key);
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
