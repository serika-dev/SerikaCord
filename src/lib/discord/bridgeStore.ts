import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { webhookIdFromUrl } from './rest';
import { normalizeBridge, pickGuildOwner, resolveLinkOptions, withoutBridgeKeys, type BridgeLinkOptions, type NormalizedBridge } from './bridgeConfig';

/**
 * Reads and writes of the bridge config in `servers.settings.integrations`.
 *
 * Writes merge only the bridge's own keys into `integrations` in one UPDATE,
 * so they never clobber a concurrent settings save of unrelated fields.
 */

export type IntegrationsPatch = Record<string, unknown>;

/**
 * Merge `set` into `integrations` (after removing `remove`). With
 * `expectGuildId`, the write only happens while the row still links that guild
 * (null = no guild): a slow operation (webhook creation) never writes a channel
 * map over a concurrent unlink or guild switch. Returns false when nothing was
 * written.
 */
export async function patchIntegrations(
  serverId: string,
  set: IntegrationsPatch,
  remove: readonly string[] = [],
  opts: { expectGuildId?: string | null } = {},
): Promise<boolean> {
  let next = sql`coalesce(${schema.servers.settings}->'integrations', '{}'::jsonb)`;
  for (const k of remove) next = sql`(${next} - ${k}::text)`;
  next = sql`(${next} || ${JSON.stringify(set)}::jsonb)`;
  const guildCheck = opts.expectGuildId === undefined
    ? undefined
    : opts.expectGuildId === null
      ? sql`coalesce(${schema.servers.settings}->'integrations'->>'discordGuildId', '') = ''`
      : sql`${schema.servers.settings}->'integrations'->>'discordGuildId' = ${opts.expectGuildId}`;
  const rows = await db
    .update(schema.servers)
    .set({ settings: sql`jsonb_set(coalesce(${schema.servers.settings}, '{}'::jsonb), '{integrations}', ${next}, true)`, updatedAt: new Date() })
    .where(guildCheck ? and(eq(schema.servers.id, normalizeId(serverId)), guildCheck) : eq(schema.servers.id, normalizeId(serverId)))
    .returning({ id: schema.servers.id });
  await cache.del(`server:${serverId}`);
  invalidateGuildBridgeCache();
  return rows.length > 0;
}

/**
 * SQL value for `servers.settings` that writes `next` but keeps the bridge
 * keys of `integrations` exactly as they are in the row at write time. General
 * settings saves use it so they can neither change the bridge nor restore
 * stale bridge state read before a concurrent link/unlink.
 */
export function settingsKeepingBridge(next: unknown): SQL {
  const base = next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
  const integrations = withoutBridgeKeys(base.integrations);
  base.integrations = integrations;
  const live = sql`coalesce((
    select jsonb_object_agg(e.key, e.value)
    from jsonb_each(case when jsonb_typeof(${schema.servers.settings}->'integrations') = 'object' then ${schema.servers.settings}->'integrations' else '{}'::jsonb end) as e(key, value)
    where e.key like 'discord%'
  ), '{}'::jsonb)`;
  return sql`jsonb_set(${JSON.stringify(base)}::jsonb, '{integrations}', ${JSON.stringify(integrations)}::jsonb || ${live}, true)`;
}

/** Every bridge key, for a full unlink. */
export const BRIDGE_LINK_KEYS = [
  'discordGuildId',
  'discordWebhooks',
  'discordChannelsMap',
  'discordLinkOptions',
  'discordLinkedAt',
  'discordLinkedBy',
  'discordGuildName',
  'discordGuildIcon',
] as const;

// ── Inbound resolution (bridge bot) ─────────────────────────────────────────

export interface ResolvedGuildBridge {
  server: typeof schema.servers.$inferSelect;
  bridge: NormalizedBridge;
  /** Discord channel id -> SerikaCord channel id + resolved options. */
  byDiscordChannel: Map<string, { serikaChannelId: string; options: BridgeLinkOptions }>;
}

const GUILD_TTL_MS = 10_000;
const guildCache = new BoundedMap<string, { at: number; value: ResolvedGuildBridge | null }>(1000);

export function invalidateGuildBridgeCache(guildId?: string): void {
  if (guildId) guildCache.delete(guildId);
  else guildCache.clear();
}

