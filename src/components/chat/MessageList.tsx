"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  memo,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowDown, CheckCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useGT, useLocale } from "gt-next";
import { ChatGtProvider } from "./ChatGtContext";
import { UnreadDivider } from "./UnreadDivider";
import {
  computeUnreadDivider,
  newestAckable,
  planMarkUnread,
  readMarkerMs,
  type MarkUnreadPlan,
  type ReadMarker,
  type UnreadDivider as UnreadDividerInfo,
} from "@/lib/chat/unreadMarker";
import { onHotkey } from "@/lib/keybinds";
import { isUserAttending, setListAtBottom, subscribeAttention } from "@/lib/unread/attentionTracker";
import { cn } from "@/lib/utils";
import { MessageGroup } from "@/components/chat/MessageGroup";
import { CallMessageRow, type CallRowPeer } from "@/components/chat/CallMessageRow";
import { GroupSystemRow } from "@/components/chat/GroupSystemRow";
import { ThreadSystemRow } from "@/components/chat/ThreadRows";
import { PollResultRow } from "@/components/chat/PollResultRow";
import { isGroupDmEventType } from "@/lib/chat/groupDm";
import type { CallGroup } from "@/lib/chat/dmCall";
import { MessageSkeleton } from "@/components/ui/skeleton";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import type { PickerEmoji } from "@/components/chat/MessageHoverActions";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";
import type { useMessageActions } from "@/hooks/useMessageActions";
import { Loader } from "@/components/ui/Loader";
import { collapseBlockedGroups } from "@/lib/chat/blocked";
import { useRelationships } from "@/lib/social/relationshipsStore";
import { BlockedMessagesRow } from "./BlockedMessagesRow";

// "Reactions" viewer (who reacted, per emoji): loaded on first open.
const ReactionsDialog = dynamic(() => import("@/components/chat/ReactionsDialog").then((m) => m.ReactionsDialog), {
  ssr: false,
});
const ReportMessageDialog = dynamic(() => import("@/components/chat/ReportMessageDialog").then((m) => m.ReportMessageDialog), {
  ssr: false,
});

export interface MessageListHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageId: string) => void;
  isAtBottom: () => boolean;
  forceScrollToBottom: () => void;
  /** Scroll roughly one viewport up (dir -1) or down (dir 1). */
  scrollByViewport: (dir: 1 | -1) => void;
  /** Scroll to the very top (loading older messages happens automatically). */
  scrollToTop: () => void;
  /** Scroll to the first unread message (the red "NEW" line). */
  jumpToUnread: () => void;
  /** "Mark Unread": the read marker moves back to just before this message. */
  markUnreadFrom: (messageId: string) => void;
  /** Back to the newest messages (reloads the live tail when detached). */
  jumpToPresent: () => void;
}

interface MentionUser {
  id: string;
  username?: string;
  displayName?: string;
  avatar?: string;
}

interface MentionRole {
  id: string;
  name: string;
  color?: string;
}

interface MessageListProps<M extends ChatMessage> {
  groups: MessageGroupData<M>[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  /** True when the window is detached from the live tail (jumped to a pin/search
   *  result, or trimmed) — enables scroll-down "load newer" pagination. */
  hasMoreNewer?: boolean;
  isLoadingMore: boolean;
  loadOlderMessages: () => Promise<boolean>;
  loadNewerMessages?: () => Promise<boolean>;
  actions: ReturnType<typeof useMessageActions<M>>;
  currentUserId?: string;
  /** Owner / MANAGE_MESSAGES — can delete other people's messages. */
  canModerate?: boolean;
  /** Owner / MANAGE_MESSAGES / PIN_MESSAGES — can pin or unpin messages. */
  canPin?: boolean;
  serverId?: string;
  serverName?: string;
  swipeEnabled?: boolean;
  mentionUsers?: MentionUser[];
  mentionRoles?: MentionRole[];
  userRoleColorMap?: Record<string, string>;
  serverEmojis?: PickerEmoji[];
  availableServerEmojis?: PickerEmoji[];
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
  onSuppressEmbeds?: (messageId: string) => void;
  /** Focus the composer after choosing "reply" (or similar). */
  onReplyFocus?: () => void;
  /** Rendered above the first message when the full history is loaded. */
  welcomeHeader?: ReactNode;
  emptyText?: string;
  className?: string;
  /** Called whenever bottom-adjacency changes (e.g. for unread indicators). */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** When this key changes, scroll state is reset and the list force-scrolls to bottom. */
  resetKey?: string;
  /** Jump to a message (e.g. a reply preview), loading its window if it isn't
   *  rendered. Defaults to scrolling to an already-rendered row. */
  onJumpToMessage?: (messageId: string) => void;
  /** DMs: the other person, for call log rows ("X missed your call", Join call). */
  dmPeer?: CallRowPeer;
  /** Group DMs: the group, so call rows join the group call (gdm:<channelId>). */
  callGroup?: CallGroup;
  /**
   * Read marker captured when the conversation was opened. Draws the red "NEW"
   * line above the first unread message, opens the list there instead of at
   * the bottom, and shows the "{n} new messages since…" bar.
   */
  unreadMarker?: ReadMarker | null;
  /**
   * The user has seen everything up to `message`: the window is focused and
   * visible and the list sits at the bottom of the live tail. Called with the
   * newest message (once per message).
   */
  onReadUpTo?: (message: { id: string; createdAt: string }) => void;
  /** "Mark as read" on the unread bar, or Escape. */
  onMarkRead?: () => void;
  /** Text channels: the viewer may start threads from messages. */
  canCreateThread?: boolean;
  /** "Create Thread" on a message (stable callback). */
  onCreateThread?: (message: M) => void;
  /** Open a thread from its chip / "started a thread" row (stable callback). */
  onOpenThread?: (threadId: string) => void;
  /** "See all threads." on a "started a thread" row (stable callback). */
  onSeeAllThreads?: () => void;
  /**
   * A secondary list (the thread side panel): it neither reports bottom
   * adjacency to the unread engine (the main list does) nor answers the
   * global Escape "mark channel read" hotkey.
   */
  secondary?: boolean;
  /** "Mark Unread" (menu / Alt+Click): move the conversation's read marker back. */
  onMarkUnread?: (plan: MarkUnreadPlan) => void;
  /** Reload the newest messages when the window is detached (useChatSession.returnToPresent). */
  onJumpToPresent?: () => Promise<unknown> | void;
  /** Owner / MANAGE_MESSAGES: the reactions viewer can remove anyone's reaction. */
  canManageReactions?: boolean;
}

interface WatchState {
  key: string;
  caughtUp: boolean;
  floor: ReadMarker | null;
  kept: UnreadDividerInfo | null;
}

const EMPTY_WATCH: WatchState = { key: "", caughtUp: false, floor: null, kept: null };

/** Record whether the list shows its newest message (and tell the unread engine). */
function markBottom(ref: { current: boolean }, reportsRef: { current: boolean }, atBottom: boolean) {
  ref.current = atBottom;
  if (reportsRef.current) setListAtBottom(atBottom);
}

/** The later of two read markers. */
function laterMarker(a: ReadMarker | null | undefined, b: ReadMarker | null | undefined): ReadMarker | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return readMarkerMs(b) > readMarkerMs(a) ? b : a;
}

