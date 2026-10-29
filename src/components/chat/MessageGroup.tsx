"use client";

import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { BellOff, Pin, Reply, Clock, Lock, ShieldAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SwipeReplyRow } from "@/components/chat/SwipeReplyRow";
import { MessageContent } from "@/components/chat/MessageContent";
import { LinkEmbed } from "@/components/chat/LinkEmbedSlot";
import { RichEmbed } from "@/components/chat/RichEmbed";
import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { MessageReactions } from "@/components/chat/MessageReactions";
import { MessageHoverActions, type PickerEmoji } from "@/components/chat/MessageHoverActions";
import { MessageEditForm } from "@/components/chat/MessageEditForm";
import { mergeEmojiLookups } from "@/lib/chat/customEmoji";
import { ForwardedMessageCard } from "@/components/chat/ForwardedMessageCard";
import { PollCard } from "@/components/chat/PollCard";
import { GroupAvatar, GroupHeader } from "@/components/chat/MessageGroupHeader";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { useChatGt } from "./ChatGtContext";
import { UnreadDivider } from "./UnreadDivider";
import { ThreadChip } from "./ThreadRows";
import { useAuth } from "@/contexts/AuthContext";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";
import { isSilentMessage } from "@/lib/chat/messageFlags";
import { collectMessageUsers, mergeMentionUsers } from "@/lib/chat/mentionResolver";
import type { RoleIconData } from "@/components/chat/RoleIcon";
import type { ChatGt } from "./ChatGtContext";
import dynamic from "next/dynamic";
import { attachmentsOutsideComponents, isLoadingMessage } from "@/lib/chat/interactionEvents";
import { isComponentsV2Message } from "@/lib/chat/componentsV2";

// Bot buttons / selects / components v2: its own chunk, only for messages that have them.
const MessageComponents = dynamic(() => import("@/components/chat/MessageComponents"), { ssr: false });

/** Why an end-to-end encrypted message can't be shown (lib/e2ee/client DecryptFailure). */
function e2eeFailureText(gt: ChatGt, reason: string | undefined): string {
  switch (reason) {
    case "restore":
    case "not_ready":
      return gt("Set up encryption on this device to read this message.");
    case "no_key":
      return gt("This message wasn't encrypted for this device.");
    case "signature":
    case "unknown_device":
    case "revoked_device":
      return gt("Couldn't verify who sent this message.");
    case "wrong_conversation":
      return gt("This message belongs to a different conversation.");
    case "foreign_url":
      return gt("This message points to files outside SerikaCord, so it wasn't shown.");
    default:
      return gt("Couldn't decrypt this message.");
  }
}

/** How long a decryption may take before "Decrypting…" shows (most finish well before). */
const DECRYPT_PLACEHOLDER_DELAY_MS = 150;

/**
 * An encrypted message still being decrypted: an empty line at first (no
 * flash for the usual few milliseconds), "Decrypting…" only if it takes
 * longer than DECRYPT_PLACEHOLDER_DELAY_MS.
 */
function PendingDecryptBody() {
  const gt = useChatGt();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), DECRYPT_PLACEHOLDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <span className="chat-message-body inline-flex items-center gap-1.5 italic text-[var(--app-muted)]" aria-busy="true">
      {slow ? (
        <>
          <Lock className="w-3.5 h-3.5 animate-pulse" />
          {gt("Decrypting…")}
        </>
      ) : (
        <span className="invisible">{gt("Decrypting…")}</span>
      )}
    </span>
  );
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

