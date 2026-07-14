import { Elysia, t } from 'elysia';
import { Application, ChannelWebhook } from '@/lib/models';
import { Channel, Message, Server, ServerMember, Role, User, ServerEmoji, ServerSticker, Invite, ServerBan } from '@/lib/models';
import { AppCommand } from '@/lib/models/AppCommand';
import * as crypto from 'crypto';
import { config } from '@/lib/config';
import { isValidObjectId } from '@/lib/security';
import { normalizeId } from '@/lib/db/normalizeId';

// ─── Bot Auth Helper ───────────────────────────────────────

async function authenticateBot(headers: Record<string, string | undefined>) {
  const authHeader = headers.authorization;
  if (!authHeader) return null;

  // Support both "Bot <token>" and "<token>" formats
  const token = authHeader.startsWith('Bot ') ? authHeader.slice(4) : authHeader;
  if (!token) return null;

  const app = await Application.findOne({ botToken: token });
  if (!app || !app.botId) return null;

  // Get the bot user
  const botUser = await User.findById(app.botId);
  if (!botUser) return null;

  return { app, botUser };
}

function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

// Permission bits (mirrors @/lib/permissions/bits).
const BOT_PERM_ADMINISTRATOR = 1n << 3n;
const BOT_PERM_MANAGE_MESSAGES = 1n << 13n;
const BOT_PERM_PIN_MESSAGES = 1n << 51n;

/**
 * Resolve a bot's effective permission bitfield within a server by OR-ing the
 * permissions of every role on its member record. Server owner gets everything.
 */
async function getBotServerPermissions(serverId: string | null | undefined, botId: string): Promise<bigint> {
  if (!serverId) return 0n;
  const server = await Server.findById(serverId);
  if (server && compareIds(server.ownerId, botId)) return ~0n;
  const member = await ServerMember.findOne({ serverId, userId: botId });
  const roleIds = (member?.roles || []) as string[];
  if (roleIds.length === 0) return 0n;
  const roles = await Role.find({ id: { in: roleIds }, serverId });
  let bitfield = 0n;
  for (const role of roles) bitfield |= BigInt((role as any).permissions || '0');
  return bitfield;
}

/** True if `bitfield` grants `permission` (ADMINISTRATOR implies all). */
function botHasPermission(bitfield: bigint, permission: bigint): boolean {
  if ((bitfield & BOT_PERM_ADMINISTRATOR) === BOT_PERM_ADMINISTRATOR) return true;
  return (bitfield & permission) === permission;
}

// ─── Discord-compatible response formatters ────────────────

function formatUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    global_name: user.displayName || user.username,
    avatar: user.avatar,
    banner: user.banner ?? null,
    accent_color: null,
    bot: user.isBot ?? false,
    system: user.isSystem ?? false,
    mfa_enabled: false,
    verified: user.isVerified ?? false,
    email: null,
    flags: 0,
    premium_type: 0,
    public_flags: 0,
    created_at: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  };
}

function formatChannel(channel: any) {
  const typeMap: Record<string, number> = {
    text: 0, dm: 1, voice: 2, group_dm: 3, category: 4, announcement: 5,
    announcement_thread: 10, public_thread: 11, private_thread: 12,
    stage_voice: 13, directory: 14, forum: 15, media: 16,
  };
  const isDM = channel.type === 'dm' || channel.type === 'group_dm';
  return {
    id: channel.id,
    type: typeMap[channel.type] ?? 0,
    guild_id: channel.serverId ?? null,
    name: channel.name ?? null,
    topic: channel.topic ?? null,
    position: channel.position ?? 0,
    nsfw: channel.nsfw ?? false,
    rate_limit_per_user: channel.rateLimitPerUser ?? 0,
    parent_id: channel.parentId ?? null,
    last_message_id: null,
    bitrate: channel.bitrate ?? undefined,
    user_limit: channel.userLimit ?? undefined,
    rtc_region: channel.rtcRegion ?? undefined,
    recipients: isDM && channel.recipientIds
      ? channel.recipientIds.map((r: any) => ({ id: r, username: '' }))
      : undefined,
  };
}

