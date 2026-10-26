import { Elysia, t } from 'elysia';
import { Channel, Server, type IServer } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, isValidObjectId, rejectInvalidObjectIdParams } from '@/lib/security';
import { hasServerPermission } from '@/lib/permissions/serverPermissions';
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { normalizeChannelName } from '@/lib/servers/channelRules';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent } from '@/lib/audit/auditLog';
import * as guildEvents from '@/lib/services/guildGatewayEvents';
import { findActiveGuildClaim, guildClaimError, linkedDiscordAccountId, verifyDiscordGuildControl } from '@/lib/services/discordGuildLink';
import {
  BUILTIN_LINK_OPTIONS,
  autoMatchByName,
  bridgeInviteUrl,
  compactOverrides,
  isSnowflake,
  normalizeBridge,
  pickGuildOwner,
  resolveLinkOptions,
  sanitizeBridgeDefaults,
  sanitizeLinkOptions,
  serializeLinks,
  upsertLink,
  type NormalizedBridge,
  type NormalizedBridgeLink,
} from '@/lib/discord/bridgeConfig';
import {
  BRIDGE_BOT_ID,
  bridgeBotToken,
  ensureBridgeWebhook,
  getGuildChannels,
  guildIconUrl,
  invalidateGuildChannels,
  isBridgeableKind,
  listManageableGuilds,
  webhookExists,
  webhookIdFromUrl,
  type DiscordChannelInfo,
  type WebhookError,
} from '@/lib/discord/rest';
import { BRIDGE_LINK_KEYS, patchIntegrations, resolveGuildBridge, webhookIdsInUseElsewhere } from '@/lib/discord/bridgeStore';
import { checkDiscordBridgeHeavyLimit } from '@/lib/discord/bridgeLimits';
import { clearBridgeError, clearBridgeHealth, readBotHeartbeat, readBridgeHealth, recordBridgeError, recordBridgeSuccess } from '@/lib/discord/bridgeHealth';
import { db, schema } from '@/lib/db/postgres';
import { and, sql } from 'drizzle-orm';

/**
 * Discord bridge settings (Server Settings -> Integrations -> Discord bridge):
 * the guided guild link, the channel mapping editor, per-link options and
 * health. Every route needs Manage Server on the SerikaCord server; routes that
 * change what the bot does in the guild also re-check that the acting user's
 * linked Discord account controls it. Discord webhook URLs never leave the
 * server (only `hasWebhook`).
 */

type Ctx = { headers: Record<string, string | undefined>; cookie: Record<string, { value?: unknown }>; set: { status?: number | string } };

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authToken = cookie.auth_token?.value;
  return authenticateRequest(headers.authorization ?? null, typeof authToken === 'string' ? { auth_token: authToken } : {});
}

type Access = { ok: true; userId: string; server: IServer } | { ok: false; body: { error: string } };

async function managerAccess(ctx: Ctx, serverId: string, opts: { write?: boolean } = {}): Promise<Access> {
  const { user, error } = await getAuth(ctx.headers, ctx.cookie);
  if (!user) {
    ctx.set.status = 401;
    return { ok: false, body: { error: error || 'Unauthorized' } };
  }
  if (!isValidObjectId(serverId)) {
    ctx.set.status = 400;
    return { ok: false, body: { error: 'Invalid server ID' } };
  }
  const server = await Server.findById(serverId);
  if (!server) {
    ctx.set.status = 404;
    return { ok: false, body: { error: 'Server not found' } };
  }
  if (!(await hasServerPermission(server, user.id, PERMISSION_BITS.MANAGE_SERVER))) {
    ctx.set.status = 403;
    return { ok: false, body: { error: 'You need Manage Server to change the Discord bridge' } };
  }
  if (opts.write) {
    const limit = await checkRateLimit('discordBridge', user.id);
    if (!limit.success) {
      ctx.set.status = 429;
      return { ok: false, body: { error: `Slow down a little. Try again in ${limit.retryAfter ?? 1}s.` } };
    }
  }
  return { ok: true, userId: user.id, server };
}

function bridgeOf(server: IServer): NormalizedBridge {
  return normalizeBridge((server.settings as { integrations?: unknown } | null)?.integrations);
}

