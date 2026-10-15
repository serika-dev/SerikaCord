import { getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { toDiscordPoll, type PollResultData, type StoredPoll } from '@/lib/chat/polls';
import type { ForwardView } from '@/lib/chat/forward';
import { toDiscordVoiceFields, type VoiceAttachmentMeta } from '@/lib/chat/voiceMessage';
import { PERMISSION_BITS } from '@/lib/permissions/bits';

/**
 * Central bus that feeds the standalone bot Gateway (scripts/gateway.ts).
 *
 * The main app publishes Discord-shaped dispatch payloads to a single Redis
 * channel; the gateway process subscribes and fans each event out to the
 * connected bots that are members of the relevant guild (respecting intents).
 */

export const GATEWAY_CHANNEL = 'gateway:dispatch';

/** Gateway intent bits (subset, matching Discord). */
export const Intents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_PRESENCES: 1 << 8,
  GUILD_MODERATION: 1 << 2,
  GUILD_MESSAGES: 1 << 9,
  GUILD_SCHEDULED_EVENTS: 1 << 16,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
  AUTO_MODERATION_CONFIGURATION: 1 << 20,
  AUTO_MODERATION_EXECUTION: 1 << 21,
  GUILD_MESSAGE_POLLS: 1 << 24,
  DIRECT_MESSAGE_POLLS: 1 << 25,
} as const;

export interface GatewayDispatch {
  /** Discord dispatch event name, e.g. MESSAGE_CREATE. */
  t: string;
  /** Guild the event belongs to (null for DM events). */
  guildId: string | null;
  /** Intent bit required to receive this event (0 = always delivered). */
  intent: number;
  /** Discord-shaped payload. */
  d: unknown;
  /** Optional target bot ID to send this dispatch strictly to. */
  targetBotId?: string;
  /**
   * User ids allowed to receive this dispatch. Channel-scoped events set it:
   * a DM's recipients, or the bots that can view the guild channel
   * (./gatewayAudience.ts). The gateway delivers only to bots listed here, and
   * a guild-less event without it reaches nobody (src/lib/gateway/routing.ts).
   */
  audience?: string[];
}

async function publish(dispatch: GatewayDispatch) {
  try {
    const pub = getPublisher();
    if (pub) await pub.publish(GATEWAY_CHANNEL, JSON.stringify(dispatch));
  } catch {
    // Best-effort — the web app must never fail because the gateway bus is down.
  }
}

/**
 * Publish an event that belongs to one channel (messages, deletes, poll votes)
 * only to the bots allowed to see that channel. Nothing is published when no
 * bot may see it (or the channel is unknown): default-deny.
 */
async function publishChannelScoped(dispatch: Omit<GatewayDispatch, 'audience'>, channelId: string | null | undefined) {
  if (!channelId) return;
  try {
    const { channelAudience } = await import('./gatewayAudience');
    const audience = await channelAudience(channelId, dispatch.guildId);
    if (audience.length === 0) return;
    await publish({ ...dispatch, audience });
  } catch {
    // Best-effort, like publish().
  }
}

/**
 * Publish a guild-wide event only to the bot members whose server permissions
 * include `bit` (e.g. VIEW_AUDIT_LOG for audit-log entries), like Discord.
 */
async function publishGuildPermissionScoped(dispatch: Omit<GatewayDispatch, 'audience'>, bit: bigint) {
  if (!dispatch.guildId) return;
  try {
    const { guildPermissionBotAudience } = await import('./gatewayAudience');
    const audience = await guildPermissionBotAudience(dispatch.guildId, bit);
    if (audience.length === 0) return;
    await publish({ ...dispatch, audience });
  } catch {
    // Best-effort, like publish().
  }
}

// ─── Shape converters ──────────────────────────────────────