function formatMessage(msg: any) {
  const author = msg.authorId && typeof msg.authorId === 'object' && msg.authorId.id
    ? formatUser(msg.authorId)
    : msg.authorId
      ? { id: msg.authorId, username: '' }
      : null;
  return {
    id: msg.id,
    channel_id: msg.channelId ?? null,
    author,
    content: msg.content ?? '',
    timestamp: msg.createdAt ? new Date(msg.createdAt).toISOString() : undefined,
    edited_timestamp: msg.edited ? new Date(msg.updatedAt).toISOString() : null,
    tts: false,
    mention_everyone: msg.mentionEveryone ?? false,
    mentions: (msg.mentionedUserIds ?? []).map((id: any) => ({ id, username: '' })),
    mention_roles: (msg.mentionedRoleIds ?? []).map((id: any) => id),
    mention_channels: (msg.mentionedChannelIds ?? []).map((id: any) => id),
    attachments: (msg.attachments ?? []).map((a: any) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.contentType,
      size: a.size,
      url: a.url,
      proxy_url: a.proxyUrl ?? a.url,
      width: a.width,
      height: a.height,
    })),
    embeds: msg.embeds ?? [],
    reactions: (msg.reactions ?? []).map((r: any) => ({
      emoji: r.emoji,
      count: r.count,
      me: r.userIds?.some((uid: any) => uid === (author as any)?.id) ?? false,
    })),
    pinned: msg.pinned ?? false,
    type: 0,
    flags: 0,
    referenced_message: null,
  };
}

async function formatGuild(server: any) {
  const [roles, emojis] = await Promise.all([
    Role.find({ serverId: server.id }).then(rs => rs.map(formatRole)).catch(() => []),
    ServerEmoji.find({ serverId: server.id }).then(es => es.map((e: any) => ({
      id: e.id,
      name: e.name,
      roles: [],
      user: null,
      require_colons: true,
      managed: false,
      animated: e.animated ?? false,
      available: true,
    }))).catch(() => []),
  ]);
  return {
    id: server.id,
    name: server.name,
    icon: server.icon ?? null,
    description: server.description ?? null,
    owner_id: server.ownerId ?? null,
    verification_level: 0,
    member_count: server.memberCount ?? 0,
    premium_tier: server.premiumTier ?? 0,
    features: server.features ?? [],
    roles,
    emojis,
    stickers: [],
    banner: server.banner ?? null,
    joined_at: server.createdAt ? new Date(server.createdAt).toISOString() : undefined,
  };
}

function formatRole(role: any) {
  return {
    id: role.id,
    name: role.name,
    color: role.color ?? 0,
    hoist: role.hoist ?? false,
    icon: null,
    unicode_emoji: null,
    position: role.position ?? 0,
    permissions: role.permissions ?? '0',
    managed: role.managed ?? false,
    mentionable: role.mentionable ?? false,
    flags: 0,
  };
}

function formatMember(member: any, user: any) {
  return {
    user: user ? formatUser(user) : null,
    nick: member.nickname ?? null,
    roles: (member.roles ?? []).map((r: any) => r),
    joined_at: member.joinedAt ? new Date(member.joinedAt).toISOString() : undefined,
    premium_since: member.premiumSince ? new Date(member.premiumSince).toISOString() : null,
    deaf: member.deaf ?? false,
    mute: member.mute ?? false,
    flags: 0,
    pending: member.pending ?? false,
    permissions: '0',
    communication_disabled_until: member.communicationDisabledUntil
      ? new Date(member.communicationDisabledUntil).toISOString()
      : null,
    avatar: member.avatar ?? null,
    banner: member.banner ?? null,
  };
}

function formatInvite(invite: any) {
  return {
    code: invite.code,
    guild: invite.serverId ? { id: invite.serverId, name: '' } : null,
    channel: invite.channelId ? { id: invite.channelId, name: '' } : null,
    inviter: invite.inviterId ? { id: invite.inviterId } : null,
    approximate_member_count: 0,
    approximate_presence_count: 0,
    expires_at: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
    uses: invite.uses ?? 0,
    max_uses: invite.maxUses ?? 0,
    max_age: invite.maxAge ?? 86400,
    temporary: invite.temporary ?? false,
    created_at: invite.createdAt ? new Date(invite.createdAt).toISOString() : undefined,
  };
}

// ─── Bot API Routes (Discord v10 compatible) ───────────────

export const botApiRoutes = new Elysia({ prefix: '/v10' })

// ─── API root (friendly index so /api/v10 isn't a bare 404) ─
.get('/', () => ({
  message: 'SerikaCord API v10 — a Discord-compatible bot API.',
  version: 10,
  documentation: `${config.API_BASE_URL}/developers/docs`,
  endpoints: {
    rest: `${config.API_BASE_URL}/api/v10`,
    gateway: config.GATEWAY_URL,
    user: `${config.API_BASE_URL}/api/v10/users/@me`,
  },
}))

// ─── Gateway ───────────────────────────────────────────────
.get('/gateway', () => ({ url: config.GATEWAY_URL }))
.get('/gateway/bot', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return {
    url: config.GATEWAY_URL,
    shards: 1,
    session_start_limit: { total: 1000, remaining: 1000, reset_after: 86400000, max_concurrency: 1 },
  };
})