/** Servers storing this guild with the bridge switched on. */
async function serversWithActiveGuild(guildId: string) {
  return db
    .select()
    .from(schema.servers)
    .where(and(
      sql`${schema.servers.settings}->'integrations'->>'discordGuildId' = ${guildId}`,
      sql`coalesce(${schema.servers.settings}->'integrations'->>'discord', 'false') = 'true'`,
    ));
}

/**
 * The one SerikaCord server that mirrors this guild (see pickGuildOwner), with
 * its links. Cached for 10 seconds per guild: settings changes reach the bot
 * within that window, even when they were saved on another app instance.
 */
export async function resolveGuildBridge(guildId: string): Promise<ResolvedGuildBridge | null> {
  const hit = guildCache.get(guildId);
  if (hit && Date.now() - hit.at < GUILD_TTL_MS) return hit.value;

  const rows = await serversWithActiveGuild(guildId);
  const ownerId = pickGuildOwner(rows.map((r) => ({
    id: r.id,
    linkedAt: normalizeBridge((r.settings as { integrations?: unknown } | null)?.integrations).linkedAt,
    createdAt: r.createdAt,
  })));
  const server = rows.find((r) => r.id === ownerId) ?? null;
  let value: ResolvedGuildBridge | null = null;
  if (server) {
    const bridge = normalizeBridge((server.settings as { integrations?: unknown } | null)?.integrations);
    const byDiscordChannel = new Map<string, { serikaChannelId: string; options: BridgeLinkOptions }>();
    for (const link of bridge.links) {
      byDiscordChannel.set(link.discordChannelId, { serikaChannelId: link.serikaChannelId, options: resolveLinkOptions(bridge.defaults, link.overrides) });
    }
    value = { server, bridge, byDiscordChannel };
  }
  guildCache.set(guildId, { at: Date.now(), value });
  return value;
}

/** Every server with the bridge on and a guild set (consent restriction sweeps). */
export async function listActiveBridges(): Promise<Array<{ serverId: string; guildId: string; restrictUnconsented: boolean }>> {
  const rows = await db
    .select({ id: schema.servers.id, settings: schema.servers.settings, createdAt: schema.servers.createdAt })
    .from(schema.servers)
    .where(and(
      sql`coalesce(${schema.servers.settings}->'integrations'->>'discord', 'false') = 'true'`,
      sql`coalesce(${schema.servers.settings}->'integrations'->>'discordGuildId', '') <> ''`,
    ));
  // One owner per guild, like inbound mirroring.
  const byGuild = new Map<string, Array<{ id: string; linkedAt: string | null; createdAt: Date | null; restrict: boolean }>>();
  for (const r of rows) {
    const b = normalizeBridge((r.settings as { integrations?: unknown } | null)?.integrations);
    if (!b.guildId) continue;
    byGuild.set(b.guildId, [...(byGuild.get(b.guildId) ?? []), { id: r.id, linkedAt: b.linkedAt, createdAt: r.createdAt, restrict: b.restrictUnconsented }]);
  }
  const out: Array<{ serverId: string; guildId: string; restrictUnconsented: boolean }> = [];
  for (const [guildId, candidates] of byGuild) {
    const ownerId = pickGuildOwner(candidates);
    const owner = candidates.find((c) => c.id === ownerId);
    if (owner) out.push({ serverId: owner.id, guildId, restrictUnconsented: owner.restrict });
  }
  return out;
}

/**
 * Webhook ids used by other servers' active links of this guild. The bridge
 * reuses one "SerikaBridge" webhook per Discord channel, so an unlink must not
 * delete one another server still posts through.
 */
export async function webhookIdsInUseElsewhere(guildId: string, serverId: string): Promise<Set<string>> {
  const rows = await serversWithActiveGuild(guildId);
  const { decryptField } = await import('@/lib/security/fieldEncryption');
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.id.toLowerCase() === serverId.toLowerCase()) continue;
    for (const link of normalizeBridge((row.settings as { integrations?: unknown } | null)?.integrations).links) {
      if (!link.webhook) continue;
      const url = await decryptField(link.webhook).catch(() => null);
      const id = typeof url === 'string' ? webhookIdFromUrl(url) : null;
      if (id) ids.add(id);
    }
  }
  return ids;
}
