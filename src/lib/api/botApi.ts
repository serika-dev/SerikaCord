import { Elysia, t } from 'elysia';
import { Application } from '@/lib/models';
import { Channel, Message, Server, ServerMember, Role, User, ServerEmoji, ServerSticker, Invite, ServerBan } from '@/lib/models';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { config } from '@/lib/config';

// ─── Webhook Model (inline, lightweight) ───────────────────
import mongoose, { Schema, Document } from 'mongoose';

interface IChannelWebhook extends Document {
  _id: Types.ObjectId;
  channelId: Types.ObjectId;
  serverId?: Types.ObjectId;
  name: string;
  avatar?: string;
  token: string;
  url: string;
  creatorId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelWebhookSchema = new Schema<IChannelWebhook>({
  channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  serverId: { type: Schema.Types.ObjectId, ref: 'Server', default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  avatar: { type: String, default: null },
  token: { type: String, required: true },
  url: { type: String, required: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const ChannelWebhook = mongoose.models.ChannelWebhook || mongoose.model<IChannelWebhook>('ChannelWebhook', ChannelWebhookSchema);

// ─── Application Command Model (shared) ────────────────────
import { AppCommand } from '@/lib/models/AppCommand';

// ─── Bot Auth Helper ───────────────────────────────────────

async function authenticateBot(headers: Record<string, string | undefined>) {
  const authHeader = headers.authorization;
  if (!authHeader) return null;

  // Support both "Bot <token>" and "<token>" formats
  const token = authHeader.startsWith('Bot ') ? authHeader.slice(4) : authHeader;
  if (!token) return null;

  const app = await Application.findOne({ botToken: token }).lean();
  if (!app || !app.botId) return null;

  // Get the bot user
  const botUser = await User.findById(app.botId).lean();
  if (!botUser) return null;

  return { app, botUser };
}

function compareIds(id1: Types.ObjectId | string, id2: Types.ObjectId | string): boolean {
  const str1 = id1 instanceof Types.ObjectId ? id1.toString() : id1;
  const str2 = id2 instanceof Types.ObjectId ? id2.toString() : id2;
  return str1 === str2;
}

// ─── Discord-compatible response formatters ────────────────

function formatUser(user: any) {
  return {
    id: user._id.toString(),
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
    id: channel._id.toString(),
    type: typeMap[channel.type] ?? 0,
    guild_id: channel.serverId?.toString() ?? null,
    name: channel.name ?? null,
    topic: channel.topic ?? null,
    position: channel.position ?? 0,
    nsfw: channel.nsfw ?? false,
    rate_limit_per_user: channel.rateLimitPerUser ?? 0,
    parent_id: channel.parentId?.toString() ?? null,
    last_message_id: null,
    bitrate: channel.bitrate ?? undefined,
    user_limit: channel.userLimit ?? undefined,
    rtc_region: channel.rtcRegion ?? undefined,
    recipients: isDM && channel.recipientIds
      ? channel.recipientIds.map((r: any) => ({ id: r.toString(), username: '' }))
      : undefined,
  };
}

function formatMessage(msg: any) {
  const author = msg.authorId && typeof msg.authorId === 'object' && msg.authorId._id
    ? formatUser(msg.authorId)
    : msg.authorId
      ? { id: msg.authorId.toString(), username: '' }
      : null;
  return {
    id: msg._id.toString(),
    channel_id: msg.channelId?.toString() ?? null,
    author,
    content: msg.content ?? '',
    timestamp: msg.createdAt ? new Date(msg.createdAt).toISOString() : undefined,
    edited_timestamp: msg.edited ? new Date(msg.updatedAt).toISOString() : null,
    tts: false,
    mention_everyone: msg.mentionEveryone ?? false,
    mentions: (msg.mentionedUserIds ?? []).map((id: any) => ({ id: id.toString(), username: '' })),
    mention_roles: (msg.mentionedRoleIds ?? []).map((id: any) => id.toString()),
    mention_channels: (msg.mentionedChannelIds ?? []).map((id: any) => id.toString()),
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
      me: r.userIds?.some((uid: any) => uid.toString() === (author as any)?.id) ?? false,
    })),
    pinned: msg.pinned ?? false,
    type: 0,
    flags: 0,
    referenced_message: null,
  };
}

async function formatGuild(server: any) {
  const [roles, emojis] = await Promise.all([
    Role.find({ serverId: server._id }).sort({ position: 1 }).lean().then(rs => rs.map(formatRole)).catch(() => []),
    ServerEmoji.find({ serverId: server._id }).lean().then(es => es.map((e: any) => ({
      id: e._id.toString(),
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
    id: server._id.toString(),
    name: server.name,
    icon: server.icon ?? null,
    description: server.description ?? null,
    owner_id: server.ownerId?.toString() ?? null,
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
    id: role._id.toString(),
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
    roles: (member.roles ?? []).map((r: any) => r.toString()),
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
    guild: invite.serverId ? { id: invite.serverId.toString(), name: '' } : null,
    channel: invite.channelId ? { id: invite.channelId.toString(), name: '' } : null,
    inviter: invite.inviterId ? { id: invite.inviterId.toString() } : null,
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

  if (!Types.ObjectId.isValid(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const user = await User.findById(params.userId).lean();
  if (!user) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  return formatUser(user);
})

// ─── Guilds ────────────────────────────────────────────────
.get('/guilds/:guildId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId).lean();
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return await formatGuild(server);
})
.patch('/guilds/:guildId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }

  const patch = body as any;
  if (patch.name !== undefined) server.name = patch.name;
  if (patch.description !== undefined) server.description = patch.description;
  if (patch.icon !== undefined) server.icon = patch.icon;
  if (patch.banner !== undefined) server.banner = patch.banner;
  if (patch.verification_level !== undefined) server.verificationLevel = patch.verification_level;
  if (patch.default_notifications !== undefined) server.defaultNotifications = patch.default_notifications;
  await server.save();
  return await formatGuild(server);
})
.get('/guilds/:guildId/preview', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId)
    .select('name icon banner description memberCount onlineCount isPartnered features')
    .lean();
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return {
    id: server._id.toString(),
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

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const channels = await Channel.find({ serverId: params.guildId }).sort({ position: 1 }).lean();
  return channels.map(formatChannel);
})
.get('/guilds/:guildId/roles', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const roles = await Role.find({ serverId: params.guildId }).sort({ position: 1 }).lean();
  return roles.map(formatRole);
})
.get('/guilds/:guildId/members', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const limit = Math.min(parseInt(query.limit as string) || 100, 1000);
  const members = await ServerMember.find({ serverId: params.guildId }).limit(limit).lean();
  const userIds = members.map((m: any) => m.userId);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

  return members.map((m: any) => formatMember(m, userMap.get(m.userId?.toString())));
})
.get('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId) || !Types.ObjectId.isValid(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId }).lean();
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  const user = await User.findById(params.userId).lean();
  return formatMember(member, user);
})
.get('/guilds/:guildId/emojis', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const emojis = await ServerEmoji.find({ serverId: params.guildId }).lean();
  return emojis.map((e: any) => ({
    id: e._id.toString(),
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

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const bans = await ServerBan.find({ serverId: params.guildId }).lean();
  return bans.map((b: any) => ({
    reason: b.reason ?? null,
    user: { id: b.userId.toString() },
  }));
})
.get('/guilds/:guildId/invites', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const invites = await Invite.find({ serverId: params.guildId }).lean();
  return invites.map(formatInvite);
})

// ─── Channels ──────────────────────────────────────────────
.get('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId).lean();
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  return formatChannel(channel);
})
.patch('/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const patch = body as any;
  if (patch.name !== undefined) channel.name = patch.name;
  if (patch.topic !== undefined) channel.topic = patch.topic;
  if (patch.nsfw !== undefined) channel.nsfw = patch.nsfw;
  if (patch.rate_limit_per_user !== undefined) channel.rateLimitPerUser = patch.rate_limit_per_user;
  await channel.save();
  return formatChannel(channel);
})
.delete('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  await Channel.findByIdAndDelete(params.channelId);
  return formatChannel({ _id: params.channelId });
})

// ─── Messages ──────────────────────────────────────────────
.get('/channels/:channelId/messages', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const messages = await Message.find({ channelId: params.channelId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('authorId')
    .lean();
  return messages.map(formatMessage);
})
.get('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId).populate('authorId').lean();
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  return formatMessage(msg);
})
.post('/channels/:channelId/messages', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId).lean();
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const { content, embeds, tts, attachments, allowed_mentions, sticker_ids, components, flags } = body as any;
  if (!content && !embeds?.length && !attachments?.length && !sticker_ids?.length) {
    set.status = 400; return { code: 50006, message: 'Cannot send an empty message' };
  }