const WEBHOOK_ERRORS: Record<WebhookError, string> = {
  missing_permissions: 'The Serika bot needs the Manage Webhooks permission in that Discord channel',
  unknown_channel: 'That Discord channel no longer exists',
  too_many_webhooks: 'That Discord channel already has the maximum number of webhooks. Delete one in Discord and try again.',
  rate_limited: 'Discord is rate limiting the bot. Try again in a minute.',
  unavailable: 'Discord did not answer. Try again in a moment.',
};

async function sealWebhook(url: string): Promise<string> {
  const { encryptField } = await import('@/lib/security/fieldEncryption');
  return encryptField(url);
}

const LINK_CHANGED = 'The Discord link changed while this was running. Reload and try again.';

/**
 * Write the channel map, but only while the server still links the guild the
 * links were built for (a concurrent unlink or switch wins). 409 otherwise.
 */
async function saveLinks(ctx: Ctx, serverId: string, guildId: string | null, links: readonly NormalizedBridgeLink[]): Promise<{ error: string } | null> {
  if (await patchIntegrations(serverId, serializeLinks(links), [], { expectGuildId: guildId })) return null;
  ctx.set.status = 409;
  return { error: LINK_CHANGED };
}

async function heavyLimit(ctx: Ctx, userId: string, serverId: string): Promise<{ error: string } | null> {
  const error = await checkDiscordBridgeHeavyLimit(userId, serverId);
  if (!error) return null;
  ctx.set.status = 429;
  return { error };
}

type SerikaChannelRow = { id: string; name: string; type: string; parentId: string | null; position: number | null };

async function serikaChannelsOf(serverId: string): Promise<SerikaChannelRow[]> {
  const rows = await Channel.find({ serverId });
  return rows.map((c) => ({ id: String(c.id).toLowerCase(), name: c.name, type: c.type, parentId: c.parentId ? String(c.parentId).toLowerCase() : null, position: c.position ?? 0 }));
}

const SERIKA_BRIDGEABLE = new Set(['text', 'announcement']);

/**
 * Re-check that the acting user still controls the linked guild before the bot
 * acts there on their behalf (webhooks, channel reads). Cached per user+guild
 * for a minute in rest.ts, so a burst of row edits costs one Discord check.
 */
async function requireGuildControl(ctx: Ctx, userId: string, server: IServer, bridge: NormalizedBridge): Promise<{ error: string } | null> {
  if (!bridge.guildId) {
    ctx.set.status = 409;
    return { error: 'Link a Discord server first' };
  }
  const check = await verifyDiscordGuildControl(userId, bridge.guildId, server.id, { alreadyLinked: true });
  if (!check.ok) {
    ctx.set.status = check.status;
    return { error: check.error };
  }
  return null;
}

async function loadGuildChannels(ctx: Ctx, guildId: string, fresh = false): Promise<DiscordChannelInfo[] | { error: string }> {
  const channels = await getGuildChannels(guildId, { fresh });
  if (!channels) {
    ctx.set.status = 502;
    return { error: 'Could not read the Discord server\'s channels. Check that the Serika bot is still in it and can view channels.' };
  }
  return channels;
}

/** Parent for a new SerikaCord channel: the category its Discord category is linked to, else one with the same name. */
function parentForNewChannel(dc: DiscordChannelInfo, discordChannels: DiscordChannelInfo[], serikaChannels: SerikaChannelRow[], links: readonly NormalizedBridgeLink[]): string | null {
  if (!dc.parentId) return null;
  const linked = links.find((l) => l.discordChannelId === dc.parentId);
  if (linked && serikaChannels.some((c) => c.id === linked.serikaChannelId && c.type === 'category')) return linked.serikaChannelId;
  const discordCategory = discordChannels.find((c) => c.id === dc.parentId);
  if (!discordCategory) return null;
  const name = discordCategory.name.toLowerCase();
  return serikaChannels.find((c) => c.type === 'category' && c.name.toLowerCase() === name)?.id ?? null;
}

