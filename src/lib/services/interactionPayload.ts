/**
 * Discord-shaped pieces of an interaction payload: users, members (with
 * channel permissions), partial channels and guilds, `data.resolved`, and
 * message objects (for component interactions, message commands, followup /
 * with_response replies).
 *
 * Everything an invoker can put into `resolved` is checked first: users must be
 * members of the guild (or recipients of the DM), roles must belong to the
 * guild, channels must be in the guild and visible to the invoker, attachments
 * must be the invoker's own uploads. So a crafted request can't make the bot
 * reveal a hidden channel's name or another server's data.
 */
import { Channel, Message, Role, ServerMember, User, type IChannel, type IMessage } from '@/lib/models';
import { config } from '@/lib/config';
import { decryptFromStorage } from '@/lib/security';
import { toDiscordMessage } from '@/lib/services/gatewayEvents';
import { parseStoredComponents } from '@/lib/botapi/components';
import { validateMessageAttachments, type IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import type { InvocationRefs } from '@/lib/botapi/commands';

const CHANNEL_TYPES: Record<string, number> = {
  text: 0, dm: 1, voice: 2, group_dm: 3, category: 4, announcement: 5,
  announcement_thread: 10, public_thread: 11, private_thread: 12,
  stage_voice: 13, directory: 14, forum: 15, media: 16,
};

export function discordChannelType(type: string | null | undefined): number {
  return CHANNEL_TYPES[String(type ?? 'text')] ?? 0;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

type UserRow = NonNullable<Awaited<ReturnType<typeof User.findById>>>;

export function discordUser(u: Pick<UserRow, 'id' | 'username'> & Partial<Pick<UserRow, 'displayName' | 'avatar' | 'isBot' | 'isSystem'>>) {
  return {
    id: u.id,
    username: u.username,
    global_name: u.displayName || u.username,
    avatar: u.avatar ?? null,
    discriminator: '0',
    public_flags: 0,
    bot: Boolean(u.isBot),
    ...(u.isSystem ? { system: true } : {}),
    avatar_decoration_data: null,
  };
}

type MemberRow = NonNullable<Awaited<ReturnType<typeof ServerMember.findOne>>>;

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Guild member object; `withUser` false for resolved.members (Discord omits it there). */
export function discordMember(member: MemberRow, user: UserRow | null, permissions: bigint | null, withUser = true) {
  return {
    ...(withUser && user ? { user: discordUser(user) } : {}),
    nick: member.nickname ?? null,
    avatar: (member as { avatar?: string | null }).avatar ?? null,
    roles: ((member.roles || []) as string[]).map(String),
    joined_at: iso(member.joinedAt) ?? new Date(0).toISOString(),
    premium_since: iso((member as { premiumSince?: Date | null }).premiumSince ?? null),
    deaf: false,
    mute: false,
    flags: 0,
    pending: Boolean((member as { pending?: boolean }).pending),
    ...(permissions !== null ? { permissions: permissions.toString() } : {}),
    communication_disabled_until: iso(member.communicationDisabledUntil),
  };
}

/** Partial channel as interactions carry it (with the invoker's permissions). */
export function discordPartialChannel(channel: IChannel, permissions: bigint | null) {
  return {
    id: channel.id,
    type: discordChannelType(channel.type),
    name: channel.name ?? null,
    guild_id: channel.serverId ?? undefined,
    parent_id: channel.parentId ?? null,
    nsfw: Boolean(channel.nsfw),
    topic: channel.topic ?? null,
    position: channel.position ?? 0,
    ...(permissions !== null ? { permissions: permissions.toString() } : {}),
    ...(channel.type === 'dm' || channel.type === 'group_dm'
      ? { recipients: [] as unknown[] }
      : {}),
  };
}

/** Bytes an attachment may have (what the bot may upload in a response). */
export function attachmentSizeLimit(): number {
  return config.MAX_FILE_SIZE;
}

/** Discord message object for a stored message (content decrypted; E2EE → empty). */
export async function discordMessageFromRow(row: IMessage, author?: UserRow | { id: string; username: string; displayName?: string; avatar?: string | null; isBot?: boolean } | null) {
  let content = '';
  if (row.content && !row.e2ee) {
    try { content = await decryptFromStorage(row.content); } catch { content = ''; }
  }
  const a = author ?? (row.authorId ? await User.findById(row.authorId) : null);
  const interaction = row.interaction as { id?: string; type?: number; name?: string; user?: { id: string; username?: string } } | null;
  return toDiscordMessage({
    id: row.id,
    content,
    channelId: row.channelId,
    serverId: row.serverId,
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    edited: Boolean(row.edited),
    pinned: Boolean(row.pinned),
    type: row.type ?? 'default',
    author: a ? { id: a.id, username: a.username, displayName: a.displayName ?? undefined, avatar: a.avatar ?? null, isBot: Boolean((a as { isBot?: boolean }).isBot) } : null,
    attachments: (Array.isArray(row.attachments) ? row.attachments : []) as Array<Record<string, unknown>>,
    flags: row.flags ?? 0,
    mentionEveryone: Boolean(row.mentionEveryone),
    mentionedUserIds: (row.mentionedUserIds ?? []) as string[],
    mentionedRoleIds: (row.mentionedRoleIds ?? []) as string[],
    reactions: [],
    embeds: Array.isArray(row.embeds) ? row.embeds : [],
    components: parseStoredComponents(row.components) ?? [],
    interaction: interaction?.id ? interaction : null,
  });
}

export interface ResolveContext {
  invokerId: string;
  channel: IChannel;
  /** Uploads the invoker attached to an ATTACHMENT option, by id. */
  attachments?: IncomingAttachment[];
  /** Message-command target (already checked to be in this channel). */
  targetMessage?: IMessage | null;
}

export type ResolvedResult =
  | { ok: true; resolved: Record<string, Record<string, unknown>> }
  | { ok: false; reason: string };

/**
 * Build `data.resolved` for the ids an invocation references, refusing ids the
 * invoker couldn't have picked in the client.
 */
export async function buildResolved(ctx: ResolveContext, refs: InvocationRefs & { messages?: string[] }): Promise<ResolvedResult> {
  const { channel } = ctx;
  const guildId = channel.serverId ?? null;
  const users: Record<string, unknown> = {};
  const members: Record<string, unknown> = {};
  const roles: Record<string, unknown> = {};
  const channels: Record<string, unknown> = {};
  const attachments: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};

  const userIds = new Set(refs.users);
  const roleIds = new Set(refs.roles);
  // Mentionables are a user or a role: whichever exists.
  const mentionables = [...new Set(refs.mentionables)];

  let guildRoles: Awaited<ReturnType<typeof Role.find>> = [];
  if (guildId && (roleIds.size || mentionables.length)) guildRoles = await Role.find({ serverId: guildId });
  const roleById = new Map(guildRoles.map((r) => [String(r.id).toLowerCase(), r]));
  for (const m of mentionables) {
    if (roleById.has(m)) roleIds.add(m);
    else userIds.add(m);
  }

  // Users (and members in a guild).
  if (userIds.size > 25 || roleIds.size > 25 || refs.channels.length > 25 || refs.attachments.length > 10) return { ok: false, reason: 'too_many' };
  if (userIds.size) {
    const list = await User.find({ id: { in: [...userIds] } });
    if (list.length !== userIds.size) return { ok: false, reason: 'unknown_user' };
    const { getMemberChannelPermissions } = guildId ? await import('@/lib/api/channels') : { getMemberChannelPermissions: null };
    for (const u of list) {
      if (guildId) {
        const member = await ServerMember.findOne({ serverId: guildId, userId: u.id });
        if (!member) return { ok: false, reason: 'unknown_member' };
        const perms = getMemberChannelPermissions ? await getMemberChannelPermissions(u.id, channel as IChannel & { serverId: string }, member) : 0n;
        members[u.id] = discordMember(member, u, perms, false);
      } else if (!((channel.recipientIds || []) as string[]).some((r) => same(r, u.id))) {
        return { ok: false, reason: 'unknown_user' };
      }
      users[u.id] = discordUser(u);
    }
  }

  // Roles of this guild only.
  for (const id of roleIds) {
    const r = roleById.get(id);
    if (!r || !guildId) return { ok: false, reason: 'unknown_role' };
    roles[r.id] = {
      id: r.id,
      name: r.name,
      color: typeof r.color === 'number' ? r.color : parseInt(String(r.color ?? '0').replace('#', ''), 16) || 0,
      hoist: Boolean(r.hoist),
      icon: null,
      unicode_emoji: null,
      position: r.position ?? 0,
      permissions: String(r.permissions ?? '0'),
      managed: Boolean((r as { managed?: boolean }).managed),
      mentionable: Boolean(r.mentionable),
      flags: 0,
    };
  }

  // Channels in this guild the invoker can see (DMs: only this one).
  if (refs.channels.length) {
    const { checkChannelAccess, getMemberChannelPermissions } = await import('@/lib/api/channels');
    for (const id of new Set(refs.channels)) {
      if (!guildId) {
        if (!same(id, channel.id)) return { ok: false, reason: 'unknown_channel' };
        channels[channel.id] = discordPartialChannel(channel, null);
        continue;
      }
      const access = await checkChannelAccess(ctx.invokerId, id);
      const ch = access.channel as IChannel | undefined;
      if (!access.hasAccess || !ch || !same(ch.serverId, guildId)) return { ok: false, reason: 'unknown_channel' };
      const perms = await getMemberChannelPermissions(ctx.invokerId, ch as IChannel & { serverId: string }, access.membership ?? null);
      channels[ch.id] = discordPartialChannel(ch, perms);
    }
  }

  // The invoker's own uploads only.
  if (refs.attachments.length) {
    const byId = new Map((ctx.attachments ?? []).map((a) => [String(a.id), a]));
    const picked: IncomingAttachment[] = [];
    for (const id of new Set(refs.attachments)) {
      const a = byId.get(id);
      if (!a) return { ok: false, reason: 'unknown_attachment' };
      picked.push(a);
    }
    const bad = validateMessageAttachments(picked, { cdnUrl: config.CDN_URL, userId: ctx.invokerId });
    if (bad) return { ok: false, reason: 'unknown_attachment' };
    for (const a of picked) {
      attachments[a.id] = {
        id: a.id,
        filename: a.filename,
        size: a.size ?? 0,
        url: a.url,
        proxy_url: a.url,
        content_type: a.contentType,
        ...(a.width ? { width: a.width, height: a.height } : {}),
        ephemeral: true,
      };
    }
  }

  if (ctx.targetMessage) {
    messages[ctx.targetMessage.id] = await discordMessageFromRow(ctx.targetMessage);
  }

  const resolved: Record<string, Record<string, unknown>> = {};
  if (Object.keys(users).length) resolved.users = users;
  if (Object.keys(members).length) resolved.members = members;
  if (Object.keys(roles).length) resolved.roles = roles;
  if (Object.keys(channels).length) resolved.channels = channels;
  if (Object.keys(attachments).length) resolved.attachments = attachments;
  if (Object.keys(messages).length) resolved.messages = messages;
  return { ok: true, resolved };
}

/** A live message in `channelId` (not deleted), or null. */
export async function loadLiveMessage(channelId: string, messageId: string): Promise<IMessage | null> {
  const msg = await Message.findById(messageId).catch(() => null);
  if (!msg || msg.isDeleted || !same(msg.channelId, channelId)) return null;
  return msg;
}

/** Re-load a channel row (used after access checks that return `any`). */
export async function loadChannel(id: string): Promise<IChannel | null> {
  return Channel.findById(id).catch(() => null);
}