/** Internal message payload shape as produced by channels.ts / dms.ts. */
interface InternalMessage {
  id: string;
  content?: string;
  channelId: string;
  serverId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  edited?: boolean;
  pinned?: boolean;
  type?: number | string;
  author?: {
    id: string;
    username?: string;
    displayName?: string;
    avatar?: string | null;
    isBot?: boolean;
    isSystem?: boolean;
  } | null;
  attachments?: Array<Record<string, unknown>>;
  /** Discord message flags (SUPPRESS_NOTIFICATIONS, IS_VOICE_MESSAGE, ...). */
  flags?: number | null;
  reactions?: unknown[];
  mentionEveryone?: boolean;
  mentionedUserIds?: string[];
  mentionedRoleIds?: string[];
  referencedMessageId?: string;
  referencedMessage?: {
    id: string;
    content?: string;
    author?: { id: string; username?: string; displayName?: string; avatar?: string | null };
    createdAt?: Date | string;
  };
  poll?: StoredPoll | null;
  pollResult?: PollResultData | null;
  forward?: ForwardView | null;
}

/** Discord message type numbers for our string types. */
const MESSAGE_TYPE_NUMBERS: Record<string, number> = { default: 0, reply: 19, call: 3, poll_result: 46 };

function iso(d?: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function toDiscordUser(a: NonNullable<InternalMessage['author']>) {
  return {
    id: a.id,
    username: a.username ?? '',
    global_name: a.displayName ?? a.username ?? null,
    display_name: a.displayName ?? a.username ?? null,
    avatar: a.avatar ?? null,
    bot: a.isBot ?? false,
    system: a.isSystem ?? false,
    discriminator: '0',
    public_flags: 0,
  };
}

export function toDiscordMessage(m: InternalMessage) {
  return {
    id: m.id,
    channel_id: m.channelId,
    guild_id: m.serverId ?? null,
    author: m.author ? toDiscordUser(m.author) : null,
    content: m.content ?? '',
    timestamp: iso(m.createdAt),
    edited_timestamp: m.edited ? iso(m.updatedAt) : null,
    tts: false,
    mention_everyone: m.mentionEveryone ?? false,
    mentions: (m.mentionedUserIds ?? []).map((id) => ({ id })),
    mention_roles: m.mentionedRoleIds ?? [],
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id ?? '0',
      filename: a.filename,
      size: a.size ?? 0,
      url: a.url,
      proxy_url: a.proxyUrl ?? a.url,
      content_type: a.contentType,
      width: a.width,
      height: a.height,
      ...(typeof a.description === 'string' ? { description: a.description } : {}),
      ...toDiscordVoiceFields(a as VoiceAttachmentMeta),
    })),
    embeds: [],
    reactions: m.reactions ?? [],
    pinned: m.pinned ?? false,
    type: typeof m.type === 'number' ? m.type : (MESSAGE_TYPE_NUMBERS[String(m.type)] ?? 0),
    flags: typeof m.flags === 'number' ? m.flags : 0,
    ...(m.poll ? { poll: toDiscordPoll(m.poll) } : {}),
    ...(m.pollResult ? {
      embeds: [{
        type: 'poll_result',
        fields: [
          { name: 'poll_question_text', value: m.pollResult.question, inline: false },
          { name: 'total_votes', value: String(m.pollResult.totalVotes), inline: false },
          ...(m.pollResult.winnerIds.length === 1 ? (() => {
            const w = m.pollResult!.answers.find((a) => a.id === m.pollResult!.winnerIds[0]);
            return w ? [
              { name: 'victor_answer_id', value: String(w.id), inline: false },
              { name: 'victor_answer_text', value: w.text, inline: false },
              { name: 'victor_answer_votes', value: String(w.votes), inline: false },
            ] : [];
          })() : []),
        ],
      }],
    } : {}),
    ...(m.forward ? {
      message_snapshots: [{
        message: {
          content: m.forward.content,
          attachments: m.forward.attachments,
          embeds: m.forward.embeds,
          timestamp: m.forward.createdAt,
          edited_timestamp: null,
          type: 0,
          flags: 0,
        },
      }],
    } : {}),
    referenced_message: m.referencedMessage
      ? {
          id: m.referencedMessage.id,
          channel_id: m.channelId,
          content: m.referencedMessage.content ?? '',
          author: m.referencedMessage.author ? toDiscordUser(m.referencedMessage.author) : null,
          timestamp: iso(m.referencedMessage.createdAt),
        }
      : null,
    message_reference: m.forward
      ? { type: 1, message_id: m.forward.messageId, channel_id: m.forward.channelId }
      : m.referencedMessageId
        ? { type: 0, message_id: m.referencedMessageId, channel_id: m.channelId, guild_id: m.serverId ?? undefined }
        : undefined,
  };
}