export interface MessageGroupProps<M extends ChatMessage> {
  group: MessageGroupData<M>;
  currentUserId?: string;
  /** Owner / MANAGE_MESSAGES — can delete other people's messages. */
  canModerate?: boolean;
  /** Owner / MANAGE_MESSAGES / PIN_MESSAGES — can pin or unpin messages. */
  canPin?: boolean;
  serverId?: string;
  serverName?: string;
  /** Touch gestures (mobile): swipe left to reply, long-press for the action sheet. */
  swipeEnabled?: boolean;
  mentionUsers?: MentionUser[];
  mentionRoles?: MentionRole[];
  /** Map of userId -> highest role color for role-colored usernames. */
  userRoleColorMap?: Record<string, string>;
  /** Map of userId -> role icon (highest role with one) shown after the name. */
  userRoleIconMap?: Record<string, RoleIconData>;
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
  onReply: (message: M, opts?: { mention?: boolean }) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) => void;
  onOpenReactionPicker: (messageId: string) => void;
  /** Open the "Reactions" viewer (right-click a reaction). */
  onViewReactions?: (message: M, emoji?: string) => void;
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
  onSuppressEmbeds?: (messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  /** Text channels where the viewer may start threads: "Create Thread" on messages. */
  canCreateThread?: boolean;
  onCreateThread?: (message: M) => void;
  /** Open the thread a message started (its chip). */
  onOpenThread?: (threadId: string) => void;
  formattedTimestamp: string;
  /** Id of a message in the middle of this group that starts the unread run;
   *  a "New" divider is drawn above that row. Undefined for every other group. */
  newSeparatorBeforeId?: string;
  /** The message the composer is replying to: highlighted like Discord. */
  replyTargetId?: string;
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
  canPin = false,
  serverId,
  serverName,
  swipeEnabled = false,
  mentionUsers,
  mentionRoles,
  userRoleColorMap,
  userRoleIconMap,
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
  onViewReactions,
  onMediaClick,
  onSuppressEmbeds,
  onJumpToMessage,
  canCreateThread = false,
  onCreateThread,
  onOpenThread,
  formattedTimestamp,
  newSeparatorBeforeId,
  replyTargetId,
}: MessageGroupProps<M>) {
  const gt = useChatGt();
  const { user } = useAuth();
  const inlineMediaEnabled = user?.settings?.textImages?.inlineMedia !== false;
  const inlineEmbedsEnabled = user?.settings?.textImages?.inlineEmbeds !== false;
  // Mentions resolve the same way everywhere in the row, reply previews
  // included: the container's users (server members, bots included) first,
  // then the authors in this group, reply authors and the users mentioned in
  // replied-to messages (referencedMessage.mentions). Anything still unknown
  // falls back to MessageContent's cached lookup.
  const mergedMentionUsers = useMemo(
    () => mergeMentionUsers(mentionUsers, collectMessageUsers(group.messages)),
    [mentionUsers, group.messages],
  );

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

  // Long-press (touch) opens the same menu as right-click: the action sheet on phones.
  const openMenuAt = (message: M) => (x: number, y: number) =>
    onContextMenu({ preventDefault() {}, clientX: x, clientY: y } as unknown as React.MouseEvent, message);

  return (
    <div className="chat-message-row group py-0.5">
      {group.messages.map((message, index) => {
        const isFirst = index === 0;
        const isEditing = editingMessageId === message.id;
        const pickerOpen = reactionPickerMessageId === message.id;
        // Pings you (mention, @everyone/@here, or a reply to you): Discord's
        // highlighted row.
        const pingsMe =
          Boolean(currentUserId) &&
          message.authorId !== currentUserId &&
          (Boolean(message.mentionEveryone) || Boolean(message.mentionedUserIds?.includes(currentUserId!)));
        return (
          <Fragment key={message.id}>
            {index > 0 && newSeparatorBeforeId === message.id && (
              <UnreadDivider label={gt("New")} />
            )}
            {message.interaction?.name && (
              <div className="ml-[3.5rem] mb-0.5 flex items-center gap-1 text-xs text-[var(--app-muted)] truncate">
                <Reply className="w-3 h-3 flex-shrink-0 -scale-x-100" />
                <span className="truncate">
                  <span className="font-medium text-[var(--text-primary)]">
                    {message.interaction.user.username}
                  </span>{" "}
                  {gt("used")}{" "}
                  <span className="font-medium text-[var(--text-primary)]">
                    /{message.interaction.name}
                  </span>
                </span>
              </div>
            )}
          <SwipeReplyRow
            disabled={!swipeEnabled || isEditing}
            onReply={() => onReply(message)}
            onLongPress={swipeEnabled ? openMenuAt(message) : undefined}
            className="hover:z-40"
          >
            <div
              id={`message-${message.id}`}
              className={cn(
                "flex gap-4 relative group/message rounded transition-colors -mx-1 px-1 hover:z-50",
                replyTargetId === message.id
                  ? "chat-reply-target"
                  : pingsMe ? "chat-mention-row" : "hover:bg-[var(--app-surface-alt)]/80",
                message.pending && "opacity-60",
                message.ephemeral && "chat-ephemeral"
              )}
              onContextMenu={(e) => onContextMenu(e, message)}
            >
              <div className="w-10 flex-shrink-0">
                {isFirst && <GroupAvatar author={group.author} serverId={serverId} />}
              </div>

              <div className="flex-1 min-w-0">
                {isFirst && (
                  <GroupHeader author={group.author} formattedTimestamp={formattedTimestamp} serverId={serverId} roleColor={userRoleColorMap?.[group.author.id]} roleIcon={userRoleIconMap?.[group.author.id]} />
                )}

                {isEditing ? (
                  <MessageEditForm
                    value={editContent}
                    onChange={onEditContentChange}
                    onKeyDown={onEditKeyDown}
                    onCancel={onEditCancel}
                    onSave={onEditSave}
                    emojis={mergeEmojiLookups(message.customEmojis, serverEmojis)}
                    serverId={serverId}
                    serverName={serverName}
                    serverEmojis={serverEmojis}
                    availableServerEmojis={availableServerEmojis}
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
                                isDiscord: message.referencedMessage.author.isDiscord,
                                isWebhook: message.referencedMessage.author.isWebhook,
                              }}
                              serverId={serverId}
                            >
                              <span
                                onClick={(e) => e.stopPropagation()}
                                onContextMenu={(e) => e.stopPropagation()}
                                className="font-medium text-[var(--app-accent)] hover:underline cursor-pointer inline"
                              >
                                {message.referencedMessage.author.displayName ||
                                  message.referencedMessage.author.username}
                              </span>
                            </MemberProfilePopup>
                          ) : (
                            gt("message")
                          )}
                          {": "}
                          {message.referencedMessage.content ? (
                            <MessageContent
                              inline
                              content={message.referencedMessage.content}
                              serverEmojis={mergeEmojiLookups(message.referencedMessage.customEmojis, mergeEmojiLookups(message.customEmojis, serverEmojis))}
                              mentionUsers={mergedMentionUsers}
                              mentionRoles={mentionRoles}
                              currentUserId={currentUserId}
                              serverId={serverId}
                              className="inline"
                            />
                          ) : message.referencedMessage.encrypted ? (
                            gt("Encrypted message")
                          ) : (
                            gt("(attachment)")
                          )}
                          {message.referencedMessage.quotedBySender && message.referencedMessage.content && (
                            // The replier's own snippet of a message we couldn't decrypt: their quote, not the original.
                            <span className="ml-1 italic opacity-70">({gt("quoted by the sender")})</span>
                          )}
                        </span>
                      </div>
                    )}

                    {message.e2eePlaintext && (
                      // No envelope in an encrypted conversation: the server could have written it.
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-500">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        {gt("Not encrypted – can't verify sender")}
                      </span>
                    )}
                    {message.e2ee && message.e2ee.status === "pending" ? (
                      <PendingDecryptBody />
                    ) : message.e2ee && message.e2ee.status !== "ok" ? (
                      // End-to-end encrypted, not readable on this device.
                      <span className="chat-message-body inline-flex items-center gap-1.5 italic text-[var(--app-muted)]">
                        <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                        {e2eeFailureText(gt, message.e2ee.reason)}
                      </span>
                    ) : isLoadingMessage(message.flags) && !message.content ? (
                      // Deferred interaction reply (callback 5) until the app edits it.
                      <span className="chat-message-body inline-flex items-center gap-1.5 italic text-[var(--app-muted)]" aria-busy="true">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {gt("{name} is thinking…", { name: group.author.displayName || group.author.username })}
                      </span>
                    ) : (
                    <MessageContent
                      content={message.content}
                      serverEmojis={mergeEmojiLookups(message.customEmojis, serverEmojis)}
                      mentionUsers={mergedMentionUsers}
                      mentionRoles={mentionRoles}
                      currentUserId={currentUserId}
                      serverId={serverId}
                      edited={message.edited}
                      sticker={message.sticker}
                      className="chat-message-body text-[var(--app-text)]"
                      onMediaClick={({ src, alt }) => onMediaClick(src, alt, message.id)}
                      messageId={message.id}
                      noLinkPreviews={Boolean(message.e2ee)}
                    />
                    )}

                    {message.e2ee?.status === "ok" && (
                      <span
                        className={cn(
                          "inline-flex items-center ml-1 align-middle",
                          message.e2ee.verified ? "text-[var(--app-muted)] opacity-60" : "text-amber-400",
                        )}
                        title={message.e2ee.verified ? gt("End-to-end encrypted") : gt("End-to-end encrypted, but the sender's security code isn't confirmed")}
                        aria-label={message.e2ee.verified ? gt("End-to-end encrypted") : gt("End-to-end encrypted, but the sender's security code isn't confirmed")}
                      >
                        <Lock className="w-3 h-3" />
                      </span>
                    )}

                    {isSilentMessage(message.flags) && (
                      <span
                        className="inline-flex items-center ml-1 text-[var(--app-muted)] align-middle"
                        title={gt("Silent message: sent without notifications")}
                        aria-label={gt("Silent message: sent without notifications")}
                      >
                        <BellOff className="w-3 h-3" />
                      </span>
                    )}

                    {message.forward && (
                      <ForwardedMessageCard
                        messageId={message.id}
                        forward={message.forward}
                        serverEmojis={serverEmojis}
                        mentionUsers={mergedMentionUsers}
                        mentionRoles={mentionRoles}
                        currentUserId={currentUserId}
                        serverId={serverId}
                        showMedia={inlineMediaEnabled}
                        onMediaClick={onMediaClick}
                      />
                    )}

                    {message.poll && (
                      <PollCard
                        messageId={message.id}
                        poll={message.poll}
                        isAuthor={message.authorId === currentUserId}
                      />
                    )}

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

                    {message.ephemeral && (
                      <div className="mt-1 text-[11px] text-[var(--app-muted)] inline-flex items-center gap-1">
                        {gt("Only you can see this")}
                      </div>
                    )}

                    {message.embeds && message.embeds.length > 0 && !message.suppressEmbeds && (
                    <RichEmbed
                      embeds={message.embeds}
                      serverEmojis={mergeEmojiLookups(message.customEmojis, serverEmojis)}
                      mentionUsers={mergedMentionUsers}
                      mentionRoles={mentionRoles}
                      currentUserId={currentUserId}
                      serverId={serverId}
                      onMediaClick={(src, alt) => onMediaClick(src, alt, message.id)}
                    />
                    )}

                    {/* No link previews for encrypted messages: they'd send the links to the server. */}
                    {inlineEmbedsEnabled && !message.suppressEmbeds && !message.e2ee && (
                    <LinkEmbed
                      content={message.content}
                      embeds={message.embeds}
                      onMediaClick={(src, alt) => onMediaClick(src, alt, message.id)}
                      onSuppress={onSuppressEmbeds && (message.authorId === currentUserId || canModerate) ? () => onSuppressEmbeds(message.id) : undefined}
                    />
                    )}

                    {message.components && message.components.length > 0 && (
                      <MessageComponents
                        messageId={message.id}
                        channelId={message.channelId}
                        components={message.components}
                        attachments={message.attachments}
                        serverId={serverId}
                        currentUserId={currentUserId}
                        mentionUsers={mergedMentionUsers}
                        mentionRoles={mentionRoles}
                        serverEmojis={mergeEmojiLookups(message.customEmojis, serverEmojis) as PickerEmoji[]}
                        onMediaClick={onMediaClick}
                      />
                    )}

                    {/* Components v2: attachments show only through file / gallery / thumbnail components, like Discord. */}
                    {inlineMediaEnabled && !isComponentsV2Message(message.flags) && (
                    <MessageAttachments
                      attachments={message.components?.length ? attachmentsOutsideComponents(message.attachments, message.components) : message.attachments}
                      messageId={message.id}
                      onMediaClick={onMediaClick}
                    />
                    )}

                    {message.thread && onOpenThread && (
                      <ThreadChip thread={message.thread} onOpen={() => onOpenThread(message.thread!.id)} />
                    )}

                    <MessageReactions
                      reactions={message.reactions}
                      messageId={message.id}
                      currentUserId={currentUserId}
                      onToggle={onToggleReaction}
                      onOpenPicker={onOpenReactionPicker}
                      onViewReactions={onViewReactions ? (emoji) => onViewReactions(message, emoji) : undefined}
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
                      canPin={canPin}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onCreateThread={
                        canCreateThread && onCreateThread && !message.thread && !message.threadId && !message.pending && !message.ephemeral && !message.id.startsWith("temp-")
                          ? onCreateThread
                          : undefined
                      }
                      serverEmojis={serverEmojis}
                      availableServerEmojis={availableServerEmojis}
                      serverName={serverName}
                    />
                  </>
                )}
              </div>
            </div>
          </SwipeReplyRow>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * True when the given messageId belongs to one of the group's messages.
 * Used so that edit/reaction-picker state only busts the memo for the one
 * group that actually contains the targeted message.
 */