// ─── Users ─────────────────────────────────────────────────
.get('/users/@me', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return formatUser(auth.botUser);
})
.get('/users/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const user = await User.findById(params.userId);
  if (!user) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  return formatUser(user);
})

// ─── Guilds ────────────────────────────────────────────────
.get('/guilds/:guildId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return await formatGuild(server);
})
.patch('/guilds/:guildId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }

  const patch = body as any;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.icon !== undefined) updates.icon = patch.icon;
  if (patch.banner !== undefined) updates.banner = patch.banner;
  if (patch.verification_level !== undefined) updates.verificationLevel = patch.verification_level;
  if (patch.default_notifications !== undefined) updates.defaultNotifications = patch.default_notifications;
  const updated = await Server.updateById(params.guildId, updates);
  return await formatGuild(updated || server);
})
.get('/guilds/:guildId/preview', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return {
    id: server.id,
    name: server.name,
    icon: server.icon ?? null,
    banner: server.banner ?? null,
    description: server.description ?? null,
    approximate_member_count: server.memberCount ?? 0,
    approximate_presence_count: server.onlineCount ?? 0,
    discovery_splash: null,
    features: server.features ?? [],
  };
})
.get('/guilds/:guildId/channels', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const channels = await Channel.find({ serverId: params.guildId });
  return channels.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(formatChannel);
})
.get('/guilds/:guildId/roles', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const roles = await Role.find({ serverId: params.guildId });
  return roles.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(formatRole);
})
.get('/guilds/:guildId/members', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const limit = Math.min(parseInt(query.limit as string) || 100, 1000);
  const members = await ServerMember.find({ serverId: params.guildId });
  const sliced = members.slice(0, limit);
  const userIds = sliced.map((m: any) => m.userId);
  const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
  const userMap = new Map(users.map((u: any) => [u.id, u]));

  return sliced.map((m: any) => formatMember(m, userMap.get(m.userId)));
})
.get('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  const user = await User.findById(params.userId);
  return formatMember(member, user);
})
.get('/guilds/:guildId/emojis', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const emojis = await ServerEmoji.find({ serverId: params.guildId });
  return emojis.map((e: any) => ({
    id: e.id,
    name: e.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: e.animated ?? false,
    available: true,
  }));
})
.get('/guilds/:guildId/bans', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const bans = await ServerBan.find({ serverId: params.guildId });
  return bans.map((b: any) => ({
    reason: b.reason ?? null,
    user: { id: b.userId },
  }));
})
.get('/guilds/:guildId/invites', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const invites = await Invite.find({ serverId: params.guildId });
  return invites.map(formatInvite);
})

// ─── Channels ──────────────────────────────────────────────
.get('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  return formatChannel(channel);
})
.patch('/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const patch = body as any;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.topic !== undefined) updates.topic = patch.topic;
  if (patch.nsfw !== undefined) updates.nsfw = patch.nsfw;
  if (patch.rate_limit_per_user !== undefined) updates.rateLimitPerUser = patch.rate_limit_per_user;
  const updated = await Channel.updateById(params.channelId, updates);
  return formatChannel(updated || channel);
})
.delete('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  await Channel.deleteById(params.channelId);
  return formatChannel({ id: params.channelId });
})