  const msg = await Message.create({
    channelId: new Types.ObjectId(params.channelId),
    serverId: channel.serverId ?? null,
    authorId: auth.botUser._id,
    content: content || '',
    embeds: embeds ?? [],
    attachments: attachments ?? [],
    type: 'default',
    pinned: false,
    edited: false,
    reactions: [],
  });

  const populated = await Message.findById(msg._id).populate('authorId').lean();

  // Deliver to the web client SSE streams and the bot gateway.
  try {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(params.channelId, { type: 'message', message: formatMessage(populated) });
  } catch {}
  try {
    const { emitMessageCreate } = await import('@/lib/services/gatewayEvents');
    const author = populated?.authorId as any;
    await emitMessageCreate({
      id: msg._id.toString(),
      content: msg.content ?? '',
      channelId: params.channelId,
      serverId: channel.serverId?.toString() ?? null,
      createdAt: (populated as any)?.createdAt,
      author: author && author._id ? {
        id: author._id.toString(),
        username: author.username,
        displayName: author.displayName,
        avatar: author.avatar,
        isBot: author.isBot,
        isSystem: author.isSystem,
      } : null,
      attachments: (msg.attachments ?? []) as any,
    });
  } catch {}

  return formatMessage(populated);
})
.patch('/channels/:channelId/messages/:messageId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  // Only the author can edit
  if (!compareIds(msg.authorId, auth.botUser._id)) {
    set.status = 403; return { code: 50003, message: 'Cannot edit a message authored by another user' };
  }

  const { content, embeds } = body as any;
  if (content !== undefined) msg.content = content;
  if (embeds !== undefined) msg.embeds = embeds;
  msg.edited = true;
  await msg.save();

  const populated = await Message.findById(msg._id).populate('authorId').lean();
  return formatMessage(populated);
})
.delete('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  // Author or manage messages permission
  const isAuthor = compareIds(msg.authorId, auth.botUser._id);
  if (!isAuthor) {
    // TODO: check MANAGE_MESSAGES permission via server member roles
  }

  await msg.deleteOne();
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

  await Message.deleteMany({ _id: { $in: messages.map((id: string) => new Types.ObjectId(id)) } });
  return { deleted_messages: messages };
})