/** "3:42 PM" today, otherwise a short date + time. */
function formatSince(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return d.toLocaleString();
  }
}

function MessageListInner<M extends ChatMessage>(
  {
    groups,
    isLoading,
    hasMoreOlder,
    hasMoreNewer = false,
    isLoadingMore,
    loadOlderMessages,
    loadNewerMessages,
    actions,
    currentUserId,
    canModerate = false,
    canPin = false,
    serverId,
    serverName,
    swipeEnabled = false,
    mentionUsers,
    mentionRoles,
    userRoleColorMap,
    serverEmojis,
    availableServerEmojis,
    onMediaClick,
    onSuppressEmbeds,
    onReplyFocus,
    welcomeHeader,
    emptyText,
    className,
    onAtBottomChange,
    resetKey,
    onJumpToMessage,
    dmPeer,
    callGroup,
    unreadMarker,
    onReadUpTo,
    onMarkRead,
    canCreateThread = false,
    onCreateThread,
    onOpenThread,
    onSeeAllThreads,
    secondary = false,
    onMarkUnread,
    onJumpToPresent,
    canManageReactions = false,
  }: MessageListProps<M>,
  ref: Ref<MessageListHandle>
) {
  const gt = useGT();
  const locale = useLocale();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  // This list acks reads (the open conversation), so it reports to the engine.
  const reportsReadingRef = useRef(Boolean(onReadUpTo) && !secondary);
  // True while the list should stay glued to the bottom. Set on channel switch
  // / force-scroll and cleared the moment the user scrolls up. Drives the
  // ResizeObserver re-anchor below so late-loading media can't strand the list
  // mid-view (which also used to spuriously trigger top-pagination).
  const stickToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const pendingScrollRestoreRef = useRef(false);
  // Element anchor for pagination scroll restore: the first visible message row
  // and its offset from the viewport top. Survives trims at either end, where a
  // plain scrollHeight delta nets to ~0.
  const scrollAnchorRef = useRef<{ id: string; top: number } | null>(null);
  const forceScrollRef = useRef(false);
  // Gates top-pagination: stays false until the list has settled at the bottom
  // for the current context, so opening a channel never auto-loads older
  // history before the user has actually scrolled up.
  const readyForPaginationRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const animateInRef = useRef(true);
  const [animateIn, setAnimateIn] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [newMessageStartId, setNewMessageStartId] = useState<string | null>(null);
  const [showContentFade, setShowContentFade] = useState(false);
  const wasLoadingRef = useRef(isLoading);
  const messageCount = useMemo(
    () => groups.reduce((total, group) => total + group.messages.length, 0),
    [groups]
  );
  const formattedTimestamps = useMemo(
    () => groups.map((g) => formatMessageTimestamp(g.timestamp, gt, locale)),
    [groups, gt, locale],
  );
  const firstMessageId = groups[0]?.messages[0]?.id;
  const lastGroupMessages = groups[groups.length - 1]?.messages;
  const lastMessageId = lastGroupMessages?.[lastGroupMessages.length - 1]?.id;
  const prevMessageCountRef = useRef(0);
  const prevGroupCountRef = useRef(0);

  // ── Unread divider / bar / read acks ──
  const allMessages = useMemo(() => groups.flatMap((g) => g.messages), [groups]);
  const contextKey = resetKey ?? "";
  // Reading session for this conversation. While the user is caught up
  // (watching the bottom, window focused) live messages are read as they land,
  // so they never get a "NEW" line: the line shown is the one `kept` from when
  // they caught up. Once they look away, messages after the last ack (`floor`)
  // form a new unread run with its own line.
  const [watchState, setWatchState] = useState<WatchState>(EMPTY_WATCH);
  const watch = watchState.key === contextKey ? watchState : EMPTY_WATCH;
  // "Mark Unread" in this conversation: the marker it set wins over the one
  // captured on open, and reading stops acking until the user reads it again
  // (Escape / "Mark as read"), sends a message or leaves.
  const [unreadOverride, setUnreadOverride] = useState<{ key: string; marker: ReadMarker } | null>(null);
  const overrideMarker = unreadOverride && unreadOverride.key === contextKey ? unreadOverride.marker : null;
  const ackPausedForRef = useRef<string | null>(null);
  const computedDivider = useMemo(
    () => computeUnreadDivider(allMessages, overrideMarker ?? laterMarker(unreadMarker, watch.floor), currentUserId, hasMoreOlder),
    [allMessages, unreadMarker, watch.floor, currentUserId, hasMoreOlder, overrideMarker],
  );
  const divider = watch.caughtUp ? watch.kept : computedDivider ?? watch.kept;
  const newestAck = useMemo(() => newestAckable(allMessages), [allMessages]);
  // Bar dismissed (read, "Mark as read", Escape) for this conversation.
  const [barDismissedFor, setBarDismissedFor] = useState<string | null>(null);
  const barDismissed = barDismissedFor === contextKey;
  // The list sits away from the bottom (drives the jump pill).
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // Far above the newest message (2+ screens): the "viewing older messages" bar.
  const [farFromBottom, setFarFromBottom] = useState(false);
  // Set while "Jump to Present" swaps in the live tail: scroll events from the
  // swap must not unpin the list.
  const jumpingRef = useRef(false);
  // Open at the first unread message once per conversation.
  const pendingUnreadScrollRef = useRef(true);
  const ackedIdRef = useRef<string | null>(null);
  const unreadRef = useRef({ divider, computedDivider, watch, newestAck, hasMoreNewer, isLoading, contextKey, barDismissed, allMessages, currentUserId, serverId });
  useLayoutEffect(() => {
    unreadRef.current = { divider, computedDivider, watch, newestAck, hasMoreNewer, isLoading, contextKey, barDismissed, allMessages, currentUserId, serverId };
  });

  const dismissBar = useCallback(() => {
    const key = unreadRef.current.contextKey;
    // Deferred: may be reached from an effect.
    void Promise.resolve().then(() => setBarDismissedFor(key));
  }, []);

  /** The user stopped watching the live tail (scrolled up, switched away). */
  const markAway = useCallback(() => {
    const { watch: w, contextKey: key } = unreadRef.current;
    if (!w.caughtUp) return;
    void Promise.resolve().then(() =>
      setWatchState((prev) => (prev.key === key && prev.caughtUp ? { ...prev, caughtUp: false } : prev)),
    );
  }, []);

  /** Ack the newest message if the user can actually see it. */
  const tryAck = useCallback(() => {
    const cb = latestRef.current.onReadUpTo;
    const { newestAck: newest, hasMoreNewer: detached, isLoading: loading, computedDivider: atAck, contextKey: key, currentUserId: selfId } = unreadRef.current;
    if (!cb || !newest || detached || loading) return;
    if (ackPausedForRef.current === key) {
      // Marked unread: stays unread until the user replies (their own message
      // reads the conversation, on the server too) or reads it explicitly.
      if (!(selfId && newest.authorId === selfId)) return;
      ackPausedForRef.current = null;
      reportsReadingRef.current = Boolean(latestRef.current.onReadUpTo);
      void Promise.resolve().then(() => setUnreadOverride(null));
    }
    if (!isAtBottomRef.current) return;
    // Visible and (focused, or touched within the last minute): see
    // lib/unread/attention.ts. Not looking: what lands now is a new unread run.
    if (!isUserAttending()) {
      markAway();
      return;
    }
    if (ackedIdRef.current === newest.id) return;
    ackedIdRef.current = newest.id;
    cb({ id: newest.id, createdAt: newest.createdAt as string });
    const floor: ReadMarker = { lastReadMessageId: newest.id, lastReadAt: newest.createdAt as string };
    void Promise.resolve().then(() =>
      setWatchState((prev) => {
        const cur = prev.key === key ? prev : { ...EMPTY_WATCH, key };
        // Catching up keeps the line of the run just read; staying caught up
        // keeps it where it was.
        return { key, caughtUp: true, floor, kept: cur.caughtUp ? cur.kept : atAck ?? cur.kept };
      }),
    );
    dismissBar();
  }, [dismissBar, markAway]);

  // Reset scroll state when channel/DM changes so the list scrolls to bottom
  // even if the message count happens to be identical to the previous context.
  // Must be a layout effect so the force-scroll flag is set BEFORE the
  // auto-scroll layout effect below runs on the same commit — otherwise an
  // instant cached paint lands mid-list.
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    pendingScrollRestoreRef.current = false;
    prevScrollHeightRef.current = 0;
    scrollAnchorRef.current = null;
    prevMessageCountRef.current = 0;
    prevGroupCountRef.current = 0;
    markBottom(isAtBottomRef, reportsReadingRef, true);
    stickToBottomRef.current = true;
    forceScrollRef.current = true;
    readyForPaginationRef.current = false;
    animateInRef.current = true;
    wasLoadingRef.current = true;
    pendingUnreadScrollRef.current = true;
    ackedIdRef.current = null;
    ackPausedForRef.current = null;
    jumpingRef.current = false;
    Promise.resolve().then(() => {
      setNewMessagesCount(0);
      setNewMessageStartId(null);
      setAnimateIn(true);
      setShowContentFade(false);
      setAwayFromBottom(false);
      setFarFromBottom(false);
      setUnreadOverride(null);
    });
  }, [resetKey]);

  // Detect transition from loading → content and trigger a smooth fade-in.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && groups.length > 0) {
      wasLoadingRef.current = false;
      // Arm older-history pagination as soon as a context finishes loading.
      // The auto-scroll effect also sets this, but it's keyed on messageCount
      // and can miss when switching into a cached channel of identical count,
      // leaving scroll-up permanently disabled ("history won't come back").
      readyForPaginationRef.current = true;
      setShowContentFade(true);
      const t = setTimeout(() => setShowContentFade(false), 200);
      return () => clearTimeout(t);
    }
    if (!isLoading) {
      wasLoadingRef.current = false;
    }
  }, [isLoading, groups.length]);

  // Latest mutable handlers behind stable identities so memoized rows
  // don't re-render on every parent render.
  const latestRef = useRef({ actions, loadOlderMessages, loadNewerMessages, onReplyFocus, onAtBottomChange, onJumpToMessage, onReadUpTo, onMarkRead, onMarkUnread, onJumpToPresent });
  useEffect(() => {
    latestRef.current = { actions, loadOlderMessages, loadNewerMessages, onReplyFocus, onAtBottomChange, onJumpToMessage, onReadUpTo, onMarkRead, onMarkUnread, onJumpToPresent };
  });

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    document
      .getElementById(`message-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Stable identity for MessageGroup's memo; routes to the container's loader
  // (which fetches the surrounding window) when one is provided.
  const jumpToMessage = useCallback((messageId: string) => {
    const handler = latestRef.current.onJumpToMessage;
    if (handler) handler(messageId);
    else scrollToMessage(messageId);
  }, [scrollToMessage]);

  // Remember the first message row visible in the viewport before a page load.
  const captureScrollAnchor = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    scrollAnchorRef.current = null;
    if (!viewport || !content) return;
    const vpTop = viewport.getBoundingClientRect().top;
    const rows = content.querySelectorAll<HTMLElement>('[id^="message-"]');
    for (const el of rows) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > vpTop) {
        scrollAnchorRef.current = { id: el.id, top: rect.top - vpTop };
        return;
      }
    }
  }, []);

  const forceScrollToBottom = useCallback(() => {
    forceScrollRef.current = true;
  }, []);

  const scrollByViewport = useCallback((dir: 1 | -1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({ top: dir * viewport.clientHeight * 0.9, behavior: "smooth" });
  }, []);

  const scrollToTop = useCallback(() => {
    viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // The bar's "Jump" button and Shift+PageUp: the first unread message, or the
  // top of the loaded history (which pages in older messages) when it isn't loaded.
  const jumpToUnread = useCallback(() => {
    const id = unreadRef.current.divider?.firstUnreadId;
    const el = id ? document.getElementById(`message-${id}`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    else viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // "Mark Unread" (message menu, Alt+Click): the red line moves above the
  // message, the conversation turns unread again (badge, sidebar, server) and
  // this view stops acking it while the user stays here.
  const markUnreadFrom = useCallback((messageId: string) => {
    const { allMessages: msgs, currentUserId: selfId, serverId: sid, contextKey: key } = unreadRef.current;
    const plan = planMarkUnread(msgs, messageId, {
      currentUserId: selfId,
      // DMs count every message; server channels only what pings you.
      counts: (m) => !sid || Boolean(selfId && m.mentionedUserIds?.includes(selfId)) || Boolean(m.mentionEveryone),
    });
    if (!plan) return;
    ackPausedForRef.current = key;
    ackedIdRef.current = null;
    if (reportsReadingRef.current) setListAtBottom(false);
    reportsReadingRef.current = false;
    setUnreadOverride({ key, marker: plan.marker });
    setWatchState({ ...EMPTY_WATCH, key });
    setBarDismissedFor(null);
    latestRef.current.onMarkUnread?.(plan);
  }, []);

  // "Jump to Present": back to the newest message; when the window is detached
  // (jumped to a pin / search result / reply) the live tail is loaded first.
  const jumpToPresent = useCallback(() => {
    setNewMessagesCount(0);
    setNewMessageStartId(null);
    setFarFromBottom(false);
    const settle = () => {
      const viewport = viewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      jumpingRef.current = false;
      forceScrollRef.current = false;
      stickToBottomRef.current = true;
      markBottom(isAtBottomRef, reportsReadingRef, true);
      latestRef.current.onAtBottomChange?.(true);
      setAwayFromBottom(false);
    };
    const load = latestRef.current.onJumpToPresent;
    if (unreadRef.current.hasMoreNewer && load) {
      jumpingRef.current = true;
      stickToBottomRef.current = true;
      forceScrollRef.current = true;
      void Promise.resolve(load()).finally(() => requestAnimationFrame(() => requestAnimationFrame(settle)));
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    // Far away: jump; close by: glide.
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: distance > viewport.clientHeight * 4 ? "auto" : "smooth" });
    markBottom(isAtBottomRef, reportsReadingRef, true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      scrollToMessage,
      isAtBottom: () => isAtBottomRef.current,
      forceScrollToBottom,
      scrollByViewport,
      scrollToTop,
      jumpToUnread,
      markUnreadFrom,
      jumpToPresent,
    }),
    [scrollToBottom, scrollToMessage, forceScrollToBottom, scrollByViewport, scrollToTop, jumpToUnread, markUnreadFrom, jumpToPresent]
  );

  // Scroll restoration after loading older/newer pages — runs synchronously
  // after DOM mutation but before paint, so the user never sees a jump.
  // Keyed on both ends (not messageCount) so it still fires when the load trims
  // the other end and keeps the total count unchanged. Anchors on the row that
  // was visible before the load; falls back to the height delta if it's gone.
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current) return;
    pendingScrollRestoreRef.current = false;
    const viewport = viewportRef.current;
    const anchor = scrollAnchorRef.current;
    scrollAnchorRef.current = null;
    const anchorEl = anchor ? document.getElementById(anchor.id) : null;
    if (viewport && anchor && anchorEl) {
      const newTop = anchorEl.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += newTop - anchor.top;
    } else if (viewport && prevScrollHeightRef.current) {
      viewport.scrollTop += viewport.scrollHeight - prevScrollHeightRef.current;
    }
    prevScrollHeightRef.current = 0;
    prevMessageCountRef.current = messageCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMessageId, lastMessageId]);

  // Auto-scroll on new messages when pinned to bottom; otherwise count them.
  // useLayoutEffect ensures instant scroll (no flash) on initial load and
  // force-scroll; RAF-deferred smooth scroll for subsequent new messages.
  useLayoutEffect(() => {
    if (isLoading) return;
    if (pendingScrollRestoreRef.current) return; // handled above
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;

    const shouldForce = forceScrollRef.current;
    // A pending force-scroll (e.g. from a channel switch) must always resolve to
    // the bottom, even when the new context has the same or fewer messages.
    if (messageCount <= prevCount && !shouldForce) return;
    forceScrollRef.current = false;

    if (shouldForce || isAtBottomRef.current) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      // Instant scroll for initial load or force-scroll; smooth otherwise.
      if (prevCount === 0 || shouldForce) {
        viewport.scrollTop = viewport.scrollHeight;
        // The list is now pinned to the bottom for this context; allow the user
        // to scroll up to trigger older-history pagination from here on.
        readyForPaginationRef.current = true;
        // Opening a conversation with unread messages: start at the first
        // unread one (the red "NEW" line) when it's above the fold.
        if (pendingUnreadScrollRef.current) {
          pendingUnreadScrollRef.current = false;
          const firstUnreadId = unreadRef.current.divider?.firstUnreadId;
          const el = firstUnreadId ? document.getElementById(`message-${firstUnreadId}`) : null;
          if (el) {
            const top =
              el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 72;
            if (top < viewport.scrollHeight - viewport.clientHeight - 80) {
              viewport.scrollTop = Math.max(0, top);
              stickToBottomRef.current = false;
              markBottom(isAtBottomRef, reportsReadingRef, false);
              latestRef.current.onAtBottomChange?.(false);
              void Promise.resolve().then(() => setAwayFromBottom(true));
            }
          }
        }
      } else {
        // Defer smooth scroll to after paint so the browser animates properly.
        requestAnimationFrame(() => {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
        });
      }
    } else {
      let delta = messageCount - prevCount;
      setNewMessagesCount((c) => c + delta);
      // Record the first new message group's ID for the separator line
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        if (g.messages.length >= delta) {
          const startIdx = g.messages.length - delta;
          const startId = g.messages[startIdx]?.id ?? g.messages[0]?.id ?? null;
          // Keep the first unread marker; later batches must not move it down.
          setNewMessageStartId((prev) => prev ?? startId);
          break;
        }
        delta -= g.messages.length;
      }
    }
    // Disable staggered animation after the initial batch has rendered.
    animateInRef.current = false;
    if (animateIn) {
      Promise.resolve().then(() => setAnimateIn(false));
    }
  }, [messageCount, animateIn, isLoading]);

  // Keep the list glued to the bottom while content height changes *after* the
  // initial paint — images, embeds, custom emojis and web fonts all resolve
  // asynchronously and grow the scroll height under us. Without this, the
  // initial scroll-to-bottom lands mid-list once that media loads, and the
  // resulting near-top scrollTop spuriously fires top-pagination.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (pendingScrollRestoreRef.current) return; // top-pagination owns scroll
      viewport.scrollTop = viewport.scrollHeight;
      if (!isAtBottomRef.current) {
        markBottom(isAtBottomRef, reportsReadingRef, true);
        latestRef.current.onAtBottomChange?.(true);
      }
      tryAck();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [tryAck]);

  // Detect if new groups were appended at the bottom (vs prepended at top).
  // Used to apply slide-in animation to newly arrived messages.
  const isBottomAppend = useRef(false);
  useLayoutEffect(() => {
    const prevGroups = prevGroupCountRef.current;
    prevGroupCountRef.current = groups.length;
    isBottomAppend.current = groups.length > prevGroups && !pendingScrollRestoreRef.current;
  }, [groups.length]);

  // Scroll listener: bottom detection + top pagination with scroll restore.
  // Throttled via requestAnimationFrame for smoother performance.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (jumpingRef.current) return; // "Jump to Present" owns the scroll
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const atBottom = scrollHeight - scrollTop - clientHeight < 80;
      setFarFromBottom(scrollHeight - scrollTop - clientHeight > clientHeight * 2);
      // A user-initiated scroll away from the bottom releases the sticky pin;
      // reaching the bottom again re-engages it.
      stickToBottomRef.current = atBottom;
      if (atBottom !== isAtBottomRef.current) {
        markBottom(isAtBottomRef, reportsReadingRef, atBottom);
        latestRef.current.onAtBottomChange?.(atBottom);
      }
      setAwayFromBottom(!atBottom);
      if (!atBottom) markAway();
      if (atBottom) {
        setNewMessagesCount(0);
        setNewMessageStartId(null);
        tryAck();
        // Detached window (jumped to a pin/search result, or trimmed): reaching
        // the bottom loads the next newer page so the user can scroll all the way
        // back to the latest message.
        if (hasMoreNewer && !isLoadingMore && readyForPaginationRef.current && latestRef.current.loadNewerMessages) {
          // Newer pages can trim the top; anchor so the view doesn't shift.
          captureScrollAnchor();
          prevScrollHeightRef.current = 0;
          pendingScrollRestoreRef.current = true;
          void Promise.resolve(latestRef.current.loadNewerMessages()).then((loaded) => {
            if (!loaded) {
              pendingScrollRestoreRef.current = false;
              scrollAnchorRef.current = null;
            }
          });
        }
      }

      // Only paginate once the list has settled at the bottom for this context
      // (readyForPaginationRef) and there is real scroll room — this prevents a
      // freshly-opened or short channel from auto-loading older history before
      // the user has actually scrolled up.
      if (
        scrollTop < 500 &&
        hasMoreOlder &&
        !isLoadingMore &&
        readyForPaginationRef.current &&
        !stickToBottomRef.current &&
        scrollHeight - clientHeight > 200
      ) {
        captureScrollAnchor();
        prevScrollHeightRef.current = viewport.scrollHeight;
        pendingScrollRestoreRef.current = true;
        void Promise.resolve(latestRef.current.loadOlderMessages()).then((loaded) => {
          // Nothing older came back (empty page / error): there is no restore
          // to do, and leaving the flag set disables auto-scroll for good.
          if (!loaded) {
            pendingScrollRestoreRef.current = false;
            prevScrollHeightRef.current = 0;
            scrollAnchorRef.current = null;
          }
        });
      }
    });
  }, [hasMoreOlder, hasMoreNewer, isLoadingMore, captureScrollAnchor, tryAck, markAway]);

  // Stable handlers for memoized rows.
  const stable = useMemo(() => {
    const a = () => latestRef.current.actions;
    return {
      onEditContentChange: (value: string) => a().setEditContent(value),
      onEditKeyDown: (e: React.KeyboardEvent) => a().handleEditKeyDown(e),
      onEditCancel: () => a().cancelEditing(),
      onEditSave: () => void a().submitEdit(),
      onReactionPickerChange: (messageId: string, open: boolean) =>
        a().setReactionPickerMessage(open ? messageId : null),
      onContextMenu: (e: React.MouseEvent, message: M) => a().openContextMenu(e, message),
      onReply: (message: M, opts?: { mention?: boolean }) => {
        a().setReplyToMessage(message, opts);
        latestRef.current.onReplyFocus?.();
      },
      onViewReactions: (message: M, emoji?: string) => a().setReactionsViewer({ message, emoji }),
      onCopy: (content: string) => a().copyMessage(content),
      onPinToggle: (message: M) => void a().togglePin(message),
      onEdit: (message: M) => a().startEditing(message),
      onDelete: (message: M) => a().setDeleteConfirmMessage(message),
      onAddReaction: (messageId: string, emoji: string) => void a().addReaction(messageId, emoji),
      onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) =>
        a().toggleReaction(messageId, emoji, hasReacted),
      onOpenReactionPicker: (messageId: string) => a().setReactionPickerMessage(messageId),
    };
  }, []);

  // Ack when a new message lands while the user is watching the bottom, when
  // the live tail comes back after a jump, and when the window regains focus.
  const newestAckId = newestAck?.id ?? null;
  useEffect(() => {
    tryAck();
  }, [newestAckId, hasMoreNewer, isLoading, tryAck]);
  // Attention changes (focus, tab shown/hidden, the one-minute window after
  // the last interaction running out) and any pointer / key / wheel / scroll
  // on the page: ack when the user is looking, start a new unread run when not.
  useEffect(
    () =>
      subscribeAttention(() => {
        if (isUserAttending()) tryAck();
        else markAway();
      }),
    [tryAck, markAway],
  );
  // Tell the unread engine whether the open conversation is being read live
  // (so live messages in it don't badge). Only lists that ack report.
  const reportsReading = Boolean(onReadUpTo) && !secondary;
  useEffect(() => {
    reportsReadingRef.current = reportsReading;
    if (!reportsReading) return;
    setListAtBottom(isAtBottomRef.current);
    return () => setListAtBottom(false);
  }, [reportsReading, contextKey]);

  const markRead = useCallback(() => {
    const { divider: d, barDismissed: dismissed, newestAck: newest, contextKey: key } = unreadRef.current;
    setBarDismissedFor(key);
    if (ackPausedForRef.current === key) {
      // Reading a conversation marked unread: back to normal acking.
      ackPausedForRef.current = null;
      reportsReadingRef.current = Boolean(latestRef.current.onReadUpTo);
      setUnreadOverride(null);
    }
    // Already read up to the newest message: nothing to send.
    if ((!d || dismissed) && newest && ackedIdRef.current === newest.id) return;
    latestRef.current.onMarkRead?.();
  }, []);

  // Escape: mark this conversation read (the global hotkey broadcasts it).
  useEffect(() => (secondary ? undefined : onHotkey("mark-channel-read", markRead)), [markRead, secondary]);

  const showUnreadBar = Boolean(divider) && !barDismissed && !isLoading;
  const dividerId = divider?.firstUnreadId ?? newMessageStartId;
  const pillCount = newMessagesCount > 0 ? newMessagesCount : awayFromBottom && showUnreadBar ? divider?.count ?? 0 : 0;
  const showPresentBar = !isLoading && groups.length > 0 && (hasMoreNewer || (awayFromBottom && farFromBottom));
  const viewer = actions.reactionsViewer;

  // Messages from people you blocked collapse into "N blocked messages" rows
  // (Discord); each row can be expanded on its own.
  const { blocked: blockedIds } = useRelationships();
  const listItems = useMemo(() => collapseBlockedGroups(groups, blockedIds), [groups, blockedIds]);
  const [revealedBlocked, setRevealedBlocked] = useState<ReadonlySet<string>>(() => new Set());
  const toggleBlocked = useCallback((key: string) => {
    setRevealedBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const renderGroup = (group: MessageGroupData<M>, idx: number) => {
    const shouldAnimate = animateIn && idx < 12;
    const isLastGroup = idx === groups.length - 1;
    const shouldSlideIn = !animateIn && isBottomAppend.current && isLastGroup && isAtBottomRef.current;
    const showNewSeparator = dividerId === group.messages[0]?.id;
    // Unread run starting mid-group (same author kept talking): the
    // group draws the divider above that row itself.
    const midGroupSeparatorId =
      dividerId && !showNewSeparator && group.messages.some((m) => m.id === dividerId)
        ? dividerId
        : undefined;
    return (
    <Fragment key={`group-${group.messages[0].id}`}>
    {showNewSeparator && <UnreadDivider label={gt("New")} className="mx-4" />}
    <div
      className={cn(
        "msg-group-cv",
        shouldAnimate && "msg-fade-in",
        shouldSlideIn && "msg-slide-in"
      )}
      style={shouldAnimate ? { animationDelay: `${Math.min(idx * 35, 350)}ms` } : undefined}
    >
    {group.messages[0].type === "call" ? (
    <CallMessageRow
      message={group.messages[0]}
      currentUserId={currentUserId}
      peer={dmPeer}
      group={callGroup}
      formattedTimestamp={formattedTimestamps[idx]}
    />
    ) : group.messages[0].type === "thread_created" ? (
    <ThreadSystemRow
      message={group.messages[0]}
      formattedTimestamp={formattedTimestamps[idx]}
      onOpenThread={onOpenThread}
      onSeeAllThreads={onSeeAllThreads}
    />
    ) : group.messages[0].type === "poll_result" ? (
    <PollResultRow
      message={group.messages[0]}
      currentUserId={currentUserId}
      formattedTimestamp={formattedTimestamps[idx]}
      onJumpToMessage={jumpToMessage}
    />
    ) : isGroupDmEventType(group.messages[0].type) ? (
    <GroupSystemRow
      message={group.messages[0]}
      formattedTimestamp={formattedTimestamps[idx]}
    />
    ) : (
    <MessageGroup
      group={group}
      currentUserId={currentUserId}
      canModerate={canModerate}
      canPin={canPin}
      serverId={serverId}
      serverName={serverName}
      swipeEnabled={swipeEnabled}
      mentionUsers={mentionUsers}
      mentionRoles={mentionRoles}
      userRoleColorMap={userRoleColorMap}
      serverEmojis={serverEmojis}
      availableServerEmojis={availableServerEmojis}
      editingMessageId={actions.editingMessage?.id}
      editContent={actions.editContent}
      onEditContentChange={stable.onEditContentChange}
      onEditKeyDown={stable.onEditKeyDown}
      onEditCancel={stable.onEditCancel}
      onEditSave={stable.onEditSave}
      reactionPickerMessageId={actions.reactionPickerMessage}
      onReactionPickerChange={stable.onReactionPickerChange}
      onContextMenu={stable.onContextMenu}
      onReply={stable.onReply}
      onCopy={stable.onCopy}
      onPinToggle={stable.onPinToggle}
      onEdit={stable.onEdit}
      onDelete={stable.onDelete}
      onAddReaction={stable.onAddReaction}
      onToggleReaction={stable.onToggleReaction}
      onOpenReactionPicker={stable.onOpenReactionPicker}
      onViewReactions={stable.onViewReactions}
      onMediaClick={onMediaClick}
      onSuppressEmbeds={onSuppressEmbeds}
      onJumpToMessage={jumpToMessage}
      formattedTimestamp={formattedTimestamps[idx]}
      newSeparatorBeforeId={midGroupSeparatorId}
      canCreateThread={canCreateThread}
      onCreateThread={onCreateThread}
      onOpenThread={onOpenThread}
    />
    )}
    </div>
    </Fragment>
    );
  };

  return (
    <ChatGtProvider>
    <div className={cn("relative flex-1 min-h-0", className)}>
      {/* Non-intrusive top loading indicator — absolute positioned, no layout shift */}
      {hasMoreOlder && !isLoading && isLoadingMore && (
        <div className="absolute top-0 left-0 right-0 z-10 flex justify-center py-2 pointer-events-none">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-app)]/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm">
            <Loader size={undefined} />
            {gt("Loading older messages")}
          </div>
        </div>
      )}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="chat-scroller h-full overflow-y-auto overflow-x-hidden scrollbar-thin overscroll-contain"
      >
        <div
          ref={contentRef}
          className="flex flex-col min-h-full"
          onClickCapture={(e) => {
            // Alt+Click a message: Mark Unread (Discord).
            if (!e.altKey || !latestRef.current.onMarkUnread) return;
            const row = (e.target as HTMLElement).closest?.('[id^="message-"]');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            markUnreadFrom(row.id.slice("message-".length));
          }}
        >
          <div className="flex-1" />
          <div className={cn("flex flex-col py-4 w-full max-w-full", showContentFade && "msg-list-fade-in")}>
            {/* History start header */}
            {!hasMoreOlder && !isLoading && welcomeHeader}

            {/* Messages */}
            {isLoading ? (
              <MessageSkeleton count={5} />
            ) : groups.length === 0 ? (
              <div className="text-center text-[var(--text-muted)] py-8">{emptyText || gt("No messages yet. Be the first to say something!")}</div>
            ) : (
              listItems.map((item) => {
                if (item.kind === "group") return renderGroup(item.group, item.index);
                const open = revealedBlocked.has(item.key);
                return (
                  <Fragment key={item.key}>
                    <BlockedMessagesRow
                      count={item.count}
                      open={open}
                      onToggle={() => toggleBlocked(item.key)}
                    />
                    {open && item.groups.map(({ group, index }) => renderGroup(group, index))}
                  </Fragment>
                );
              })
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>

      {/* Unread bar: "{n} new messages since {time}" */}
      {showUnreadBar && divider && (
        <div className="absolute top-0 left-0 right-0 z-20 px-2 pt-1 animate-fade-in-up">
          <div className="flex items-center gap-2 rounded-b-lg rounded-t-md bg-[var(--app-accent)] px-3 py-1 text-xs font-semibold text-[var(--text-on-accent,#fff)] shadow-md">
            <button
              type="button"
              onClick={jumpToUnread}
              className="min-w-0 flex-1 truncate text-left hover:underline"
              title={gt("Jump to unread")}
            >
              {divider.since
                ? gt("{count} new messages since {time}", {
                    count: divider.countIsLowerBound ? `${divider.count}+` : divider.count,
                    time: formatSince(divider.since, locale),
                  })
                : gt("{count} new messages", { count: divider.count })}
            </button>
            <button type="button" onClick={jumpToUnread} className="shrink-0 hover:underline">
              {gt("Jump to unread")}
            </button>
            <span className="h-3 w-px shrink-0 bg-current opacity-40" aria-hidden="true" />
            <button
              type="button"
              onClick={markRead}
              className="flex shrink-0 items-center gap-1 hover:underline"
              title={gt("Mark as read (Esc)")}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {gt("Mark as read")}
            </button>
          </div>
        </div>
      )}

      {/* "You're viewing older messages — Jump to Present" (Discord): the window
          is detached from the live tail or far above it. */}
      {showPresentBar && (
        <div className="absolute bottom-0 left-0 right-0 z-10 px-2 animate-fade-in-up">
          <div className="flex items-center gap-3 rounded-t-lg bg-[var(--app-surface-alt)] border border-b-0 border-[var(--app-border)] px-3 py-1.5 text-xs shadow-[var(--app-elev-1)]">
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--app-muted)]">
              {pillCount > 0
                ? gt("{count} new messages", { count: pillCount })
                : gt("You're viewing older messages")}
            </span>
            <button
              type="button"
              onClick={jumpToPresent}
              className="flex shrink-0 items-center gap-1 font-semibold text-[var(--app-accent)] hover:underline"
            >
              {gt("Jump to Present")}
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* New messages pill: unread below the fold */}
      {!showPresentBar && pillCount > 0 && (
        <button
          onClick={() => {
            setNewMessagesCount(0);
            setNewMessageStartId(null);
            markBottom(isAtBottomRef, reportsReadingRef, true);
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent,#fff)] text-sm shadow-lg hover:opacity-90 transition-opacity animate-fade-in-up"
        >
          <ArrowDown className="w-4 h-4" />
          {gt("{count} new messages", { count: pillCount })}
        </button>
      )}

      <MountWhenOpened open={Boolean(viewer)}>
        <ReactionsDialog
          message={viewer?.message ?? null}
          initialEmoji={viewer?.emoji}
          currentUserId={currentUserId}
          canManage={canManageReactions}
          onClose={() => actions.setReactionsViewer(null)}
          onRemoveOwn={(messageId, emoji) => actions.toggleReaction(messageId, emoji, true)}
        />
      </MountWhenOpened>
      <MountWhenOpened open={Boolean(actions.reportMessage)}>
        <ReportMessageDialog message={actions.reportMessage} onClose={() => actions.setReportMessage(null)} />
      </MountWhenOpened>
    </div>
    </ChatGtProvider>
  );
}

/**
 * Shared, scroll-managed message list used by both channels and DMs:
 * bottom-pinned auto-scroll, top pagination with position restore,
 * "new messages" pill, and stable handlers for memoized rows.
 */
export const MessageList = memo(forwardRef(MessageListInner) as <M extends ChatMessage>(
  props: MessageListProps<M> & { ref?: Ref<MessageListHandle> }
) => ReactNode);