// ─── Public emitters ───────────────────────────────────────

export function emitMessageCreate(message: InternalMessage) {
  const isDM = !message.serverId;
  return publishChannelScoped({
    t: 'MESSAGE_CREATE',
    guildId: message.serverId ?? null,
    intent: isDM ? Intents.DIRECT_MESSAGES : Intents.GUILD_MESSAGES,
    d: toDiscordMessage(message),
  }, message.channelId);
}

export function emitMessageUpdate(message: InternalMessage) {
  const isDM = !message.serverId;
  return publishChannelScoped({
    t: 'MESSAGE_UPDATE',
    guildId: message.serverId ?? null,
    intent: isDM ? Intents.DIRECT_MESSAGES : Intents.GUILD_MESSAGES,
    d: toDiscordMessage(message),
  }, message.channelId);
}

/**
 * MESSAGE_POLL_VOTE_ADD / _REMOVE for each answer a vote change added or
 * removed, like Discord (one event per answer).
 */
export async function emitPollVoteChanges(opts: {
  userId: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  previous: number[];
  next: number[];
}) {
  const before = new Set(opts.previous);
  const after = new Set(opts.next);
  const intent = opts.guildId ? Intents.GUILD_MESSAGE_POLLS : Intents.DIRECT_MESSAGE_POLLS;
  const base = { user_id: opts.userId, channel_id: opts.channelId, message_id: opts.messageId, ...(opts.guildId ? { guild_id: opts.guildId } : {}) };
  for (const id of after) {
    if (!before.has(id)) await publishChannelScoped({ t: 'MESSAGE_POLL_VOTE_ADD', guildId: opts.guildId, intent, d: { ...base, answer_id: id } }, opts.channelId);
  }
  for (const id of before) {
    if (!after.has(id)) await publishChannelScoped({ t: 'MESSAGE_POLL_VOTE_REMOVE', guildId: opts.guildId, intent, d: { ...base, answer_id: id } }, opts.channelId);
  }
}

export function emitMessageDelete(opts: { id: string; channelId: string; guildId?: string | null }) {
  return publishChannelScoped({
    t: 'MESSAGE_DELETE',
    guildId: opts.guildId ?? null,
    intent: opts.guildId ? Intents.GUILD_MESSAGES : Intents.DIRECT_MESSAGES,
    d: { id: opts.id, channel_id: opts.channelId, guild_id: opts.guildId ?? null },
  }, opts.channelId);
}

export function emitGuildMemberAdd(opts: { guildId: string; member: unknown }) {
  return publish({
    t: 'GUILD_MEMBER_ADD',
    guildId: opts.guildId,
    intent: Intents.GUILD_MEMBERS,
    d: { guild_id: opts.guildId, ...(opts.member as object) },
  });
}

export function emitGuildMemberRemove(opts: { guildId: string; user: unknown }) {
  return publish({
    t: 'GUILD_MEMBER_REMOVE',
    guildId: opts.guildId,
    intent: Intents.GUILD_MEMBERS,
    d: { guild_id: opts.guildId, user: opts.user },
  });
}

/**
 * GUILD_DELETE: targeted at a bot that was kicked, banned or left (its session
 * drops the guild), or untargeted when the server itself was deleted (every
 * bot in it drops the guild). See routeDecision in src/lib/gateway/routing.ts.
 */
export function emitGuildDelete(opts: { guildId: string; targetBotId?: string }) {
  return publish({
    t: 'GUILD_DELETE',
    guildId: opts.guildId,
    intent: Intents.GUILDS,
    ...(opts.targetBotId ? { targetBotId: opts.targetBotId } : {}),
    d: { id: opts.guildId },
  });
}

/** GUILD_AUDIT_LOG_ENTRY_CREATE: only bots with VIEW_AUDIT_LOG (Discord), and the GUILD_MODERATION intent. */
export function emitAuditLogEntryCreate(guildId: string, entry: Record<string, unknown>) {
  return publishGuildPermissionScoped({
    t: 'GUILD_AUDIT_LOG_ENTRY_CREATE',
    guildId,
    intent: Intents.GUILD_MODERATION,
    d: { guild_id: guildId, ...entry },
  }, PERMISSION_BITS.VIEW_AUDIT_LOG);
}

