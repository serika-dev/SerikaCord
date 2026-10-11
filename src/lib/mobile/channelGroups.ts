/**
 * Pure helpers for the phone channel list (MobileServerView): group a server's
 * channels under their categories the way the desktop sidebar does, and filter
 * them by a search query. No React, no DOM.
 */

export interface MobileChannelLike {
  id: string;
  name: string;
  type: string;
  position?: number | null;
  parentId?: string | null;
}

export interface MobileChannelGroup<C extends MobileChannelLike> {
  /** Category channel id, or null for channels outside any category. */
  id: string | null;
  /** Category name; null for the uncategorized group (the UI labels it). */
  name: string | null;
  channels: C[];
}

const THREAD_TYPES = new Set(["public_thread", "private_thread"]);

const byPosition = (a: MobileChannelLike, b: MobileChannelLike) => (a.position ?? 0) - (b.position ?? 0);

/**
 * Categories in position order, each with its channels in position order.
 * Threads are left out (they live under their parent). A channel whose
 * category no longer exists is shown with the uncategorized channels, which
 * come first, like on desktop. Empty categories are kept (admins see them).
 */
export function groupMobileChannels<C extends MobileChannelLike>(channels: readonly C[]): MobileChannelGroup<C>[] {
  const categories = channels.filter((c) => c.type === "category").sort(byPosition);
  const categoryIds = new Set(categories.map((c) => c.id));
  const byParent = new Map<string | null, C[]>();

  for (const channel of [...channels].sort(byPosition)) {
    if (channel.type === "category" || THREAD_TYPES.has(channel.type)) continue;
    const parent = channel.parentId && categoryIds.has(channel.parentId) ? channel.parentId : null;
    const list = byParent.get(parent);
    if (list) list.push(channel);
    else byParent.set(parent, [channel]);
  }

  const groups: MobileChannelGroup<C>[] = [];
  const loose = byParent.get(null);
  if (loose?.length) groups.push({ id: null, name: null, channels: loose });
  for (const category of categories) {
    groups.push({ id: category.id, name: category.name, channels: byParent.get(category.id) ?? [] });
  }
  return groups;
}

/** Keep only channels whose name contains the query (case-insensitive); drops emptied groups. */
export function filterMobileChannelGroups<C extends MobileChannelLike>(
  groups: MobileChannelGroup<C>[],
  query: string,
): MobileChannelGroup<C>[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, channels: g.channels.filter((c) => c.name.toLowerCase().includes(q)) }))
    .filter((g) => g.channels.length > 0);
}

/** Movement (px) after which a press stops counting as a long-press (it's a scroll). */
export const LONG_PRESS_SLOP_PX = 10;
/** How long (ms) a finger must rest before the long-press menu opens. */
export const LONG_PRESS_MS = 420;

/** Whether a touch moved far enough from where it started to cancel a long-press. */
export function exceedsLongPressSlop(dx: number, dy: number, slop = LONG_PRESS_SLOP_PX): boolean {
  return dx * dx + dy * dy > slop * slop;
}
