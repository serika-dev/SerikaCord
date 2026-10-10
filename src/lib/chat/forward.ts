/**
 * Message forwarding (Discord-style), shared by the server and the client.
 *
 * A forward is a new message in the destination whose `messages.message_snapshot`
 * column holds a copy of the original (content encrypted at rest like every
 * message, attachments, embeds, sticker, author, time) plus where it came from.
 * The copy is frozen: editing or deleting the original doesn't change it. The
 * optional note typed in the forward dialog is sent as a separate message right
 * after it, like Discord.
 *
 * The client only gets a jump link ("origin") when the viewer can still open
 * the original conversation.
 */
import type { ChatMessage, MessageAttachment, MessageCustomEmoji, MessageEmbed, MessageSticker } from "./types";

/** Destinations per forward (Discord allows 5). */
export const MAX_FORWARD_TARGETS = 5;
export const MAX_FORWARD_NOTE_LENGTH = 2000;

export interface ForwardAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
}

/** What is stored in messages.message_snapshot. */
export interface StoredForward {
  messageId: string;
  channelId: string;
  serverId: string | null;
  authorId: string;
  author: ForwardAuthor | null;
  /** Encrypted like messages.content. */
  content: string;
  attachments: MessageAttachment[];
  embeds: MessageEmbed[];
  sticker: MessageSticker | null;
  createdAt: string;
  edited: boolean;
}

/** Where a forward came from, only sent to viewers who can open it. */
export type ForwardOrigin =
  | { kind: "channel"; serverId: string; serverName: string | null; channelName: string | null; href: string }
  | { kind: "dm"; name: string | null; href: string }
  | { kind: "group_dm"; name: string | null; href: string };

/** The forward as a client renders it. */
export interface ForwardView {
  messageId: string;
  channelId: string;
  author: ForwardAuthor | null;
  content: string;
  attachments: MessageAttachment[];
  embeds: MessageEmbed[];
  sticker: MessageSticker | null;
  customEmojis?: MessageCustomEmoji[];
  createdAt: string;
  edited: boolean;
  /**
   * Jump link to the original. null: the viewer can't open it. Absent: not
   * resolved for this viewer (live-broadcast payloads) — ask on click.
   */
  origin?: ForwardOrigin | null;
}

/** A conversation the forward dialog can send to. */
export interface ForwardTarget {
  /** Channel id (server channel, DM or group DM). */
  id: string;
  kind: "dm" | "group_dm" | "channel";
  name: string;
  /** Avatar (DM), group icon or server icon. */
  icon?: string | null;
  serverId?: string | null;
  serverName?: string | null;
  /** 1:1 DMs: the other person. */
  recipientId?: string | null;
  username?: string | null;
}

const NOT_FORWARDABLE_TYPES = new Set([
  "call",
  "poll_result",
  "system",
  "member_join",
  "member_leave",
  "channel_pinned_message",
  "recipient_add",
  "recipient_remove",
  "channel_name_change",
  "channel_icon_change",
]);

/** Whether the Forward action is offered for a message. */
export function isForwardable(message: Pick<ChatMessage, "id" | "type" | "pending" | "ephemeral" | "content" | "attachments" | "sticker" | "embeds" | "poll" | "forward">): boolean {
  if (!message.id || message.id.startsWith("temp-") || message.pending || message.ephemeral) return false;
  if (message.type && NOT_FORWARDABLE_TYPES.has(message.type)) return false;
  // Polls can't be forwarded (Discord doesn't either: votes don't travel).
  if (message.poll) return false;
  if (message.forward) return true;
  return Boolean(
    (message.content && message.content.trim()) ||
      (message.attachments && message.attachments.length > 0) ||
      (message.embeds && message.embeds.length > 0) ||
      message.sticker,
  );
}

/** The in-app URL that opens the original message. */
export function forwardJumpHref(
  source: { kind: "channel"; serverId: string; channelId: string } | { kind: "dm"; recipientId: string } | { kind: "group_dm"; channelId: string },
  messageId: string,
): string {
  const jump = `?jump=${encodeURIComponent(messageId)}`;
  if (source.kind === "channel") return `/channels/${source.serverId}/${source.channelId}${jump}`;
  if (source.kind === "dm") return `/dm/${source.recipientId}${jump}`;
  return `/dm/group/${source.channelId}${jump}`;
}

/** Validate the destination list of a forward request. */
export function normalizeForwardTargets(raw: unknown): { targets: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Pick at least one destination" };
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !/^[0-9a-fA-F-]{8,64}$/.test(v)) return { error: "Invalid destination" };
    const id = v.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_FORWARD_TARGETS) return { error: `You can forward to at most ${MAX_FORWARD_TARGETS} places at once` };
  return { targets: ids };
}

/** Collapse a note to what will be posted (null when empty). */
export function normalizeForwardNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.trim().slice(0, MAX_FORWARD_NOTE_LENGTH);
  return note ? note : null;
}

/** Read messages.message_snapshot; null for anything malformed. */
export function parseStoredForward(raw: unknown): StoredForward | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.messageId !== "string" || typeof s.channelId !== "string") return null;
  const a = s.author && typeof s.author === "object" ? (s.author as Record<string, unknown>) : null;
  return {
    messageId: s.messageId,
    channelId: s.channelId,
    serverId: typeof s.serverId === "string" ? s.serverId : null,
    authorId: typeof s.authorId === "string" ? s.authorId : (typeof a?.id === "string" ? a.id : ""),
    author: a && typeof a.id === "string"
      ? {
          id: a.id,
          username: typeof a.username === "string" ? a.username : "unknown",
          displayName: typeof a.displayName === "string" && a.displayName ? a.displayName : (typeof a.username === "string" ? a.username : "Unknown"),
          avatar: typeof a.avatar === "string" ? a.avatar : null,
        }
      : null,
    content: typeof s.content === "string" ? s.content : "",
    attachments: Array.isArray(s.attachments) ? (s.attachments as MessageAttachment[]) : [],
    embeds: Array.isArray(s.embeds) ? (s.embeds as MessageEmbed[]) : [],
    sticker: s.sticker && typeof s.sticker === "object" ? (s.sticker as MessageSticker) : null,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(0).toISOString(),
    edited: s.edited === true,
  };
}

/**
 * Order destinations for a search query: name prefix matches first, then name
 * substring, then username / server name matches. Stable within each tier;
 * an empty query keeps the given (recency) order.
 */
export function rankForwardTargets<T extends Pick<ForwardTarget, "name" | "serverName" | "username">>(
  targets: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase().replace(/^[#@]/, "");
  if (!q) return targets;
  const scored: Array<{ t: T; score: number; i: number }> = [];
  targets.forEach((t, i) => {
    const name = (t.name || "").toLowerCase();
    const user = (t.username || "").toLowerCase();
    const server = (t.serverName || "").toLowerCase();
    let score = -1;
    if (name.startsWith(q) || user.startsWith(q)) score = 0;
    else if (name.includes(q) || user.includes(q)) score = 1;
    else if (server.includes(q)) score = 2;
    if (score >= 0) scored.push({ t, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.t);
}