// ─── Messages ──────────────────────────────────────────────
.get('/channels/:channelId/messages', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const messages = await Message.find({ channelId: params.channelId, _limit: limit });
  const authorIds = [...new Set(messages.map((m: any) => m.authorId).filter(Boolean))] as string[];
  const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
  const authorMap = new Map(authors.map((u: any) => [u.id, u]));
  return messages.map((m: any) => formatMessage({ ...m, authorId: authorMap.get(m.authorId) || m.authorId }));
})
.get('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const author = msg.authorId ? await User.findById(msg.authorId) : null;
  return formatMessage({ ...msg, authorId: author || msg.authorId });
})
.post('/channels/:channelId/messages', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const { content, embeds, tts, attachments, allowed_mentions, sticker_ids, components, flags } = body as any;
  if (!content && !embeds?.length && !attachments?.length && !sticker_ids?.length) {
    set.status = 400; return { code: 50006, message: 'Cannot send an empty message' };
  }

  const msg = await Message.create({
    channelId: params.channelId,
    serverId: channel.serverId ?? null,
    authorId: auth.botUser.id,
    content: content || '',
    embeds: embeds ?? [],
    attachments: attachments ?? [],
    type: 'default',
    pinned: false,
    edited: false,
    reactions: [],
  });

  const populated = await Message.findById(msg.id);
  const author = populated?.authorId ? await User.findById(populated.authorId) : null;
  const formattedMsg = populated ? formatMessage({ ...populated, authorId: author || populated.authorId }) : null;

  // Deliver to the web client SSE streams and the bot gateway.
  try {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(params.channelId, { type: 'message', message: formattedMsg });
  } catch {}
  try {
    const { emitMessageCreate } = await import('@/lib/services/gatewayEvents');
    await emitMessageCreate({
      id: msg.id,
      content: msg.content ?? '',
      channelId: params.channelId,
      serverId: channel.serverId ?? null,
      createdAt: (populated as any)?.createdAt,
      author: author ? {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatar: author.avatar,
        isBot: author.isBot ?? undefined,
        isSystem: author.isSystem ?? undefined,
      } : null,
      attachments: (msg.attachments ?? []) as any,
    });
  } catch {}

  return formattedMsg;
})
.patch('/channels/:channelId/messages/:messageId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  // Only the author can edit
  if (!compareIds(msg.authorId, auth.botUser.id)) {
    set.status = 403; return { code: 50003, message: 'Cannot edit a message authored by another user' };
  }

  const { content, embeds } = body as any;
  const updates: Record<string, unknown> = { edited: true };
  if (content !== undefined) updates.content = content;
  if (embeds !== undefined) updates.embeds = embeds;
  const updated = await Message.updateById(params.messageId, updates);
  const author = updated?.authorId ? await User.findById(updated.authorId) : null;
  return formatMessage({ ...(updated || msg), authorId: author || (updated || msg).authorId });
})
.delete('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  // Author or manage messages permission
  const isAuthor = compareIds(msg.authorId, auth.botUser.id);
  if (!isAuthor) {
    const channel = await Channel.findById(params.channelId);
    const perms = await getBotServerPermissions(channel?.serverId, auth.botUser.id);
    if (!botHasPermission(perms, BOT_PERM_MANAGE_MESSAGES)) {
      set.status = 403; return { code: 50013, message: 'Missing Permissions' };
    }
  }

  await Message.deleteById(params.messageId);
  set.status = 204;
  return '';
})
.post('/channels/:channelId/messages/bulk-delete', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { messages } = body as any;
  if (!messages || !Array.isArray(messages) || messages.length < 2 || messages.length > 100) {
    set.status = 400; return { code: 50016, message: 'Invalid number of messages (2-100)' };
  }

  // Bulk delete always requires MANAGE_MESSAGES.
  const bulkChannel = await Channel.findById(params.channelId);
  const bulkPerms = await getBotServerPermissions(bulkChannel?.serverId, auth.botUser.id);
  if (!botHasPermission(bulkPerms, BOT_PERM_MANAGE_MESSAGES)) {
    set.status = 403; return { code: 50013, message: 'Missing Permissions' };
  }

  for (const id of messages) {
    await Message.deleteById(id);
  }
  return { deleted_messages: messages };
})

// ─── Pins ──────────────────────────────────────────────────
.get('/channels/:channelId/pins', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const pinned = await Message.find({ channelId: params.channelId, pinned: true, isDeleted: false });
  const formatted = await Promise.all((pinned as any[]).map(async (msg) => {
    const author = msg.authorId ? await User.findById(msg.authorId) : null;
    return formatMessage({ ...msg, authorId: author || msg.authorId });
  }));
  return formatted;
})
.put('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg || msg.channelId !== params.channelId) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const channel = await Channel.findById(params.channelId);
  const perms = await getBotServerPermissions(channel?.serverId, auth.botUser.id);
  if (!botHasPermission(perms, BOT_PERM_PIN_MESSAGES) && !botHasPermission(perms, BOT_PERM_MANAGE_MESSAGES)) {
    set.status = 403; return { code: 50013, message: 'Missing Permissions' };
  }

  await Message.updateById(params.messageId, { pinned: true });
  try {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(params.channelId, { type: 'pin_update', messageId: params.messageId, pinned: true, updatedBy: auth.botUser.id });
  } catch {}
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg || msg.channelId !== params.channelId) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const channel = await Channel.findById(params.channelId);
  const perms = await getBotServerPermissions(channel?.serverId, auth.botUser.id);
  if (!botHasPermission(perms, BOT_PERM_PIN_MESSAGES) && !botHasPermission(perms, BOT_PERM_MANAGE_MESSAGES)) {
    set.status = 403; return { code: 50013, message: 'Missing Permissions' };
  }

  await Message.updateById(params.messageId, { pinned: false });
  try {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(params.channelId, { type: 'pin_update', messageId: params.messageId, pinned: false, updatedBy: auth.botUser.id });
  } catch {}
  set.status = 204;
  return '';
})