// ─── Reactions ─────────────────────────────────────────────
.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  let reaction = msg.reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (!reaction) {
    reaction = { emoji: { name: emojiKey }, count: 0, userIds: [] as any[] };
    msg.reactions.push(reaction);
  }
  if (!reaction.userIds.some((uid: any) => uid.toString() === auth.botUser._id.toString())) {
    reaction.userIds.push(auth.botUser._id);
    reaction.count = reaction.userIds.length;
  }
  await msg.save();
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reaction = msg.reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (reaction) {
    reaction.userIds = reaction.userIds.filter((uid: any) => uid.toString() !== auth.botUser._id.toString());
    reaction.count = reaction.userIds.length;
    if (reaction.count === 0) {
      msg.reactions = msg.reactions.filter((r: any) => r !== reaction);
    }
    await msg.save();
  }
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId);
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reaction = msg.reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (reaction) {
    reaction.userIds = reaction.userIds.filter((uid: any) => uid.toString() !== params.userId);
    reaction.count = reaction.userIds.length;
    if (reaction.count === 0) {
      msg.reactions = msg.reactions.filter((r: any) => r !== reaction);
    }
    await msg.save();
  }
  set.status = 204;
  return '';
})
.get('/channels/:channelId/messages/:messageId/reactions/:emoji', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  const msg = await Message.findById(params.messageId).lean();
  if (!msg) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }

  const emojiKey = params.emoji;
  const reaction = msg.reactions.find((r: any) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (!reaction) return [];

  const limit = Math.min(parseInt(query.limit as string) || 25, 100);
  const userIds = reaction.userIds.slice(0, limit);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  return users.map(formatUser);
})
.delete('/channels/:channelId/messages/:messageId/reactions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  await Message.updateOne({ _id: params.messageId }, { reactions: [] });
  set.status = 204;
  return '';
})

