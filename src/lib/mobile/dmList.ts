/**
 * Pure helpers for the phone DM list (MobileMessagesView): row identity across
 * refetches and the per-row badge key the list subscribes to. Unit tested
 * (tests/dm-list-rows.test.ts).
 */

/** One conversation row of the list. */
export interface DmListRow {
  id: string;
  recipientId: string;
  /** Where the row opens (the 1:1 DM or the group page). */
  href: string;
  type: "dm" | "group";
  name: string;
  username: string;
  avatar?: string;
  avatars?: string[];
  lastMessage: string;
  timestamp: string;
  unreadCount?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
}

/** The unread functions the badge key reads. */
export interface RowBadgeSource {
  isChannelUnread: (channelId: string) => boolean;
  getMentionCount: (channelId: string) => number;
}

/** Each row's badge ("id:unread:mentions;"), so the list re-renders only when one changes. */
export function rowBadgeKey(u: RowBadgeSource, rows: ReadonlyArray<Pick<DmListRow, "id">>): string {
  let key = "";
  for (const m of rows) key += `${m.id}:${u.isChannelUnread(m.id) ? 1 : 0}:${u.getMentionCount(m.id)};`;
  return key;
}

export function parseRowBadges(key: string): Map<string, { unread: boolean; mentions: number }> {
  const out = new Map<string, { unread: boolean; mentions: number }>();
  for (const part of key.split(";")) {
    if (!part) continue;
    const [id, unread, mentions] = part.split(":");
    out.set(id, { unread: unread === "1", mentions: Number(mentions) || 0 });
  }
  return out;
}

/** Same row content (a refetch builds new objects for unchanged rows). */
export function sameRow(a: DmListRow, b: DmListRow): boolean {
  return a.id === b.id && a.href === b.href && a.type === b.type && a.name === b.name && a.avatar === b.avatar
    && (a.avatars ?? []).join("|") === (b.avatars ?? []).join("|") && a.lastMessage === b.lastMessage
    && a.timestamp === b.timestamp && a.status === b.status && a.isPinned === b.isPinned && a.isFavorite === b.isFavorite;
}

/** Keep the previous object for rows that didn't change, so their memoized rows skip rendering. */
export function reuseRows(prev: DmListRow[], next: DmListRow[]): DmListRow[] {
  if (prev.length === 0) return next;
  const byId = new Map(prev.map((m) => [m.id, m]));
  let same = prev.length === next.length;
  const out = next.map((m, i) => {
    const old = byId.get(m.id);
    const kept = old && sameRow(old, m) ? old : m;
    if (kept !== prev[i]) same = false;
    return kept;
  });
  return same ? prev : out;
}
