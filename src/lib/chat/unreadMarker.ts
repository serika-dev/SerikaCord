/**
 * "NEW" divider / unread bar math for a conversation, from the read marker
 * captured when the conversation was opened.
 */

export interface ReadMarker {
  /** createdAt of the last read message (server time), or null if never read. */
  lastReadAt: string | null;
  /** Exact last read message id when known (cross-device ack). */
  lastReadMessageId: string | null;
}

export interface UnreadMessageLike {
  id: string;
  createdAt?: string;
  authorId?: string;
  pending?: boolean;
  ephemeral?: boolean;
  type?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnreadDivider {
  /** Message the red "NEW" line is drawn above. */
  firstUnreadId: string;
  /** Unread messages from others in the loaded window. */
  count: number;
  /** More unread messages may sit above the loaded window. */
  countIsLowerBound: boolean;
  /** createdAt of the first unread message (for "since {time}"). */
  since: string | null;
}

function ts(value: string | undefined | null): number {
  if (!value) return NaN;
  return new Date(value).getTime();
}

/**
 * First unread message (oldest message from someone else after the marker)
 * and how many follow it. Messages must be sorted oldest → newest. Returns
 * null when nothing is unread, or when the conversation was never opened
 * before (a brand new DM shouldn't open on a wall of red).
 */
export function computeUnreadDivider(
  messages: ReadonlyArray<UnreadMessageLike>,
  marker: ReadMarker | null | undefined,
  currentUserId: string | null | undefined,
  hasMoreOlder = false,
): UnreadDivider | null {
  if (!marker || messages.length === 0) return null;
  const { lastReadMessageId, lastReadAt } = marker;
  if (!lastReadMessageId && !lastReadAt) return null;

  let start = -1;
  const markerIdx = lastReadMessageId ? messages.findIndex((m) => m.id === lastReadMessageId) : -1;
  if (markerIdx >= 0) {
    start = markerIdx + 1;
  } else {
    const readMs = ts(lastReadAt);
    if (Number.isNaN(readMs)) return null;
    start = messages.findIndex((m) => {
      const t = ts(m.createdAt);
      return !Number.isNaN(t) && t > readMs;
    });
    if (start < 0) return null;
  }

  let firstUnreadId: string | null = null;
  let since: string | null = null;
  let count = 0;
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (m.pending || m.ephemeral) continue;
    // Your own messages are read by definition; a reply you sent ends the run.
    if (currentUserId && m.authorId === currentUserId) {
      firstUnreadId = null;
      since = null;
      count = 0;
      continue;
    }
    if (!firstUnreadId) {
      firstUnreadId = m.id;
      since = m.createdAt ?? null;
    }
    count += 1;
  }
  if (!firstUnreadId || count === 0) return null;
  // The marker message isn't in the window and the first loaded message is
  // already unread: there may be more above it.
  const countIsLowerBound = markerIdx < 0 && start === 0 && hasMoreOlder;
  return { firstUnreadId, count, countIsLowerBound, since };
}

/** Marker time in ms (0 when never read), for "has the marker moved?" checks. */
export function readMarkerMs(marker: ReadMarker | null | undefined): number {
  const t = marker?.lastReadAt ? Date.parse(marker.lastReadAt) : 0;
  return Number.isNaN(t) ? 0 : t;
}

export interface MessageStamp {
  id: string;
  createdAt: string;
}

/** What "Mark Unread" on one message does (see UnreadContext.markChannelUnread). */
export interface MarkUnreadPlan {
  /** The message marked unread: the "NEW" line goes above it. */
  from: MessageStamp;
  /** The message above it, which becomes the last read one (null: none loaded). */
  previous: MessageStamp | null;
  /** The new read marker. */
  marker: ReadMarker;
  /** Messages that badge again (DM messages / mentions from others). */
  badge: MessageStamp[];
  /** Newest loaded message, so the conversation counts as unread. */
  newest: MessageStamp | null;
}

/**
 * Plan "Mark Unread" from `fromId` in a loaded window (oldest → newest).
 * `counts` decides which messages from others badge again (every message in a
 * DM, mentions in a server channel).
 */
export function planMarkUnread<M extends UnreadMessageLike>(
  messages: ReadonlyArray<M>,
  fromId: string,
  opts: { currentUserId?: string | null; counts: (message: M) => boolean },
): MarkUnreadPlan | null {
  const real = messages.filter((m) => !m.pending && !m.ephemeral && m.createdAt && UUID_RE.test(m.id));
  const idx = real.findIndex((m) => m.id === fromId);
  if (idx < 0) return null;
  const stamp = (m: M): MessageStamp => ({ id: m.id, createdAt: m.createdAt as string });
  const from = stamp(real[idx]);
  const previous = idx > 0 ? stamp(real[idx - 1]) : null;
  const marker: ReadMarker = previous
    ? { lastReadMessageId: previous.id, lastReadAt: previous.createdAt }
    : { lastReadMessageId: null, lastReadAt: new Date(ts(from.createdAt) - 1).toISOString() };
  const badge = real
    .slice(idx)
    .filter((m) => !(opts.currentUserId && m.authorId === opts.currentUserId) && opts.counts(m))
    .map(stamp);
  return { from, previous, marker, badge, newest: stamp(real[real.length - 1]) };
}

/** Newest message that can be acknowledged as read (skips optimistic sends). */
export function newestAckable<M extends UnreadMessageLike>(messages: ReadonlyArray<M>): M | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.pending || m.ephemeral || !m.createdAt) continue;
    if (!UUID_RE.test(m.id)) continue;
    return m;
  }
  return null;
}