export function emitGuildCreate(opts: { guildId: string; targetBotId: string; guild: unknown }) {
  return publish({
    t: 'GUILD_CREATE',
    guildId: opts.guildId,
    intent: 0,
    targetBotId: opts.targetBotId,
    d: opts.guild,
  });
}

/**
 * Deliver an APPLICATION_COMMAND (or other) interaction to a specific bot over
 * the gateway. Targeted by botId; intent 0 so it always reaches the bot. The
 * bot responds via POST /interactions/:id/:token/callback.
 */
export function emitInteractionCreate(opts: {
  botId: string;
  guildId?: string | null;
  interaction: unknown;
}) {
  return publish({
    t: 'INTERACTION_CREATE',
    guildId: opts.guildId ?? null,
    intent: 0,
    targetBotId: opts.botId,
    d: opts.interaction,
  });
}

/** AUTO_MODERATION_RULE_CREATE / _UPDATE / _DELETE (d is the Discord rule object). */
export function emitAutoModRuleEvent(
  t: 'AUTO_MODERATION_RULE_CREATE' | 'AUTO_MODERATION_RULE_UPDATE' | 'AUTO_MODERATION_RULE_DELETE',
  guildId: string,
  rule: unknown,
) {
  // Discord sends rule events only to bots with MANAGE_GUILD (Serika: Manage Server).
  return publishGuildPermissionScoped({ t, guildId, intent: Intents.AUTO_MODERATION_CONFIGURATION, d: rule }, PERMISSION_BITS.MANAGE_SERVER);
}

/**
 * AUTO_MODERATION_ACTION_EXECUTION: one per action AutoMod took. It carries the
 * matched message content, so only bots with MANAGE_GUILD (Manage Server) get
 * it, like Discord.
 */
export function emitAutoModActionExecution(guildId: string, d: Record<string, unknown>) {
  return publishGuildPermissionScoped({
    t: 'AUTO_MODERATION_ACTION_EXECUTION',
    guildId,
    intent: Intents.AUTO_MODERATION_EXECUTION,
    d: { guild_id: guildId, ...d },
  }, PERMISSION_BITS.MANAGE_SERVER);
}

/** GUILD_SCHEDULED_EVENT_CREATE / _UPDATE / _DELETE / _USER_ADD / _USER_REMOVE. */
export function emitGuildScheduledEvent(t: string, guildId: string, d: unknown) {
  return publish({ t, guildId, intent: Intents.GUILD_SCHEDULED_EVENTS, d });
}

export function gatewayBotUrl() {
  return config.GATEWAY_URL;
}

// ─── Guild resource serializers (READY / GUILD_CREATE / REST) ──────────────
// Discord-shaped views of internal rows, shared by the gateway's GUILD_CREATE
// (src/lib/gateway/guildPayload.ts) and the REST formatters in botApi.ts.
// Ids stay internal UUIDs; the snowflake boundary (src/lib/botapi) translates.

/** Discord channel type numbers for our channel types. */
export const CHANNEL_TYPE_NUMBERS: Record<string, number> = {
  text: 0, dm: 1, voice: 2, group_dm: 3, category: 4, announcement: 5,
  announcement_thread: 10, public_thread: 11, private_thread: 12,
  stage: 13, stage_voice: 13, directory: 14, forum: 15, media: 16,
};

const FORUM_LAYOUT: Record<string, number> = { not_set: 0, list_view: 1, list: 1, gallery_view: 2, gallery: 2 };
const SORT_ORDER: Record<string, number> = { latest_activity: 0, activity: 0, creation_date: 1, created: 1 };

export interface ChannelRowLike {
  id: string;
  serverId?: string | null;
  name?: string | null;
  type?: string | null;
  topic?: string | null;
  position?: number | null;
  parentId?: string | null;
  lastMessageId?: string | null;
  lastPinTimestamp?: Date | string | null;
  rateLimitPerUser?: number | null;
  nsfw?: boolean | null;
  bitrate?: number | null;
  userLimit?: number | null;
  rtcRegion?: string | null;
  defaultAutoArchiveDuration?: number | null;
  defaultThreadRateLimitPerUser?: number | null;
  availableTags?: unknown;
  defaultReactionEmoji?: unknown;
  defaultSortOrder?: string | null;
  defaultForumLayout?: string | null;
  permissionOverwrites?: unknown;
  recipientIds?: string[] | null;
  ownerId?: string | null;
  archived?: boolean | null;
  locked?: boolean | null;
  autoArchiveDuration?: number | null;
  archiveTimestamp?: Date | string | null;
  messageCount?: number | null;
  threadMemberIds?: string[] | null;
  appliedTags?: string[] | null;
  createdAt?: Date | string | null;
  icon?: string | null;
}

