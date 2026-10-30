import type { ChatMessage } from "@/lib/chat/types";

/** Pure helpers for the loaded message window in `useChatSession`. */

const isTemp = (m: ChatMessage) => m.id.startsWith("temp-");
const time = (m: ChatMessage) => Date.parse(m.createdAt) || 0;

/**
 * Reconcile a freshly fetched latest page against what is on screen (or cached).
 *
 * - Everything inside the page's time range is replaced by the page's copies, so
 *   messages deleted while we weren't listening disappear and edits, reactions
 *   and pins take the server's version.
 * - Confirmed messages older than the page are kept only when the cache overlaps
 *   the page (otherwise there may be a gap between them, so they are dropped and
 *   scroll-up pagination reloads them).
 * - Messages newer than the page (arrived over SSE meanwhile), client-only
 *   ephemerals and optimistic `temp-` bubbles are kept.
 */
export function reconcileLatestPage<M extends ChatMessage>(page: M[], prev: M[]): M[] {
  if (prev.length === 0) return page;
  const temps = prev.filter(isTemp);
  const ephemerals = prev.filter((m) => m.ephemeral && !isTemp(m));
  if (page.length === 0) return [...ephemerals, ...temps];

  const pageIds = new Set(page.map((m) => m.id));
  let oldest = Infinity;
  let newest = -Infinity;
  for (const m of page) {
    const t = time(m);
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  const confirmed = prev.filter((m) => !isTemp(m) && !m.ephemeral && !pageIds.has(m.id));
  const overlaps = prev.some((m) => pageIds.has(m.id)) || confirmed.some((m) => time(m) >= oldest);
  const older = overlaps ? confirmed.filter((m) => time(m) < oldest) : [];
  const newer = confirmed.filter((m) => time(m) > newest);

  const merged = [...older, ...page, ...newer];
  for (const e of ephemerals) {
    if (pageIds.has(e.id)) continue;
    const at = merged.findIndex((m) => time(m) > time(e));
    if (at === -1) merged.push(e);
    else merged.splice(at, 0, e);
  }
  return temps.length ? [...merged, ...temps] : merged;
}

/** Keep only the newest `max` messages. */
export function capTail<M>(messages: M[], max: number): M[] {
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

/**
 * Put a message back after a failed optimistic removal without touching anything
 * that changed meanwhile: after its former neighbour if that is still there,
 * otherwise at its createdAt position. No-op if it is already present.
 */
export function reinsertMessage<M extends ChatMessage>(prev: M[], removed: M, prevNeighborId?: string): M[] {
  if (prev.some((m) => m.id === removed.id)) return prev;
  let idx = -1;
  if (prevNeighborId) {
    const n = prev.findIndex((m) => m.id === prevNeighborId);
    if (n !== -1) idx = n + 1;
  }
  if (idx === -1) {
    const t = time(removed);
    idx = prev.findIndex((m) => !isTemp(m) && time(m) > t);
    if (idx === -1) idx = prev.length;
  }
  return [...prev.slice(0, idx), removed, ...prev.slice(idx)];
}

/**
 * First group index to mount when a conversation opens (MessageList mounts
 * the newest `count` groups first, the rest right after that first paint).
 * Starts earlier when the unread divider is in an older group, so the list
 * can open at the first unread message.
 */
export function initialMountStart(
  groups: ReadonlyArray<{ messages: ReadonlyArray<{ id: string }> }>,
  dividerId: string | null | undefined,
  count: number,
): number {
  let start = Math.max(0, groups.length - count);
  if (dividerId && start > 0) {
    const at = groups.findIndex((g) => g.messages.some((m) => m.id === dividerId));
    if (at !== -1 && at < start) start = at;
  }
  return start;
}

/**
 * Cold open of an encrypted conversation: the newest rows to decrypt and show
 * before the rest of the page, or null when the page is decrypted in one go
 * (a short page, or no envelopes). `isEncrypted` tells envelope rows apart.
 */
export function headFirstRows<R>(page: R[], count: number, isEncrypted: (row: R) => boolean): R[] | null {
  if (page.length <= count || !page.some(isEncrypted)) return null;
  return page.slice(-count);
}

/**
 * How MessageList keeps the reader in place when the older groups of a just
 * opened conversation mount above the ones on screen: back to the bottom when
 * the reader was there (or is glued to it, or a force-scroll is pending),
 * else on the row they were looking at, else by the height that was added.
 */
export function fullMountRestoreMode(s: { atBottom: boolean; stuckToBottom: boolean; forcePending: boolean; hasAnchor: boolean }): "bottom" | "anchor" | "height" {
  if (s.atBottom || s.stuckToBottom || s.forcePending) return "bottom";
  return s.hasAnchor ? "anchor" : "height";
}
