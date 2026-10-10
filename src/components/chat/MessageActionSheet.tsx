"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Hash, Link2, MessagesSquare, Pencil, Pin, Reply, Share2, SmilePlus, Trash2, CornerUpRight } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { canShare, haptic, shareLink } from "@/lib/native/bridge";
import { useBackHandler } from "@/hooks/useBackHandler";
import type { ChatMessage } from "@/lib/chat/types";
import { requestForward } from "@/lib/chat/forwardBus";

/** Discord-style quick reactions at the top of the sheet. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;

const DISMISS_DRAG_PX = 90;

/** Whether `userId` already reacted to `message` with this unicode emoji. */
export function hasReactedWith(message: ChatMessage, emoji: string, userId?: string): boolean {
  if (!userId) return false;
  const reaction = message.reactions?.find((r) => !r.emoji.id && r.emoji.name === emoji);
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
  onToggleReaction?: (message: M, emoji: string, hasReacted: boolean) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  /** Start a thread from the message (omitted where threads aren't allowed). */
  onCreateThread?: (message: M) => void;
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
  onToggleReaction,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
  onCreateThread,
}: MessageActionSheetProps<M>) {
  const gt = useGT();
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const shareable = canShare();

  useBackHandler(true, onClose);

  // A firm tick when the sheet appears, like a native long-press menu.
  useEffect(() => {
    haptic("medium");
  }, [message.id]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const messageUrl = () => `${window.location.origin}${window.location.pathname}?jump=${message.id}`;

  const onDragStart = (e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
  };
  const onDragMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStart.current));
  };
  const onDragEnd = () => {
    const close = dragY > DISMISS_DRAG_PX;
    dragStart.current = null;
    setDragY(0);
    if (close) onClose();
  };

  const rowClass =
    "flex w-full items-center gap-3 px-4 h-12 text-left text-[15px] font-medium text-[var(--text-primary)] active:bg-[var(--bg-hover)] touch-manipulation";

  return (
    <div
      className="fixed inset-0 z-[9999] md:hidden"
      data-message-sheet=""
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label={gt("Message actions")}
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--app-border)] bg-[var(--app-surface)] shadow-2xl",
          "animate-in slide-in-from-bottom duration-200 ease-out",
          dragY === 0 && "transition-transform duration-200",
        )}
        style={{ transform: `translateY(${dragY}px)`, paddingBottom: "max(0.75rem, var(--safe-area-bottom))" }}
      >
        <div
          className="flex justify-center pb-3 pt-2.5"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
        >
          <div className="h-1 w-10 rounded-full bg-[var(--app-border)]" />
        </div>

        {onToggleReaction && (
          <div
            className="flex items-center justify-between gap-1.5 px-4 pb-3"
            onTouchStart={onDragStart}
            onTouchMove={onDragMove}
            onTouchEnd={onDragEnd}
            onTouchCancel={onDragEnd}
          >
            {QUICK_REACTIONS.map((emoji) => {
              const reacted = hasReactedWith(message, emoji, currentUserId);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={gt("React")}
                  aria-pressed={reacted}
                  onClick={run(() => onToggleReaction(message, emoji, reacted))}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full text-[22px] transition-transform active:scale-90 touch-manipulation",
                    reacted
                      ? "bg-[var(--app-accent)]/20 ring-1 ring-[var(--app-accent)]"
                      : "bg-[var(--app-surface-alt)]",
                  )}
                >
                  {emoji}
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
        </div>

        <div className="mx-3 mb-2 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl bg-[var(--app-surface-alt)]">
          {(message.forward?.content || message.content) && (
            <button
              type="button"
              className={rowClass}
              onClick={run(() => {
                haptic("light");
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

        {canDelete && (
          <div className="mx-3 overflow-hidden rounded-xl bg-[var(--app-surface-alt)]">
            <button
              type="button"
              className={cn(rowClass, "text-red-500")}
              onClick={run(() => {
                haptic("warning");
                onDelete(message);
              })}
            >
              <Trash2 className="h-5 w-5" /> {gt("Delete Message")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
