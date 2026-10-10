/**
 * Message flags (Discord numbering) and the send-time rules that set them:
 * `@silent` messages and reply pings. Pure, shared by the send routes and the
 * client (optimistic messages), tested in tests/message-flags.test.ts.
 */

export const MESSAGE_FLAGS = {
  SUPPRESS_EMBEDS: 1 << 2,
  /** "@silent": no push / desktop notification / sound for recipients. */
  SUPPRESS_NOTIFICATIONS: 1 << 12,
} as const;

/** Flags a client or bot may set when sending. */
const SENDABLE_FLAGS = MESSAGE_FLAGS.SUPPRESS_EMBEDS | MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS;

const SILENT_PREFIX_RE = /^@silent(?:\s+|$)/;

/**
 * Discord's `@silent` prefix: a message starting with "@silent" followed by
 * whitespace (or nothing else) is sent without notifications, and the prefix
 * is removed from the text.
 */
export function parseSilentPrefix(content: string | null | undefined): { content: string; silent: boolean } {
  const text = content ?? "";
  const m = text.match(SILENT_PREFIX_RE);
  if (!m) return { content: text, silent: false };
  return { content: text.slice(m[0].length), silent: true };
}

/** Flags stored for a new message from the request's `flags` and an `@silent` prefix. */
export function sendFlags(requested: unknown, silentPrefix: boolean): number {
  const req = typeof requested === "number" && Number.isInteger(requested) && requested > 0 ? requested & SENDABLE_FLAGS : 0;
  return silentPrefix ? req | MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS : req;
}

export function isSilentMessage(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS) !== 0;
}

/**
 * Mentioned users for a reply: replies ping the replied-to author unless the
 * sender turned the ping off (Discord's "@ON / @OFF"). Never pings yourself.
 */
export function withReplyMention(
  mentionedUserIds: string[],
  opts: { repliedAuthorId?: string | null; senderId: string; mentionRepliedUser?: boolean | null },
): string[] {
  const target = opts.repliedAuthorId;
  if (!target || opts.mentionRepliedUser === false) return mentionedUserIds;
  if (target.toLowerCase() === opts.senderId.toLowerCase()) return mentionedUserIds;
  if (mentionedUserIds.some((id) => id.toLowerCase() === target.toLowerCase())) return mentionedUserIds;
  return [...mentionedUserIds, target];
}
