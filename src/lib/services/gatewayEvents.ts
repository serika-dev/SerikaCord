import { getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import type { PollResultData, StoredPoll } from '@/lib/chat/polls';
import type { ForwardView } from '@/lib/chat/forward';
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { discordUser, serializeMessage, type UserLike } from '@/lib/chat/discordMessage';
import { discordEmoji } from '@/lib/chat/reactionEmoji';
import { processShared } from '@/lib/realtime/processShared';
import { BoundedMap } from '@/lib/utils/boundedMap';

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
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  GUILD_MESSAGE_TYPING: 1 << 11,
  GUILD_SCHEDULED_EVENTS: 1 << 16,
  DIRECT_MESSAGES: 1 << 12,
  DIRECT_MESSAGE_REACTIONS: 1 << 13,
  DIRECT_MESSAGE_TYPING: 1 << 14,
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
async function publishChannelScoped(
  dispatch: Omit<GatewayDispatch, 'audience'>,
  channelId: string | null | undefined,
  opts: { excludeUserId?: string | null } = {},
) {
  return publishChannelScopedLazy({ t: dispatch.t, guildId: dispatch.guildId, intent: dispatch.intent }, channelId, async () => dispatch.d, opts);
}

/**
 * Like publishChannelScoped, but the payload is only built (DB lookups, member
 * objects) when at least one bot may receive it. `build` returning null drops
 * the event. `excludeUserId` keeps an actor's own event away from it
 * (TYPING_START of the bot itself).
 */
async function publishChannelScopedLazy(
  meta: Omit<GatewayDispatch, 'audience' | 'd'>,
  channelId: string | null | undefined,
  build: () => Promise<unknown>,
  opts: { excludeUserId?: string | null } = {},
) {
  if (!channelId) return;
  try {
    const { channelAudience } = await import('./gatewayAudience');
    let audience = await channelAudience(channelId, meta.guildId);
    if (opts.excludeUserId) {
      const ex = opts.excludeUserId.toLowerCase();
      audience = audience.filter((id) => id.toLowerCase() !== ex);
    }
    if (audience.length === 0) return;
    const d = await build();
    if (d === null || d === undefined) return;
    await publish({ ...meta, d, audience });
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

export function toDiscordUser(a: NonNullable<InternalMessage['author']>) {
  return discordUser({ id: a.id, username: a.username ?? null, displayName: a.displayName ?? null, avatar: a.avatar ?? null, isBot: a.isBot, isSystem: a.isSystem });
}

/**
 * Discord message object from an in-memory payload (the shape channels.ts /
 * dms.ts publish to web clients). Only a fallback: the emitters below
 * re-read the stored row (src/lib/services/botMessages.ts) so the gateway
 * sends exactly what GET /channels/{id}/messages/{id} returns.
 */
export function toDiscordMessage(m: InternalMessage) {
  const users = new Map<string, UserLike>();
  if (m.author) users.set(m.author.id.toLowerCase(), m.author);
  return serializeMessage({
    id: m.id,
    channelId: m.channelId,
    serverId: m.serverId ?? null,
    authorId: m.author?.id ?? '',
    content: m.content ?? '',
    type: typeof m.type === 'string' ? m.type : 'default',
    createdAt: m.createdAt ?? null,
    updatedAt: m.updatedAt ?? null,
    edited: m.edited ?? false,
    attachments: m.attachments ?? [],
    reactions: m.reactions ?? [],
    pinned: m.pinned ?? false,
    flags: m.flags ?? 0,
    mentionEveryone: m.mentionEveryone ?? false,
    mentionedUserIds: m.mentionedUserIds ?? [],
    mentionedRoleIds: m.mentionedRoleIds ?? [],
    referencedMessageId: m.referencedMessageId ?? null,
    poll: m.pollResult ?? m.poll ?? null,
  }, {
    users,
    includeGuildId: true,
    forward: m.forward
      ? { messageId: m.forward.messageId, channelId: m.forward.channelId, content: m.forward.content, attachments: m.forward.attachments, embeds: m.forward.embeds, sticker: m.forward.sticker, createdAt: m.forward.createdAt }
      : null,
  });
}

// ─── Public emitters ───────────────────────────────────────

function messageIntent(guildId: string | null | undefined) {
  return guildId ? Intents.GUILD_MESSAGES : Intents.DIRECT_MESSAGES;
}

/** The stored message as a gateway payload, falling back to the in-memory one. */
async function gatewayMessagePayload(message: InternalMessage, extras: { nonce?: string | number | null } = {}) {
  try {
    const { loadGatewayMessage } = await import('./botMessages');
    const loaded = await loadGatewayMessage(message.id, extras);
    if (loaded) return loaded;
  } catch {
    // fall through to the in-memory shape
  }
  return { ...toDiscordMessage(message), ...(extras.nonce !== undefined && extras.nonce !== null ? { nonce: extras.nonce } : {}) };
}

/**
 * MESSAGE_CREATE for any new message (user, bot, webhook, system, DM). The
 * payload is the stored row serialized like the REST API (plus guild_id and
 * the author's member), built only when some bot may see the channel.
 */
export function emitMessageCreate(message: InternalMessage, extras: { nonce?: string | number | null } = {}) {
  return publishChannelScopedLazy(
    { t: 'MESSAGE_CREATE', guildId: message.serverId ?? null, intent: messageIntent(message.serverId) },
    message.channelId,
    () => gatewayMessagePayload(message, extras),
  );
}

/** MESSAGE_UPDATE with the full, current message (edits, embed suppression, flag changes). */
export function emitMessageUpdate(message: Pick<InternalMessage, 'id' | 'channelId' | 'serverId'> & Partial<InternalMessage>) {
  return publishChannelScopedLazy(
    { t: 'MESSAGE_UPDATE', guildId: message.serverId ?? null, intent: messageIntent(message.serverId) },
    message.channelId,
    () => gatewayMessagePayload(message as InternalMessage),
  );
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
    intent: messageIntent(opts.guildId),
    d: { id: opts.id, channel_id: opts.channelId, ...(opts.guildId ? { guild_id: opts.guildId } : {}) },
  }, opts.channelId);
}

/** MESSAGE_DELETE_BULK (bot bulk delete, moderator /clear). */
export function emitMessageDeleteBulk(opts: { ids: string[]; channelId: string; guildId?: string | null }) {
  if (opts.ids.length === 0) return Promise.resolve();
  return publishChannelScoped({
    t: 'MESSAGE_DELETE_BULK',
    guildId: opts.guildId ?? null,
    intent: messageIntent(opts.guildId),
    d: { ids: opts.ids, channel_id: opts.channelId, ...(opts.guildId ? { guild_id: opts.guildId } : {}) },
  }, opts.channelId);
}

interface ReactionEmojiRef { name: string; id?: string | null; animated?: boolean | null }

function reactionIntent(guildId: string | null | undefined) {
  return guildId ? Intents.GUILD_MESSAGE_REACTIONS : Intents.DIRECT_MESSAGE_REACTIONS;
}

/** A guild member object (with user) for reaction / typing events, or undefined. */
async function memberWithUser(guildId: string | null | undefined, userId: string) {
  if (!guildId) return undefined;
  try {
    const { ServerMember, User } = await import('@/lib/models');
    const [member, user] = await Promise.all([
      ServerMember.findOne({ serverId: guildId, userId }),
      User.findById(userId),
    ]);
    if (!member) return undefined;
    const { discordPartialMember } = await import('@/lib/chat/discordMessage');
    return { ...discordPartialMember(member), ...(user ? { user: discordUser(user) } : {}) };
  } catch {
    return undefined;
  }
}

/** MESSAGE_REACTION_ADD (user or bot reacted). */
export function emitReactionAdd(opts: {
  channelId: string;
  guildId?: string | null;
  messageId: string;
  messageAuthorId?: string | null;
  userId: string;
  emoji: ReactionEmojiRef;
}) {
  return publishChannelScopedLazy(
    { t: 'MESSAGE_REACTION_ADD', guildId: opts.guildId ?? null, intent: reactionIntent(opts.guildId) },
    opts.channelId,
    async () => ({
      user_id: opts.userId,
      channel_id: opts.channelId,
      message_id: opts.messageId,
      ...(opts.guildId ? { guild_id: opts.guildId, member: await memberWithUser(opts.guildId, opts.userId) } : {}),
      emoji: discordEmoji(opts.emoji),
      ...(opts.messageAuthorId ? { message_author_id: opts.messageAuthorId } : {}),
      burst: false,
      burst_colors: [],
      type: 0,
    }),
  );
}

/** MESSAGE_REACTION_REMOVE (one user's reaction removed). */
export function emitReactionRemove(opts: { channelId: string; guildId?: string | null; messageId: string; userId: string; emoji: ReactionEmojiRef }) {
  return publishChannelScoped({
    t: 'MESSAGE_REACTION_REMOVE',
    guildId: opts.guildId ?? null,
    intent: reactionIntent(opts.guildId),
    d: {
      user_id: opts.userId,
      channel_id: opts.channelId,
      message_id: opts.messageId,
      ...(opts.guildId ? { guild_id: opts.guildId } : {}),
      emoji: discordEmoji(opts.emoji),
      burst: false,
      type: 0,
    },
  }, opts.channelId);
}

/** MESSAGE_REACTION_REMOVE_ALL (every reaction cleared). */
export function emitReactionRemoveAll(opts: { channelId: string; guildId?: string | null; messageId: string }) {
  return publishChannelScoped({
    t: 'MESSAGE_REACTION_REMOVE_ALL',
    guildId: opts.guildId ?? null,
    intent: reactionIntent(opts.guildId),
    d: { channel_id: opts.channelId, message_id: opts.messageId, ...(opts.guildId ? { guild_id: opts.guildId } : {}) },
  }, opts.channelId);
}

/** MESSAGE_REACTION_REMOVE_EMOJI (every reaction of one emoji cleared). */
export function emitReactionRemoveEmoji(opts: { channelId: string; guildId?: string | null; messageId: string; emoji: ReactionEmojiRef }) {
  return publishChannelScoped({
    t: 'MESSAGE_REACTION_REMOVE_EMOJI',
    guildId: opts.guildId ?? null,
    intent: reactionIntent(opts.guildId),
    d: { channel_id: opts.channelId, message_id: opts.messageId, ...(opts.guildId ? { guild_id: opts.guildId } : {}), emoji: discordEmoji(opts.emoji) },
  }, opts.channelId);
}

/** CHANNEL_PINS_UPDATE after a pin or unpin (GUILDS intent in guilds, DIRECT_MESSAGES in DMs). */
export function emitChannelPinsUpdate(opts: { channelId: string; guildId?: string | null; lastPinTimestamp?: Date | string | null }) {
  const last = opts.lastPinTimestamp ? new Date(opts.lastPinTimestamp).toISOString() : null;
  return publishChannelScoped({
    t: 'CHANNEL_PINS_UPDATE',
    guildId: opts.guildId ?? null,
    intent: opts.guildId ? Intents.GUILDS : Intents.DIRECT_MESSAGES,
    d: { channel_id: opts.channelId, ...(opts.guildId ? { guild_id: opts.guildId } : {}), last_pin_timestamp: last },
  }, opts.channelId);
}

/** Last TYPING_START per typer + channel (clients ping every few seconds; Discord sends one per ~10 s). */
const typingSent = processShared('gatewayEvents:typing', () => new BoundedMap<string, number>(20_000));
const TYPING_EVENT_INTERVAL_MS = 8_000;

/**
 * TYPING_START when a user or bot starts typing. Never sent back to the typer
 * itself. Guild events carry the typer's member object. Repeated typing pings
 * within a few seconds are folded into one event.
 */
export function emitTypingStart(opts: { channelId: string; guildId?: string | null; userId: string; at?: Date }) {
  const key = `${opts.userId.toLowerCase()}:${opts.channelId.toLowerCase()}`;
  const now = Date.now();
  const last = typingSent.get(key);
  if (last !== undefined && now - last < TYPING_EVENT_INTERVAL_MS) return Promise.resolve();
  typingSent.set(key, now);
  return publishChannelScopedLazy(
    {
      t: 'TYPING_START',
      guildId: opts.guildId ?? null,
      intent: opts.guildId ? Intents.GUILD_MESSAGE_TYPING : Intents.DIRECT_MESSAGE_TYPING,
    },
    opts.channelId,
    async () => ({
      channel_id: opts.channelId,
      ...(opts.guildId ? { guild_id: opts.guildId, member: await memberWithUser(opts.guildId, opts.userId) } : {}),
      user_id: opts.userId,
      timestamp: Math.floor((opts.at ?? new Date()).getTime() / 1000),
    }),
    { excludeUserId: opts.userId },
  );
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

function iso(d?: Date | string | null): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

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
    nsfw: s.isAgeGated ?? false,
    nsfw_level: s.isAgeGated ? 3 : 0,
    region: 'deprecated',
    home_header: null,
    premium_progress_bar_enabled: false,
    safety_alerts_channel_id: null,
    incidents_data: null,
  };
}
