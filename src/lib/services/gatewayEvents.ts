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
  /** Rich embeds (bot / webhook / interaction messages). */
  embeds?: unknown[] | null;
  /** Message components (lib/botapi/components), already in Discord shape. */
  components?: unknown[] | null;
  webhookId?: string | null;
  applicationId?: string | null;
  /** Interaction that created this message ({ id, type, name, user }). */
  interaction?: { id?: string; type?: number; name?: string; user?: { id: string; username?: string } } | null;
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
  // A webhook author is serialized as the webhook (webhook_id set), not a user.
  const webhooks = new Map<string, { id: string; name?: string | null; avatar?: string | null }>();
  if (m.author && m.webhookId && m.author.id.toLowerCase() === m.webhookId.toLowerCase()) {
    webhooks.set(m.webhookId.toLowerCase(), { id: m.webhookId, name: m.author.username ?? null, avatar: m.author.avatar ?? null });
  } else if (m.author) users.set(m.author.id.toLowerCase(), m.author);
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
    embeds: m.embeds ?? [],
    components: m.components ?? [],
    interaction: m.interaction?.id ? { ...m.interaction, applicationId: m.applicationId ?? null } : null,
  }, {
    users,
    webhooks,
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

/**
 * APPLICATION_COMMAND_PERMISSIONS_UPDATE to the application's own bot when a
 * command's (or the app's) permissions change in a guild.
 */
export function emitApplicationCommandPermissionsUpdate(opts: { botId: string; guildId: string; permissions: unknown }) {
  return publish({
    t: 'APPLICATION_COMMAND_PERMISSIONS_UPDATE',
    guildId: opts.guildId,
    intent: 0,
    targetBotId: opts.botId,
    d: opts.permissions,
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