// ─── Pins ──────────────────────────────────────────────────
.get('/channels/:channelId/pins', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const messages = await Message.find({ channelId: params.channelId, pinned: true })
    .populate('authorId').lean();
  return messages.map(formatMessage);
})
.put('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  await Message.updateOne({ _id: params.messageId }, { pinned: true });
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.messageId)) { set.status = 404; return { code: 10008, message: 'Unknown Message' }; }
  await Message.updateOne({ _id: params.messageId }, { pinned: false });
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
  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: null }).lean();
  return cmds.map((c: any) => ({
    id: c._id.toString(),
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
  await AppCommand.deleteMany({ applicationId: params.appId, guildId: null });
  const created = commands.length
    ? await AppCommand.insertMany(commands.map((c: any) => ({
        applicationId: new Types.ObjectId(params.appId),
        guildId: null,
        name: c.name,
        description: c.description ?? '',
        options: c.options ?? [],
        defaultPermission: c.default_permission ?? true,
        type: c.type ?? 1,
      })))
    : [];
  return created.map((c: any) => ({
    id: c._id.toString(),
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

  const invite = await Invite.findOne({ code: params.code }).lean();
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  return formatInvite(invite);
})
.delete('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const invite = await Invite.findOneAndDelete({ code: params.code }).lean();
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  return formatInvite(invite);
})

// ─── Guild Channel CRUD ────────────────────────────────────
.post('/guilds/:guildId/channels', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }

  const channelCount = await Channel.countDocuments({ serverId: params.guildId });
  if (channelCount >= config.MAX_CHANNELS_PER_SERVER) {
    set.status = 400;
    return { code: 30013, message: 'Maximum number of guild channels reached' };
  }

  const { name, type, topic, nsfw, parent_id, rate_limit_per_user, position } = body as any;
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }

  const typeReverseMap: Record<number, string> = {
    0: 'text', 2: 'voice', 4: 'category', 5: 'announcement',
    13: 'stage', 15: 'forum',
  };

  const channel = await Channel.create({
    serverId: new Types.ObjectId(params.guildId),
    name,
    type: typeReverseMap[type] ?? 'text',
    topic: topic ?? '',
    nsfw: nsfw ?? false,
    parentId: parent_id ? new Types.ObjectId(parent_id) : undefined,
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
  if (patch.name !== undefined) channel.name = patch.name;
  if (patch.topic !== undefined) channel.topic = patch.topic;
  if (patch.nsfw !== undefined) channel.nsfw = patch.nsfw;
  if (patch.position !== undefined) channel.position = patch.position;
  if (patch.rate_limit_per_user !== undefined) channel.rateLimitPerUser = patch.rate_limit_per_user;
  if (patch.parent_id !== undefined) channel.parentId = patch.parent_id ? new Types.ObjectId(patch.parent_id) : undefined;
  await channel.save();
  return formatChannel(channel);
})
.delete('/guilds/:guildId/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await Channel.findByIdAndDelete(params.channelId);
  set.status = 204;
  return '';
})

// ─── Guild Role CRUD ───────────────────────────────────────
.post('/guilds/:guildId/roles', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { name, color, hoist, permissions, mentionable, icon, unicode_emoji } = body as any;

  const role = await Role.create({
    serverId: new Types.ObjectId(params.guildId),
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
  if (patch.name !== undefined) role.name = patch.name;
  if (patch.color !== undefined) role.color = patch.color;
  if (patch.hoist !== undefined) role.hoist = patch.hoist;
  if (patch.permissions !== undefined) role.permissions = patch.permissions;
  if (patch.mentionable !== undefined) role.mentionable = patch.mentionable;
  if (patch.position !== undefined) role.position = patch.position;
  await role.save();
  return formatRole(role);
})
.delete('/guilds/:guildId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await Role.findByIdAndDelete(params.roleId);
  set.status = 204;
  return '';
})

// ─── Guild Member Management ───────────────────────────────
.patch('/guilds/:guildId/members/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId) || !Types.ObjectId.isValid(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const patch = body as any;
  if (patch.nick !== undefined) member.nickname = patch.nick;
  if (patch.roles !== undefined) member.roles = patch.roles.map((r: string) => new Types.ObjectId(r));
  if (patch.deaf !== undefined) member.deaf = patch.deaf;
  if (patch.mute !== undefined) member.mute = patch.mute;
  if (patch.communication_disabled_until !== undefined) {
    member.communicationDisabledUntil = patch.communication_disabled_until ? new Date(patch.communication_disabled_until) : undefined;
  }
  await member.save();

  const user = await User.findById(params.userId).lean();
  return formatMember(member, user);
})
.patch('/guilds/:guildId/members/@me/nick', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const member = await ServerMember.findOne({ serverId: params.guildId, userId: auth.botUser._id });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const { nick } = body as any;
  member.nickname = nick;
  await member.save();
  return nick;
})
.delete('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId) || !Types.ObjectId.isValid(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  await ServerMember.deleteOne({ serverId: params.guildId, userId: params.userId });
  await Server.updateOne({ _id: params.guildId }, { $inc: { memberCount: -1 } });
  set.status = 204;
  return '';
})