/** Discord permission overwrite list from the stored jsonb ({ type: 'role' | 'member' }). */
export function toDiscordOverwrites(raw: unknown): Array<{ id: string; type: number; allow: string; deny: string }> {
  if (!Array.isArray(raw)) return [];
  const bits = (v: unknown) => {
    try { return BigInt(String(v ?? '0')).toString(); } catch { return '0'; }
  };
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as { id?: unknown }).id === 'string')
    .map((o) => ({
      id: o.id as string,
      type: o.type === 'member' || o.type === 1 || o.type === '1' ? 1 : 0,
      allow: bits(o.allow),
      deny: bits(o.deny),
    }));
}

export function isThreadChannelType(type?: string | null) {
  return type === 'public_thread' || type === 'private_thread' || type === 'announcement_thread';
}

/** Discord channel object (guild channels, threads, DMs). */
export function toDiscordChannel(c: ChannelRowLike) {
  const type = CHANNEL_TYPE_NUMBERS[String(c.type)] ?? 0;
  const base: Record<string, unknown> = {
    id: c.id,
    type,
    flags: 0,
    last_message_id: c.lastMessageId ?? null,
  };
  if (c.type === 'dm' || c.type === 'group_dm') {
    return {
      ...base,
      recipients: (c.recipientIds ?? []).map((id) => ({ id, username: '', discriminator: '0', global_name: null, avatar: null })),
      ...(c.type === 'group_dm' ? { name: c.name ?? null, icon: c.icon ?? null, owner_id: c.ownerId ?? null } : {}),
    };
  }
  const guildPart: Record<string, unknown> = {
    guild_id: c.serverId ?? null,
    name: c.name ?? '',
    position: c.position ?? 0,
    parent_id: c.parentId ?? null,
    nsfw: c.nsfw ?? false,
    permission_overwrites: toDiscordOverwrites(c.permissionOverwrites),
  };
  if (isThreadChannelType(c.type)) {
    const created = iso(c.createdAt);
    return {
      ...base,
      guild_id: c.serverId ?? null,
      parent_id: c.parentId ?? null,
      owner_id: c.ownerId ?? null,
      name: c.name ?? '',
      rate_limit_per_user: c.rateLimitPerUser ?? 0,
      message_count: c.messageCount ?? 0,
      total_message_sent: c.messageCount ?? 0,
      member_count: Math.min(50, (c.threadMemberIds ?? []).length),
      applied_tags: c.appliedTags ?? [],
      thread_metadata: {
        archived: c.archived ?? false,
        auto_archive_duration: c.autoArchiveDuration ?? 10080,
        archive_timestamp: iso(c.archiveTimestamp) ?? created,
        locked: c.locked ?? false,
        ...(c.type === 'private_thread' ? { invitable: true } : {}),
        create_timestamp: created,
      },
    };
  }
  if (c.type === 'voice' || c.type === 'stage' || c.type === 'stage_voice') {
    return {
      ...base, ...guildPart,
      bitrate: c.bitrate ?? 64000,
      user_limit: c.userLimit ?? 0,
      rtc_region: c.rtcRegion ?? null,
      rate_limit_per_user: c.rateLimitPerUser ?? 0,
      video_quality_mode: 1,
    };
  }
  if (c.type === 'category') return { ...base, ...guildPart };
  const text: Record<string, unknown> = {
    ...base, ...guildPart,
    topic: c.topic ?? null,
    rate_limit_per_user: c.rateLimitPerUser ?? 0,
    default_auto_archive_duration: c.defaultAutoArchiveDuration ?? 1440,
    last_pin_timestamp: iso(c.lastPinTimestamp),
  };
  if (c.type === 'forum' || c.type === 'media') {
    const tags = Array.isArray(c.availableTags) ? (c.availableTags as Array<Record<string, unknown>>) : [];
    const reaction = (c.defaultReactionEmoji ?? null) as { emojiId?: string | null; emoji_id?: string | null; emojiName?: string | null; emoji_name?: string | null; name?: string | null; id?: string | null } | null;
    Object.assign(text, {
      available_tags: tags.filter((t) => t && typeof t.id === 'string').map((t) => ({
        id: t.id,
        name: String(t.name ?? ''),
        moderated: Boolean(t.moderated),
        emoji_id: (t.emojiId ?? t.emoji_id ?? null) as string | null,
        emoji_name: (t.emojiName ?? t.emoji_name ?? null) as string | null,
      })),
      default_reaction_emoji: reaction
        ? { emoji_id: reaction.emojiId ?? reaction.emoji_id ?? reaction.id ?? null, emoji_name: reaction.emojiName ?? reaction.emoji_name ?? reaction.name ?? null }
        : null,
      default_thread_rate_limit_per_user: c.defaultThreadRateLimitPerUser ?? 0,
      default_sort_order: c.defaultSortOrder ? (SORT_ORDER[c.defaultSortOrder] ?? null) : null,
      default_forum_layout: FORUM_LAYOUT[String(c.defaultForumLayout ?? 'not_set')] ?? 0,
    });
  }
  return text;
}

