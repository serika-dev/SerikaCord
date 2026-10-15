"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { isAccountRestricted, openAccountStanding } from "@/components/safety/openAccountStanding";
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
import { MESSAGE_FLAGS, parseSilentPrefix } from "@/lib/chat/messageFlags";
import {
  clearMessageCache,
  hasCachedMessages,
  inflightPrefetch,
  messageCache,
  readCache,
  writeCache,
} from "@/lib/chat/messageCache";

export { clearMessageCache, hasCachedMessages };
import type { VoiceMessageAttachment } from "@/lib/chat/voiceMessage";
import {
  attachmentViewOf,
  buildEncryptedEditBody,
  buildEncryptedSendBody,
  conversationMetaOf,
  decodeConversationRows,
  encryptChannelIdFor,
  hasEnvelope,
  isRememberedEncrypted,
  rememberEncrypted,
  type ConversationMeta,
  type EncryptedAttachmentUpload,
} from "@/lib/e2ee/client/chatGlue";
import { conversationKey, e2eeTargetForApiBase, type E2eeTarget } from "@/lib/e2ee/conversation";
import { getE2eeSnapshot, loadE2eeSession, openE2eeDialog } from "@/lib/e2ee/client/state";
import { useE2ee } from "@/hooks/useE2ee";

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
      const raw: RawMessagePayload[] = Array.isArray(data) ? data : data.messages || [];
      // DMs / group DMs: a page that is (or may be) end-to-end encrypted is
      // only decrypted and checked once opened, never warmed here.
      const meta = conversationMetaOf(data);
      if (meta && (meta.e2ee || raw.some(hasEnvelope) || (await mayBeEncryptedHere(apiBase)))) return;
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