// ─── Reactions ─────────────────────────────────────────────
.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reactions = [...((msg.reactions as any[]) || [])];
  let reaction = reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (!reaction) {
    reaction = { emoji: { name: emojiKey }, count: 0, userIds: [] as any[] };
    reactions.push(reaction);
  }
  if (!reaction.userIds.some((uid: any) => uid === auth.botUser.id)) {
    reaction.userIds.push(auth.botUser.id);
    reaction.count = reaction.userIds.length;
  }
  await Message.updateById(params.messageId, { reactions });
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reactions = [...((msg.reactions as any[]) || [])];
  const reaction = reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (reaction) {
    reaction.userIds = reaction.userIds.filter((uid: any) => uid !== auth.botUser.id);
    reaction.count = reaction.userIds.length;
    if (reaction.count === 0) {
      const idx = reactions.indexOf(reaction);
      if (idx >= 0) reactions.splice(idx, 1);
    }
    await Message.updateById(params.messageId, { reactions });
  }
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reactions = [...((msg.reactions as any[]) || [])];
  const reaction = reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (reaction) {
    reaction.userIds = reaction.userIds.filter((uid: any) => uid !== params.userId);
    reaction.count = reaction.userIds.length;
    if (reaction.count === 0) {
      const idx = reactions.indexOf(reaction);
      if (idx >= 0) reactions.splice(idx, 1);
    }
    await Message.updateById(params.messageId, { reactions });
  }
  set.status = 204;
  return '';
})
.get('/channels/:channelId/messages/:messageId/reactions/:emoji', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reaction = ((msg.reactions as any[]) || []).find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (!reaction) return [];

  const limit = Math.min(parseInt(query.limit as string) || 25, 100);
  const userIds = reaction.userIds.slice(0, limit);
  const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
  return users.map(formatUser);
})
.delete('/channels/:channelId/messages/:messageId/reactions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  await Message.updateById(params.messageId, { reactions: [] });
  set.status = 204;
  return '';
})

// ─── Typing ────────────────────────────────────────────────
.post('/channels/:channelId/typing', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 204;
  return '';
})

// ─── Application Commands ──────────────────────────────────
.get('/applications/:appId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: null });
  return cmds.map((c: any) => ({
    id: c.id,
    application_id: params.appId,
    name: c.name,
    description: c.description,
    options: c.options ?? [],
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.put('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Bulk overwrite global commands.
  const commands = (body as any[]) ?? [];
  const existing = await AppCommand.find({ applicationId: params.appId, guildId: null });
  for (const cmd of existing) {
    await AppCommand.deleteById(cmd.id);
  }
  const created: any[] = [];
  for (const c of commands) {
    const row = await AppCommand.create({
      applicationId: params.appId,
      guildId: null,
      name: c.name,
      description: c.description ?? '',
      options: c.options ?? [],
      defaultPermission: c.default_permission ?? true,
      type: c.type ?? 1,
    });
    created.push(row);
  }
  return created.map((c: any) => ({
    id: c.id,
    application_id: params.appId,
    name: c.name,
    description: c.description,
    options: c.options,
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.post('/interactions/:interactionId/:interactionToken/callback', async ({ params, body, set }) => {
  // Interaction callback — no auth needed, token in URL
  set.status = 204;
  return '';
})

// ─── Invite ────────────────────────────────────────────────
.get('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const invite = await Invite.findOne({ code: params.code });
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  return formatInvite(invite);
})
.delete('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const invite = await Invite.findOne({ code: params.code });
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  await Invite.deleteById(invite.id);
  return formatInvite(invite);
})

// ─── Guild Channel CRUD ────────────────────────────────────
.post('/guilds/:guildId/channels', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }

  const existingChannels = await Channel.find({ serverId: params.guildId });
  if (existingChannels.length >= config.MAX_CHANNELS_PER_SERVER) {
    set.status = 400;
    return { code: 30013, message: 'Maximum number of guild channels reached' };
  }

  const { name, type, topic, nsfw, parent_id, rate_limit_per_user, position } = body as any;
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }

  const typeReverseMap: Record<number, 'text' | 'voice' | 'category' | 'announcement' | 'stage' | 'forum'> = {
    0: 'text', 2: 'voice', 4: 'category', 5: 'announcement',
    13: 'stage', 15: 'forum',
  };

  const channel = await Channel.create({
    serverId: params.guildId,
    name,
    type: typeReverseMap[type] ?? 'text',
    topic: topic ?? '',
    nsfw: nsfw ?? false,
    parentId: parent_id ?? undefined,
    rateLimitPerUser: rate_limit_per_user ?? 0,
    position: position ?? 0,
    bitrate: 64000,
    userLimit: 0,
    recipientIds: [],
    permissionOverwrites: [],
  });
  return formatChannel(channel);
})
.patch('/guilds/:guildId/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const patch = body as any;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.topic !== undefined) updates.topic = patch.topic;
  if (patch.nsfw !== undefined) updates.nsfw = patch.nsfw;
  if (patch.position !== undefined) updates.position = patch.position;
  if (patch.rate_limit_per_user !== undefined) updates.rateLimitPerUser = patch.rate_limit_per_user;
  if (patch.parent_id !== undefined) updates.parentId = patch.parent_id ?? undefined;
  const updated = await Channel.updateById(params.channelId, updates);
  return formatChannel(updated || channel);
})
.delete('/guilds/:guildId/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await Channel.deleteById(params.channelId);
  set.status = 204;
  return '';
})

// ─── Guild Role CRUD ───────────────────────────────────────
.post('/guilds/:guildId/roles', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { name, color, hoist, permissions, mentionable, icon, unicode_emoji } = body as any;

  const role = await Role.create({
    serverId: params.guildId,
    name: name ?? 'new role',
    color: color ?? 0,
    hoist: hoist ?? false,
    permissions: permissions ?? '0',
    mentionable: mentionable ?? false,
    isDefault: false,
    managed: false,
  });
  return formatRole(role);
})
.patch('/guilds/:guildId/roles/:roleId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const role = await Role.findById(params.roleId);
  if (!role) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }

  const patch = body as any;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.color !== undefined) updates.color = patch.color;
  if (patch.hoist !== undefined) updates.hoist = patch.hoist;
  if (patch.permissions !== undefined) updates.permissions = patch.permissions;
  if (patch.mentionable !== undefined) updates.mentionable = patch.mentionable;
  if (patch.position !== undefined) updates.position = patch.position;
  const updated = await Role.updateById(params.roleId, updates);
  return formatRole(updated || role);
})
.delete('/guilds/:guildId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await Role.deleteById(params.roleId);
  set.status = 204;
  return '';
})