async function createSerikaChannelFor(
  server: IServer,
  userId: string,
  dc: DiscordChannelInfo,
  parentId: string | null,
  name?: string,
): Promise<SerikaChannelRow> {
  const siblings = (await Channel.find({ serverId: server.id })).filter((c) => (c.parentId ? String(c.parentId).toLowerCase() : null) === parentId);
  const position = siblings.reduce((max, c) => Math.max(max, (c.position ?? 0) + 1), 0);
  const channelName = normalizeChannelName(name || dc.name) || 'discord';
  const channel = await Channel.create({
    serverId: server.id,
    name: channelName,
    type: dc.kind === 'announcement' ? 'announcement' : 'text',
    topic: dc.topic ? dc.topic.slice(0, 1024) : null,
    position,
    parentId,
    nsfw: dc.nsfw,
    permissionOverwrites: [],
  });
  audit({
    serverId: server.id,
    userId,
    actionType: AuditLogEvent.CHANNEL_CREATE,
    targetId: channel.id,
    changes: [{ key: 'name', new: channel.name }, { key: 'type', new: channel.type }],
    options: { channel_name: channel.name, channel_type: channel.type },
    reason: 'Discord bridge',
  });
  void guildEvents.emitChannelCreate(channel);
  return { id: String(channel.id).toLowerCase(), name: channel.name, type: channel.type, parentId, position };
}

/**
 * The sealed webhook for a Discord channel (made or reused). Done before any
 * SerikaCord channel is created, so a failure never leaves an orphan channel.
 */
async function prepareWebhook(discordChannelId: string): Promise<{ ok: true; sealed: string } | { ok: false; error: string }> {
  const hook = await ensureBridgeWebhook(discordChannelId);
  if (!hook.ok) return { ok: false, error: WEBHOOK_ERRORS[hook.error] };
  return { ok: true, sealed: await sealWebhook(hook.url) };
}

async function bridgeState(server: IServer, userId: string) {
  const bridge = bridgeOf(server);
  const configured = Boolean(bridgeBotToken());
  const [bot, discordAccountId, health, serikaChannels] = await Promise.all([
    readBotHeartbeat(),
    linkedDiscordAccountId(userId),
    readBridgeHealth(server.id),
    serikaChannelsOf(server.id),
  ]);
  const { UserConnection } = await import('@/lib/models');
  const connection = discordAccountId ? await UserConnection.findOne({ userId, provider: 'discord' }) : null;

  // Another server that stores the same guild with the bridge on and wins the
  // mirror (links made before one-server-per-guild): this one is inactive.
  let conflict: { serverName: string | null } | null = null;
  if (bridge.guildId && bridge.enabled) {
    const rows = await db
      .select({ id: schema.servers.id, name: schema.servers.name, ownerId: schema.servers.ownerId, settings: schema.servers.settings, createdAt: schema.servers.createdAt })
      .from(schema.servers)
      .where(and(
        sql`${schema.servers.settings}->'integrations'->>'discordGuildId' = ${bridge.guildId}`,
        sql`coalesce(${schema.servers.settings}->'integrations'->>'discord', 'false') = 'true'`,
      ));
    const owner = pickGuildOwner(rows.map((r) => ({ id: r.id, linkedAt: normalizeBridge((r.settings as { integrations?: unknown } | null)?.integrations).linkedAt, createdAt: r.createdAt })));
    if (owner && owner !== server.id) {
      const other = rows.find((r) => r.id === owner);
      conflict = { serverName: other && other.ownerId === userId ? other.name : null };
    }
  }

  const channelById = new Map(serikaChannels.map((c) => [c.id, c]));
  return {
    configured,
    bot: { online: bot.online, lastSeenAt: bot.at, username: bot.username, id: BRIDGE_BOT_ID, inviteUrl: bridgeInviteUrl(BRIDGE_BOT_ID, bridge.guildId) },
    account: { connected: Boolean(discordAccountId), username: connection?.username || connection?.displayName || null },
    enabled: bridge.enabled,
    restrictUnconsented: bridge.restrictUnconsented,
    guild: bridge.guildId
      ? { id: bridge.guildId, name: bridge.guildName, icon: guildIconUrl(bridge.guildId, bridge.guildIcon) }
      : null,
    linkedAt: bridge.linkedAt,
    conflict,
    defaults: { ...BUILTIN_LINK_OPTIONS, ...bridge.defaults, paused: false },
    links: bridge.links
      .filter((l) => SERIKA_BRIDGEABLE.has(channelById.get(l.serikaChannelId)?.type ?? ''))
      .map((l) => ({
        discordChannelId: l.discordChannelId,
        serikaChannelId: l.serikaChannelId,
        hasWebhook: Boolean(l.webhook),
        overrides: l.overrides,
        options: resolveLinkOptions(bridge.defaults, l.overrides),
        health: health[l.serikaChannelId] ?? null,
      })),
    serikaChannels: serikaChannels
      .filter((c) => c.type === 'category' || SERIKA_BRIDGEABLE.has(c.type))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  };
}

