"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { sharedGet } from "@/lib/bootFetch";
import { useGT } from "gt-next";
import type { MessageBarHandle } from "@/components/chat/MessageBar";
import { useChatStream, useTypingSignal, type ChatStreamEvent } from "@/hooks/useChatStream";
import { useMessageActions } from "@/hooks/useMessageActions";
import {
  applyThreadUpdate,
  groupMessages,
  isComposerlessMessage,
  normalizeIncomingMessage,
  type EmojiLookupEntry,
  type RawMessagePayload,
} from "@/lib/chat/messages";
import { buildGalleryFromMessages } from "@/lib/chat/media";
import { capTail, reconcileLatestPage } from "@/lib/chat/messageWindow";
import type { ChatMessage, MessageSticker } from "@/lib/chat/types";
import { parseCallData } from "@/lib/voice/callMessage";
import { applyPollUpdate, type PollUpdateEvent } from "@/lib/chat/polls";
import { haptic } from "@/lib/native/bridge";

const PAGE_SIZE = 50;
// Scroll-up pagination fetches a smaller batch than the initial load. Mounting
// 50 fresh message subtrees in one commit (markdown parse + embeds + avatars)
// is a single long main-thread task that freezes the whole app mid-scroll;
// a smaller batch keeps each spike short. Initial load stays PAGE_SIZE so a
// freshly-opened channel fills the viewport in one request.
const OLDER_PAGE_SIZE = 25;
// Keeps the DOM light (no virtualization needed) while allowing deep scrollback.
const MAX_LOADED_MESSAGES = 200;
// Live appends trim the head only once the window is this far over the cap, so
// a busy channel doesn't re-slice (and regroup the first group) on every message.
const LIVE_TRIM_SLACK = 50;

/**
 * Module-level stale-while-revalidate cache keyed by REST base (apiBase).
 * Re-opening a channel/DM paints the last-seen messages instantly while a
 * fresh fetch revalidates in the background, so switching feels near-instant
 * instead of clearing to a spinner on every visit. Lives for the tab session.
 */
const MAX_CACHED_CONTEXTS = 50;
const messageCache = new Map<string, ChatMessage[]>();

// localStorage persistence: paints channels instantly after a full page reload
// (in-memory cache alone is lost on reload). We persist only a small tail of
// recent messages for a bounded set of contexts to stay well under quota.
const LS_MSG_PREFIX = "sc:msgcache:";
const LS_PERSIST_TAIL = 50;
const LS_MAX_PERSISTED = 30;
const LS_INDEX_KEY = "sc:msgcache:index";

