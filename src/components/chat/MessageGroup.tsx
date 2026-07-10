"use client";

import { memo, useMemo } from "react";
import { Pencil, Pin, Reply, Smile, Trash2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SwipeableRow, type SwipeAction } from "@/components/ui/swipe-actions";
import { MessageContent } from "@/components/chat/MessageContent";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { LinkEmbed } from "@/components/chat/LinkEmbed";
import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { MessageReactions } from "@/components/chat/MessageReactions";
import { MessageHoverActions, type PickerEmoji } from "@/components/chat/MessageHoverActions";
import { MessageEditForm } from "@/components/chat/MessageEditForm";
import { GroupAvatar, GroupHeader } from "@/components/chat/MessageGroupHeader";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { useGT } from "gt-next";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";

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

export interface MessageGroupProps<M extends ChatMessage> {
  group: MessageGroupData<M>;
  currentUserId?: string;
  /** Owner / MANAGE_MESSAGES — can delete other people's messages. */
  canModerate?: boolean;
  serverId?: string;
  serverName?: string;
  /** Enables swipe actions on the entire row (mobile). */
  swipeEnabled?: boolean;
  mentionUsers?: MentionUser[];
  mentionRoles?: MentionRole[];
  /** Map of userId -> highest role color for role-colored usernames. */
  userRoleColorMap?: Record<string, string>;
  /** Fallback emoji set when a message carries no customEmojis of its own. */
  serverEmojis?: PickerEmoji[];
  availableServerEmojis?: PickerEmoji[];

  editingMessageId?: string;
  editContent: string;
  onEditContentChange: (value: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onEditCancel: () => void;
  onEditSave: () => void;

  reactionPickerMessageId?: string | null;
  onReactionPickerChange: (messageId: string, open: boolean) => void;

  onContextMenu: (e: React.MouseEvent, message: M) => void;
  onReply: (message: M) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) => void;
  onOpenReactionPicker: (messageId: string) => void;
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}

/**
 * One author group of messages, Discord style: the first row carries the
 * avatar and header, follow-up rows reuse the gutter. Each row (including the
 * avatar/username/timestamp area) is swipeable on touch devices.
 */
