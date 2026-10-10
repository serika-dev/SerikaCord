"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Copy, Link2, MessagesSquare, Pencil, Pin, Reply, Smile, Trash2, Hash, CornerUpRight, Download, ExternalLink, EyeOff, Flag, Image as ImageIcon, SmilePlus, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";
import type { MessageContextMenuState } from "@/hooks/useMessageActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAuth } from "@/contexts/AuthContext";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { isForwardable } from "@/lib/chat/forward";
import { requestForward } from "@/lib/chat/forwardBus";
import { cdnImage, cn } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { emojiToken, quickReactions, type FrecencyEmoji } from "@/lib/chat/emojiFrecency";
import { recordEmoji, useFrecentEmojis } from "@/lib/chat/emojiFrecencyStore";
import { copyImageToClipboard, saveImage } from "@/lib/chat/imageActions";

interface MessageContextMenuProps<M extends ChatMessage> {
  menu: MessageContextMenuState<M> | null;
  isOwn: (message: M) => boolean;
  /** Owner / MANAGE_MESSAGES — can delete other people's messages. */
  canModerate?: boolean;
  /** Owner / MANAGE_MESSAGES / PIN_MESSAGES — can pin or unpin messages. */
  canPin?: boolean;
  onClose: () => void;
  onReply: (message: M) => void;
  onAddReaction?: (message: M) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
  /** Instant delete without a confirm prompt (Shift+Delete). */
  onDeleteNow?: (message: M) => void;
  /** Quick-reaction row (desktop menu and phone sheet). */
  onToggleReaction?: (message: M, emoji: string, hasReacted: boolean) => void;
  /** "Mark Unread": the conversation is unread again from this message. */
  onMarkUnread?: (message: M) => void;
  /** "Reactions": who reacted, per emoji. */
  onViewReactions?: (message: M) => void;
  /** "Report Message" (not on your own messages). */
  onReport?: (message: M) => void;
  currentUserId?: string;
  /** Text channels where the viewer may start threads: "Create Thread". */
  onCreateThread?: (message: M) => void;
  /** Open the thread a message started. */
  onOpenThread?: (threadId: string) => void;
}

const itemClass = "ctx-item";

/** Whether `userId` already reacted to `message` with this emoji. */
export function hasReacted(message: ChatMessage, emoji: FrecencyEmoji, userId?: string): boolean {
  if (!userId) return false;
  const reaction = message.reactions?.find((r) =>
    emoji.kind === "custom" ? r.emoji.id === emoji.id : !r.emoji.id && r.emoji.name === emoji.emoji,
  );
  return Boolean(reaction?.userIds?.includes(userId));
}

