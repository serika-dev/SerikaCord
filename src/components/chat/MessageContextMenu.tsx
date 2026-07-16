"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Copy, Link2, Pencil, Pin, Reply, Smile, Trash2, Hash } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";
import type { MessageContextMenuState } from "@/hooks/useMessageActions";

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
}

const itemClass =
  "w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left";

/** Fixed-position right-click menu for a message. */
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
}: MessageContextMenuProps<M>) {
  const gt = useGT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;

    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    const padding = 8;
    const messageBarHeight = 70;

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

    // Flip vertically if too close to bottom edge — open upward instead
    const bottomLimit = window.innerHeight - messageBarHeight - padding;
    if (top + menuHeight > bottomLimit) {
      top = menu.y - menuHeight;
    }
    // Clamp to viewport
    if (top < padding) top = padding;
    if (top + menuHeight > bottomLimit) {
      top = bottomLimit - menuHeight;
    }

    setPos({ left, top });
  }, [menu]);

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

  const { message } = menu;
  const own = isOwn(message);
  const canDelete = own || canModerate;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md shadow-xl"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? "visible" : "hidden" }}
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
      <button
        onClick={run(() => {
          navigator.clipboard?.writeText(message.id);
          toast.success(gt("Message ID copied"));
        })}
        className={itemClass}
      >
        <Hash className="w-4 h-4" /> {gt("Copy Message ID")}
      </button>
      {canPin && (
        <>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
          <button onClick={run(() => onPinToggle(message))} className={itemClass}>
            <Pin className="w-4 h-4" /> {message.pinned ? gt("Unpin Message") : gt("Pin Message")}
          </button>
        </>
      )}
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
          onClick={(e) => {
            if ((e.shiftKey || e.ctrlKey) && onDeleteNow) {
              onDeleteNow(message);
            } else {
              onDelete(message);
            }
            onClose();
          }}
          title={gt("Shift+Click to delete instantly")}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors text-left"
        >
          <Trash2 className="w-4 h-4" /> {gt("Delete Message")}
        </button>
      )}
    </div>
  );
}
