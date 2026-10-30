"use client";

import { Copy, Hash, Link2, MessagesSquare, Pencil, Pin, Reply, Share2, SmilePlus, Trash2, CornerUpRight, EyeOff, Flag, Smile, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cdnImage, cn } from "@/lib/utils";
import { DEFAULT_QUICK_REACTIONS, emojiKey, type FrecencyEmoji } from "@/lib/chat/emojiFrecency";
import { canShare, shareLink } from "@/lib/native/bridge";
import { MobileSheet } from "@/components/mobile/MobileSheet";
import type { ChatMessage } from "@/lib/chat/types";
import { requestForward } from "@/lib/chat/forwardBus";


/** Whether `userId` already reacted to `message` with this emoji. */
export function hasReactedWith(message: ChatMessage, emoji: FrecencyEmoji, userId?: string): boolean {
  if (!userId) return false;
  const reaction = message.reactions?.find((r) =>
    emoji.kind === "custom" ? r.emoji.id === emoji.id : !r.emoji.id && r.emoji.name === emoji.emoji,
  );
  return Boolean(reaction?.userIds?.includes(userId));
}

interface MessageActionSheetProps<M extends ChatMessage> {
  message: M;
  own: boolean;
  /** Own message with text of its own (not a poll or a forward). */
  editable?: boolean;
  /** Offer "Forward" (see isForwardable). */
  forwardable?: boolean;
  canDelete: boolean;
  canPin: boolean;
  currentUserId?: string;
  onClose: () => void;
  onReply: (message: M) => void;
  onAddReaction?: (message: M) => void;
  /** Quick reactions shown at the top (frecent first). */
  quickReactions?: FrecencyEmoji[];
  /** Toggle one of the quick reactions. */
  onReact?: (emoji: FrecencyEmoji) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  /** Start a thread from the message (omitted where threads aren't allowed). */
  onCreateThread?: (message: M) => void;
  /** Announcement channels: publish to following channels. */
  onPublish?: (message: M) => void;
  onMarkUnread?: (message: M) => void;
  onViewReactions?: (message: M) => void;
  onReport?: (message: M) => void;
}

/**
 * Long-press menu for a message on phones: a bottom sheet with quick
 * reactions and big touch targets, dismissed by tapping outside, dragging it
 * down or the Android back button.
 */
