"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import type { MessageBarHandle } from "@/components/chat/MessageBar";
import { useChatStream, useTypingSignal, type ChatStreamEvent } from "@/hooks/useChatStream";
import { useMessageActions } from "@/hooks/useMessageActions";
import {
  groupMessages,
  normalizeIncomingMessage,
  type EmojiLookupEntry,
  type RawMessagePayload,
} from "@/lib/chat/messages";
import { buildGalleryFromMessages } from "@/lib/chat/media";
import type { ChatMessage, MessageSticker } from "@/lib/chat/types";

const PAGE_SIZE = 50;
// Keeps the DOM light (no virtualization needed) while allowing deep scrollback.
const MAX_LOADED_MESSAGES = 200;

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
const LS_PERSIST_TAIL = 30;
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
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<M[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);

  // Guard against a slow response from a previously viewed context
  // overwriting the current one after a fast switch.
  const activeFetchContextRef = useRef<string | null>(null);

  // Track in-flight / resolved authors who loaded as "Unknown" so we don't spam fetch
  const fetchedUnknownAuthorsRef = useRef<Set<string>>(new Set());

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
    let deltaCursor: string | null = null;
    if (cached && cached.length > 0) {
      setMessages(cached);
      // Be optimistic about older history when painting from cache: the cache may
      // be a short persisted tail (localStorage only keeps ~30 messages), so a
      // strict `>= PAGE_SIZE` check would wrongly disable scroll-up pagination
      // after a reload. loadOlderMessages self-corrects to `false` the first time
      // the server returns a short page.
      setHasMoreOlder(paginated);
      setIsLoading(false);
      latestRef.current.onShouldScrollToBottom?.();
      // Newest non-optimistic message becomes the delta cursor: we revalidate
      // by fetching only messages *after* it rather than re-downloading the whole
      // last page. For far-away users this turns a full round-trip + ~50-message
      // payload into a usually-empty response — the biggest win we can get
      // without moving the server closer.
      for (let i = cached.length - 1; i >= 0; i--) {
        const id = cached[i]?.id;
        if (id && !id.startsWith("temp-")) {
          deltaCursor = id;
          break;
        }
      }
    } else {
      setIsLoading(true);
      setHasMoreOlder(false);
      setMessages([]);
    }
    try {
      const url = deltaCursor
        ? `${apiBase}/messages?after=${deltaCursor}&limit=${PAGE_SIZE}`
        : `${apiBase}/messages?limit=${PAGE_SIZE}`;
      const response = await fetch(url);
      if (activeFetchContextRef.current !== requestedContext) return;
      if (response.ok) {
        const data = await response.json();
        if (activeFetchContextRef.current !== requestedContext) return;
        const raw = Array.isArray(data) ? data : data.messages || [];

        if (deltaCursor) {
          // Delta revalidation. A full page of results means there may be a gap
          // between our cache and now (rare: away a long time / very busy
          // channel), so fall back to a full refetch to stay correct.
          if (raw.length >= PAGE_SIZE) {
            const full = await fetch(`${apiBase}/messages?limit=${PAGE_SIZE}`);
            if (activeFetchContextRef.current !== requestedContext) return;
            if (full.ok) {
              const fullData = await full.json();
              if (activeFetchContextRef.current !== requestedContext) return;
              const fullRaw = Array.isArray(fullData) ? fullData : fullData.messages || [];
              const deduped = dedupeMessages<M>(fullRaw);
              writeCache(requestedContext, deduped, true);
              setMessages(deduped);
              setHasMoreOlder(paginated && deduped.length >= PAGE_SIZE);
              // No explicit scroll here: we already scrolled on the cache paint,
              // and MessageList auto-scrolls when the message count grows while
              // pinned to the bottom. A second scroll here caused the visible
              // "jump" on channel open.
            }
          } else if (raw.length > 0) {
            // Merge the few new messages into whatever is on screen now (which
            // may include live SSE / optimistic updates), deduping by id.
            const incoming = raw.map((item: RawMessagePayload) => normalizeIncomingMessage<M>(item));
            setMessages((prev) => {
              const existing = new Set(prev.map((m) => m.id));
              const appended = [...prev];
              for (const msg of incoming) {
                if (!existing.has(msg.id)) appended.push(msg);
              }
              const trimmed = appended.length > MAX_LOADED_MESSAGES
                ? appended.slice(appended.length - MAX_LOADED_MESSAGES)
                : appended;
              writeCache(requestedContext, trimmed, true);
              return trimmed;
            });
            // MessageList auto-scrolls on the resulting message-count increase
            // when pinned to bottom; no explicit scroll needed here.
          }
          // raw.length === 0 → cache was already current; nothing to do.
        } else {
          const deduped = dedupeMessages<M>(raw);
          writeCache(requestedContext, deduped, true);
          setMessages(deduped);
          setHasMoreOlder(paginated && deduped.length >= PAGE_SIZE);
          latestRef.current.onShouldScrollToBottom?.();
        }
      } else if (!deltaCursor) {
        toast.error(gt("Failed to load messages"));
      }
    } catch (error) {
      if (activeFetchContextRef.current !== requestedContext) return;
      console.error("Failed to fetch messages:", error);
      // On a warm open we already painted cache, so a failed revalidation is
      // silent — only surface an error when we had nothing to show.
      if (!deltaCursor) toast.error(gt("Failed to load messages"));
    } finally {
      if (activeFetchContextRef.current === requestedContext) {
        setIsLoading(false);
      }
    }
  }, [apiBase, paginated]);

  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    if (!apiBase || isLoadingMore || !hasMoreOlder || messages.length === 0) return false;
    const oldestId = messages[0]?.id;
    if (!oldestId || oldestId.startsWith("temp-")) return false;

    setIsLoadingMore(true);
    try {
      const response = await fetch(`${apiBase}/messages?before=${oldestId}&limit=${PAGE_SIZE}`);
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
            return combined.length > MAX_LOADED_MESSAGES
              ? combined.slice(0, MAX_LOADED_MESSAGES)
              : combined;
          });
          setHasMoreOlder(raw.length >= PAGE_SIZE);
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
    if (apiBase && activeFetchContextRef.current === apiBase) {
      writeCache(apiBase, messages);
    }
  }, [apiBase, messages]);

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
  const { typingStatusText, typingUsers } = useChatStream({
    url: apiBase && user ? `${apiBase}/stream` : null,
    currentUsername: user?.username,
    onEvent: (data) => {
      if (data.type === "message") {
        const incoming = normalizeIncomingMessage<M>(data.message);
        const isOwnMessage = incoming.authorId === user?.id || incoming.author?.id === user?.id;

        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          if (isOwnMessage) {
            // Replace the most recent temp message from this user (content
            // match is best-effort — server may normalise differently).
            const ownTempIndex = prev.findIndex(
              (m) => m.id.startsWith("temp-") && m.authorId === user?.id
            );
            if (ownTempIndex !== -1) {
              return prev.map((m, index) => (index === ownTempIndex ? incoming : m));
            }
          }
          return [...prev, incoming];
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
          return [...prev, incoming];
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
                  edited: data.content !== undefined ? true : m.edited,
                  updatedAt: new Date().toISOString(),
                }
              : m
          )
        );
        return;
      }

      if (data.type === "delete") {
        setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        return;
      }

      if (data.type === "reaction_add" || data.type === "reaction_remove") {
        // Own reactions are already applied optimistically.
        if (data.userId !== user?.id) {
          actions.applyReactionEvent(
            String(data.messageId),
            String(data.emoji),
            String(data.userId),
            data.type === "reaction_add"
          );
        }
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

      const replyReference = actions.replyToMessage;
      if (!isOverrideSend) {
        composer?.clear();
      }
      resetTyping();
      setIsSending(true);

      let tempId: string | null = null;
      const restoreDraft = () => {
        if (!isOverrideSend && messageContent.trim()) {
          messageBarRef.current?.getComposer()?.insertTextAtCaret(messageContent);
        }
      };

      try {
        let uploadedAttachments: Array<{ id: string; url: string; filename: string; contentType: string }> = [];
        if (pendingAttachments.length > 0) {
          uploadedAttachments = (await messageBarRef.current?.uploadAttachments()) ?? [];
          messageBarRef.current?.clearAttachments();
          if (uploadedAttachments.length === 0 && !messageContent.trim()) {
            toast.error(gt("Failed to upload file(s). Your message was not sent."));
            return;
          }
        }

        tempId = `temp-${Date.now()}`;
        const optimisticMessage = {
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
          attachments: uploadedAttachments,
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
        } as unknown as M;

        setMessages((prev) => [...prev, optimisticMessage]);
        latestRef.current.onShouldScrollToBottom?.();

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
              setMessages((prev) =>
                prev.map((m) => (m.id === tempId ? { ...m, ...confirmed, pending: false } : m))
              );
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
        if (tempId) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
        }
        restoreDraft();
        toast.error(gt("Failed to send message. Check your connection."));
      } finally {
        setIsSending(false);
        actions.setReplyToMessage(null);
      }
    },
    [apiBase, contextId, isSending, user, messageBarRef, actions, resetTyping]
  );

  /**
   * Inject a client-only ephemeral message visible to the current user. Used by
   * built-in slash commands whose output only the invoker should see — nothing
   * is sent to the server or other clients.
   */
  const addEphemeralMessage = useCallback((raw: Record<string, unknown>) => {
    const incoming = normalizeIncomingMessage<M>(raw);
    setMessages((prev) =>
      prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
    );
    latestRef.current.onShouldScrollToBottom?.();
  }, []);

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
    isLoadingMore,
    fetchMessages,
    loadOlderMessages,
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