export interface RoleRowLike {
  id: string;
  name?: string | null;
  color?: number | string | null;
  hoist?: boolean | null;
  icon?: string | null;
  unicodeEmoji?: string | null;
  position?: number | null;
  permissions?: string | null;
  managed?: boolean | null;
  mentionable?: boolean | null;
  isDefault?: boolean | null;
}

/** Discord role object. The @everyone role (isDefault) sits at position 0, like Discord. */
export function toDiscordRole(r: RoleRowLike, botId?: string | null) {
  const color = Number(r.color) || 0;
  let permissions = '0';
  try { permissions = BigInt(String(r.permissions ?? '0')).toString(); } catch { /* keep 0 */ }
  return {
    id: r.id,
    name: r.isDefault ? '@everyone' : (r.name ?? ''),
    color,
    colors: { primary_color: color, secondary_color: null, tertiary_color: null },
    hoist: r.hoist ?? false,
    icon: r.icon ?? null,
    unicode_emoji: r.unicodeEmoji ?? null,
    position: r.isDefault ? 0 : (r.position ?? 0),
    permissions,
    managed: r.managed ?? false,
    mentionable: r.mentionable ?? false,
    flags: 0,
    ...(botId ? { tags: { bot_id: botId } } : {}),
  };
}

export interface UserRowLike {
  id: string;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  banner?: string | null;
  isBot?: boolean | null;
  isSystem?: boolean | null;
}

/** Discord user object from a users row. */
export function toDiscordUserRow(u: UserRowLike) {
  return {
    id: u.id,
    username: u.username ?? '',
    discriminator: '0',
    global_name: u.displayName ?? null,
    avatar: u.avatar ?? null,
    banner: u.banner ?? null,
    accent_color: null,
    bot: u.isBot ?? false,
    system: u.isSystem ?? false,
    public_flags: 0,
    flags: 0,
    avatar_decoration_data: null,
  };
}

export interface MemberRowLike {
  userId?: string;
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
  roles?: string[] | null;
  joinedAt?: Date | string | null;
  premiumSince?: Date | string | null;
  deaf?: boolean | null;
  mute?: boolean | null;
  pending?: boolean | null;
  communicationDisabledUntil?: Date | string | null;
}

/**
 * Discord guild member. `everyoneRoleId` is dropped from `roles` (Discord
 * never lists @everyone there).
 */
export function toDiscordGuildMember(m: MemberRowLike, user: UserRowLike | null, everyoneRoleId?: string | null) {
  const everyone = everyoneRoleId?.toLowerCase();
  const until = m.communicationDisabledUntil ? new Date(m.communicationDisabledUntil) : null;
  return {
    ...(user ? { user: toDiscordUserRow(user) } : {}),
    nick: m.nickname ?? null,
    avatar: m.avatar ?? null,
    banner: m.banner ?? null,
    roles: (m.roles ?? []).filter((r) => !everyone || r.toLowerCase() !== everyone),
    joined_at: iso(m.joinedAt) ?? new Date(0).toISOString(),
    premium_since: iso(m.premiumSince),
    deaf: m.deaf ?? false,
    mute: m.mute ?? false,
    flags: 0,
    pending: m.pending ?? false,
    communication_disabled_until: until && until.getTime() > Date.now() ? until.toISOString() : null,
  };
}

