import { db, schema } from '@/lib/db/postgres';
import { and, ne, sql } from 'drizzle-orm';
import { canManageGuild, getGuildInfo, getMemberGuildPermissions, type DiscordGuildInfo } from '@/lib/discord/rest';
import { resolveLinkedDiscord } from './discordConnection';

/**
 * Linking a SerikaCord server to a Discord guild lets the platform bot create
 * webhooks there, mirror its channels/roles/messages and time out members, so
 * the link must be proven: the acting user's linked Discord account has to own
 * the guild or hold Administrator / Manage Server in it, and a guild can be
 * claimed by only one server.
 */

const SNOWFLAKE = /^\d{17,20}$/;

/** Shown when the acting user has no Discord account linked anywhere. */
export const NO_DISCORD_ACCOUNT_ERROR = 'Link your Discord account in Serika Accounts (Settings → Connections) first';

export type GuildLinkCheck = { ok: true; guild: DiscordGuildInfo } | { ok: false; status: number; error: string };

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

/**
 * Another server holding this guild with the bridge switched on. Only servers
 * with the bridge on hold a claim: a stale guild id left behind on a server
 * that turned the bridge off must not lock the guild forever.
 */
export async function findActiveGuildClaim(guildId: string, serverId: string): Promise<{ id: string; name: string; ownerId: string } | null> {
  const claimed = await db
    .select({ id: schema.servers.id, name: schema.servers.name, ownerId: schema.servers.ownerId })
    .from(schema.servers)
    .where(and(
      sql`${schema.servers.settings}->'integrations'->>'discordGuildId' = ${guildId}`,
      sql`coalesce(${schema.servers.settings}->'integrations'->>'discord', 'false') = 'true'`,
      ne(schema.servers.id, serverId),
    ))
    .limit(1);
  return claimed[0] ?? null;
}

/** The 409 for a guild another server already bridges, naming the user's own server when it is theirs. */
export function guildClaimError(claim: { name: string; ownerId: string }, userId: string): string {
  return claim.ownerId === userId
    ? `That Discord server is already bridged to your server "${claim.name}". Turn the Discord bridge off there first.`
    : 'That Discord server is already bridged to another SerikaCord server';
}

/**
 * The acting user's linked Discord account id, or null. Discord is linked in
 * Serika Accounts; resolveLinkedDiscord falls back to asking it when the local
 * connection row is missing, so the bridge setup and the guild check agree.
 */
export async function linkedDiscordAccountId(userId: string, opts: { fresh?: boolean } = {}): Promise<string | null> {
  return (await resolveLinkedDiscord(userId, opts))?.accountId || null;
}

export async function verifyDiscordGuildControl(
  userId: string,
  guildId: string,
  serverId: string,
  opts: { alreadyLinked?: boolean; fresh?: boolean } = {},
): Promise<GuildLinkCheck> {
  if (!isDiscordSnowflake(guildId)) {
    return { ok: false, status: 400, error: 'That is not a valid Discord server ID' };
  }
  if (!process.env.SERIKA_DISCORD_TOKEN) return { ok: false, status: 503, error: 'The Discord bridge is not configured' };

  // One SerikaCord server per Discord guild. A server that already stores this
  // guild (links made before this check existed) keeps syncing; it still has
  // to pass the control check below.
  if (!opts.alreadyLinked) {
    const claim = await findActiveGuildClaim(guildId, serverId);
    if (claim) return { ok: false, status: 409, error: guildClaimError(claim, userId) };
  }

  const discordUserId = await linkedDiscordAccountId(userId, { fresh: opts.fresh });
  if (!discordUserId) {
    return { ok: false, status: 403, error: NO_DISCORD_ACCOUNT_ERROR };
  }

  const guild = await getGuildInfo(guildId, { fresh: opts.fresh });
  if (!guild) {
    return { ok: false, status: 404, error: 'The Serika bot is not in that Discord server. Add the bot first.' };
  }
  const perms = await getMemberGuildPermissions(guild, discordUserId, { fresh: opts.fresh });
  if (perms === null) {
    return { ok: false, status: 403, error: 'Your linked Discord account is not a member of that server' };
  }
  if (canManageGuild(perms)) return { ok: true, guild };
  return { ok: false, status: 403, error: 'You need Manage Server on that Discord server to link it' };
}

/** Server settings as members may see them: no Discord webhook URLs (they carry tokens) or bridge internals. */
export function publicServerSettings<T>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const s = settings as Record<string, unknown>;
  const integrations = s.integrations as Record<string, unknown> | undefined;
  if (!integrations) return settings;
  const hidden = ['discordWebhooks', 'discordChannelsMap', 'discordLinkOptions', 'discordBridgeDefaults', 'discordLinkedBy'];
  if (!hidden.some((k) => k in integrations)) return settings;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(integrations)) if (!hidden.includes(k)) rest[k] = v;
  return {
    ...s,
    integrations: {
      ...rest,
      bridgedChannelIds: Object.keys((integrations.discordWebhooks as Record<string, string> | undefined) ?? {}),
    },
  } as T;
}