// ─── Guild Member Management ───────────────────────────────
.patch('/guilds/:guildId/members/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const patch = body as any;
  const updates: Record<string, unknown> = {};
  if (patch.nick !== undefined) updates.nickname = patch.nick;
  if (patch.roles !== undefined) updates.roles = patch.roles;
  if (patch.deaf !== undefined) updates.deaf = patch.deaf;
  if (patch.mute !== undefined) updates.mute = patch.mute;
  if (patch.communication_disabled_until !== undefined) {
    updates.communicationDisabledUntil = patch.communication_disabled_until ? new Date(patch.communication_disabled_until) : undefined;
  }
  const updated = await ServerMember.updateById(member.id, updates);

  const user = await User.findById(params.userId);
  return formatMember(updated || member, user);
})
.patch('/guilds/:guildId/members/@me/nick', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const member = await ServerMember.findOne({ serverId: params.guildId, userId: auth.botUser.id });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const { nick } = body as any;
  await ServerMember.updateById(member.id, { nickname: nick });
  return nick;
})
.delete('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (member) await ServerMember.deleteById(member.id);
  const server = await Server.findById(params.guildId);
  if (server) await Server.updateById(params.guildId, { memberCount: Math.max(0, (server.memberCount ?? 1) - 1) });
  set.status = 204;
  return '';
})

// ─── Guild Bans ────────────────────────────────────────────
.put('/guilds/:guildId/bans/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10004, message: 'Unknown Guild' };
  }
  const { reason } = body as any;

  // Remove member if exists
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (member) await ServerMember.deleteById(member.id);
  // Create ban
  await ServerBan.create({
    serverId: params.guildId,
    userId: params.userId,
    bannedBy: auth.botUser.id,
    reason: reason ?? null,
  });
  const server = await Server.findById(params.guildId);
  if (server) await Server.updateById(params.guildId, { memberCount: Math.max(0, (server.memberCount ?? 1) - 1) });
  set.status = 204;
  return '';
})
.get('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId });
  if (!ban) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  return { reason: ban.reason ?? null, user: { id: ban.userId } };
})
.delete('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId });
  if (ban) await ServerBan.deleteById(ban.id);
  set.status = 204;
  return '';
})

