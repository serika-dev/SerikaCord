import { getPublisher } from '@/lib/db';
import { config } from '@/lib/config';

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
  GUILD_MODERATION: 1 << 2,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
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
}

async function publish(dispatch: GatewayDispatch) {
  try {
    const pub = getPublisher();
    if (pub) await pub.publish(GATEWAY_CHANNEL, JSON.stringify(dispatch));
  } catch {
    // Best-effort — the web app must never fail because the gateway bus is down.
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
}

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
    })),
    embeds: [],
    reactions: m.reactions ?? [],
    pinned: m.pinned ?? false,
    type: typeof m.type === 'number' ? m.type : 0,
    flags: 0,
    referenced_message: m.referencedMessage
      ? {
          id: m.referencedMessage.id,
          channel_id: m.channelId,
          content: m.referencedMessage.content ?? '',
          author: m.referencedMessage.author ? toDiscordUser(m.referencedMessage.author) : null,
          timestamp: iso(m.referencedMessage.createdAt),
        }
      : null,
    message_reference: m.referencedMessageId
      ? { message_id: m.referencedMessageId, channel_id: m.channelId, guild_id: m.serverId ?? undefined }
      : undefined,
  };
}

// ─── Public emitters ───────────────────────────────────────

export function emitMessageCreate(message: InternalMessage) {
  const isDM = !message.serverId;
  return publish({
    t: 'MESSAGE_CREATE',
    guildId: message.serverId ?? null,
    intent: isDM ? Intents.DIRECT_MESSAGES : Intents.GUILD_MESSAGES,
    d: toDiscordMessage(message),
  });
}

export function emitMessageUpdate(message: InternalMessage) {
  const isDM = !message.serverId;
  return publish({
    t: 'MESSAGE_UPDATE',
    guildId: message.serverId ?? null,
    intent: isDM ? Intents.DIRECT_MESSAGES : Intents.GUILD_MESSAGES,
    d: toDiscordMessage(message),
  });
}

export function emitMessageDelete(opts: { id: string; channelId: string; guildId?: string | null }) {
  return publish({
    t: 'MESSAGE_DELETE',
    guildId: opts.guildId ?? null,
    intent: opts.guildId ? Intents.GUILD_MESSAGES : Intents.DIRECT_MESSAGES,
    d: { id: opts.id, channel_id: opts.channelId, guild_id: opts.guildId ?? null },
  });
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

export function gatewayBotUrl() {
  return config.GATEWAY_URL;
}