// ─── Guild Bans ────────────────────────────────────────────
.put('/guilds/:guildId/bans/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId) || !Types.ObjectId.isValid(params.userId)) {
    set.status = 404; return { code: 10004, message: 'Unknown Guild' };
  }
  const { reason } = body as any;

  // Remove member if exists
  await ServerMember.deleteOne({ serverId: params.guildId, userId: params.userId });
  // Create ban
  await ServerBan.create({
    serverId: new Types.ObjectId(params.guildId),
    userId: new Types.ObjectId(params.userId),
    bannedBy: auth.botUser._id,
    reason: reason ?? null,
  });
  await Server.updateOne({ _id: params.guildId }, { $inc: { memberCount: -1 } });
  set.status = 204;
  return '';
})
.get('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId }).lean();
  if (!ban) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  return { reason: ban.reason ?? null, user: { id: ban.userId.toString() } };
})
.delete('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await ServerBan.deleteOne({ serverId: params.guildId, userId: params.userId });
  set.status = 204;
  return '';
})

// ─── Guild Emoji CRUD ──────────────────────────────────────
.get('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.emojiId)) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }
  const emoji = await ServerEmoji.findById(params.emojiId).lean();
  if (!emoji) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }
  return {
    id: emoji._id.toString(),
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

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { name, image, roles } = body as any;
  if (!name || !image) { set.status = 400; return { code: 50035, message: 'Name and image are required' }; }

  const emoji = await ServerEmoji.create({
    serverId: new Types.ObjectId(params.guildId),
    name,
    imageUrl: image,
    animated: image.startsWith('data:image/gif'),
    available: true,
    managed: false,
    requireColons: true,
    roles: [],
    uploadedBy: auth.botUser._id,
  });
  return {
    id: emoji._id.toString(),
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
  if (name !== undefined) emoji.name = name;
  await emoji.save();
  return {
    id: emoji._id.toString(),
    name: emoji.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: emoji.animated,
    available: true,
  };
})
.delete('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await ServerEmoji.findByIdAndDelete(params.emojiId);
  set.status = 204;
  return '';
})

// ─── Guild Stickers ────────────────────────────────────────
.get('/guilds/:guildId/stickers', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const stickers = await ServerSticker.find({ serverId: params.guildId }).lean();
  return stickers.map((s: any) => ({
    id: s._id.toString(),
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

  if (!Types.ObjectId.isValid(params.stickerId)) { set.status = 404; return { code: 10011, message: 'Unknown Sticker' }; }
  const sticker = await ServerSticker.findById(params.stickerId).lean();
  if (!sticker) { set.status = 404; return { code: 10011, message: 'Unknown Sticker' }; }
  return {
    id: sticker._id.toString(),
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

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const webhooks = await ChannelWebhook.find({ serverId: params.guildId }).lean();
  return webhooks.map((w: any) => ({
    id: w._id.toString(),
    type: 1,
    guild_id: params.guildId,
    channel_id: w.channelId.toString(),
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId.toString(),
  }));
})
.get('/channels/:channelId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const webhooks = await ChannelWebhook.find({ channelId: params.channelId }).lean();
  return webhooks.map((w: any) => ({
    id: w._id.toString(),
    type: 1,
    guild_id: w.serverId?.toString() ?? null,
    channel_id: params.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId.toString(),
  }));
})
.post('/channels/:channelId/webhooks', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId).lean();
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const { name, avatar } = body as any;
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }

  const token = crypto.randomBytes(24).toString('hex');
  const webhook = await ChannelWebhook.create({
    channelId: new Types.ObjectId(params.channelId),
    serverId: channel.serverId ?? undefined,
    name,
    avatar: avatar ?? null,
    token,
    url: `${config.API_BASE_URL}/api/webhooks/${params.channelId}/${token}`,
    creatorId: auth.botUser._id,
  });
  return {
    id: webhook._id.toString(),
    type: 1,
    guild_id: channel.serverId?.toString() ?? null,
    channel_id: params.channelId,
    name: webhook.name,
    avatar: webhook.avatar,
    token: webhook.token,
    creator_id: auth.botUser._id.toString(),
  };
})
.get('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.webhookId)) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const webhook = await ChannelWebhook.findById(params.webhookId).lean();
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return {
    id: webhook._id.toString(),
    type: 1,
    guild_id: webhook.serverId?.toString() ?? null,
    channel_id: webhook.channelId.toString(),
    name: webhook.name,
    avatar: webhook.avatar,
    token: webhook.token,
    creator_id: webhook.creatorId.toString(),
  };
})
.delete('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await ChannelWebhook.findByIdAndDelete(params.webhookId);
  set.status = 204;
  return '';
})

