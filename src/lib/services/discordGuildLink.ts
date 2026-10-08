import { UserConnection } from '@/lib/models';
import { db, schema } from '@/lib/db/postgres';
import { and, ne, sql } from 'drizzle-orm';

/**
 * Linking a SerikaCord server to a Discord guild lets the platform bot create
 * webhooks there, mirror its channels/roles/messages and time out members, so
 * the link must be proven: the acting user's linked Discord account has to own
 * the guild or hold Administrator / Manage Server in it, and a guild can be
 * claimed by only one server.
 */

const SNOWFLAKE = /^\d{17,20}$/;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export type GuildLinkCheck = { ok: true } | { ok: false; status: number; error: string };

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

async function discordGet<T>(path: string, botToken: string): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) return { status: res.status, data: null };
  return { status: res.status, data: (await res.json()) as T };
}

export async function verifyDiscordGuildControl(
  userId: string,
  guildId: string,
  serverId: string,
): Promise<GuildLinkCheck> {
  if (!isDiscordSnowflake(guildId)) {
    return { ok: false, status: 400, error: 'That is not a valid Discord server ID' };
  }
  const botToken = process.env.SERIKA_DISCORD_TOKEN;
  if (!botToken) return { ok: false, status: 503, error: 'The Discord bridge is not configured' };

  // One SerikaCord server per Discord guild.
  const claimed = await db
    .select({ id: schema.servers.id })
    .from(schema.servers)
    .where(and(
      sql`${schema.servers.settings}->'integrations'->>'discordGuildId' = ${guildId}`,
      ne(schema.servers.id, serverId),
    ))
    .limit(1);
  if (claimed.length > 0) {
    return { ok: false, status: 409, error: 'That Discord server is already linked to another server' };
  }

  const connection = await UserConnection.findOne({ userId, provider: 'discord' });
  const discordUserId = connection?.accountId;
  if (!discordUserId) {
    return { ok: false, status: 403, error: 'Link your Discord account in Connections first' };
  }

  const guild = await discordGet<{ owner_id?: string }>(`/guilds/${guildId}`, botToken);
  if (!guild.data) {
    return { ok: false, status: 404, error: 'The Serika bot is not in that Discord server' };
  }
  if (guild.data.owner_id === discordUserId) return { ok: true };

  const member = await discordGet<{ roles?: string[] }>(`/guilds/${guildId}/members/${discordUserId}`, botToken);
  if (!member.data) {
    return { ok: false, status: 403, error: 'Your Discord account is not a member of that server' };
  }
  const roles = await discordGet<Array<{ id: string; permissions: string }>>(`/guilds/${guildId}/roles`, botToken);
  const memberRoleIds = new Set(member.data.roles ?? []);
  let perms = 0n;
  for (const role of roles.data ?? []) {
    // @everyone's role id is the guild id.
    if (role.id === guildId || memberRoleIds.has(role.id)) perms |= BigInt(role.permissions || '0');
  }
  if ((perms & ADMINISTRATOR) || (perms & MANAGE_GUILD)) return { ok: true };
  return { ok: false, status: 403, error: 'You need Manage Server on that Discord server to link it' };
}

/** Server settings as members may see them: no Discord webhook URLs (they carry tokens). */
export function publicServerSettings<T>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const s = settings as Record<string, unknown>;
  const integrations = s.integrations as Record<string, unknown> | undefined;
  if (!integrations || (!('discordWebhooks' in integrations) && !('discordChannelsMap' in integrations))) return settings;
  const { discordWebhooks, discordChannelsMap: _map, ...rest } = integrations;
  return {
    ...s,
    integrations: {
      ...rest,
      bridgedChannelIds: Object.keys((discordWebhooks as Record<string, string> | undefined) ?? {}),
    },
  } as T;
}
