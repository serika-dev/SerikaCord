"use client";

import { Copy, Pencil, Pin, Reply, Smile, Trash2 } from "lucide-react";
import { useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";
import type { MessageContextMenuState } from "@/hooks/useMessageActions";

interface MessageContextMenuProps<M extends ChatMessage> {
  menu: MessageContextMenuState<M> | null;
  isOwn: (message: M) => boolean;
  /** Owner / MANAGE_MESSAGES — can delete other people's messages. */
  canModerate?: boolean;
  onClose: () => void;
  onReply: (message: M) => void;
  onAddReaction?: (message: M) => void;
  onCopy: (content: string) => void;
  onPinToggle: (message: M) => void;
  onEdit: (message: M) => void;
  onDelete: (message: M) => void;
}

const itemClass =
  "w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left";

/** Fixed-position right-click menu for a message. */
export function MessageContextMenu<M extends ChatMessage>({
  menu,
  isOwn,
  canModerate = false,
  onClose,
  onReply,
  onAddReaction,
  onCopy,
  onPinToggle,
  onEdit,
  onDelete,
}: MessageContextMenuProps<M>) {
  const gt = useGT();
  if (!menu) return null;

  const { message } = menu;
  const own = isOwn(message);
  const canDelete = own || canModerate;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  // Calculate position to avoid being cut off by message bar
  const menuHeight = 300;
  const menuWidth = 200;
  const padding = 10;
  const messageBarHeight = 80; // Approximate height of message bar area
  
  let left = menu.x;
  let top = menu.y;

  if (typeof window !== "undefined") {
    // Flip horizontally if too close to right edge
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }
    
    // Flip vertically if too close to bottom edge (account for message bar)
    const bottomLimit = window.innerHeight - messageBarHeight - padding;
    if (top + menuHeight > bottomLimit) {
      top = bottomLimit - menuHeight;
    }
    
    // Ensure menu doesn't go off top
    if (top < padding) {
      top = padding;
    }
  }

  return (
    <div
      className="fixed z-[9999] min-w-[180px] py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md shadow-xl"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={run(() => onReply(message))} className={itemClass}>
        <Reply className="w-4 h-4" /> {gt("Reply")}
      </button>
      {onAddReaction && (
        <button onClick={run(() => onAddReaction(message))} className={itemClass}>
          <Smile className="w-4 h-4" /> {gt("Add Reaction")}
        </button>
      )}
      <button onClick={run(() => onCopy(message.content))} className={itemClass}>
        <Copy className="w-4 h-4" /> {gt("Copy Text")}
      </button>
      <div className="h-px bg-[var(--border-subtle)] my-1" />
      <button onClick={run(() => onPinToggle(message))} className={itemClass}>
        <Pin className="w-4 h-4" /> {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
      </button>
      {(own || canDelete) && (
        <div className="h-px bg-[var(--border-subtle)] my-1" />
      )}
      {own && (
        <button onClick={run(() => onEdit(message))} className={itemClass}>
          <Pencil className="w-4 h-4" /> {gt("Edit Message")}
        </button>
      )}
      {canDelete && (
        <button
          onClick={run(() => onDelete(message))}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors text-left"
        >
          <Trash2 className="w-4 h-4" /> {gt("Delete Message")}
        </button>
      )}
    </div>
  );
}