/** Discord emoji object (guild emoji). */
export function toDiscordEmoji(e: { id: string; name: string; animated?: boolean | null; available?: boolean | null; managed?: boolean | null; requireColons?: boolean | null; roles?: string[] | null }) {
  return {
    id: e.id,
    name: e.name,
    roles: e.roles ?? [],
    require_colons: e.requireColons ?? true,
    managed: e.managed ?? false,
    animated: e.animated ?? false,
    available: e.available ?? true,
  };
}

/** Discord sticker object (guild sticker; format inferred from the image URL). */
export function toDiscordSticker(s: { id: string; serverId?: string | null; name: string; description?: string | null; imageUrl?: string | null; tags?: string[] | null; available?: boolean | null }) {
  const url = String(s.imageUrl ?? '').toLowerCase();
  const format = url.endsWith('.gif') ? 4 : url.endsWith('.json') ? 3 : url.endsWith('.apng') ? 2 : 1;
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? '',
    tags: (s.tags ?? []).join(', ') || s.name,
    type: 2,
    format_type: format,
    available: s.available ?? true,
    guild_id: s.serverId ?? null,
  };
}

const VERIFICATION_LEVEL: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, very_high: 4, highest: 4 };
const EXPLICIT_FILTER: Record<string, number> = { disabled: 0, members_without_roles: 1, all_members: 2 };
const DEFAULT_NOTIFICATIONS: Record<string, number> = { all_messages: 0, all: 0, only_mentions: 1, mentions: 1 };

export interface ServerRowLike {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  banner?: string | null;
  splash?: string | null;
  discoverySplash?: string | null;
  ownerId?: string | null;
  systemChannelId?: string | null;
  rulesChannelId?: string | null;
  publicUpdatesChannelId?: string | null;
  afkChannelId?: string | null;
  afkTimeout?: number | null;
  features?: string[] | null;
  verificationLevel?: string | null;
  explicitContentFilter?: string | null;
  defaultNotifications?: string | null;
  premiumTier?: number | null;
  premiumSubscriptionCount?: number | null;
  vanityUrlCode?: string | null;
  mfaLevel?: number | null;
  isAgeGated?: boolean | null;
}

/** Discord guild object: top-level fields only (no roles/emojis/channels). */
export function toDiscordGuildBase(s: ServerRowLike) {
  return {
    id: s.id,
    name: s.name,
    icon: s.icon ?? null,
    icon_hash: null,
    splash: s.splash ?? null,
    discovery_splash: s.discoverySplash ?? null,
    owner_id: s.ownerId ?? null,
    afk_channel_id: s.afkChannelId ?? null,
    afk_timeout: s.afkTimeout ?? 300,
    widget_enabled: false,
    widget_channel_id: null,
    verification_level: VERIFICATION_LEVEL[String(s.verificationLevel ?? 'none')] ?? 0,
    default_message_notifications: DEFAULT_NOTIFICATIONS[String(s.defaultNotifications ?? 'only_mentions')] ?? 1,
    explicit_content_filter: EXPLICIT_FILTER[String(s.explicitContentFilter ?? 'disabled')] ?? 0,
    features: s.features ?? [],
    mfa_level: s.mfaLevel ?? 0,
    application_id: null,
    system_channel_id: s.systemChannelId ?? null,
    system_channel_flags: 0,
    rules_channel_id: s.rulesChannelId ?? null,
    max_presences: null,
    max_members: 250000,
    vanity_url_code: s.vanityUrlCode ?? null,
    description: s.description ?? null,
    banner: s.banner ?? null,
    premium_tier: s.premiumTier ?? 0,
    premium_subscription_count: s.premiumSubscriptionCount ?? 0,
    preferred_locale: 'en-US',
    public_updates_channel_id: s.publicUpdatesChannelId ?? null,
    max_video_channel_users: 25,
    max_stage_video_channel_users: 50,
    nsfw_level: s.isAgeGated ? 3 : 0,
    premium_progress_bar_enabled: false,
    safety_alerts_channel_id: null,
    incidents_data: null,
  };
}