const optionsSchema = t.Object({
  direction: t.Optional(t.Union([t.Literal('both'), t.Literal('to_serika'), t.Literal('to_discord')])),
  mirrorEdits: t.Optional(t.Boolean()),
  mirrorDeletes: t.Optional(t.Boolean()),
  attachments: t.Optional(t.Boolean()),
  showIdentity: t.Optional(t.Boolean()),
  includeBots: t.Optional(t.Boolean()),
  prefix: t.Optional(t.String({ maxLength: 200 })),
  suffix: t.Optional(t.String({ maxLength: 200 })),
  paused: t.Optional(t.Boolean()),
});

const serverParams = t.Object({ serverId: t.String() });
const linkParams = t.Object({ serverId: t.String(), discordChannelId: t.String() });

function badDiscordChannelId(ctx: Ctx, id: string): { error: string } | null {
  if (isSnowflake(id)) return null;
  ctx.set.status = 400;
  return { error: 'Invalid Discord channel ID' };
}

export const discordBridgeRoutes = new Elysia({ prefix: '/servers' })
  .onBeforeHandle(rejectInvalidObjectIdParams)

  // Everything the panel shows: link, bot, account, defaults, links + health.
  .get('/:serverId/discord-bridge', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId);
    if (!access.ok) return access.body;
    return bridgeState(access.server, access.userId);
  }, { params: serverParams })

  // Discord servers the bot is in that the user's linked Discord account can manage.
  .get('/:serverId/discord-bridge/guilds', async ({ headers, cookie, params, query, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    if (!bridgeBotToken()) {
      set.status = 503;
      return { error: 'The Discord bridge is not configured' };
    }
    const discordUserId = await linkedDiscordAccountId(access.userId);
    if (!discordUserId) {
      set.status = 403;
      return { error: 'Link your Discord account in Connections first', code: 'no_account' };
    }
    // Up to 200 member lookups on a cache miss.
    const limited = await heavyLimit(ctx, access.userId, access.server.id);
    if (limited) return limited;
    const guilds = await listManageableGuilds(discordUserId, { fresh: query.fresh === '1' });
    // Which of these are already bridged elsewhere (shown, but not pickable).
    const claims = await Promise.all(guilds.map((g) => findActiveGuildClaim(g.id, access.server.id)));
    return {
      guilds: guilds.map((g, i) => ({
        id: g.id,
        name: g.name,
        icon: guildIconUrl(g.id, g.icon),
        memberCount: g.memberCount,
        claimedBy: claims[i] ? (claims[i]!.ownerId === access.userId ? { yours: true, name: claims[i]!.name } : { yours: false, name: null }) : null,
      })),
    };
  }, { params: serverParams, query: t.Object({ fresh: t.Optional(t.String()) }) })

  // Link (or switch) the Discord server. Re-verifies control with fresh Discord data.
  .post('/:serverId/discord-bridge/link', async ({ headers, cookie, params, body, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const guildId = body.guildId.trim();
    const check = await verifyDiscordGuildControl(access.userId, guildId, access.server.id, { fresh: true });
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    const bridge = bridgeOf(access.server);
    const switching = bridge.guildId !== guildId;
    const saved = await patchIntegrations(
      access.server.id,
      {
        discord: true,
        discordGuildId: guildId,
        discordLinkedAt: new Date().toISOString(),
        discordLinkedBy: access.userId,
        discordGuildName: check.guild.name.slice(0, 100),
        discordGuildIcon: check.guild.icon,
      },
      // A different guild invalidates the old webhooks, channel map and link options.
      switching ? ['discordWebhooks', 'discordChannelsMap', 'discordLinkOptions'] : [],
      // Only over the link this request saw (a concurrent link/unlink wins).
      { expectGuildId: bridge.guildId },
    );
    if (!saved) {
      set.status = 409;
      return { error: LINK_CHANGED };
    }
    if (switching) await clearBridgeHealth(access.server.id);
    audit({
      serverId: access.server.id,
      userId: access.userId,
      actionType: AuditLogEvent.GUILD_UPDATE,
      targetId: access.server.id,
      changes: [{ key: 'discord_guild_id', old: bridge.guildId ?? undefined, new: guildId }],
      reason: 'Discord bridge linked',
    });
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, { params: serverParams, body: t.Object({ guildId: t.String({ maxLength: 32 }) }) })

  // Unlink the Discord server: removes the guild, links and options, and the bridge webhooks on Discord.
  .delete('/:serverId/discord-bridge/link', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    await patchIntegrations(access.server.id, { discord: false }, BRIDGE_LINK_KEYS);
    await clearBridgeHealth(access.server.id);
    if (bridge.guildId) {
      audit({
        serverId: access.server.id,
        userId: access.userId,
        actionType: AuditLogEvent.GUILD_UPDATE,
        targetId: access.server.id,
        changes: [{ key: 'discord_guild_id', old: bridge.guildId, new: undefined }],
        reason: 'Discord bridge unlinked',
      });
    }
    // Best-effort cleanup of the webhooks the bridge made (their token
    // authorises the delete). Webhooks are reused by name per Discord channel,
    // so one still used by another server's active link of this guild stays.
    if (bridge.guildId) {
      const guildId = bridge.guildId;
      void (async () => {
        const inUse = await webhookIdsInUseElsewhere(guildId, access.server.id);
        const { decryptField } = await import('@/lib/security/fieldEncryption');
        for (const link of bridge.links) {
          if (!link.webhook) continue;
          const url = await decryptField(link.webhook).catch(() => null);
          const id = typeof url === 'string' ? webhookIdFromUrl(url) : null;
          if (!id || inUse.has(id)) continue;
          await fetch(url as string, { method: 'DELETE', signal: AbortSignal.timeout(8000) }).catch(() => {});
        }
      })().catch(() => {});
    }
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, { params: serverParams })

  // Bridge on/off, consent restriction, server-wide defaults.
  .patch('/:serverId/discord-bridge', async ({ headers, cookie, params, body, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const patch: Record<string, unknown> = {};
    // Turning mirroring or member timeouts on makes the bot act in the guild:
    // re-verify that this user still controls it (and, for the bridge, that no
    // other server claims it).
    if (body.enabled === true || body.restrictUnconsented === true) {
      const denied = await requireGuildControl(ctx, access.userId, access.server, bridge);
      if (denied) return denied;
    }
    if (body.enabled !== undefined) {
      if (body.enabled) {
        const claim = await findActiveGuildClaim(bridge.guildId!, access.server.id);
        if (claim) {
          set.status = 409;
          return { error: guildClaimError(claim, access.userId) };
        }
      }
      patch.discord = body.enabled;
    }
    if (body.restrictUnconsented !== undefined) patch.discordRestrictUnconsented = body.restrictUnconsented;
    if (body.defaults !== undefined) {
      const next = { ...bridge.defaults, ...sanitizeBridgeDefaults(body.defaults) };
      // Store only what differs from the built-ins.
      patch.discordBridgeDefaults = compactOverrides({}, next);
    }
    if (Object.keys(patch).length > 0 && !(await patchIntegrations(access.server.id, patch, [], { expectGuildId: bridge.guildId }))) {
      set.status = 409;
      return { error: LINK_CHANGED };
    }
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, {
    params: serverParams,
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      restrictUnconsented: t.Optional(t.Boolean()),
      defaults: t.Optional(optionsSchema),
    }),
  })

  // The linked guild's channels, for the mapping editor.
  .get('/:serverId/discord-bridge/channels', async ({ headers, cookie, params, query, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId);
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    if (!bridge.guildId) {
      set.status = 409;
      return { error: 'Link a Discord server first' };
    }
    const fresh = query.fresh === '1';
    if (fresh) {
      const limited = await heavyLimit(ctx, access.userId, access.server.id);
      if (limited) return limited;
    }
    const channels = await loadGuildChannels(ctx, bridge.guildId, fresh);
    if (!Array.isArray(channels)) return channels;
    return {
      channels: channels
        .filter((c) => c.kind === 'category' || isBridgeableKind(c.kind))
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, position: c.position })),
    };
  }, { params: serverParams, query: t.Object({ fresh: t.Optional(t.String()) }) })

  // Link a Discord channel to an existing SerikaCord channel, or to a new one.
  .put('/:serverId/discord-bridge/links/:discordChannelId', async ({ headers, cookie, params, body, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const bad = badDiscordChannelId(ctx, params.discordChannelId);
    if (bad) return bad;
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const denied = await requireGuildControl(ctx, access.userId, access.server, bridge);
    if (denied) return denied;
    const discordChannels = await loadGuildChannels(ctx, bridge.guildId!);
    if (!Array.isArray(discordChannels)) return discordChannels;
    const dc = discordChannels.find((c) => c.id === params.discordChannelId);
    if (!dc || !isBridgeableKind(dc.kind)) {
      set.status = 404;
      return { error: 'That Discord channel is not a text or announcement channel in the linked server' };
    }
    const serikaChannels = await serikaChannelsOf(access.server.id);

    let existingTarget: SerikaChannelRow | null = null;
    if (body.create) {
      if (!(await hasServerPermission(access.server, access.userId, PERMISSION_BITS.MANAGE_CHANNELS))) {
        set.status = 403;
        return { error: 'You need Manage Channels to create channels' };
      }
    } else {
      const wanted = (body.serikaChannelId || '').toLowerCase();
      existingTarget = serikaChannels.find((c) => c.id === wanted) ?? null;
      if (!existingTarget || !SERIKA_BRIDGEABLE.has(existingTarget.type)) {
        set.status = 400;
        return { error: 'Pick a text or announcement channel from this server' };
      }
      // One Discord channel <-> one SerikaCord channel.
      const takenBy = bridge.links.find((l) => l.serikaChannelId === existingTarget!.id && l.discordChannelId !== dc.id);
      if (takenBy) {
        const other = discordChannels.find((c) => c.id === takenBy.discordChannelId);
        set.status = 409;
        return { error: other ? `That SerikaCord channel is already linked to #${other.name}. Unlink it first.` : 'That SerikaCord channel is already linked to another Discord channel. Unlink it first.' };
      }
    }
    const hook = await prepareWebhook(dc.id);
    if (!hook.ok) {
      set.status = 502;
      return { error: hook.error };
    }
    const serikaChannelId = existingTarget
      ? existingTarget.id
      : (await createSerikaChannelFor(access.server, access.userId, dc, parentForNewChannel(dc, discordChannels, serikaChannels, bridge.links), body.name)).id;
    await clearBridgeError(access.server.id, serikaChannelId);
    const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, upsertLink(bridge.links, { discordChannelId: dc.id, serikaChannelId, webhook: hook.sealed }));
    if (saveError) return saveError;
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, {
    params: linkParams,
    body: t.Object({
      serikaChannelId: t.Optional(t.String({ maxLength: 64 })),
      create: t.Optional(t.Boolean()),
      name: t.Optional(t.String({ maxLength: 100 })),
    }),
  })

  .delete('/:serverId/discord-bridge/links/:discordChannelId', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const bad = badDiscordChannelId(ctx, params.discordChannelId);
    if (bad) return bad;
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const links = bridge.links.filter((l) => l.discordChannelId !== params.discordChannelId);
    if (links.length !== bridge.links.length) {
      const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, links);
      if (saveError) return saveError;
    }
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, { params: linkParams })

  // Per-link options (partial; `reset` drops every override so the link follows the server defaults).
  .patch('/:serverId/discord-bridge/links/:discordChannelId/options', async ({ headers, cookie, params, body, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const bad = badDiscordChannelId(ctx, params.discordChannelId);
    if (bad) return bad;
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const link = bridge.links.find((l) => l.discordChannelId === params.discordChannelId);
    if (!link) {
      set.status = 404;
      return { error: 'That Discord channel is not linked' };
    }
    const overrides = body.reset ? {} : compactOverrides(bridge.defaults, { ...link.overrides, ...sanitizeLinkOptions(body.options ?? {}) });
    const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, bridge.links.map((l) => (l === link ? { ...l, overrides } : l)));
    if (saveError) return saveError;
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, { params: linkParams, body: t.Object({ options: t.Optional(optionsSchema), reset: t.Optional(t.Boolean()) }) })

  // Recreate the link's webhook on Discord (after it was deleted or reset there).
  .post('/:serverId/discord-bridge/links/:discordChannelId/repair', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const bad = badDiscordChannelId(ctx, params.discordChannelId);
    if (bad) return bad;
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const denied = await requireGuildControl(ctx, access.userId, access.server, bridge);
    if (denied) return denied;
    const link = bridge.links.find((l) => l.discordChannelId === params.discordChannelId);
    if (!link) {
      set.status = 404;
      return { error: 'That Discord channel is not linked' };
    }
    const hook = await ensureBridgeWebhook(link.discordChannelId, { replace: true });
    if (!hook.ok) {
      set.status = 502;
      return { error: WEBHOOK_ERRORS[hook.error] };
    }
    const sealed = await sealWebhook(hook.url);
    const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, bridge.links.map((l) => (l === link ? { ...l, webhook: sealed } : l)));
    if (saveError) return saveError;
    await clearBridgeError(access.server.id, link.serikaChannelId);
    const fresh = await Server.findById(access.server.id);
    return bridgeState(fresh ?? access.server, access.userId);
  }, { params: linkParams })

  // Post a test message to Discord through the link's webhook.
  .post('/:serverId/discord-bridge/links/:discordChannelId/test', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const bad = badDiscordChannelId(ctx, params.discordChannelId);
    if (bad) return bad;
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const bridge = bridgeOf(access.server);
    const link = bridge.links.find((l) => l.discordChannelId === params.discordChannelId);
    if (!link?.webhook) {
      set.status = 404;
      return { error: 'That Discord channel is not linked' };
    }
    // Only the server that actually mirrors this guild, with the bridge on, may post through it.
    const owner = bridge.enabled && bridge.guildId ? await resolveGuildBridge(bridge.guildId) : null;
    if (!owner || owner.server.id !== access.server.id) {
      set.status = 409;
      return { error: bridge.enabled ? 'Another SerikaCord server mirrors this Discord server, so this link is inactive' : 'Turn the Discord bridge on first' };
    }
    const { decryptField } = await import('@/lib/security/fieldEncryption');
    const url = await decryptField(link.webhook);
    const channel = await Channel.findById(link.serikaChannelId);
    const res = typeof url === 'string' && webhookIdFromUrl(url)
      ? await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `This channel is bridged with #${channel?.name ?? 'channel'} on SerikaCord.`,
            username: 'SerikaCord bridge',
            allowed_mentions: { parse: [] },
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null)
      : null;
    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      if (status === 404 || status === 401) void recordBridgeError(access.server.id, link.serikaChannelId, 'webhook_missing', status);
      set.status = 502;
      return { error: status === 404 || status === 401 ? 'The bridge webhook was deleted on Discord. Use Repair.' : 'Discord did not accept the test message' };
    }
    recordBridgeSuccess(access.server.id, link.serikaChannelId, 'outbound');
    return { success: true };
  }, { params: linkParams })

  // Check every link's webhook on Discord and record the ones that are gone.
  .post('/:serverId/discord-bridge/check', async ({ headers, cookie, params, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const limited = await heavyLimit(ctx, access.userId, access.server.id);
    if (limited) return limited;
    const bridge = bridgeOf(access.server);
    const { decryptField } = await import('@/lib/security/fieldEncryption');
    let missing = 0;
    for (const link of bridge.links.slice(0, 100)) {
      if (!link.webhook) continue;
      const url = await decryptField(link.webhook).catch(() => null);
      const exists = typeof url === 'string' ? await webhookExists(url) : false;
      if (exists === false) {
        missing++;
        await recordBridgeError(access.server.id, link.serikaChannelId, 'webhook_missing');
      }
    }
    const fresh = await Server.findById(access.server.id);
    return { missing, state: await bridgeState(fresh ?? access.server, access.userId) };
  }, { params: serverParams })

  // Bulk: auto-match by name, create every missing channel, or unlink everything.
  .post('/:serverId/discord-bridge/bulk', async ({ headers, cookie, params, body, set }) => {
    const ctx = { headers, cookie: cookie as Ctx['cookie'], set };
    const access = await managerAccess(ctx, params.serverId, { write: true });
    if (!access.ok) return access.body;
    const limited = await heavyLimit(ctx, access.userId, access.server.id);
    if (limited) return limited;
    const bridge = bridgeOf(access.server);

    if (body.action === 'unlink_all') {
      const serikaChannels = await serikaChannelsOf(access.server.id);
      // Category pairs from older syncs stay (they only place new channels).
      const categories = new Set(serikaChannels.filter((c) => c.type === 'category').map((c) => c.id));
      const kept = bridge.links.filter((l) => categories.has(l.serikaChannelId));
      const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, kept);
      if (saveError) return saveError;
      const fresh = await Server.findById(access.server.id);
      return { linked: 0, created: 0, unlinked: bridge.links.length - kept.length, failed: [], state: await bridgeState(fresh ?? access.server, access.userId) };
    }

    const denied = await requireGuildControl(ctx, access.userId, access.server, bridge);
    if (denied) return denied;
    if (body.action === 'create_missing' && !(await hasServerPermission(access.server, access.userId, PERMISSION_BITS.MANAGE_CHANNELS))) {
      set.status = 403;
      return { error: 'You need Manage Channels to create channels' };
    }
    const discordChannels = await loadGuildChannels(ctx, bridge.guildId!, true);
    if (!Array.isArray(discordChannels)) return discordChannels;
    let serikaChannels = await serikaChannelsOf(access.server.id);
    const linkedDiscord = new Set(bridge.links.map((l) => l.discordChannelId));
    const bridgeableDiscord = discordChannels.filter((c) => isBridgeableKind(c.kind) && !linkedDiscord.has(c.id)).sort((a, b) => a.position - b.position);

    let links = [...bridge.links];
    let linked = 0;
    let created = 0;
    const failed: Array<{ discordChannelId: string; error: string }> = [];
    // Webhook creation is rate limited per guild; 50 per request keeps one call under a minute.
    const MAX = 50;

    const pairs: Array<{ discordChannelId: string; serikaChannelId: string | null }> =
      body.action === 'auto_match'
        ? autoMatchByName(bridgeableDiscord, serikaChannels.filter((c) => SERIKA_BRIDGEABLE.has(c.type)), links)
        : bridgeableDiscord.map((c) => ({ discordChannelId: c.id, serikaChannelId: null }));

    for (const pair of pairs.slice(0, MAX)) {
      const dc = discordChannels.find((c) => c.id === pair.discordChannelId)!;
      const hook = await prepareWebhook(dc.id);
      if (!hook.ok) {
        failed.push({ discordChannelId: dc.id, error: hook.error });
        continue;
      }
      let serikaChannelId = pair.serikaChannelId;
      if (!serikaChannelId) {
        const row = await createSerikaChannelFor(access.server, access.userId, dc, parentForNewChannel(dc, discordChannels, serikaChannels, links));
        serikaChannels = [...serikaChannels, row];
        serikaChannelId = row.id;
        created++;
      }
      links = upsertLink(links, { discordChannelId: dc.id, serikaChannelId, webhook: hook.sealed });
      void clearBridgeError(access.server.id, serikaChannelId);
      linked++;
      await new Promise((r) => setTimeout(r, 250));
    }
    const saveError = await saveLinks(ctx, access.server.id, bridge.guildId, links);
    if (saveError) return saveError;
    invalidateGuildChannels(bridge.guildId!);
    const fresh = await Server.findById(access.server.id);
    return { linked, created, unlinked: 0, failed, skipped: Math.max(0, pairs.length - MAX), state: await bridgeState(fresh ?? access.server, access.userId) };
  }, {
    params: serverParams,
    body: t.Object({ action: t.Union([t.Literal('auto_match'), t.Literal('create_missing'), t.Literal('unlink_all')]) }),
  });