function MessageGroupInner<M extends ChatMessage>({
  group,
  currentUserId,
  canModerate = false,
  serverId,
  serverName,
  swipeEnabled = false,
  mentionUsers,
  mentionRoles,
  userRoleColorMap,
  serverEmojis,
  availableServerEmojis,
  editingMessageId,
  editContent,
  onEditContentChange,
  onEditKeyDown,
  onEditCancel,
  onEditSave,
  reactionPickerMessageId,
  onReactionPickerChange,
  onContextMenu,
  onReply,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
  onAddReaction,
  onToggleReaction,
  onOpenReactionPicker,
  onMediaClick,
  onJumpToMessage,
}: MessageGroupProps<M>) {
  const gt = useGT();
  // Merge mention users with message authors and referenced message authors
  // so that mentions resolve even for users who left the server or aren't in
  // the member list fetched for autocomplete.
  const mergedMentionUsers = useMemo(() => {
    const map = new Map<string, MentionUser>();
    for (const u of mentionUsers || []) {
      if (u?.id) map.set(u.id, u);
    }
    for (const msg of group.messages) {
      if (msg.author?.id && !map.has(msg.author.id)) {
        map.set(msg.author.id, {
          id: msg.author.id,
          username: msg.author.username,
          displayName: msg.author.displayName || msg.author.username,
        });
      }
      if (msg.referencedMessage?.author?.id && !map.has(msg.referencedMessage.author.id)) {
        map.set(msg.referencedMessage.author.id, {
          id: msg.referencedMessage.author.id,
          username: msg.referencedMessage.author.username,
          displayName: msg.referencedMessage.author.displayName || msg.referencedMessage.author.username,
        });
      }
    }
    return Array.from(map.values());
  }, [mentionUsers, group.messages]);

  // Build a userId -> {id, username, displayName, avatar} map for reaction tooltips.
  // Includes mention users plus all message authors in this group.
  const reactionUsersMap = useMemo(() => {
    const map: Record<string, { id: string; username?: string; displayName?: string; avatar?: string }> = {};
    for (const u of mergedMentionUsers) {
      map[u.id] = u;
    }
    for (const msg of group.messages) {
      if (msg.author?.id && !map[msg.author.id]) {
        map[msg.author.id] = {
          id: msg.author.id,
          username: msg.author.username,
          displayName: msg.author.displayName || msg.author.username,
          avatar: msg.author.avatar,
        };
      }
    }
    return map;
  }, [mergedMentionUsers, group.messages]);

  const buildSwipeActions = (message: M): SwipeAction[] => {
    if (!swipeEnabled) return [];
    const actions: SwipeAction[] = [
      {
        label: gt("Reply"),
        icon: <Reply className="w-5 h-5" />,
        onAction: () => onReply(message),
        className: "bg-[#8B5CF6]",
      },
      {
        label: gt("React"),
        icon: <Smile className="w-5 h-5" />,
        onAction: () => onOpenReactionPicker(message.id),
        className: "bg-[#6366f1]",
      },
    ];
    const isOwnMessage = message.authorId === currentUserId;
    if (isOwnMessage) {
      actions.push({
        label: gt("Edit"),
        icon: <Pencil className="w-5 h-5" />,
        onAction: () => onEdit(message),
        className: "bg-[#3b82f6]",
      });
    }
    if (isOwnMessage || canModerate) {
      actions.push({
        label: gt("Delete"),
        icon: <Trash2 className="w-5 h-5" />,
        onAction: () => onDelete(message),
        className: "bg-red-500",
      });
    }
    return actions;
  };

  return (
    <div className="chat-message-row group py-0.5 hover:bg-[var(--app-surface-alt)]/80 message-hover transition-colors">
      {group.messages.map((message, index) => {
        const isFirst = index === 0;
        const isEditing = editingMessageId === message.id;
        const pickerOpen = reactionPickerMessageId === message.id;
        return (
          <SwipeableRow key={message.id} actions={buildSwipeActions(message)} className="hover:z-40">
            <div
              id={`message-${message.id}`}
              className={cn("flex gap-4 relative group/message hover:z-50", message.pending && "opacity-60")}
              onContextMenu={(e) => onContextMenu(e, message)}
            >
              <div className="w-10 flex-shrink-0">
                {isFirst && <GroupAvatar author={group.author} serverId={serverId} />}
              </div>

              <div className="flex-1 min-w-0">
                {isFirst && (
                  <GroupHeader author={group.author} timestamp={group.timestamp} serverId={serverId} roleColor={userRoleColorMap?.[group.author.id]} />
                )}

                {isEditing ? (
                  <MessageEditForm
                    value={editContent}
                    onChange={onEditContentChange}
                    onKeyDown={onEditKeyDown}
                    onCancel={onEditCancel}
                    onSave={onEditSave}
                  />
                ) : (
                  <>
                    {message.referencedMessage && (
                      <div
                        onClick={() => onJumpToMessage?.(message.referencedMessage!.id)}
                        className={cn(
                          "mb-1 text-xs text-[var(--app-muted)] flex items-center gap-1 max-w-full",
                          onJumpToMessage && "hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        )}
                      >
                        <Reply className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">
                          {gt("Replying to")}{" "}
                          {message.referencedMessage.author?.id ? (
                            <MemberProfilePopup
                              member={{
                                id: message.referencedMessage.author.id,
                                username: message.referencedMessage.author.username || "unknown",
                                displayName: message.referencedMessage.author.displayName,
                                avatar: message.referencedMessage.author.avatar,
                              }}
                              serverId={serverId}
                              side="right"
                              align="start"
                            >
                              <span
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-[var(--app-accent)] hover:underline cursor-pointer inline"
                              >
                                {message.referencedMessage.author.displayName ||
                                  message.referencedMessage.author.username}
                              </span>
                            </MemberProfilePopup>
                          ) : (
                            gt("message")
                          )}
                          : {message.referencedMessage.content ? decodeHtmlEntities(message.referencedMessage.content) : gt("(attachment)")}
                        </span>
                      </div>
                    )}

                    <MessageContent
                      content={message.content}
                      serverEmojis={message.customEmojis?.length ? message.customEmojis : serverEmojis}
                      mentionUsers={mergedMentionUsers}
                      mentionRoles={mentionRoles}
                      currentUserId={currentUserId}
                      serverId={serverId}
                      edited={message.edited}
                      sticker={message.sticker}
                      className="chat-message-body text-[var(--app-text)]"
                      onMediaClick={({ src, alt }) => onMediaClick(src, alt, message.id)}
                      messageId={message.id}
                    />

                    {message.pending && (
                      <span className="inline-flex items-center gap-1 ml-1 text-[11px] text-[var(--app-muted)] align-middle">
                        <Clock className="w-3 h-3 animate-pulse" />
                        {gt("Sending…")}
                      </span>
                    )}

                    {message.pinned && (
                      <div className="mt-1 text-[11px] text-[var(--app-muted)] inline-flex items-center gap-1">
                        <Pin className="w-3 h-3" />
                        {gt("Pinned message")}
                      </div>
                    )}

                    <LinkEmbed
                      content={message.content}
                      onMediaClick={(src, alt) => onMediaClick(src, alt, message.id)}
                    />

                    <MessageAttachments
                      attachments={message.attachments}
                      messageId={message.id}
                      onMediaClick={onMediaClick}
                    />

                    <MessageReactions
                      reactions={message.reactions}
                      messageId={message.id}
                      currentUserId={currentUserId}
                      onToggle={onToggleReaction}
                      onOpenPicker={onOpenReactionPicker}
                      reactionUsers={reactionUsersMap}
                    />

                    <MessageHoverActions
                      message={message}
                      isOwn={message.authorId === currentUserId}
                      reactionPickerOpen={pickerOpen}
                      onReactionPickerChange={(open) => onReactionPickerChange(message.id, open)}
                      onAddReaction={onAddReaction}
                      onReply={onReply}
                      onCopy={onCopy}
                      onPinToggle={onPinToggle}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      serverEmojis={serverEmojis}
                      availableServerEmojis={availableServerEmojis}
                      serverName={serverName}
                    />
                  </>
                )}
              </div>
            </div>
          </SwipeableRow>
        );
      })}
    </div>
  );
}

/**
 * Memoized: with stable handler props from the chat session, a group only
 * re-renders when its own messages (or edit/reaction-picker targeting it)
 * change — instead of the whole list re-rendering on every keystroke.
 */
export const MessageGroup = memo(MessageGroupInner) as typeof MessageGroupInner;