function lsPersist(key: string, messages: ChatMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const tail = messages.slice(-LS_PERSIST_TAIL);
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

function readCache<M extends ChatMessage>(key: string): M[] | undefined {
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

function writeCache<M extends ChatMessage>(key: string, messages: M[], persist = false): void {
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

/** Normalize a raw message list and drop duplicate ids, preserving order. */
function dedupeMessages<M extends ChatMessage>(raw: RawMessagePayload[]): M[] {
  const seen = new Set<string>();
  const out: M[] = [];
  for (const item of raw) {
    const normalized = normalizeIncomingMessage<M>(item);
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
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
const inflightPrefetch = new Map<string, Promise<void>>();

/**
 * Warm the shared message cache for a channel/DM without mounting the chat.
 * Used to make channel switching feel instant: on server open we prefetch
 * channels with unread activity, and on hover we prefetch the hovered channel.
 * No-op (returns cached) if already warm unless `force` is set.
 */
export function prefetchChannelMessages(apiBase: string, force = false): Promise<void> {
  if (!apiBase) return Promise.resolve();
  if (!force && hasCachedMessages(apiBase)) return Promise.resolve();
  const existing = inflightPrefetch.get(apiBase);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetch(`${apiBase}/messages?limit=${PAGE_SIZE}`);
      if (!response.ok) return;
      const data = await response.json();
      const raw = Array.isArray(data) ? data : data.messages || [];
      const seen = new Set<string>();
      const deduped: ChatMessage[] = [];
      for (const item of raw) {
        const normalized = normalizeIncomingMessage<ChatMessage>(item);
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        deduped.push(normalized);
      }
      if (deduped.length > 0) writeCache(apiBase, deduped, true);
    } catch {
      // best-effort warm-up; the real fetch on open will retry
    } finally {
      inflightPrefetch.delete(apiBase);
    }
  })();

  inflightPrefetch.set(apiBase, task);
  return task;
}

export interface ChatSessionUser {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  status?: "online" | "idle" | "dnd" | "offline";
  isPremium?: boolean;
  badges?: string[];
}

export interface SendMessageInput {
  /** Overrides the composer content (e.g. GIF url). Composer is untouched. */
  contentOverride?: string;
  sticker?: MessageSticker;
}

interface UseChatSessionOptions<M extends ChatMessage> {
  /** REST base, e.g. `/api/channels/{id}` or `/api/dms/{id}`. Null disables. */
  apiBase: string | null;
  /** Identifier stored on optimistic messages as channelId. */
  contextId: string | null;
  user: ChatSessionUser | null | undefined;
  messageBarRef: RefObject<MessageBarHandle | null>;
  emojiLookup?: EmojiLookupEntry[];
  /** Whether the backend supports `before=` pagination (channels do). */
  paginated?: boolean;
  /** Transform draft content before sending (e.g. mention normalization). */
  normalizeContent?: (content: string) => string;
  /**
   * Called for incoming SSE messages authored by someone else, after they are
   * applied to state — hook for notification / unread UX.
   */
  onIncomingMessage?: (message: M) => void;
  /** Extra SSE event types the caller wants to handle (e.g. voice events). */
  onOtherEvent?: (event: ChatStreamEvent) => void;
  /** Called right after a send/receive that should scroll to bottom. */
  onShouldScrollToBottom?: () => void;
}

/**
 * The single chat engine shared by server channels and DMs: message state,
 * initial fetch + `before` pagination, SSE application, optimistic sends with
 * rollback, pins, per-message actions, and typing signals.
 */
export function useChatSession<M extends ChatMessage>({
  apiBase,
  contextId,
  user,
  messageBarRef,
  emojiLookup,
  paginated = true,
  normalizeContent,
  onIncomingMessage,
  onOtherEvent,
  onShouldScrollToBottom,
}: UseChatSessionOptions<M>) {
  const gt = useGT();
  const [messages, setMessages] = useState<M[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  // Sends are queued, not dropped: each Enter clears the composer and shows its
  // optimistic bubble right away, and the POSTs go out one at a time in order.
  // Only an attachment upload is exclusive — the MessageBar holds one set of
  // pending files, so a second send with files waits for the first to finish.
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightSendsRef = useRef(0);
  const uploadingRef = useRef(false);
  const tempSeqRef = useRef(0);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  // True when the loaded window is NOT anchored to the live tail — i.e. we jumped
  // to a pinned/search result via `around`, or older-history loading trimmed the
  // newest messages away. Drives forward ("load newer") pagination so the user
  // can scroll back down to the latest message. Mirror in a ref so SSE/live
  // appends can be gated without re-subscribing.
  const [hasMoreNewer, setHasMoreNewer] = useState(false);
  const hasMoreNewerRef = useRef(false);
  useEffect(() => { hasMoreNewerRef.current = hasMoreNewer; }, [hasMoreNewer]);
  // Mirrors MessageList's bottom-adjacency (via onAtBottomChange). Live appends
  // only trim the head while the reader is at the bottom, so rows never vanish
  // from under someone reading older history.
  const atBottomRef = useRef(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<M[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);

  // Guard against a slow response from a previously viewed context
  // overwriting the current one after a fast switch.
  const activeFetchContextRef = useRef<string | null>(null);

  // Track in-flight / resolved authors who loaded as "Unknown" so we don't spam fetch
  const fetchedUnknownAuthorsRef = useRef<Set<string>>(new Set());

  // Synchronously swap to the new context's view the moment apiBase changes,
  // BEFORE paint. Without this, `messages` still holds the previous channel's
  // list until fetchMessages runs in a passive effect a frame later, so the new
  // channel visibly flashes the old channel's messages (the "buggy switching").
  // We paint the SWR cache instantly (no spinner) or clear to the loading state
  // on a cold open. fetchMessages then revalidates in the background.
  const [renderedContext, setRenderedContext] = useState<string | null>(apiBase);
  if (apiBase !== renderedContext) {
    // Memory: the context we're leaving no longer needs deep scrollback in the
    // cache — trim its entry to one page. Only the active context can grow to
    // MAX_LOADED_MESSAGES; without this, 50 cached contexts × 200 messages of
    // authors/embeds/reactions stay retained on the heap for the tab lifetime.
    if (renderedContext) {
      const departing = messageCache.get(renderedContext);
      if (departing && departing.length > PAGE_SIZE) {
        messageCache.set(renderedContext, departing.slice(-PAGE_SIZE));
      }
    }
    setRenderedContext(apiBase);
    activeFetchContextRef.current = apiBase;
    fetchedUnknownAuthorsRef.current.clear();
    setPinnedMessages([]);
    setIsLoadingMore(false);
    // A fresh context always opens anchored to the live tail.
    setHasMoreNewer(false);
    hasMoreNewerRef.current = false;
    atBottomRef.current = true;
    if (apiBase) {
      const cached = readCache<M>(apiBase);
      if (cached && cached.length > 0) {
        setMessages(cached);
        // Optimistic about older history — loadOlderMessages self-corrects the
        // first time the server returns a short page. MessageList only auto-
        // paginates once the user actually scrolls into scrollable room, so this
        // no longer triggers a spurious fetch on open.
        setHasMoreOlder(paginated);
        setIsLoading(false);
      } else {
        setMessages([]);
        setHasMoreOlder(false);
        setIsLoading(true);
      }
    } else {
      setMessages([]);
      setHasMoreOlder(false);
      setIsLoading(false);
    }
  }

  const latestRef = useRef({ normalizeContent, onIncomingMessage, onOtherEvent, onShouldScrollToBottom });
  useEffect(() => {
    latestRef.current = { normalizeContent, onIncomingMessage, onOtherEvent, onShouldScrollToBottom };
  });

  const fetchPinnedMessages = useCallback(async () => {
    if (!apiBase) return;
    setIsLoadingPins(true);
    try {
      const response = await fetch(`${apiBase}/pins?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setPinnedMessages(((data.messages || []) as M[]).map((m) => normalizeIncomingMessage<M>(m)));
      }
    } catch {
      // best-effort UI
    } finally {
      setIsLoadingPins(false);
    }
  }, [apiBase]);

  const actions = useMessageActions<M>({
    apiBase,
    setMessages,
    userId: user?.id,
    emojiLookup,
    onPinsChanged: fetchPinnedMessages,
  });

  const { signalTyping, resetTyping } = useTypingSignal(apiBase ? `${apiBase}/typing` : null);

  const fetchMessages = useCallback(async () => {
    if (!apiBase) return;
    const requestedContext = apiBase;
    activeFetchContextRef.current = requestedContext;

    // Stale-while-revalidate: paint cached messages immediately (no spinner)
    // and revalidate below. Only fall back to the loading state on a cold open.
    const cached = readCache<M>(requestedContext);
    const warm = Boolean(cached && cached.length > 0);
    if (cached && warm) {
      setMessages(cached);
      // Be optimistic about older history when painting from cache: the cache may
      // be a short persisted tail (localStorage only keeps ~30 messages), so a
      // strict `>= PAGE_SIZE` check would wrongly disable scroll-up pagination
      // after a reload. loadOlderMessages self-corrects to `false` the first time
      // the server returns a short page.
      setHasMoreOlder(paginated);
      setIsLoading(false);
      latestRef.current.onShouldScrollToBottom?.();
    } else {
      setIsLoading(true);
      setHasMoreOlder(false);
      setMessages([]);
    }
    try {
      // Always revalidate with the plain latest page (not an `after=` delta):
      // only the active context has a stream, so edits, deletes, reactions and
      // pins made while we were away must be re-read, not just new messages.
      // A cold or boot-prefetched open may already have this page in flight.
      const response = await sharedGet(`${apiBase}/messages?limit=${PAGE_SIZE}`);
      if (activeFetchContextRef.current !== requestedContext) return;
      if (response.ok) {
        const data = await response.json();
        if (activeFetchContextRef.current !== requestedContext) return;
        const raw = Array.isArray(data) ? data : data.messages || [];
        const page = dedupeMessages<M>(raw);
        // The latest page anchors us to the present again.
        setHasMoreNewer(false);
        setMessages((prev) => {
          const next = capTail(reconcileLatestPage(page, prev), MAX_LOADED_MESSAGES);
          writeCache(requestedContext, next, true);
          return next;
        });
        // On a warm open keep the optimistic hasMoreOlder unless the page shows
        // the whole history fits (reconciled older rows may still be cached).
        if (!warm || page.length >= PAGE_SIZE) setHasMoreOlder(paginated && page.length >= PAGE_SIZE);
        // No explicit scroll on a warm open: we already scrolled on the cache
        // paint, and a second scroll here caused a visible "jump".
        if (!warm) latestRef.current.onShouldScrollToBottom?.();
      } else if (!warm) {
        toast.error(gt("Failed to load messages"));
      }
    } catch (error) {
      if (activeFetchContextRef.current !== requestedContext) return;
      console.error("Failed to fetch messages:", error);
      // On a warm open we already painted cache, so a failed revalidation is
      // silent — only surface an error when we had nothing to show.
      if (!warm) toast.error(gt("Failed to load messages"));
    } finally {
      if (activeFetchContextRef.current === requestedContext) {
        setIsLoading(false);
      }
    }
  }, [apiBase, paginated]);

  const messagesRef = useRef<M[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // After an SSE reconnect: re-read the latest page and reconcile it with the
  // window, so messages sent and edits/deletes/reactions made while the stream
  // was down all show up.
  const catchUpTail = useCallback(async () => {
    if (!apiBase) return;
    const context = apiBase;
    try {
      const response = await fetch(`${apiBase}/messages?limit=${PAGE_SIZE}`);
      if (!response.ok || activeFetchContextRef.current !== context) return;
      const data = await response.json();
      if (activeFetchContextRef.current !== context || hasMoreNewerRef.current) return;
      const raw = Array.isArray(data) ? data : data.messages || [];
      const page = dedupeMessages<M>(raw);
      setMessages((prev) => {
        // Drop optimistic bubbles that the page now confirms.
        const existing = new Set(prev.map((m) => m.id));
        let base = prev;
        for (const own of page) {
          if (existing.has(own.id) || own.authorId !== user?.id) continue;
          const idx = base.findIndex((m) => m.id.startsWith("temp-") && m.content === own.content);
          if (idx !== -1) base = [...base.slice(0, idx), ...base.slice(idx + 1)];
        }
        return capTail(reconcileLatestPage(page, base), MAX_LOADED_MESSAGES);
      });
    } catch {
      /* next reconnect or channel switch will retry */
    }
  }, [apiBase, user?.id]);

  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    if (!apiBase || isLoadingMore || !hasMoreOlder || messages.length === 0) return false;
    const oldestId = messages[0]?.id;
    if (!oldestId || oldestId.startsWith("temp-")) return false;

    setIsLoadingMore(true);
    try {
      const response = await fetch(`${apiBase}/messages?before=${oldestId}&limit=${OLDER_PAGE_SIZE}`);
      if (response.ok) {
        const data = await response.json();
        const raw = Array.isArray(data) ? data : data.messages || [];
        if (raw.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const seenOlder = new Set<string>();
            const filtered: M[] = [];
            for (const item of raw) {
              const normalized = normalizeIncomingMessage<M>(item);
              if (seenOlder.has(normalized.id) || existingIds.has(normalized.id)) continue;
              seenOlder.add(normalized.id);
              filtered.push(normalized);
            }
            const combined = [...filtered, ...prev];
            if (combined.length > MAX_LOADED_MESSAGES) {
              // We dropped the newest messages off the bottom to cap memory, so
              // the window is no longer anchored to the live tail — enable
              // forward pagination so scrolling back down can reload them.
              setHasMoreNewer(true);
              return combined.slice(0, MAX_LOADED_MESSAGES);
            }
            return combined;
          });
          setHasMoreOlder(raw.length >= OLDER_PAGE_SIZE);
          return true;
        }
        setHasMoreOlder(false);
      }
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
    return false;
  }, [apiBase, isLoadingMore, hasMoreOlder, messages]);

  // Load the page of messages *after* the newest currently-loaded one. Used when
  // the window is detached from the live tail (jumped to a pin/search result, or
  // older-history loading trimmed the newest away) so scrolling back down reaches
  // the latest messages again.
  const loadNewerMessages = useCallback(async (): Promise<boolean> => {
    if (!apiBase || isLoadingMore || !hasMoreNewer || messages.length === 0) return false;
    // Newest non-optimistic message is the forward cursor.
    let newestId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i]?.id;
      if (id && !id.startsWith("temp-")) { newestId = id; break; }
    }
    if (!newestId) return false;

    setIsLoadingMore(true);
    try {
      const response = await fetch(`${apiBase}/messages?after=${newestId}&limit=${PAGE_SIZE}`);
      if (response.ok) {
        const data = await response.json();
        const raw = Array.isArray(data) ? data : data.messages || [];
        if (raw.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const seenNewer = new Set<string>();
            const filtered: M[] = [];
            for (const item of raw) {
              const normalized = normalizeIncomingMessage<M>(item);
              if (seenNewer.has(normalized.id) || existingIds.has(normalized.id)) continue;
              seenNewer.add(normalized.id);
              filtered.push(normalized);
            }
            const combined = [...prev, ...filtered];
            if (combined.length > MAX_LOADED_MESSAGES) {
              // Trimmed the oldest off the top → older history is now reloadable.
              setHasMoreOlder(true);
              return combined.slice(combined.length - MAX_LOADED_MESSAGES);
            }
            return combined;
          });
        }
        // A short page means we've caught up to the live tail.
        setHasMoreNewer(raw.length >= PAGE_SIZE);
        // Only report a load when rows were added (MessageList keeps a scroll
        // restore pending until the window changes).
        return raw.length > 0;
      }
    } catch (error) {
      console.error("Failed to load newer messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
    return false;
  }, [apiBase, isLoadingMore, hasMoreNewer, messages]);

  // Ensure a message is loaded so the UI can scroll to it. If it's already in
  // the window, no-op. Otherwise load a window centered on it via the `around`
  // cursor (used by pinned-message and search-result jumps). Returns whether
  // the target should now be present in the DOM after the next render.
  const jumpToMessage = useCallback(async (messageId: string): Promise<boolean> => {
    if (!apiBase || !messageId) return false;
    if (messages.some((m) => m.id === messageId)) return true;
    try {
      const response = await fetch(`${apiBase}/messages?around=${messageId}&limit=${PAGE_SIZE}`);
      if (!response.ok) return false;
      const data = await response.json();
      const raw = Array.isArray(data) ? data : data.messages || [];
      if (raw.length === 0) return false;
      const seen = new Set<string>();
      const window: M[] = [];
      for (const item of raw) {
        const normalized = normalizeIncomingMessage<M>(item);
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        window.push(normalized);
      }
      setMessages(window);
      setHasMoreOlder(true);
      // The window is centered on the target, not the live tail — allow scrolling
      // back down to newer messages (fixes "can't see newer messages after
      // viewing a pinned message").
      setHasMoreNewer(true);
      return window.some((m) => m.id === messageId);
    } catch (error) {
      console.error("Failed to jump to message:", error);
      return false;
    }
  }, [apiBase, messages]);

  useEffect(() => {
    if (apiBase && user) {
      fetchedUnknownAuthorsRef.current.clear();
      void fetchMessages();
      void fetchPinnedMessages();
    }
  }, [apiBase, user, fetchMessages, fetchPinnedMessages]);

  // Keep the SWR cache current with live updates (SSE, optimistic sends, edits,
  // deletes, scrollback). Guarded by activeFetchContextRef so a mid-switch render
  // — where `messages` still holds the previous context — never corrupts the new
  // context's cache entry.
  useEffect(() => {
    // Only tail-anchored windows are cached: a detached (jumped) window would
    // repaint on the next open as if it were the present.
    if (apiBase && activeFetchContextRef.current === apiBase && !hasMoreNewer) {
      writeCache(apiBase, messages);
    }
  }, [apiBase, messages, hasMoreNewer]);

  // Append one live message, trimming the head past the cap when allowed
  // (always for own sends, which scroll to the bottom anyway).
  const appendCapped = useCallback((prev: M[], item: M, force = false): M[] => {
    const next = [...prev, item];
    if (next.length > MAX_LOADED_MESSAGES + LIVE_TRIM_SLACK && (force || atBottomRef.current)) {
      setHasMoreOlder(true);
      return next.slice(next.length - MAX_LOADED_MESSAGES);
    }
    return next;
  }, []);

  // Wired to MessageList's onAtBottomChange. Returning to the bottom trims any
  // overflow that built up while the reader was scrolled up.
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom;
    if (!atBottom) return;
    setMessages((prev) => {
      if (prev.length <= MAX_LOADED_MESSAGES + LIVE_TRIM_SLACK) return prev;
      setHasMoreOlder(true);
      return prev.slice(prev.length - MAX_LOADED_MESSAGES);
    });
  }, []);

  // Lazy-resolve "Unknown" authors
  useEffect(() => {
    const unknownAuthorIds = new Set<string>();
    for (const m of messages) {
      if (m.author && m.author.id && m.author.id !== "unknown" && m.author.username === "unknown") {
        unknownAuthorIds.add(m.author.id);
      }
      const refAuthor = m.referencedMessage?.author;
      if (refAuthor && refAuthor.id && refAuthor.id !== "unknown" && refAuthor.username === "unknown") {
        unknownAuthorIds.add(refAuthor.id);
      }
    }

    for (const userId of Array.from(unknownAuthorIds)) {
      if (fetchedUnknownAuthorsRef.current.has(userId)) continue;
      fetchedUnknownAuthorsRef.current.add(userId);

      void (async () => {
        try {
          const res = await fetch(`/api/users/${userId}`);
          if (res.ok) {
            const fetched = await res.json();
            setMessages((prev) =>
              prev.map((m) => {
                let updated = false;
                const author = m.author?.id === userId
                  ? {
                      ...m.author,
                      username: fetched.username,
                      displayName: fetched.displayName || fetched.username,
                      avatar: fetched.avatar,
                      status: fetched.status,
                      isPremium: fetched.isPremium,
                      badges: fetched.badges || [],
                      isSystem: fetched.isSystem || false,
                      isBot: Boolean(fetched.isBot),
                      isVerified: Boolean(fetched.isVerified),
                      customization: fetched.customization || null,
                    }
                  : m.author;
                if (author !== m.author) updated = true;

                const refAuthor = m.referencedMessage?.author?.id === userId
                  ? {
                      ...m.referencedMessage.author,
                      username: fetched.username,
                      displayName: fetched.displayName || fetched.username,
                      avatar: fetched.avatar,
                      isBot: Boolean(fetched.isBot),
                      isVerified: Boolean(fetched.isVerified),
                    }
                  : m.referencedMessage?.author;
                if (refAuthor !== m.referencedMessage?.author) updated = true;

                if (!updated) return m;

                return {
                  ...m,
                  author,
                  referencedMessage: m.referencedMessage
                    ? {
                        ...m.referencedMessage,
                        author: refAuthor,
                      }
                    : undefined,
                };
              })
            );
          }
        } catch (err) {
          console.error("Failed to lazy-resolve unknown user", userId, err);
        }
      })();
    }
  }, [messages]);

  // Real-time updates over SSE (connection + typing handled by the stream hook)
  const { typingStatusText, typingUsers, clearTypingUser } = useChatStream({
    url: apiBase && user ? `${apiBase}/stream` : null,
    currentUsername: user?.username,
    // Messages sent while the stream was down never arrive over it: revalidate
    // the tail (a delta fetch after the newest cached message) on reconnect.
    onReconnect: () => {
      if (!hasMoreNewerRef.current) void catchUpTail();
    },
    onEvent: (data) => {
      if (data.type === "message") {
        const incoming = normalizeIncomingMessage<M>(data.message);
        // A webhook post is never "own", even for the webhook's creator: it must
        // not replace their pending bubble or skip the incoming-message path.
        const isOwnMessage = !incoming.webhookId
          && (incoming.authorId === user?.id || incoming.author?.id === user?.id);
        // A call log row, poll result, poll or forward is never a composer
        // send: it must not stand in for a pending bubble.
        const isCallRow = isComposerlessMessage(incoming);
        // Their message landed: they're no longer "typing".
        if (incoming.author?.username) clearTypingUser(incoming.author.username);

        // While viewing a detached window (jumped to a pin/search result), don't
        // append live messages at the bottom — they'd render as falsely adjacent
        // to the window's tail and advance the forward-pagination cursor past the
        // gap. They'll be picked up by forward pagination when the user scrolls
        // back down. Own sends return to the present first (see sendMessage), so
        // an own message here is an echo from another device.
        if (hasMoreNewerRef.current) {
          if (!isOwnMessage) latestRef.current.onIncomingMessage?.(incoming);
          return;
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          if (isOwnMessage && !isCallRow) {
            // Replace the most recent temp message from this user (content
            // match is best-effort — server may normalise differently).
            const isOwnTemp = (m: M) => m.id.startsWith("temp-") && m.authorId === user?.id;
            // Prefer a temp whose attachment presence matches too, so a file
            // send's echo doesn't replace a text bubble queued after it.
            const hasFiles = (incoming.attachments?.length ?? 0) > 0;
            const sameKind = (m: M) => ((m.attachments?.length ?? 0) > 0) === hasFiles;
            let ownTempIndex = prev.findIndex((m) => isOwnTemp(m) && m.content === incoming.content && sameKind(m));
            if (ownTempIndex === -1) ownTempIndex = prev.findIndex((m) => isOwnTemp(m) && m.content === incoming.content);
            if (ownTempIndex === -1) ownTempIndex = prev.findIndex(isOwnTemp);
            if (ownTempIndex !== -1) {
              return prev.map((m, index) => (index === ownTempIndex ? incoming : m));
            }
          }
          return appendCapped(prev, incoming);
        });

        if (!isOwnMessage) {
          latestRef.current.onIncomingMessage?.(incoming);
        }
        latestRef.current.onShouldScrollToBottom?.();
        return;
      }

      if (data.type === "ephemeral") {
        // Ephemeral messages are only visible to the invoking user.
        if (data.userId !== user?.id) return;
        const incoming = normalizeIncomingMessage<M>(data.message);
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return appendCapped(prev, incoming);
        });
        latestRef.current.onShouldScrollToBottom?.();
        return;
      }

      if (data.type === "edit") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  content: data.content ?? m.content,
                  pinned: data.pinned !== undefined ? Boolean(data.pinned) : m.pinned,
                  embeds: data.embeds !== undefined ? data.embeds : m.embeds,
                  attachments: data.attachments !== undefined ? data.attachments : m.attachments,
                  edited: data.content !== undefined ? true : m.edited,
                  updatedAt: new Date().toISOString(),
                }
              : m
          )
        );
        return;
      }

      if (data.type === "call_update") {
        // A DM call's log row changed (answered, ended).
        const call = parseCallData(data.call);
        if (!call) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === data.messageId ? { ...m, call } : m))
        );
        return;
      }

      if (data.type === "poll_update") {
        // Votes changed or the poll closed: new tallies (and our own selection
        // when the vote was ours, from another tab or device).
        const update = data as unknown as PollUpdateEvent;
        setMessages((prev) =>
          prev.map((m) => (m.id === update.messageId && m.poll ? { ...m, poll: applyPollUpdate(m.poll, update, user?.id) } : m))
        );
        return;
      }

      if (data.type === "suppress_embeds") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? { ...m, suppressEmbeds: true }
              : m
          )
        );
        return;
      }

      if (data.type === "delete") {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== data.messageId);
          // Write through to the persisted (localStorage) tail cache too.
          // The generic messages->cache sync effect only persists=false, so
          // without this a deleted message repaints from localStorage on the
          // next full reload until the fresh fetch lands.
          if (next.length !== prev.length && apiBase && activeFetchContextRef.current === apiBase) {
            writeCache(apiBase, next, true);
          }
          return next;
        });
        return;
      }

      if (data.type === "reaction_add" || data.type === "reaction_remove") {
        // Idempotent, so our own optimistic reactions aren't doubled — and a
        // reaction made on another device of ours shows up here too.
        actions.applyReactionEvent(
          String(data.messageId),
          String(data.emoji),
          String(data.userId),
          data.type === "reaction_add"
        );
        return;
      }

      if (data.type === "thread_update") {
        // A thread started here changed (new reply, renamed, archived, deleted):
        // its starter message chip / "started a thread" row follows.
        if (typeof data.threadId === "string") {
          setMessages((prev) =>
            applyThreadUpdate(prev, {
              threadId: data.threadId,
              messageId: typeof data.messageId === "string" ? data.messageId : null,
              thread: data.thread ?? null,
            })
          );
        }
        latestRef.current.onOtherEvent?.(data);
        return;
      }

      if (data.type === "pin_update") {
        setMessages((prev) =>
          prev.map((m) => (m.id === data.messageId ? { ...m, pinned: Boolean(data.pinned) } : m))
        );
        void fetchPinnedMessages();
        return;
      }

      latestRef.current.onOtherEvent?.(data);
    },
  });

  /**
   * Optimistic send with rollback. Handles text, replies, stickers, GIF
   * overrides, and pending attachments (uploaded via the MessageBar).
   */
  const sendMessage = useCallback(
    async ({ contentOverride, sticker }: SendMessageInput = {}) => {
      if (!apiBase || !contextId || !user) return;

      const isOverrideSend = typeof contentOverride === "string";
      const composer = messageBarRef.current?.getComposer();
      const rawContent = isOverrideSend ? contentOverride : (composer?.getText() ?? "");
      const messageContent = latestRef.current.normalizeContent
        ? latestRef.current.normalizeContent(rawContent)
        : rawContent;
      const pendingAttachments = isOverrideSend ? [] : (messageBarRef.current?.getAttachments() ?? []);

      if (!messageContent.trim() && pendingAttachments.length === 0 && !sticker) {
        return;
      }

      // A send with files can't start while another upload is running.
      const hasAttachments = pendingAttachments.length > 0;
      if (hasAttachments && uploadingRef.current) return;

      const replyReference = actions.replyToMessage;
      if (!isOverrideSend) {
        composer?.clear();
      }
      resetTyping();
      actions.setReplyToMessage(null);
      inFlightSendsRef.current += 1;
      setIsSending(true);

      const restoreDraft = () => {
        if (!isOverrideSend && messageContent.trim()) {
          messageBarRef.current?.getComposer()?.insertTextAtCaret(messageContent);
        }
      };

      // Sending from a detached window (jumped to a pin/search result) returns to
      // the present first, like Discord. Appending to the old window would put
      // the message next to week-old ones and make it the forward cursor, so the
      // gap in between would never load.
      if (hasMoreNewerRef.current) {
        const context = apiBase;
        try {
          const response = await fetch(`${apiBase}/messages?limit=${PAGE_SIZE}`);
          if (response.ok && activeFetchContextRef.current === context) {
            const data = await response.json();
            if (activeFetchContextRef.current === context) {
              const raw = Array.isArray(data) ? data : data.messages || [];
              const page = dedupeMessages<M>(raw);
              hasMoreNewerRef.current = false;
              setHasMoreNewer(false);
              setHasMoreOlder(paginated && page.length >= PAGE_SIZE);
              setMessages((prev) => [...page, ...prev.filter((m) => m.id.startsWith("temp-"))]);
              writeCache(context, page, true);
            }
          }
        } catch {
          // Fall through and append to the current window.
        }
      }

      // Upload now, while the MessageBar still holds these files.
      let uploadPromise: Promise<Array<{ id: string; url: string; filename: string; contentType: string; spoiler?: boolean }>> =
        Promise.resolve([]);
      if (hasAttachments) {
        uploadingRef.current = true;
        uploadPromise = (async () => {
          try {
            const uploaded = (await messageBarRef.current?.uploadAttachments()) ?? [];
            // Keep the files in the composer if nothing uploaded, so they can retry.
            if (uploaded.length > 0) messageBarRef.current?.clearAttachments();
            return uploaded;
          } finally {
            uploadingRef.current = false;
          }
        })();
      }

      tempSeqRef.current += 1;
      const tempId = `temp-${Date.now()}-${tempSeqRef.current}`;
      // Native app: a soft tick as the message leaves the composer.
      haptic("light");
      const buildOptimistic = (attachments: unknown[]) => ({
          id: tempId,
          content: messageContent,
          type: replyReference ? "reply" : "default",
          authorId: user.id,
          author: {
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar,
            status: user.status || "online",
            isPremium: user.isPremium,
            badges: user.badges,
          },
          channelId: contextId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sticker,
          attachments,
          referencedMessageId: replyReference?.id,
          referencedMessage: replyReference
            ? {
                id: replyReference.id,
                content: replyReference.content,
                author: replyReference.author,
                createdAt: replyReference.createdAt,
              }
            : undefined,
          reactions: [],
          customEmojis: [],
          pending: true,
        } as unknown as M);

      // Every send shows its bubble right away, in queue order (= POST order =
      // server createdAt order). A send with files fills in its attachments once
      // the upload finishes.
      setMessages((prev) => appendCapped(prev, buildOptimistic([]), true));
      latestRef.current.onShouldScrollToBottom?.();

      const run = async () => {
        try {
          const uploadedAttachments = await uploadPromise;
          if (hasAttachments && uploadedAttachments.length === 0) {
            // Nothing uploaded: don't send the text alone either — put the
            // draft and reply back so the whole message can be retried.
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            restoreDraft();
            if (replyReference) actions.setReplyToMessage(replyReference);
            toast.error(gt("Failed to upload file(s). Your message was not sent."));
            return;
          }
          if (hasAttachments) {
            setMessages((prev) =>
              prev.map((m) => (m.id === tempId ? ({ ...m, attachments: uploadedAttachments } as M) : m))
            );
          }

          const body: Record<string, unknown> = {};
          if (messageContent) body.content = messageContent;
          if (sticker) body.sticker = sticker;
          if (uploadedAttachments.length > 0) body.attachments = uploadedAttachments;
          if (replyReference) body.replyTo = replyReference.id;

          const response = await fetch(`${apiBase}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (response.ok) {
            const payload = await response.json().catch(() => null);
            if (payload?.interaction) {
              // The content was a bot slash command dispatched as an interaction —
              // nothing to render here; the bot's reply arrives over SSE. Drop the
              // optimistic "/command" bubble.
              setMessages((prev) => prev.filter((m) => m.id !== tempId));
            } else {
              const raw = payload?.message || payload;
              if (raw && (raw.id || raw._id)) {
                const confirmed = normalizeIncomingMessage<M>(raw);
                setMessages((prev) => {
                  // The SSE echo may already have landed — then just drop the temp.
                  if (prev.some((m) => m.id === confirmed.id)) {
                    return prev.filter((m) => m.id !== tempId);
                  }
                  return prev.map((m) => (m.id === tempId ? { ...m, ...confirmed, pending: false } : m));
                });
              }
            }
          } else {
            const data = await response.json().catch(() => null);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            restoreDraft();
            toast.error(data?.error || gt("Failed to send message"));
          }
        } catch (error) {
          console.error("Failed to send message:", error);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          restoreDraft();
          toast.error(gt("Failed to send message. Check your connection."));
        } finally {
          inFlightSendsRef.current -= 1;
          if (inFlightSendsRef.current === 0) setIsSending(false);
        }
      };

      const queued = sendQueueRef.current.then(run);
      sendQueueRef.current = queued.catch(() => undefined);
      await queued;
    },
    [apiBase, contextId, user, messageBarRef, actions, resetTyping, gt, paginated, appendCapped]
  );

  /**
   * Inject a client-only ephemeral message visible to the current user. Used by
   * built-in slash commands whose output only the invoker should see — nothing
   * is sent to the server or other clients.
   */
  const addEphemeralMessage = useCallback((raw: Record<string, unknown>) => {
    const incoming = normalizeIncomingMessage<M>(raw);
    setMessages((prev) =>
      prev.some((m) => m.id === incoming.id) ? prev : appendCapped(prev, incoming, true)
    );
    latestRef.current.onShouldScrollToBottom?.();
  }, [appendCapped]);

  const handleGifSelect = useCallback(
    (gifUrl: string) => void sendMessage({ contentOverride: gifUrl }),
    [sendMessage]
  );

  const handleStickerSelect = useCallback(
    (sticker: MessageSticker) => void sendMessage({ sticker }),
    [sendMessage]
  );

  /** Inserts a picked emoji (unicode or custom) into the composer. */
  const handleEmojiSelect = useCallback(
    (emoji: string, isCustom?: boolean, emojiData?: { id: string; name: string; animated?: boolean; url?: string }) => {
      const composer = messageBarRef.current?.getComposer();
      if (!composer) return;
      if (isCustom && emojiData?.url) {
        composer.insertEmojiAtCaret({
          id: emojiData.id,
          name: emojiData.name,
          url: emojiData.url,
          animated: emojiData.animated,
        });
      } else if (isCustom && emojiData) {
        composer.insertTextAtCaret(`<${emojiData.animated ? "a" : ""}:${emojiData.name}:${emojiData.id}>`);
      } else {
        composer.insertTextAtCaret(emoji);
      }
      signalTyping(composer.getText());
      composer.focus();
    },
    [messageBarRef, signalTyping]
  );

  const groupedMessages = useMemo(() => groupMessages(messages), [messages]);
  const mediaGallery = useMemo(() => buildGalleryFromMessages(messages), [messages]);

  return {
    messages,
    setMessages,
    isLoading,
    isSending,
    hasMoreOlder,
    hasMoreNewer,
    isLoadingMore,
    fetchMessages,
    loadOlderMessages,
    loadNewerMessages,
    jumpToMessage,
    handleAtBottomChange,
    pinnedMessages,
    isLoadingPins,
    fetchPinnedMessages,
    actions,
    typingStatusText,
    typingUsers,
    signalTyping,
    resetTyping,
    sendMessage,
    addEphemeralMessage,
    handleGifSelect,
    handleStickerSelect,
    handleEmojiSelect,
    groupedMessages,
    mediaGallery,
  };
}
