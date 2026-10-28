/**
 * Name / Discord-account lookups for mentions in a message the outbound bridge
 * relays (SerikaCord -> Discord). The pure formatting is in outboundFormat.ts.
 *
 * A mentioned user becomes a real Discord mention only when the Discord
 * account is theirs, they are in the bridged Discord server, and showing the
 * link can't expose anyone:
 *   - a bridged Discord account (discord_users) that agreed to the bridge
 *   - a SerikaCord account with a linked Discord id whose owner agreed to
 *     their messages going to Discord (dataPrivacy.discordBridgeOutbound);
 *     without that agreement they are named in plain text
 *   - a SerikaCord bot whose application is linked to a Discord bot
 * Everyone else reads as plain `@Name` (server nickname > display name >
 * username). Roles and channels are named only from the same server.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import type { NormalizedBridgeLink } from './bridgeConfig';
import { serikaMentionIds, type OutboundMentionLookup } from './outboundFormat';

const MAX_MEMBER_CHECKS = 10;

interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  discordId: string | null;
  isBot: boolean | null;
  settings: unknown;
}

function consentedOutbound(settings: unknown): boolean {
  const dp = (settings as { dataPrivacy?: { discordBridgeOutbound?: unknown } } | null | undefined)?.dataPrivacy;
  return dp?.discordBridgeOutbound === true;
}

export async function resolveOutboundMentions(opts: {
  texts: ReadonlyArray<string | null | undefined>;
  serverId: string;
  guildId: string;
  links: readonly NormalizedBridgeLink[];
}): Promise<OutboundMentionLookup> {
  const ids = serikaMentionIds(opts.texts);
  const lookup: Required<OutboundMentionLookup> = { users: {}, roles: {}, channels: {} };
  if (ids.userIds.length + ids.roleIds.length + ids.channelIds.length === 0) return lookup;
  const serverId = opts.serverId.toLowerCase();

  try {
    const [users, discordUsers, members, roles, channels] = await Promise.all([
      ids.userIds.length
        ? db.select({
            id: schema.users.id,
            username: schema.users.username,
            displayName: schema.users.displayName,
            discordId: schema.users.discordId,
            isBot: schema.users.isBot,
            settings: schema.users.settings,
          }).from(schema.users).where(inArray(schema.users.id, ids.userIds)) as Promise<UserRow[]>
        : Promise.resolve([] as UserRow[]),
      ids.userIds.length
        ? db.select({
            id: schema.discordUsers.id,
            username: schema.discordUsers.username,
            displayName: schema.discordUsers.displayName,
            discordId: schema.discordUsers.discordId,
            isBot: schema.discordUsers.isBot,
            consentStatus: schema.discordUsers.consentStatus,
          }).from(schema.discordUsers).where(inArray(schema.discordUsers.id, ids.userIds))
        : Promise.resolve([]),
      ids.userIds.length
        ? db.select({ userId: schema.serverMembers.userId, nickname: schema.serverMembers.nickname })
            .from(schema.serverMembers)
            .where(and(eq(schema.serverMembers.serverId, serverId), inArray(schema.serverMembers.userId, ids.userIds)))
        : Promise.resolve([] as Array<{ userId: string; nickname: string | null }>),
      ids.roleIds.length
        ? db.select({ id: schema.roles.id, name: schema.roles.name })
            .from(schema.roles)
            .where(and(eq(schema.roles.serverId, serverId), inArray(schema.roles.id, ids.roleIds)))
        : Promise.resolve([]),
      ids.channelIds.length
        ? db.select({ id: schema.channels.id, name: schema.channels.name })
            .from(schema.channels)
            .where(and(eq(schema.channels.serverId, serverId), inArray(schema.channels.id, ids.channelIds)))
        : Promise.resolve([]),
    ]);

    const nickname = new Map(members.filter((m) => m.nickname).map((m) => [String(m.userId).toLowerCase(), m.nickname as string]));
    // Discord account candidates: serika id -> Discord snowflake (membership checked below).
    const candidates = new Map<string, string>();

    const botIds = users.filter((u) => u.isBot).map((u) => String(u.id).toLowerCase());
    const linkedBots = botIds.length
      ? await import('@/lib/services/applicationDiscordLink').then(({ linkedDiscordBotIds }) => linkedDiscordBotIds(botIds)).catch(() => new Map<string, string>())
      : new Map<string, string>();

    for (const u of users) {
      const id = String(u.id).toLowerCase();
      lookup.users[id] = { name: nickname.get(id) || u.displayName || u.username };
      if (u.isBot) {
        const discordBot = linkedBots.get(id);
        if (discordBot) candidates.set(id, discordBot);
      } else if (u.discordId && consentedOutbound(u.settings)) {
        candidates.set(id, u.discordId);
      }
    }
    for (const d of discordUsers) {
      const id = String(d.id).toLowerCase();
      if (lookup.users[id]) continue;
      // The stored display name carries a "(Discord)" tag; on Discord the mention shows their own name.
      lookup.users[id] = { name: nickname.get(id) || d.username || d.displayName };
      if (d.isBot || d.consentStatus === 'granted') candidates.set(id, d.discordId);
    }

    if (candidates.size > 0) {
      const { isGuildMember } = await import('./rest');
      const checks = [...candidates].slice(0, MAX_MEMBER_CHECKS);
      const results = await Promise.all(checks.map(([, discordId]) => isGuildMember(opts.guildId, discordId).catch(() => null)));
      checks.forEach(([id, discordId], i) => {
        if (results[i] === true) lookup.users[id] = { ...lookup.users[id], discordId };
      });
    }

    for (const r of roles) lookup.roles[String(r.id).toLowerCase()] = r.name;
    const bridged = new Map(opts.links.map((l) => [l.serikaChannelId.toLowerCase(), l.discordChannelId]));
    for (const c of channels) {
      const id = String(c.id).toLowerCase();
      lookup.channels[id] = { name: c.name, discordChannelId: bridged.get(id) ?? null };
    }
  } catch (err) {
    console.error('[Discord Bridge] Mention lookup failed:', (err as Error)?.message ?? err);
  }
  return lookup;
}