// ─── Guild Emoji CRUD ──────────────────────────────────────
.get('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.emojiId)) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }
  const emoji = await ServerEmoji.findById(params.emojiId);
  if (!emoji) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }
  return {
    id: emoji.id,
    name: emoji.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: emoji.animated ?? false,
    available: true,
  };
})
.post('/guilds/:guildId/emojis', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { name, image, roles } = body as any;
  if (!name || !image) { set.status = 400; return { code: 50035, message: 'Name and image are required' }; }

  const emoji = await ServerEmoji.create({
    serverId: params.guildId,
    name,
    imageUrl: image,
    animated: image.startsWith('data:image/gif'),
    available: true,
    managed: false,
    requireColons: true,
    roles: [],
    uploadedBy: auth.botUser.id,
  });
  return {
    id: emoji.id,
    name: emoji.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: emoji.animated,
    available: true,
  };
})
.patch('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const emoji = await ServerEmoji.findById(params.emojiId);
  if (!emoji) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }

  const { name, roles } = body as any;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  const updated = await ServerEmoji.updateById(params.emojiId, updates);
  const result = updated || emoji;
  return {
    id: result.id,
    name: result.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: result.animated,
    available: true,
  };
})
.delete('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await ServerEmoji.deleteById(params.emojiId);
  set.status = 204;
  return '';
})

// ─── Guild Stickers ────────────────────────────────────────
.get('/guilds/:guildId/stickers', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const stickers = await ServerSticker.find({ serverId: params.guildId });
  return stickers.map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    tags: s.tags ?? [],
    type: 1,
    format_type: 1,
    available: s.available ?? true,
    guild_id: params.guildId,
    user: null,
  }));
})
.get('/guilds/:guildId/stickers/:stickerId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.stickerId)) { set.status = 404; return { code: 10011, message: 'Unknown Sticker' }; }
  const sticker = await ServerSticker.findById(params.stickerId);
  if (!sticker) { set.status = 404; return { code: 10011, message: 'Unknown Sticker' }; }
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null,
    tags: sticker.tags ?? [],
    type: 1,
    format_type: 1,
    available: sticker.available ?? true,
    guild_id: params.guildId,
    user: null,
  };
})

// ─── Guild Webhooks ────────────────────────────────────────
.get('/guilds/:guildId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const webhooks = await ChannelWebhook.find({ serverId: params.guildId });
  return webhooks.map((w: any) => ({
    id: w.id,
    type: 1,
    guild_id: params.guildId,
    channel_id: w.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId,
  }));
})
.get('/channels/:channelId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const webhooks = await ChannelWebhook.find({ channelId: params.channelId });
  return webhooks.map((w: any) => ({
    id: w.id,
    type: 1,
    guild_id: w.serverId ?? null,
    channel_id: params.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId,
  }));
})
.post('/channels/:channelId/webhooks', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const { name, avatar } = body as any;
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }

  const token = crypto.randomBytes(24).toString('hex');
  const webhook = await ChannelWebhook.create({
    channelId: params.channelId,
    serverId: channel.serverId ?? undefined,
    name,
    avatar: avatar ?? null,
    token,
    url: `${config.API_BASE_URL}/api/webhooks/${params.channelId}/${token}`,
    creatorId: auth.botUser.id,
  });
  return {
    id: webhook.id,
    type: 1,
    guild_id: channel.serverId ?? null,
    channel_id: params.channelId,
    name: webhook.name,
    avatar: webhook.avatar,
    token: webhook.token,
    creator_id: auth.botUser.id,
  };
})
.get('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.webhookId)) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const webhook = await ChannelWebhook.findById(params.webhookId);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return {
    id: webhook.id,
    type: 1,
    guild_id: webhook.serverId ?? null,
    channel_id: webhook.channelId,
    name: webhook.name,
    avatar: webhook.avatar,
    token: webhook.token,
    creator_id: webhook.creatorId,
  };
})
.delete('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await ChannelWebhook.deleteById(params.webhookId);
  set.status = 204;
  return '';
})

// ─── Audit Log ─────────────────────────────────────────────
.get('/guilds/:guildId/audit-logs', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { AdminLog } = await import('@/lib/models');
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const logs = await AdminLog.find({ targetId: params.guildId });
  const sorted = logs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  return {
    audit_log_entries: sorted.map((l: any) => ({
      id: l.id,
      action_type: l.action ?? 0,
      user_id: l.adminId ?? null,
      target_id: l.targetId ?? null,
      reason: l.reason ?? null,
      changes: [],
      created_at: l.createdAt ? new Date(l.createdAt).toISOString() : undefined,
    })),
  };
})

