/**
 * Desktop notifications are grouped per conversation: one notification per
 * channel/DM (same tag), replaced as more messages arrive, and closed once the
 * conversation is read on any device.
 */

/** Notification tag for a conversation. */
export function conversationTag(channelId: string): string {
  return `message-${channelId}`;
}

/** Messages notified per open group, keyed by tag. */
export class NotificationGroups {
  private counts = new Map<string, number>();
  constructor(private readonly max = 99) {}

  /** Count one more message for `tag`; returns the new count. */
  bump(tag: string): number {
    const next = Math.min((this.counts.get(tag) ?? 0) + 1, this.max);
    this.counts.delete(tag); // keep insertion order = recency
    this.counts.set(tag, next);
    if (this.counts.size > 200) {
      const oldest = this.counts.keys().next().value;
      if (oldest !== undefined) this.counts.delete(oldest);
    }
    return next;
  }

  /** The conversation was read: start over. Returns whether a group was open. */
  clear(tag: string): boolean {
    return this.counts.delete(tag);
  }

  count(tag: string): number {
    return this.counts.get(tag) ?? 0;
  }
}

export interface GroupedBodyInput {
  count: number;
  /** Preview of the newest message (already respecting "show preview"). */
  latestBody: string;
  showPreview: boolean;
}

/**
 * Body for a grouped notification. One message shows its preview; several show
 * "{n} new messages", followed by the newest preview when previews are on.
 * `formatMany` supplies the translated "{n} new messages" string.
 */
export function groupedNotificationBody(
  input: GroupedBodyInput,
  formatMany: (count: number) => string,
): string {
  if (input.count <= 1) return input.latestBody;
  const label = formatMany(input.count);
  if (!input.showPreview || !input.latestBody) return label;
  return `${label}\n${input.latestBody}`;
}