/** Right-click menu for a message; a bottom action sheet on phones (long-press). */
export function MessageContextMenu<M extends ChatMessage>({
  menu,
  isOwn,
  canModerate = false,
  canPin = false,
  onClose,
  onReply,
  onAddReaction,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
  onDeleteNow,
  onToggleReaction,
  onMarkUnread,
  onViewReactions,
  onReport,
  currentUserId,
  onCreateThread,
  onOpenThread,
}: MessageContextMenuProps<M>) {
  const gt = useGT();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const frecent = useFrecentEmojis();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current || isMobile) return;

    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    const padding = 8;

    let left = menu.x;
    let top = menu.y;

    // Flip horizontally if too close to right edge — open leftward instead
    if (left + menuWidth > window.innerWidth - padding) {
      left = menu.x - menuWidth;
    }
    // Clamp to viewport
    if (left < padding) left = padding;
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }

    // Flip vertically if too close to the bottom edge — open upward instead
    const bottomLimit = window.innerHeight - padding;
    if (top + menuHeight > bottomLimit) {
      top = menu.y - menuHeight;
    }
    // Clamp to viewport
    if (top < padding) top = padding;
    if (top + menuHeight > bottomLimit) {
      top = Math.max(padding, bottomLimit - menuHeight);
    }

    setPos({ left, top });
  }, [menu, isMobile]);

  // Close on Escape
  useEffect(() => {
    if (!menu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
  }, [menu, onClose]);

  if (!menu) return null;

  const { message, target } = menu;
  const own = isOwn(message);
  const canDelete = own || canModerate;
  const threadId = message.thread?.id ?? message.threadId;
  const startThread =
    onCreateThread && !threadId && !message.pending && !message.ephemeral && !message.id.startsWith("temp-")
      ? onCreateThread
      : undefined;
  const forwardable = isForwardable(message);
  // Polls and forwards have no text of their own to edit (like Discord).
  const editable = own && !message.poll && !message.forward;
  const copyText = message.forward?.content || message.content;
  const isSaved = !message.pending && !message.ephemeral && !message.id.startsWith("temp-");
  const hasReactions = (message.reactions?.length ?? 0) > 0;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const react = (emoji: FrecencyEmoji) => {
    if (!onToggleReaction) return;
    const reacted = hasReacted(message, emoji, currentUserId);
    if (!reacted) recordEmoji(emoji);
    onToggleReaction(message, emojiToken(emoji), reacted);
  };
  const speak = () => {
    const text = decodeHtmlEntities(message.content || "").replace(/^\/tts\s+/, "");
    if (!text.trim()) return;
    void import("@/lib/chat/tts")
      .then(({ playTts }) =>
        playTts({
          content: text,
          authorName: message.author?.displayName || message.author?.username,
          rate: user?.settings?.accessibility?.ttsRate,
          voiceGender: user?.settings?.accessibility?.ttsVoice,
        }),
      )
      .catch(() => toast.error(gt("Text-to-speech isn't available here.")));
  };

  if (isMobile) {
    return (
      <MessageActionSheet
        message={message}
        own={own}
        editable={editable}
        forwardable={forwardable}
        canDelete={canDelete}
        canPin={canPin}
        currentUserId={currentUserId}
        quickReactions={quickReactions(frecent, 5)}
        onClose={onClose}
        onReply={onReply}
        onAddReaction={onAddReaction}
        onReact={onToggleReaction ? react : undefined}
        onCopy={onCopy}
        onPinToggle={onPinToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        onCreateThread={startThread}
        onMarkUnread={isSaved ? onMarkUnread : undefined}
        onViewReactions={hasReactions ? onViewReactions : undefined}
        onReport={!own && isSaved ? onReport : undefined}
      />
    );
  }

  const quick = onToggleReaction && isSaved ? quickReactions(frecent, 4) : [];

  return (
    <div
      ref={menuRef}
      className="ctx-menu fixed z-[9999] min-w-[200px] max-h-[calc(100dvh-16px)] overflow-y-auto"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? "visible" : "hidden" }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {quick.length > 0 && (
        <>
          <div className="flex items-center gap-1 px-1 pb-1">
            {quick.map((emoji) => {
              const reacted = hasReacted(message, emoji, currentUserId);
              return (
                <button
                  key={emoji.kind === "custom" ? emoji.id : emoji.emoji}
                  type="button"
                  onClick={run(() => react(emoji))}
                  aria-pressed={reacted}
                  title={emoji.kind === "custom" ? `:${emoji.name}:` : emoji.emoji}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-xl transition-colors",
                    reacted
                      ? "bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)]"
                      : "bg-[var(--app-surface-alt)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  {emoji.kind === "custom" ? (
                    <img src={cdnImage(emoji.url)} alt={`:${emoji.name}:`} className="h-6 w-6 object-contain" />
                  ) : (
                    <span className="leading-none">{emoji.emoji}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="ctx-sep" />
        </>
      )}
      {onAddReaction && (
        <button onClick={run(() => onAddReaction(message))} className={itemClass}>
          <Smile className="w-4 h-4" /> {gt("Add Reaction")}
        </button>
      )}
      {hasReactions && onViewReactions && (
        <button onClick={run(() => onViewReactions(message))} className={itemClass}>
          <SmilePlus className="w-4 h-4" /> {gt("Reactions")}
        </button>
      )}
      {editable && (
        <button onClick={run(() => onEdit(message))} className={itemClass}>
          <Pencil className="w-4 h-4" /> {gt("Edit Message")}
        </button>
      )}
      <button onClick={run(() => onReply(message))} className={itemClass}>
        <Reply className="w-4 h-4" /> {gt("Reply")}
      </button>
      {forwardable && (
        <button onClick={run(() => requestForward(message))} className={itemClass}>
          <CornerUpRight className="w-4 h-4" /> {gt("Forward")}
        </button>
      )}
      {startThread && (
        <button onClick={run(() => startThread(message))} className={itemClass}>
          <MessagesSquare className="w-4 h-4" /> {gt("Create Thread")}
        </button>
      )}
      {threadId && onOpenThread && message.thread !== null && (
        <button onClick={run(() => onOpenThread(threadId))} className={itemClass}>
          <MessagesSquare className="w-4 h-4" /> {gt("Open Thread")}
        </button>
      )}
      {canPin && (
        <button onClick={run(() => onPinToggle(message))} className={itemClass}>
          <Pin className="w-4 h-4" /> {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
        </button>
      )}
      <div className="ctx-sep" />
      {copyText && (
        <button onClick={run(() => onCopy(decodeHtmlEntities(copyText)))} className={itemClass}>
          <Copy className="w-4 h-4" /> {gt("Copy Text")}
        </button>
      )}
      {isSaved && onMarkUnread && (
        <button onClick={run(() => onMarkUnread(message))} className={itemClass} title={gt("Alt+Click a message to mark it unread")}>
          <EyeOff className="w-4 h-4" /> {gt("Mark Unread")}
        </button>
      )}
      <button
        onClick={run(() => {
          const url = `${window.location.origin}${window.location.pathname}?jump=${message.id}`;
          navigator.clipboard?.writeText(url);
          toast.success(gt("Link copied"));
        })}
        className={itemClass}
      >
        <Link2 className="w-4 h-4" /> {gt("Copy Message Link")}
      </button>
      {message.content && (
        <button onClick={run(speak)} className={itemClass}>
          <Volume2 className="w-4 h-4" /> {gt("Speak Message")}
        </button>
      )}
      {target?.imageUrl && (
        <>
          <div className="ctx-sep" />
          <button
            onClick={run(() => {
              const url = target.imageUrl!;
              void copyImageToClipboard(url)
                .then((what) => toast.success(what === "image" ? gt("Image copied") : gt("Image link copied")))
                .catch(() => toast.error(gt("Couldn't copy the image")));
            })}
            className={itemClass}
          >
            <ImageIcon className="w-4 h-4" /> {gt("Copy Image")}
          </button>
          <button onClick={run(() => void saveImage(target.imageUrl!))} className={itemClass}>
            <Download className="w-4 h-4" /> {gt("Save Image")}
          </button>
        </>
      )}
      {target?.linkUrl && (
        <>
          {!target.imageUrl && <div className="ctx-sep" />}
          <button
            onClick={run(() => {
              navigator.clipboard?.writeText(target.linkUrl!);
              toast.success(gt("Link copied"));
            })}
            className={itemClass}
          >
            <Link2 className="w-4 h-4" /> {gt("Copy Link")}
          </button>
          <button onClick={run(() => void window.open(target.linkUrl!, "_blank", "noopener,noreferrer"))} className={itemClass}>
            <ExternalLink className="w-4 h-4" /> {gt("Open Link")}
          </button>
        </>
      )}
      {((canDelete && isSaved) || (!own && isSaved && onReport)) && <div className="ctx-sep" />}
      {canDelete && (
        <button
          onClick={(e) => {
            if ((e.shiftKey || e.ctrlKey) && onDeleteNow) {
              onDeleteNow(message);
            } else {
              onDelete(message);
            }
            onClose();
          }}
          title={gt("Shift+Click to delete instantly")}
          className="ctx-item ctx-item-danger"
        >
          <Trash2 className="w-4 h-4" /> {gt("Delete Message")}
        </button>
      )}
      {!own && isSaved && onReport && (
        <button onClick={run(() => onReport(message))} className="ctx-item ctx-item-danger">
          <Flag className="w-4 h-4" /> {gt("Report Message")}
        </button>
      )}
      <div className="ctx-sep" />
      <button
        onClick={run(() => {
          navigator.clipboard?.writeText(message.id);
          toast.success(gt("Message ID copied"));
        })}
        className={itemClass}
      >
        <Hash className="w-4 h-4" /> {gt("Copy Message ID")}
      </button>
    </div>
  );
}