// ─── Audit Log ─────────────────────────────────────────────
.get('/guilds/:guildId/audit-logs', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { AdminLog } = await import('@/lib/models');
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const logs = await AdminLog.find({ targetId: params.guildId }).sort({ createdAt: -1 }).limit(limit).lean();
  return {
    audit_log_entries: logs.map((l: any) => ({
      id: l._id.toString(),
      action_type: l.action ?? 0,
      user_id: l.adminId?.toString() ?? null,
      target_id: l.targetId?.toString() ?? null,
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

  const dmChannels = await Channel.find({
    type: { $in: ['dm', 'group_dm'] },
    recipientIds: auth.botUser._id,
  }).lean();
  return dmChannels.map(formatChannel);
})
.post('/users/@me/channels', async ({ headers, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { recipient_id } = body as any;
  if (!recipient_id || !Types.ObjectId.isValid(recipient_id)) {
    set.status = 400; return { code: 50035, message: 'Invalid recipient_id' };
  }

  // Check if DM channel already exists
  let dm = await Channel.findOne({
    type: 'dm',
    recipientIds: { $all: [auth.botUser._id, new Types.ObjectId(recipient_id)] },
  }).lean();

  if (!dm) {
    dm = await Channel.create({
      type: 'dm',
      recipientIds: [auth.botUser._id, new Types.ObjectId(recipient_id)],
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

  if (!Types.ObjectId.isValid(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  await ServerMember.deleteOne({ serverId: params.guildId, userId: auth.botUser._id });
  await Server.updateOne({ _id: params.guildId }, { $inc: { memberCount: -1 } });
  set.status = 204;
  return '';
})

// ─── Application Command CRUD ──────────────────────────────
.get('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!Types.ObjectId.isValid(params.commandId)) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  const cmd = await AppCommand.findById(params.commandId).lean();
  if (!cmd) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  return {
    id: cmd._id.toString(),
    application_id: cmd.applicationId.toString(),
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
    applicationId: new Types.ObjectId(params.appId),
    name,
    description,
    options: options ?? [],
    defaultPermission: default_permission ?? true,
    type: type ?? 1,
  });
  return {
    id: cmd._id.toString(),
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
  if (name !== undefined) cmd.name = name;
  if (description !== undefined) cmd.description = description;
  if (options !== undefined) cmd.options = options;
  if (default_permission !== undefined) cmd.defaultPermission = default_permission;
  await cmd.save();
  return {
    id: cmd._id.toString(),
    application_id: params.appId,
    name: cmd.name,
    description: cmd.description,
    options: cmd.options,
    default_permission: cmd.defaultPermission,
    type: cmd.type,
    version: cmd.version,
  };
})
.delete('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  await AppCommand.findByIdAndDelete(params.commandId);
  set.status = 204;
  return '';
})

// ─── Guild Application Commands ────────────────────────────
.get('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: params.guildId }).lean();
  return cmds.map((c: any) => ({
    id: c._id.toString(),
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
  await AppCommand.deleteMany({ applicationId: params.appId, guildId: params.guildId });
  const created = await AppCommand.insertMany(commands.map((c: any) => ({
    applicationId: new Types.ObjectId(params.appId),
    guildId: new Types.ObjectId(params.guildId),
    name: c.name,
    description: c.description,
    options: c.options ?? [],
    defaultPermission: c.default_permission ?? true,
    type: c.type ?? 1,
  })));
  return created.map((c: any) => ({
    id: c._id.toString(),
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
