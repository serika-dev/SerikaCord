import type { ChatMessage, MessageAuthor, MessageGroupData, MessageReaction } from "./types";

/** Raw message payload as it arrives from the REST API or SSE stream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawMessagePayload = Record<string, any>;

/**
 * Normalizes a raw API/SSE message payload into a ChatMessage. Handles the
 * quirks of both channel and DM payloads: `_id` vs `id`, `authorId` arriving
 * as a populated object, and missing author objects.
 */
export function normalizeIncomingMessage<M extends ChatMessage>(raw: RawMessagePayload): M {
  const rawAuthorId = raw.authorId;
  const authorId: string =
    typeof rawAuthorId === "object" && rawAuthorId !== null
      ? rawAuthorId._id || rawAuthorId.id || ""
      : rawAuthorId || raw.author?.id || "";

  const author: MessageAuthor =
    raw.author ||
    (typeof rawAuthorId === "object" && rawAuthorId !== null
      ? {
          id: rawAuthorId._id || rawAuthorId.id,
          username: rawAuthorId.username,
          displayName: rawAuthorId.displayName || rawAuthorId.username,
          avatar: rawAuthorId.avatar,
        }
      : { id: authorId || "unknown", username: "unknown", displayName: "Unknown" });

  return {
    ...raw,
    id: raw.id || raw._id,
    content: raw.content ?? "",
    authorId,
    author,
    attachments: raw.attachments || [],
    embeds: raw.embeds || [],
    reactions: raw.reactions || [],
    customEmojis: raw.customEmojis || [],
    mentionEveryone: Boolean(raw.mentionEveryone),
    mentionedUserIds: raw.mentionedUserIds || [],
    mentionedRoleIds: raw.mentionedRoleIds || [],
    mentionedChannelIds: raw.mentionedChannelIds || [],
  } as M;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Deduplicate by id and group consecutive messages from the same author
 * posted within a 5 minute window (Discord-style message grouping).
 */
export function groupMessages<M extends ChatMessage>(messages: M[]): MessageGroupData<M>[] {
  const seen = new Set<string>();
  const groups: MessageGroupData<M>[] = [];

  for (const message of messages) {
    const key = String(message.id);
    if (seen.has(key)) continue;
    seen.add(key);

    const lastGroup = groups[groups.length - 1];
    const lastMessage = lastGroup?.messages[lastGroup.messages.length - 1];
    const sameAuthor = lastMessage?.authorId === message.authorId;
    const withinWindow =
      !!lastMessage &&
      new Date(message.createdAt).getTime() - new Date(lastMessage.createdAt).getTime() < GROUP_WINDOW_MS;

    if (sameAuthor && withinWindow) {
      lastGroup.messages.push(message);
    } else {
      groups.push({ author: message.author, timestamp: message.createdAt, messages: [message] });
    }
  }

  return groups;
}

/** "Today at 3:41 PM" / "Yesterday at ..." / "Mar 4, 2026 at ..." */
export function formatMessageTimestamp(
  timestamp: string,
  gt?: (msg: string, opts?: Record<string, unknown>) => string,
  locale?: string,
): string {
  const date = new Date(timestamp);
  const now = new Date();
  const loc = locale || undefined;
  const time = date.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) {
    return gt ? gt("Today at {time}", { time }) : `Today at ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return gt ? gt("Yesterday at {time}", { time }) : `Yesterday at ${time}`;
  }

  const dateStr = date.toLocaleDateString(loc, { month: "short", day: "numeric", year: "numeric" });
  return gt ? gt("{date} at {time}", { date: dateStr, time }) : `${dateStr} at ${time}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reactionMatches(reaction: MessageReaction, emoji: string): boolean {
  if (reaction.emoji.id) {
    if (reaction.emoji.id === emoji) return true;
    const token = `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`;
    if (token === emoji) return true;
  }
  return reaction.emoji.name === emoji;
}

export interface EmojiLookupEntry {
  id: string;
  name: string;
  url?: string;
  animated?: boolean;
}

/**
 * Pure reducer applying a reaction add/remove to a message list.
 * `emoji` may be a unicode emoji, a custom emoji id, or a `<a:name:id>` token.
 */
export function applyReactionToMessages<M extends ChatMessage>(
  messages: M[],
  messageId: string,
  emoji: string,
  userId: string,
  isAdd: boolean,
  emojiLookup: EmojiLookupEntry[] = []
): M[] {
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg;

    const reactions = msg.reactions || [];
    const index = reactions.findIndex((reaction) => reactionMatches(reaction, emoji));

    if (index === -1) {
      if (!isAdd) return msg;
      const customMatch = emoji.match(/^<(a)?:([a-zA-Z0-9_]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>$/);
      let emojiObj: MessageReaction["emoji"];
      if (customMatch) {
        const [, animated, name, id] = customMatch;
        const found = emojiLookup.find((e) => e.id === id);
        emojiObj = { name, id, animated: Boolean(animated), url: found?.url };
      } else {
        emojiObj = { name: emoji };
      }
      return {
        ...msg,
        reactions: [...reactions, { emoji: emojiObj, count: 1, userIds: [userId] }],
      };
    }

    const target = reactions[index];
    const alreadyReacted = target.userIds.includes(userId);
    if (isAdd === alreadyReacted) return msg;

    const nextReactions = reactions
      .map((reaction, i) => {
        if (i !== index) return reaction;
        const nextUserIds = isAdd
          ? [...reaction.userIds, userId]
          : reaction.userIds.filter((id) => id !== userId);
        return { ...reaction, userIds: nextUserIds, count: nextUserIds.length };
      })
      .filter((reaction) => reaction.count > 0);

    return { ...msg, reactions: nextReactions };
  });
}

/**
 * Decodes the HTML entities that server-side sanitization leaves in stored
 * message content (e.g. `&amp;`, `&lt;`). Chat content is rendered as React
 * text nodes (never via dangerouslySetInnerHTML), so React re-escapes on
 * render — decoding here is safe and just restores what the user typed.
 * `&amp;` is handled last so pre-encoded entities aren't double-decoded.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#x0*2f;|&#0*47;/gi, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
