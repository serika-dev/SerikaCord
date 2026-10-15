/**
 * Pure gateway delivery rules for GatewayHub.routeDispatch (src/lib/gateway/core.ts):
 * which authenticated bot sessions receive a dispatch, and what a bot without
 * the MESSAGE_CONTENT intent may see of a message. No DB, no sockets.
 *
 * DM-scoped (guild-less) dispatches are default-deny: they reach a bot only
 * when the bot is in the dispatch's `audience` (the DM's recipients, resolved
 * by the emitter), when the channel is one of the bot's DMs known at IDENTIFY,
 * or when the dispatch is explicitly targeted at the bot. A guild-less
 * dispatch without a channel id reaches nobody unless targeted.
 */
import { INTENT } from './intents';

export interface RoutingSession {
  botId: string | null;
  intents: number;
  guildIds: ReadonlySet<string>;
  dmChannelIds: ReadonlySet<string>;
}

export interface RoutableDispatch {
  t: string;
  guildId: string | null;
  intent: number;
  d: unknown;
  targetBotId?: string;
  /**
   * User ids allowed to receive this dispatch (DM recipients, or the bots that
   * can view a guild channel). When set, only bots in the list receive it.
   */
  audience?: string[];
}

export interface RouteDecision {
  deliver: boolean;
  /** The bot just joined this guild: add it to the session. */
  addGuildId?: string;
  /** A DM the bot is in that the session didn't know yet: track it. */
  addDmChannelId?: string;
  /** The bot left / was removed from this guild (or it was deleted): drop it. */
  removeGuildId?: string;
}

const NO: RouteDecision = { deliver: false };

export function sameId(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function hasId(set: ReadonlySet<string>, id: string): boolean {
  if (set.has(id)) return true;
  const lower = id.toLowerCase();
  for (const v of set) if (v.toLowerCase() === lower) return true;
  return false;
}

export function routeDecision(s: RoutingSession, dispatch: RoutableDispatch): RouteDecision {
  const botId = s.botId;
  if (!botId) return NO;

  if (dispatch.targetBotId && !sameId(dispatch.targetBotId, botId)) return NO;

  // GUILD_DELETE always updates the session (even without the GUILDS intent),
  // so a kicked / banned bot stops getting the guild's events immediately.
  if (dispatch.t === 'GUILD_DELETE' && dispatch.guildId) {
    if (!hasId(s.guildIds, dispatch.guildId)) return NO;
    const intentOk = !dispatch.intent || (s.intents & dispatch.intent) !== 0;
    return { deliver: intentOk, removeGuildId: dispatch.guildId };
  }

  if (dispatch.intent && (s.intents & dispatch.intent) === 0) return NO;
  if (dispatch.audience && !dispatch.audience.some((id) => sameId(id, botId))) return NO;

  const d = (dispatch.d ?? {}) as { channel_id?: unknown; user?: { id?: unknown }; author?: { id?: unknown } };

  // Never echo a bot's own message back to it.
  if (dispatch.t === 'MESSAGE_CREATE' && sameId(d.author?.id, botId)) return NO;

  if (dispatch.guildId) {
    const isBotJoin =
      (dispatch.t === 'GUILD_MEMBER_ADD' && sameId(d.user?.id, botId)) ||
      (dispatch.t === 'GUILD_CREATE' && !!dispatch.targetBotId);
    if (isBotJoin) return { deliver: true, addGuildId: dispatch.guildId };
    if (!hasId(s.guildIds, dispatch.guildId)) return NO;
    return { deliver: true };
  }

  // Guild-less (DM / group DM) dispatch.
  if (dispatch.targetBotId) return { deliver: true };
  const channelId = typeof d.channel_id === 'string' ? d.channel_id : null;
  if (!channelId) return NO;
  if (dispatch.audience) {
    // The audience check above already proved the bot is a recipient.
    return hasId(s.dmChannelIds, channelId) ? { deliver: true } : { deliver: true, addDmChannelId: channelId };
  }
  return hasId(s.dmChannelIds, channelId) ? { deliver: true } : NO;
}

// ─── MESSAGE_CONTENT ───────────────────────────────────────

export interface MessageVisibility {
  /** Guild id, or null/undefined for a DM. */
  guildId?: string | null;
  authorId?: string | null;
  mentionedUserIds?: readonly string[] | null;
}

/**
 * Discord semantics: a bot without the MESSAGE_CONTENT intent gets empty
 * content, embeds, attachments, components and poll, except in DMs, for its
 * own messages, and for messages that mention it.
 */
export function shouldRedactContent(m: MessageVisibility, botId: string, hasMessageContent: boolean): boolean {
  if (hasMessageContent) return false;
  if (!m.guildId) return false;
  if (sameId(m.authorId, botId)) return false;
  if ((m.mentionedUserIds ?? []).some((id) => sameId(id, botId))) return false;
  return true;
}

type DiscordMessageLike = {
  content?: unknown;
  embeds?: unknown;
  attachments?: unknown;
  components?: unknown;
  poll?: unknown;
  message_snapshots?: Array<{ message?: Record<string, unknown> }>;
  referenced_message?: { author?: { id?: unknown } | null } & Record<string, unknown> | null;
};

/** A copy of a Discord-shaped message with the privileged fields blanked. */
export function redactMessageContent<T extends object>(msg: T, botId?: string | null): T {
  const m = msg as T & DiscordMessageLike;
  const out: Record<string, unknown> = { ...m, content: '', embeds: [], attachments: [], components: [] };
  delete out.poll;
  if (Array.isArray(m.message_snapshots)) {
    out.message_snapshots = m.message_snapshots.map((s) => ({
      ...s,
      message: s?.message ? { ...s.message, content: '', embeds: [], attachments: [], components: [] } : s?.message,
    }));
  }
  if (m.referenced_message && !(botId && sameId(m.referenced_message.author?.id, botId))) {
    out.referenced_message = { ...m.referenced_message, content: '', embeds: [], attachments: [], components: [] };
  }
  return out as T;
}

/** Message dispatches whose payload is a message object subject to MESSAGE_CONTENT. */
export function isMessagePayloadEvent(t: string): boolean {
  return t === 'MESSAGE_CREATE' || t === 'MESSAGE_UPDATE';
}

/** Gateway view of a message dispatch for one bot session. */
export function messagePayloadFor(t: string, d: unknown, botId: string, sessionIntents: number): unknown {
  if (!isMessagePayloadEvent(t) || !d || typeof d !== 'object') return d;
  const msg = d as { guild_id?: string | null; author?: { id?: string } | null; mentions?: Array<{ id?: string }> };
  const hasMessageContent = (sessionIntents & INTENT.MESSAGE_CONTENT) !== 0;
  const redact = shouldRedactContent(
    {
      guildId: msg.guild_id ?? null,
      authorId: msg.author?.id ?? null,
      mentionedUserIds: (msg.mentions ?? []).map((u) => String(u?.id ?? '')),
    },
    botId,
    hasMessageContent,
  );
  return redact ? redactMessageContent(msg, botId) : d;
}
