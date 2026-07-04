"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  memo,
  type ReactNode,
  type Ref,
} from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageGroup } from "@/components/chat/MessageGroup";
import { MessageSkeleton } from "@/components/ui/skeleton";
import type { PickerEmoji } from "@/components/chat/MessageHoverActions";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";
import type { useMessageActions } from "@/hooks/useMessageActions";

export interface MessageListHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageId: string) => void;
  isAtBottom: () => boolean;
}

interface MentionUser {
  id: string;
  username?: string;
  displayName?: string;
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
    emptyText = "No messages yet. Be the first to say something!",
    className,
    onAtBottomChange,
  }: MessageListProps<M>,
  ref: Ref<MessageListHandle>
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const messageCount = useMemo(
    () => groups.reduce((total, group) => total + group.messages.length, 0),
    [groups]
  );
  const prevMessageCountRef = useRef(0);

  // Latest mutable handlers behind stable identities so memoized rows
  // don't re-render on every parent render.
  const latestRef = useRef({ actions, loadOlderMessages, onReplyFocus, onAtBottomChange });
  useEffect(() => {
    latestRef.current = { actions, loadOlderMessages, onReplyFocus, onAtBottomChange };
  });

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    document
      .getElementById(`message-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      scrollToMessage,
      isAtBottom: () => isAtBottomRef.current,
    }),
    [scrollToBottom, scrollToMessage]
  );

  // Auto-scroll on new messages when pinned to bottom; otherwise count them.
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;
    if (messageCount > prevCount) {
      if (isAtBottomRef.current) {
        scrollToBottom(prevCount === 0 ? "auto" : "smooth");
      } else {
        setNewMessagesCount((c) => c + (messageCount - prevCount));
      }
    }
  }, [messageCount, scrollToBottom]);

  // Scroll listener: bottom detection + top pagination with scroll restore.
  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      latestRef.current.onAtBottomChange?.(atBottom);
    }
    if (atBottom) setNewMessagesCount(0);

    if (scrollTop < 100 && hasMoreOlder && !isLoadingMore) {
      prevScrollHeightRef.current = viewport.scrollHeight;
      void latestRef.current.loadOlderMessages().then((didLoad) => {
        if (!didLoad) return;
        requestAnimationFrame(() => {
          const vp = viewportRef.current;
          if (vp && prevScrollHeightRef.current) {
            vp.scrollTop += vp.scrollHeight - prevScrollHeightRef.current;
          }
        });
      });
    }
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
    <div className={cn("relative flex-1 min-h-0", className)}>
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="chat-scroller h-full overflow-y-auto overflow-x-hidden scrollbar-thin overscroll-contain"
      >
        <div className="flex flex-col min-h-full">
          <div className="flex-1" />
          <div className="flex flex-col py-4 w-full max-w-full">
            {/* Load older */}
            {hasMoreOlder && !isLoading && (
              <div className="flex justify-center py-3">
                {isLoadingMore ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading older messages...
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const viewport = viewportRef.current;
                      prevScrollHeightRef.current = viewport?.scrollHeight ?? 0;
                      void latestRef.current.loadOlderMessages().then((didLoad) => {
                        if (!didLoad) return;
                        requestAnimationFrame(() => {
                          const vp = viewportRef.current;
                          if (vp && prevScrollHeightRef.current) {
                            vp.scrollTop += vp.scrollHeight - prevScrollHeightRef.current;
                          }
                        });
                      });
                    }}
                    className="px-4 py-1.5 rounded-full text-sm text-[var(--accent-color)] bg-[var(--accent-color)]/10 hover:bg-[var(--accent-color)]/20 transition-colors"
                  >
                    Load older messages
                  </button>
                )}
              </div>
            )}

            {/* History start header */}
            {!hasMoreOlder && !isLoading && welcomeHeader}

            {/* Messages */}
            {isLoading ? (
              <MessageSkeleton count={5} />
            ) : groups.length === 0 ? (
              <div className="text-center text-[var(--text-muted)] py-8">{emptyText}</div>
            ) : (
              groups.map((group) => (
                <MessageGroup
                  key={`group-${group.messages[0].id}`}
                  group={group}
                  currentUserId={currentUserId}
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
                />
              ))
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
            isAtBottomRef.current = true;
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-color)] text-white text-sm shadow-lg hover:opacity-90 transition-opacity animate-fade-in-up"
        >
          <ArrowDown className="w-4 h-4" />
          {newMessagesCount} new message{newMessagesCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
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
