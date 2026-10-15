/**
 * The chat engine's message cache, kept apart from useChatSession so the root
 * layout (AuthContext clears it on login/logout/account switch) doesn't pull
 * the whole chat engine into every page's startup bundle.
 */
import type { ChatMessage } from "@/lib/chat/types";

/**
 * Module-level stale-while-revalidate cache keyed by REST base (apiBase).
 * Re-opening a channel/DM paints the last-seen messages instantly while a
 * fresh fetch revalidates in the background, so switching feels near-instant
 * instead of clearing to a spinner on every visit. Lives for the tab session.
 */
export const MAX_CACHED_CONTEXTS = 50;
export const messageCache = new Map<string, ChatMessage[]>();

// localStorage persistence: paints channels instantly after a full page reload
// (in-memory cache alone is lost on reload). We persist only a small tail of
// recent messages for a bounded set of contexts to stay well under quota.
const LS_MSG_PREFIX = "sc:msgcache:";
const LS_PERSIST_TAIL = 50;
const LS_MAX_PERSISTED = 30;
const LS_INDEX_KEY = "sc:msgcache:index";

/**
 * End-to-end encrypted messages are persisted as their envelope only (no
 * decrypted text, files, sticker or reply preview); the next fetch decrypts
 * them again in memory.
 */
function withoutPlaintext(m: ChatMessage): ChatMessage {
  if (!m.e2ee) return m;
  const ref = m.referencedMessage ? { ...m.referencedMessage, content: "" } : undefined;
  return {
    ...m,
    content: "",
    attachments: [],
    sticker: undefined,
    mentionedUserIds: [],
    referencedMessage: ref,
    e2ee: { status: "pending", envelope: m.e2ee.envelope },
  };
}

function lsPersist(key: string, messages: ChatMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const tail = messages.slice(-LS_PERSIST_TAIL).map(withoutPlaintext);
    localStorage.setItem(LS_MSG_PREFIX + key, JSON.stringify(tail));
    // Maintain a small LRU index so we can evict old persisted contexts.
    const idx: string[] = JSON.parse(localStorage.getItem(LS_INDEX_KEY) || "[]");
    const next = [key, ...idx.filter((k) => k !== key)];
    while (next.length > LS_MAX_PERSISTED) {
      const evict = next.pop();
      if (evict) localStorage.removeItem(LS_MSG_PREFIX + evict);
    }
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(next));
  } catch {
    /* quota / disabled — ignore */
  }
}

function lsHydrate<M extends ChatMessage>(key: string): M[] | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(LS_MSG_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as M[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function readCache<M extends ChatMessage>(key: string): M[] | undefined {
  let cached = messageCache.get(key);
  if (!cached) {
    // Fall back to persisted tail (post-reload) and promote into memory.
    const hydrated = lsHydrate<M>(key);
    if (!hydrated) return undefined;
    cached = hydrated;
    messageCache.set(key, cached);
  } else {
    // Refresh LRU recency.
    messageCache.delete(key);
    messageCache.set(key, cached);
  }
  return cached as M[];
}

export function writeCache<M extends ChatMessage>(key: string, messages: M[], persist = false): void {
  messageCache.delete(key);
  messageCache.set(key, messages);
  if (messageCache.size > MAX_CACHED_CONTEXTS) {
    const oldest = messageCache.keys().next().value;
    if (oldest !== undefined) messageCache.delete(oldest);
  }
  // Only persist authoritative fetches (initial load / prefetch), not every
  // live SSE/optimistic mutation — those would thrash localStorage.
  if (persist) lsPersist(key, messages);
}

/** Clear all cached messages (in-memory + localStorage). Call on account switch / login / logout to prevent cross-account message leakage. */
export function clearMessageCache(): void {
  messageCache.clear();
  inflightPrefetch.clear();
  if (typeof localStorage === "undefined") return;
  try {
    const idx: string[] = JSON.parse(localStorage.getItem(LS_INDEX_KEY) || "[]");
    for (const key of idx) {
      localStorage.removeItem(LS_MSG_PREFIX + key);
    }
    localStorage.removeItem(LS_INDEX_KEY);
  } catch {
    /* ignore */
  }
}

/** True if this REST base already has messages warmed in the SWR cache. */
export function hasCachedMessages(apiBase: string): boolean {
  const cached = messageCache.get(apiBase);
  return !!cached && cached.length > 0;
}

// De-dupes concurrent prefetches for the same base (hover + server-open can race).
export const inflightPrefetch = new Map<string, Promise<void>>();