// ─── User DMs ──────────────────────────────────────────────
.get('/users/@me/channels', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const allChannels = await Channel.find({});
  const dmChannels = allChannels.filter((c: any) =>
    (c.type === 'dm' || c.type === 'group_dm') &&
    Array.isArray(c.recipientIds) &&
    c.recipientIds.includes(auth.botUser.id)
  );
  return dmChannels.map(formatChannel);
})
.post('/users/@me/channels', async ({ headers, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { recipient_id } = body as any;
  if (!recipient_id || !isValidObjectId(recipient_id)) {
    set.status = 400; return { code: 50035, message: 'Invalid recipient_id' };
  }

  // Check if DM channel already exists
  const allChannels = await Channel.find({});
  let dm = allChannels.find((c: any) =>
    c.type === 'dm' &&
    Array.isArray(c.recipientIds) &&
    c.recipientIds.includes(auth.botUser.id) &&
    c.recipientIds.includes(recipient_id)
  );

  if (!dm) {
    dm = await Channel.create({
      type: 'dm',
      recipientIds: [auth.botUser.id, recipient_id],
      name: '',
      position: 0,
      rateLimitPerUser: 0,
      nsfw: false,
      bitrate: 0,
      userLimit: 0,
      permissionOverwrites: [],
    });
  }
  return formatChannel(dm);
})

// ─── Leave Guild ───────────────────────────────────────────
.delete('/users/@me/guilds/:guildId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: auth.botUser.id });
  if (member) await ServerMember.deleteById(member.id);
  const server = await Server.findById(params.guildId);
  if (server) await Server.updateById(params.guildId, { memberCount: Math.max(0, (server.memberCount ?? 1) - 1) });
  set.status = 204;
  return '';
})

// ─── Application Command CRUD ──────────────────────────────
.get('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.commandId)) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  const cmd = await AppCommand.findById(params.commandId);
  if (!cmd) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  return {
    id: cmd.id,
    application_id: cmd.applicationId,
    name: cmd.name,
    description: cmd.description,
    options: cmd.options ?? [],
    default_permission: cmd.defaultPermission,
    type: cmd.type,
    version: cmd.version,
  };
})
.post('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { name, description, options, default_permission, type } = body as any;
  if (!name || !description) { set.status = 400; return { code: 50035, message: 'Name and description are required' }; }

  const cmd = await AppCommand.create({
    applicationId: params.appId,
    name,
    description,
    options: options ?? [],
    defaultPermission: default_permission ?? true,
    type: type ?? 1,
  });
  return {
    id: cmd.id,
    application_id: params.appId,
    name: cmd.name,
    description: cmd.description,
    options: cmd.options,
    default_permission: cmd.defaultPermission,
    type: cmd.type,
    version: cmd.version,
  };
})
.patch('/applications/:appId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const cmd = await AppCommand.findById(params.commandId);
  if (!cmd) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }

  const { name, description, options, default_permission } = body as any;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (options !== undefined) updates.options = options;
  if (default_permission !== undefined) updates.defaultPermission = default_permission;
  const updated = await AppCommand.updateById(params.commandId, updates);
  const result = updated || cmd;
  return {
    id: result.id,
    application_id: params.appId,
    name: result.name,
    description: result.description,
    options: result.options,
    default_permission: result.defaultPermission,
    type: result.type,
    version: result.version,
  };
})
.delete('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await AppCommand.deleteById(params.commandId);
  set.status = 204;
  return '';
})

// ─── Guild Application Commands ────────────────────────────
.get('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: params.guildId });
  return cmds.map((c: any) => ({
    id: c.id,
    application_id: params.appId,
    guild_id: params.guildId,
    name: c.name,
    description: c.description,
    options: c.options ?? [],
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.put('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // Bulk overwrite guild commands
  const commands = body as any[];
  const existing = await AppCommand.find({ applicationId: params.appId, guildId: params.guildId });
  for (const cmd of existing) {
    await AppCommand.deleteById(cmd.id);
  }
  const created: any[] = [];
  for (const c of commands) {
    const row = await AppCommand.create({
      applicationId: params.appId,
      guildId: params.guildId,
      name: c.name,
      description: c.description,
      options: c.options ?? [],
      defaultPermission: c.default_permission ?? true,
      type: c.type ?? 1,
    });
    created.push(row);
  }
  return created.map((c: any) => ({
    id: c.id,
    application_id: params.appId,
    guild_id: params.guildId,
    name: c.name,
    description: c.description,
    options: c.options,
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})

// ─── Voice Regions ─────────────────────────────────────────
.get('/voice/regions', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return [
    { id: 'us-west', name: 'US West', optimal: false, deprecated: false, custom: false },
    { id: 'us-east', name: 'US East', optimal: false, deprecated: false, custom: false },
    { id: 'eu-central', name: 'EU Central', optimal: false, deprecated: false, custom: false },
    { id: 'eu-west', name: 'EU West', optimal: false, deprecated: false, custom: false },
    { id: 'japan', name: 'Japan', optimal: false, deprecated: false, custom: false },
    { id: 'singapore', name: 'Singapore', optimal: false, deprecated: false, custom: false },
  ];
});