export function MessageActionSheet<M extends ChatMessage>({
  message,
  own,
  editable = own,
  forwardable = false,
  canDelete,
  canPin,
  currentUserId,
  onClose,
  onReply,
  onAddReaction,
  quickReactions = DEFAULT_QUICK_REACTIONS,
  onReact,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
  onCreateThread,
  onPublish,
  onMarkUnread,
  onViewReactions,
  onReport,
}: MessageActionSheetProps<M>) {
  const gt = useGT();
  const shareable = canShare();

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const messageUrl = () => `${window.location.origin}${window.location.pathname}?jump=${message.id}`;

  const rowClass =
    "flex w-full items-center gap-3 px-4 h-12 text-left text-[15px] font-medium text-[var(--text-primary)] active:bg-[var(--bg-hover)] touch-manipulation";

  return (
    <MobileSheet onClose={onClose} label={gt("Message actions")} containerClassName="desk:hidden">
        {onReact && (
          <div
            className="flex items-center justify-between gap-1.5 px-4 pb-3"
          >
            {quickReactions.map((emoji) => {
              const reacted = hasReactedWith(message, emoji, currentUserId);
              return (
                <button
                  key={emojiKey(emoji)}
                  type="button"
                  aria-label={gt("React")}
                  aria-pressed={reacted}
                  onClick={run(() => onReact(emoji))}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full text-[22px] transition-transform active:scale-90 touch-manipulation",
                    reacted
                      ? "bg-[var(--app-accent)]/20 ring-1 ring-[var(--app-accent)]"
                      : "bg-[var(--app-surface-alt)]",
                  )}
                >
                  {emoji.kind === "custom" ? (
                    <img src={cdnImage(emoji.url)} alt={`:${emoji.name}:`} className="h-6 w-6 object-contain" />
                  ) : (
                    emoji.emoji
                  )}
                </button>
              );
            })}
            {onAddReaction && (
              <button
                type="button"
                aria-label={gt("Add Reaction")}
                onClick={run(() => onAddReaction(message))}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-surface-alt)] text-[var(--text-secondary)] transition-transform active:scale-90 touch-manipulation"
              >
                <SmilePlus className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        <div className="mx-3 mb-2 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl bg-[var(--app-surface-alt)]">
          <button type="button" className={rowClass} onClick={run(() => onReply(message))}>
            <Reply className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Reply")}
          </button>
          {onCreateThread && (
            <button type="button" className={rowClass} onClick={run(() => onCreateThread(message))}>
              <MessagesSquare className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Create Thread")}
            </button>
          )}
          {onPublish && (
            <button type="button" className={rowClass} onClick={run(() => onPublish(message))}>
              <Megaphone className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Publish")}
            </button>
          )}
          {forwardable && (
            <button type="button" className={rowClass} onClick={run(() => requestForward(message))}>
              <CornerUpRight className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Forward")}
            </button>
          )}
          {editable && (
            <button type="button" className={rowClass} onClick={run(() => onEdit(message))}>
              <Pencil className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Edit Message")}
            </button>
          )}
          {canPin && (
            <button type="button" className={rowClass} onClick={run(() => onPinToggle(message))}>
              <Pin className="h-5 w-5 text-[var(--text-secondary)]" />
              {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
            </button>
          )}
          {onMarkUnread && (
            <button type="button" className={rowClass} onClick={run(() => onMarkUnread(message))}>
              <EyeOff className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Mark Unread")}
            </button>
          )}
          {onViewReactions && (
            <button type="button" className={rowClass} onClick={run(() => onViewReactions(message))}>
              <Smile className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Reactions")}
            </button>
          )}
        </div>

        <div className="mx-3 mb-2 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl bg-[var(--app-surface-alt)]">
          {(message.forward?.content || message.content) && (
            <button
              type="button"
              className={rowClass}
              onClick={run(() => {
                onCopy(message.forward?.content || message.content);
              })}
            >
              <Copy className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Copy Text")}
            </button>
          )}
          {shareable ? (
            <button
              type="button"
              className={rowClass}
              onClick={run(() => void shareLink({ url: messageUrl(), dialogTitle: gt("Share Message") }))}
            >
              <Share2 className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Share Message")}
            </button>
          ) : (
            <button
              type="button"
              className={rowClass}
              onClick={run(() => {
                navigator.clipboard?.writeText(messageUrl());
                toast.success(gt("Link copied"));
              })}
            >
              <Link2 className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Copy Message Link")}
            </button>
          )}
          <button
            type="button"
            className={rowClass}
            onClick={run(() => {
              navigator.clipboard?.writeText(message.id);
              toast.success(gt("Message ID copied"));
            })}
          >
            <Hash className="h-5 w-5 text-[var(--text-secondary)]" /> {gt("Copy Message ID")}
          </button>
        </div>

        {(canDelete || onReport) && (
          <div className="mx-3 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl bg-[var(--app-surface-alt)]">
            {onReport && (
              <button type="button" className={cn(rowClass, "text-red-500")} onClick={run(() => onReport(message))}>
                <Flag className="h-5 w-5" /> {gt("Report Message")}
              </button>
            )}
            {canDelete && (
            <button
              type="button"
              className={cn(rowClass, "text-red-500")}
              onClick={run(() => {
                onDelete(message);
              })}
            >
              <Trash2 className="h-5 w-5" /> {gt("Delete Message")}
            </button>
            )}
          </div>
        )}
    </MobileSheet>
  );
}