/** Whether a DM / group DM was seen encrypted on this device (unknown → yes). */
async function mayBeEncryptedHere(apiBase: string): Promise<boolean> {
  const target = e2eeTargetForApiBase(apiBase);
  if (!target) return false;
  const uid = getE2eeSnapshot().userId;
  if (!uid) return true;
  return isRememberedEncrypted(uid, target).catch(() => true);
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
  /** An uploaded recording sent as a voice message (IS_VOICE_MESSAGE, no text). */
  voice?: VoiceMessageAttachment;
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
  /**
   * DMs and group DMs: end-to-end encryption aware (decrypt envelopes, and
   * encrypt sends / edits when the conversation is encrypted). Off for
   * server channels.
   */
  encryptedChat?: boolean;
  /**
   * Group DMs: ids of the members the group UI shows (null while loading).
   * Encrypted messages only go to these people, whatever the server lists.
   */
  e2eeMemberIds?: string[] | null;
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
  encryptedChat = false,
  e2eeMemberIds = null,
}: UseChatSessionOptions<M>) {
  const gt = useGT();
  const e2ee = useE2ee();
  const [messages, setMessages] = useState<M[]>([]);
  // DM / group DM facts from the message endpoints (channel id, E2EE state).
  const [conversation, setConversation] = useState<ConversationMeta | null>(null);
  const conversationRef = useRef<ConversationMeta | null>(null);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  // What the page opened (from the URL, never from the server): the 1:1 DM's
  // person or the group. Encryption is bound to it.
  const e2eeTarget = useMemo<E2eeTarget | null>(() => (encryptedChat ? e2eeTargetForApiBase(apiBase) : null), [encryptedChat, apiBase]);
  const memberIdsRef = useRef<string[] | null>(e2eeMemberIds);
  useEffect(() => { memberIdsRef.current = e2eeMemberIds; }, [e2eeMemberIds]);
  const e2eeUid = user?.id ?? null;
  // Conversations this device has seen encrypted stay encrypted locally (the
  // server can't downgrade them). Keyed by the URL's conversation and read
  // from IndexedDB (async): until it is known, sends wait for it.
  const rememberedKey = e2eeTarget && e2eeUid ? `${e2eeUid.toLowerCase()}|${conversationKey(e2eeTarget)}` : null;
  const rememberedRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null);
  const checkRemembered = useCallback((target: E2eeTarget | null): Promise<boolean> => {
    if (!target || !e2eeUid) return Promise.resolve(false);
    const key = `${e2eeUid.toLowerCase()}|${conversationKey(target)}`;
    if (rememberedRef.current?.key === key) return rememberedRef.current.promise;
    // Storage failing is treated as "encrypted" (fail closed).
    const promise = isRememberedEncrypted(e2eeUid, target).catch(() => true);
    rememberedRef.current = { key, promise };
    return promise;
  }, [e2eeUid]);
  const [remembered, setRemembered] = useState<{ key: string; value: boolean } | null>(null);
  const rememberedNow = remembered && remembered.key === rememberedKey ? remembered.value : null;
  const e2eeActive = encryptedChat && Boolean(conversation?.e2ee || rememberedNow === true);
  const e2eeActiveRef = useRef(e2eeActive);
  useEffect(() => { e2eeActiveRef.current = e2eeActive; }, [e2eeActive]);
  useEffect(() => {
    if (!encryptedChat || !e2eeTarget || !e2eeUid || !rememberedKey) return;
    let cancelled = false;
    const key = rememberedKey;
    if (conversation?.e2ee) {
      rememberedRef.current = { key, promise: Promise.resolve(true) };
      void rememberEncrypted(e2eeUid, e2eeTarget).catch(() => {});
    }
    void checkRemembered(e2eeTarget).then((value) => {
      if (!cancelled) setRemembered({ key, value });
    });
    return () => { cancelled = true; };
  }, [encryptedChat, e2eeTarget, e2eeUid, rememberedKey, conversation?.e2ee, e2ee.phase, checkRemembered]);
  /** DMs / group DMs: flag plaintext rows of an encrypted conversation and decrypt envelopes (no-op otherwise). */
  const decodeRaw = useCallback(
    async (raw: RawMessagePayload[], data?: unknown): Promise<RawMessagePayload[]> => {
      if (!encryptedChat) return raw;
      const target = e2eeTargetForApiBase(apiBase);
      const meta = conversationMetaOf(data) ?? conversationRef.current;
      const encrypted = Boolean(meta?.e2ee) || (await checkRemembered(target));
      return decodeConversationRows(raw, { target, meta, encrypted });
    },
    [encryptedChat, apiBase, checkRemembered],
  );
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
    setConversation(null);
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
        const raw = await decodeRaw(data.messages || []);
        setPinnedMessages((raw as M[]).map((m) => normalizeIncomingMessage<M>(m)));
      }
    } catch {
      // best-effort UI
    } finally {
      setIsLoadingPins(false);
    }
  }, [apiBase, decodeRaw]);

  const buildEditBody = useMemo(() => {
    const channelId = encryptChannelIdFor(e2eeTarget, conversation);
    return e2eeActive && channelId && e2eeTarget
      ? (message: M, content: string) => buildEncryptedEditBody(channelId, message, content, e2eeTarget, memberIdsRef.current)
      : undefined;
  }, [e2eeActive, e2eeTarget, conversation]);

  const actions = useMessageActions<M>({
    apiBase,
    setMessages,
    userId: user?.id,
    emojiLookup,
    onPinsChanged: fetchPinnedMessages,
    buildEditBody,
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
        const meta = encryptedChat ? conversationMetaOf(data) : null;
        if (meta) setConversation(meta);
        const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
        if (activeFetchContextRef.current !== requestedContext) return;
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
  }, [apiBase, paginated, encryptedChat, decodeRaw]);

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
      const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
      if (activeFetchContextRef.current !== context) return;
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
  }, [apiBase, user?.id, decodeRaw]);

  // Encrypted conversations: once this device's keys load or a contact's
  // security code is accepted / verified, messages that failed (unknown
  // device, keys not ready) are decrypted and verified again.
  const e2eeRecheckRef = useRef<string | null>(null);
  useEffect(() => {
    if (!encryptedChat) return;
    const sig = `${e2ee.phase}|${e2ee.pinsVersion}`;
    const previous = e2eeRecheckRef.current;
    e2eeRecheckRef.current = sig;
    if (previous === null || previous === sig || hasMoreNewerRef.current) return;
    if (messagesRef.current.some((m) => m.e2ee?.status === "error")) void catchUpTail();
  }, [encryptedChat, e2ee.phase, e2ee.pinsVersion, catchUpTail]);

  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    if (!apiBase || isLoadingMore || !hasMoreOlder || messages.length === 0) return false;
    const oldestId = messages[0]?.id;
    if (!oldestId || oldestId.startsWith("temp-")) return false;

    setIsLoadingMore(true);
    try {
      const response = await fetch(`${apiBase}/messages?before=${oldestId}&limit=${OLDER_PAGE_SIZE}`);
      if (response.ok) {
        const data = await response.json();
        const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
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
  }, [apiBase, isLoadingMore, hasMoreOlder, messages, decodeRaw]);

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
        const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
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
  }, [apiBase, isLoadingMore, hasMoreNewer, messages, decodeRaw]);

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
      const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
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
  }, [apiBase, messages, decodeRaw]);

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

  // End-to-end encrypted conversations: stream events carrying envelopes are
  // decrypted first. Every event goes through one queue so they still apply
  // in arrival order (a delete never overtakes the message it deletes).
  const streamChainRef = useRef<Promise<void>>(Promise.resolve());
  const decodeStreamEvent = async (event: ChatStreamEvent): Promise<ChatStreamEvent | null> => {
    const target = e2eeTargetForApiBase(apiBase);
    const meta = conversationRef.current;
    if (event.type === "message") {
      const encrypted = Boolean(meta?.e2ee) || (await checkRemembered(target));
      if (!encrypted && !hasEnvelope(event.message)) return event;
      const [message] = await decodeConversationRows([event.message], { target, meta, encrypted });
      return { ...event, message };
    }
    if (event.type === "edit") {
      const existing = messagesRef.current.find((m) => m.id === event.messageId);
      if (!event.e2ee) {
        // A plaintext edit can never replace an encrypted message's content.
        return existing?.e2ee ? null : event;
      }
      if (!existing) return null;
      const [decoded] = await decodeConversationRows(
        [{
          id: event.messageId,
          authorId: existing.authorId,
          createdAt: existing.createdAt,
          edited: true,
          e2ee: event.e2ee,
          // The blobs stored on the message (payload files must be among them).
          attachments: (existing.attachments ?? []).map((a) => ({ url: a.url })),
        }],
        { target, meta, encrypted: true },
      );
      return {
        ...event,
        content: decoded.content ?? "",
        attachments: decoded.attachments ?? [],
        e2eeState: decoded.e2ee,
        sticker: decoded.sticker,
        mentionedUserIds: decoded.mentionedUserIds ?? [],
      };
    }
    return event;
  };
  const routeStreamEvent = (event: ChatStreamEvent, apply: (event: ChatStreamEvent) => void) => {
    if (!encryptedChat) {
      apply(event);
      return;
    }
    if (event.type === "e2ee_enabled") {
      // Someone turned encryption on: from now on sends are encrypted here.
      setConversation((c) => (c ? { ...c, e2ee: true, e2eeAuto: false } : c));
    }
    streamChainRef.current = streamChainRef.current
      .then(async () => {
        const decoded = await decodeStreamEvent(event);
        if (decoded) apply(decoded);
      })
      .catch(() => { /* one bad event never blocks the stream */ });
  };

  // Real-time updates over SSE (connection + typing handled by the stream hook)
  const { typingStatusText, typingUsers, clearTypingUser } = useChatStream({
    url: apiBase && user ? `${apiBase}/stream` : null,
    currentUsername: user?.username,
    // Messages sent while the stream was down never arrive over it: revalidate
    // the tail (a delta fetch after the newest cached message) on reconnect.
    onReconnect: () => {
      if (!hasMoreNewerRef.current) void catchUpTail();
    },
    onEvent: (streamEvent) => routeStreamEvent(streamEvent, (data) => {
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
                  ...(data.e2eeState ? { e2ee: data.e2eeState, sticker: data.sticker, mentionedUserIds: data.mentionedUserIds ?? [] } : {}),
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

      if (data.type === "message_flags") {
        // e.g. an announcement was published (CROSSPOSTED).
        if (typeof data.flags === "number") {
          const flags = data.flags;
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, flags } : m)));
        }
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
    }),
  });

  /**
   * Load the live tail again after a jump (pin, search result, reply) left the
   * window detached ("Jump to Present", and before sending). Optimistic sends
   * stay. Resolves once the newest page is in state (or the fetch failed).
   */
  const returnToPresent = useCallback(async (): Promise<boolean> => {
    if (!apiBase) return false;
    const context = apiBase;
    try {
      const response = await fetch(`${apiBase}/messages?limit=${PAGE_SIZE}`);
      if (!response.ok || activeFetchContextRef.current !== context) return false;
      const data = await response.json();
      if (activeFetchContextRef.current !== context) return false;
      const raw = await decodeRaw(Array.isArray(data) ? data : data.messages || [], data);
      if (activeFetchContextRef.current !== context) return false;
      const page = dedupeMessages<M>(raw);
      hasMoreNewerRef.current = false;
      setHasMoreNewer(false);
      setHasMoreOlder(paginated && page.length >= PAGE_SIZE);
      setMessages((prev) => [...page, ...prev.filter((m) => m.id.startsWith("temp-"))]);
      writeCache(context, page, true);
      return true;
    } catch {
      // Keep the current window.
      return false;
    }
  }, [apiBase, paginated, decodeRaw]);

  /**
   * Optimistic send with rollback. Handles text, replies, stickers, GIF
   * overrides, and pending attachments (uploaded via the MessageBar).
   */
  const sendMessage = useCallback(
    async ({ contentOverride, sticker, voice }: SendMessageInput = {}) => {
      if (!apiBase || !contextId || !user) return;

      // A voice message leaves the composer (text and pending files) untouched.
      const isOverrideSend = typeof contentOverride === "string" || !!voice;
      const composer = messageBarRef.current?.getComposer();
      const rawContent = isOverrideSend ? (contentOverride ?? "") : (composer?.getText() ?? "");
      const messageContent = latestRef.current.normalizeContent
        ? latestRef.current.normalizeContent(rawContent)
        : rawContent;
      const pendingAttachments = isOverrideSend ? [] : (messageBarRef.current?.getAttachments() ?? []);
      // "@silent hi" is sent as "hi" with notifications suppressed (the server
      // strips the prefix too; this keeps the optimistic bubble right).
      const silentParse = parseSilentPrefix(messageContent);

      if (!silentParse.content.trim() && pendingAttachments.length === 0 && !sticker && !voice) {
        return;
      }

      // A send with files can't start while another upload is running.
      const hasAttachments = pendingAttachments.length > 0;
      if (hasAttachments && uploadingRef.current) return;

      // End-to-end encrypted conversation: everything goes into an envelope.
      // Never plaintext while it's unknown whether this device saw the
      // conversation encrypted (the server can't downgrade it).
      const sendTarget = encryptedChat ? e2eeTargetForApiBase(apiBase) : null;
      const encryptSend = encryptedChat && (
        e2eeActiveRef.current || Boolean(conversationRef.current?.e2ee) || (await checkRemembered(sendTarget))
      );
      const encryptChannelId = encryptChannelIdFor(sendTarget, conversationRef.current);
      if (encryptSend && voice) {
        toast.error(gt("Voice messages can't be sent in encrypted conversations yet."));
        return;
      }
      if (encryptSend && (!encryptChannelId || !sendTarget)) {
        toast.error(gt("Failed to send message"));
        return;
      }

      const replyReference = actions.replyToMessage;
      const replyMention = actions.replyMention;
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
      if (hasMoreNewerRef.current) await returnToPresent();

      // Upload now, while the MessageBar still holds these files.
      let uploadPromise: Promise<EncryptedAttachmentUpload[]> = Promise.resolve([]);
      if (hasAttachments) {
        uploadingRef.current = true;
        uploadPromise = (async () => {
          try {
            // Encrypted conversations upload each file as an opaque encrypted blob.
            const encryptFile = encryptSend ? (await loadE2eeSession()).encryptFileForUpload : undefined;
            const uploaded = (await messageBarRef.current?.uploadAttachments(encryptFile ? { encryptFile } : undefined)) ?? [];
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
      const buildOptimistic = (attachments: unknown[]) => ({
          id: tempId,
          content: silentParse.content,
          flags: (silentParse.silent ? MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS : 0) | (voice ? MESSAGE_FLAGS.IS_VOICE_MESSAGE : 0),
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
          // Never persisted as plaintext (see messageCache).
          ...(encryptSend ? { e2ee: { status: "pending" } } : {}),
        } as unknown as M);

      // Every send shows its bubble right away, in queue order (= POST order =
      // server createdAt order). A send with files fills in its attachments once
      // the upload finishes.
      setMessages((prev) => appendCapped(prev, buildOptimistic(voice ? [voice] : []), true));
      latestRef.current.onShouldScrollToBottom?.();

      const run = async () => {
        try {
          const uploadedAttachments = await uploadPromise;
          if (hasAttachments && uploadedAttachments.length === 0) {
            // Nothing uploaded: don't send the text alone either — put the
            // draft and reply back so the whole message can be retried.
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            restoreDraft();
            if (replyReference) actions.setReplyToMessage(replyReference, { mention: replyMention });
            toast.error(gt("Failed to upload file(s). Your message was not sent."));
            return;
          }
          if (hasAttachments) {
            const shown = encryptSend ? uploadedAttachments.map(attachmentViewOf) : uploadedAttachments;
            setMessages((prev) =>
              prev.map((m) => (m.id === tempId ? ({ ...m, attachments: shown } as M) : m))
            );
          }

          let body: Record<string, unknown> = {};
          if (encryptSend) {
            body = await buildEncryptedSendBody({
              channelId: encryptChannelId!,
              target: sendTarget!,
              memberIds: memberIdsRef.current,
              content: silentParse.content,
              attachments: uploadedAttachments,
              sticker,
              reply: replyReference ? { id: replyReference.id, content: replyReference.content } : null,
            });
            if (silentParse.silent) body.flags = MESSAGE_FLAGS.SUPPRESS_NOTIFICATIONS;
          } else {
            if (messageContent) body.content = messageContent;
            if (sticker) body.sticker = sticker;
            if (uploadedAttachments.length > 0) body.attachments = uploadedAttachments;
          }
          if (voice) {
            body.attachments = [voice];
            body.flags = MESSAGE_FLAGS.IS_VOICE_MESSAGE;
          }
          if (replyReference) body.replyTo = replyReference.id;
          if (replyReference && !replyMention) body.mentionRepliedUser = false;

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
              const rawReply = payload?.message || payload;
              const [raw] = rawReply && hasEnvelope(rawReply) ? await decodeRaw([rawReply]) : [rawReply];
              if (raw && (raw.id || raw._id)) {
                const confirmed = normalizeIncomingMessage<M>(raw);
                setMessages((prev) => {
                  // The SSE echo may already have landed — then just drop the temp.
                  if (prev.some((m) => m.id === confirmed.id)) {
                    return prev.filter((m) => m.id !== tempId);
                  }
                  return prev.map((m) => (m.id === tempId ? { ...m, ...confirmed, pending: false } : m));
                });
              } else {
                // Accepted but no message came back (e.g. AutoMod held it):
                // never leave the bubble on "Sending…".
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                if (payload?.error) toast.error(String(payload.error));
              }
            }
          } else {
            const data = await response.json().catch(() => null);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            restoreDraft();
            if (isAccountRestricted(data)) {
              // Platform chat restriction (Trust & Safety): say until when and
              // link to Account Standing, where it can be appealed.
              const until = data.restrictedUntil ? new Date(data.restrictedUntil) : null;
              toast.error(gt("Your account can't send messages right now"), {
                description: until && !Number.isNaN(until.getTime())
                  ? gt("You can chat again after {time}.", { time: until.toLocaleString() })
                  : undefined,
                action: { label: gt("View Account Standing"), onClick: openAccountStanding },
                duration: 10_000,
              });
            } else {
              toast.error(data?.error || gt("Failed to send message"));
            }
          }
        } catch (error) {
          console.error("Failed to send message:", error);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          restoreDraft();
          const blocked = error instanceof Error && error.name === "E2eeSendBlockedError"
            ? (error as Error & { reason?: string }).reason
            : null;
          if (blocked === "not_ready") {
            toast.error(gt("Set up encryption on this device to send messages here."), {
              action: { label: gt("Set up"), onClick: () => openE2eeDialog("restore") },
            });
          } else if (blocked === "identity_changed") {
            toast.error(gt("Someone's security code changed. Review it above the message box before sending."));
          } else if (blocked === "member_mismatch") {
            toast.error(gt("This conversation's members don't match its encryption keys, so the message wasn't sent."));
          } else if (blocked === "members_unknown") {
            toast.error(gt("The member list is still loading. Try again in a moment."));
          } else if (blocked) {
            toast.error(gt("Nobody in this conversation can receive encrypted messages yet."));
          } else if (error instanceof Error && error.name === "E2eeFormatError") {
            toast.error(gt("This message couldn't be encrypted. It may be too long."));
          } else {
            toast.error(gt("Failed to send message. Check your connection."));
          }
        } finally {
          inFlightSendsRef.current -= 1;
          if (inFlightSendsRef.current === 0) setIsSending(false);
        }
      };

      const queued = sendQueueRef.current.then(run);
      sendQueueRef.current = queued.catch(() => undefined);
      await queued;
    },
    [apiBase, contextId, user, messageBarRef, actions, resetTyping, gt, appendCapped, returnToPresent, encryptedChat, checkRemembered, decodeRaw]
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

  const handleVoiceSend = useCallback(
    (voice: VoiceMessageAttachment) => void sendMessage({ voice }),
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
    /** DMs / group DMs: channel id and end-to-end encryption state. */
    conversation,
    /** Sends and edits in this conversation are end-to-end encrypted. */
    e2eeActive,
    isLoading,
    isSending,
    hasMoreOlder,
    hasMoreNewer,
    isLoadingMore,
    fetchMessages,
    loadOlderMessages,
    loadNewerMessages,
    jumpToMessage,
    returnToPresent,
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
    handleVoiceSend,
    handleEmojiSelect,
    groupedMessages,
    mediaGallery,
  };
}
