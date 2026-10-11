/**
 * Announcement channels: publishing ("crossposting") a message to every
 * channel that follows it. Pure rules shared by the API
 * (lib/api/announcements.ts) and the chat UI. Tested in
 * tests/announcements.test.ts.
 *
 *   source #news (announcement) ──Publish──▶ copy posted in each follower
 *   channel by that follow's webhook, shown as "Server #news".
 */

/** Discord message flags for crossposting. */
export const CROSSPOST_FLAGS = {
  /** The original was published to its followers. */
  CROSSPOSTED: 1 << 0,
  /** This message is a published copy from a followed channel. */
  IS_CROSSPOST: 1 << 1,
} as const;

/** Most follows one announcement channel publishes to. */
export const MAX_FOLLOWERS_PER_CHANNEL = 500;
/** Most announcement channels one channel can follow. */
export const MAX_FOLLOWS_PER_TARGET = 50;

const MAX_WEBHOOK_NAME = 80;

export function isCrossposted(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & CROSSPOST_FLAGS.CROSSPOSTED) !== 0;
}

export function isCrosspostCopy(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & CROSSPOST_FLAGS.IS_CROSSPOST) !== 0;
}

/** Message types that can be published (regular messages and replies). */
const PUBLISHABLE_TYPES = new Set(["default", "reply", "0", "19"]);

/**
 * Whether `message` in a channel of `channelType` can still be published.
 * Only saved, regular messages in announcement channels that were not
 * published already (and aren't copies themselves).
 */
export function canPublishMessage(
  message: { id?: string; type?: string | number | null; flags?: number | null; pending?: boolean; ephemeral?: boolean; isDeleted?: boolean | null },
  channelType: string | null | undefined,
): boolean {
  if (channelType !== "announcement") return false;
  if (!message.id || message.id.startsWith("temp-") || message.pending || message.ephemeral || message.isDeleted) return false;
  if (message.type !== undefined && message.type !== null && !PUBLISHABLE_TYPES.has(String(message.type))) return false;
  return !isCrossposted(message.flags) && !isCrosspostCopy(message.flags);
}

/** The follow webhook's name: "Server #channel", trimmed to the webhook limit. */
export function followWebhookName(serverName: string | null | undefined, channelName: string | null | undefined): string {
  const server = (serverName || "").replace(/[\x00-\x1F\x7F]/g, "").trim();
  const channel = (channelName || "").replace(/[\x00-\x1F\x7F]/g, "").trim();
  const tag = channel ? `#${channel}` : "";
  if (!server) return (tag || "Announcements").slice(0, MAX_WEBHOOK_NAME);
  if (!tag) return server.slice(0, MAX_WEBHOOK_NAME);
  const room = MAX_WEBHOOK_NAME - tag.length - 1;
  if (room <= 0) return tag.slice(0, MAX_WEBHOOK_NAME);
  const s = server.length > room ? `${server.slice(0, Math.max(1, room - 1))}…` : server;
  return `${s} ${tag}`;
}

/** Channel types that may receive published messages. */
export function canReceiveFollow(channelType: string | null | undefined): boolean {
  return channelType === "text" || channelType === "announcement";
}

/** Strip anything per-message from attachments/embeds before copying them. */
export function copyableAttachments(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a) => a && typeof a === "object").slice(0, 10);
}

export function copyableEmbeds(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e) => e && typeof e === "object").slice(0, 10);
}