function groupHasMessage(messages: ChatMessage[], id: string | null | undefined): boolean {
  if (!id) return false;
  for (const m of messages) {
    if (m.id === id) return true;
  }
  return false;
}

/**
 * Custom equality for the memo below.
 *
 * The problem this solves: `groupMessages()` allocates fresh group wrapper
 * objects (and fresh `messages` arrays) on every render — including on every
 * incoming SSE message and every keystroke in the composer/edit box. The
 * default shallow compare sees a new `group` reference and re-renders EVERY
 * group in the channel, re-parsing markdown/emoji for every message. On a busy
 * channel (or any non-English locale, which adds per-render `gt` lookups) this
 * saturates the main thread and produces the "scrollbar moves but the messages
 * freeze" jank.
 *
 * Key insight: the message *objects* inside a group are referentially stable —
 * `setMessages` only allocates a new object for the message that actually
 * changed (new/edited/reacted). So we compare the group by its message
 * references, and only consider edit/reaction-picker props when the targeted
 * message lives in THIS group. All handler props are stabilized by the parent.
 */
function arePropsEqual<M extends ChatMessage>(
  prev: MessageGroupProps<M>,
  next: MessageGroupProps<M>,
): boolean {
  const pm = prev.group.messages;
  const nm = next.group.messages;
  if (pm.length !== nm.length) return false;
  for (let i = 0; i < pm.length; i++) {
    if (pm[i] !== nm[i]) return false;
  }

  if (
    prev.group.author !== next.group.author ||
    prev.formattedTimestamp !== next.formattedTimestamp
  ) {
    return false;
  }

  // Edit state only matters when the editing target is (or was) in this group.
  const editRelevant =
    groupHasMessage(pm, prev.editingMessageId) || groupHasMessage(nm, next.editingMessageId);
  if (editRelevant) {
    if (
      prev.editingMessageId !== next.editingMessageId ||
      prev.editContent !== next.editContent
    ) {
      return false;
    }
  }

  // Reply highlight only matters when its target is (or was) in this group.
  if (
    prev.replyTargetId !== next.replyTargetId &&
    (groupHasMessage(pm, prev.replyTargetId) || groupHasMessage(nm, next.replyTargetId))
  ) {
    return false;
  }

  // Reaction-picker state only matters when its target is in this group.
  const pickerRelevant =
    groupHasMessage(pm, prev.reactionPickerMessageId) ||
    groupHasMessage(nm, next.reactionPickerMessageId);
  if (pickerRelevant && prev.reactionPickerMessageId !== next.reactionPickerMessageId) {
    return false;
  }

  // Remaining data props (handlers are stabilized by the parent). Compare by
  // reference — these are React state / memoized in the chat session.
  return (
    prev.currentUserId === next.currentUserId &&
    prev.canModerate === next.canModerate &&
    prev.canPin === next.canPin &&
    prev.serverId === next.serverId &&
    prev.serverName === next.serverName &&
    prev.swipeEnabled === next.swipeEnabled &&
    prev.mentionUsers === next.mentionUsers &&
    prev.mentionRoles === next.mentionRoles &&
    prev.userRoleColorMap === next.userRoleColorMap &&
    prev.userRoleIconMap === next.userRoleIconMap &&
    prev.serverEmojis === next.serverEmojis &&
    prev.availableServerEmojis === next.availableServerEmojis &&
    prev.onMediaClick === next.onMediaClick &&
    prev.onSuppressEmbeds === next.onSuppressEmbeds &&
    prev.onJumpToMessage === next.onJumpToMessage &&
    prev.canCreateThread === next.canCreateThread &&
    prev.onCreateThread === next.onCreateThread &&
    prev.onOpenThread === next.onOpenThread &&
    prev.onViewReactions === next.onViewReactions &&
    prev.newSeparatorBeforeId === next.newSeparatorBeforeId
  );
}

/**
 * Memoized: with stable handler props from the chat session, a group only
 * re-renders when its own messages (or edit/reaction-picker targeting it)
 * change — instead of the whole list re-rendering on every keystroke or every
 * incoming message. See {@link arePropsEqual}.
 */
export const MessageGroup = memo(MessageGroupInner, arePropsEqual) as typeof MessageGroupInner;
