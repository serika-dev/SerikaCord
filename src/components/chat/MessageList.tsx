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
import { ArrowDown } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { ChatGtProvider } from "./ChatGtContext";
import { cn } from "@/lib/utils";
import { MessageGroup } from "@/components/chat/MessageGroup";
import { MessageSkeleton } from "@/components/ui/skeleton";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import type { PickerEmoji } from "@/components/chat/MessageHoverActions";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";
import type { useMessageActions } from "@/hooks/useMessageActions";
import { Loader } from "@/components/ui/Loader";

export interface MessageListHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageId: string) => void;
  isAtBottom: () => boolean;
  forceScrollToBottom: () => void;
  /** Scroll roughly one viewport up (dir -1) or down (dir 1). */
  scrollByViewport: (dir: 1 | -1) => void;
  /** Scroll to the very top (loading older messages happens automatically). */
  scrollToTop: () => void;
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
  isLoadingMore: boolean;
  loadOlderMessages: () => Promise<boolean>;
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
}

function MessageListInner<M extends ChatMessage>(
  {
    groups,
    isLoading,
    hasMoreOlder,
    isLoadingMore,
    loadOlderMessages,
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
    onReplyFocus,
    welcomeHeader,
    emptyText,
    className,
    onAtBottomChange,
    resetKey,
  }: MessageListProps<M>,
  ref: Ref<MessageListHandle>
) {
  const gt = useGT();
  const locale = useLocale();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const pendingScrollRestoreRef = useRef(false);
  const forceScrollRef = useRef(false);
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
  const prevMessageCountRef = useRef(0);
  const prevGroupCountRef = useRef(0);

  // Reset scroll state when channel/DM changes so the list scrolls to bottom
  // even if the message count happens to be identical to the previous context.
  // Must be a layout effect so the force-scroll flag is set BEFORE the
  // auto-scroll layout effect below runs on the same commit — otherwise an
  // instant cached paint lands mid-list.
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    prevMessageCountRef.current = 0;
    prevGroupCountRef.current = 0;
    isAtBottomRef.current = true;
    forceScrollRef.current = true;
    animateInRef.current = true;
    wasLoadingRef.current = true;
    Promise.resolve().then(() => {
      setNewMessagesCount(0);
      setNewMessageStartId(null);
      setAnimateIn(true);
      setShowContentFade(false);
    });
  }, [resetKey]);

  // Detect transition from loading → content and trigger a smooth fade-in.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && groups.length > 0) {
      wasLoadingRef.current = false;
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
  const latestRef = useRef({ actions, loadOlderMessages, onReplyFocus, onAtBottomChange });
  useEffect(() => {
    latestRef.current = { actions, loadOlderMessages, onReplyFocus, onAtBottomChange };
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

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      scrollToMessage,
      isAtBottom: () => isAtBottomRef.current,
      forceScrollToBottom,
      scrollByViewport,
      scrollToTop,
    }),
    [scrollToBottom, scrollToMessage, forceScrollToBottom, scrollByViewport, scrollToTop]
  );

  // Scroll restoration after loading older messages — runs synchronously
  // after DOM mutation but before paint, so the user never sees a jump.
  // Depends on firstMessageId (not messageCount) so it still fires when
  // trimming keeps the total count unchanged.
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current) return;
    pendingScrollRestoreRef.current = false;
    const viewport = viewportRef.current;
    if (viewport && prevScrollHeightRef.current) {
      viewport.scrollTop += viewport.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
    }
    prevMessageCountRef.current = messageCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMessageId]);

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
          setNewMessageStartId(g.messages[startIdx]?.id ?? g.messages[0]?.id ?? null);
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
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const atBottom = scrollHeight - scrollTop - clientHeight < 80;
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        latestRef.current.onAtBottomChange?.(atBottom);
      }
      if (atBottom) {
        setNewMessagesCount(0);
        setNewMessageStartId(null);
      }

      if (scrollTop < 500 && hasMoreOlder && !isLoadingMore) {
        prevScrollHeightRef.current = viewport.scrollHeight;
        pendingScrollRestoreRef.current = true;
        void latestRef.current.loadOlderMessages();
      }
    });
  }, [hasMoreOlder, isLoadingMore]);

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
      onReply: (message: M) => {
        a().setReplyToMessage(message);
        latestRef.current.onReplyFocus?.();
      },
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
        <div className="flex flex-col min-h-full">
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
              groups.map((group, idx) => {
                const shouldAnimate = animateIn && idx < 12;
                const isLastGroup = idx === groups.length - 1;
                const shouldSlideIn = !animateIn && isBottomAppend.current && isLastGroup && isAtBottomRef.current;
                const showNewSeparator = newMessageStartId === group.messages[0]?.id;
                return (
                <Fragment key={`group-${group.messages[0].id}`}>
                {showNewSeparator && (
                  <div className="flex items-center gap-2 px-4 my-2 select-none">
                    <span className="text-xs font-semibold text-[var(--app-accent)] whitespace-nowrap">{gt("New")}</span>
                    <div className="h-px flex-1 bg-[var(--app-accent)]" />
                  </div>
                )}
                <div
                  className={cn(
                    "msg-group-cv",
                    shouldAnimate && "msg-fade-in",
                    shouldSlideIn && "msg-slide-in"
                  )}
                  style={shouldAnimate ? { animationDelay: `${Math.min(idx * 35, 350)}ms` } : undefined}
                >
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
                  onMediaClick={onMediaClick}
                  onJumpToMessage={scrollToMessage}
                  formattedTimestamp={formattedTimestamps[idx]}
                />
                </div>
                </Fragment>
                );
              })
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>

      {/* New messages pill */}
      {newMessagesCount > 0 && (
        <button
          onClick={() => {
            setNewMessagesCount(0);
            setNewMessageStartId(null);
            isAtBottomRef.current = true;
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-color)] text-white text-sm shadow-lg hover:opacity-90 transition-opacity animate-fade-in-up"
        >
          <ArrowDown className="w-4 h-4" />
          {gt("{count} new messages", { count: newMessagesCount })}
        </button>
      )}
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
