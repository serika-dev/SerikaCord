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
