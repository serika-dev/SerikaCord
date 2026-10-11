"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useBackHandler } from "@/hooks/useBackHandler";

const DISMISS_DRAG_PX = 90;

/**
 * Discord-style bottom sheet for phones: dimmed backdrop, grab handle, drag
 * down / tap outside / Android back to close, safe-area aware and scrollable
 * when its content is taller than the screen. Render it only while open.
 */
export function MobileSheet({
  onClose,
  label,
  header,
  children,
  className,
}: {
  onClose: () => void;
  /** Accessible name of the sheet. */
  label: string;
  /** Pinned above the scrolling body (and draggable). */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  useBackHandler(true, onClose);

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
  const dragHandlers = { onTouchStart: onDragStart, onTouchMove: onDragMove, onTouchEnd: onDragEnd, onTouchCancel: onDragEnd };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9990]"
      data-message-sheet=""
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-150" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-app)] shadow-2xl",
          "animate-in slide-in-from-bottom duration-200 ease-out",
          dragY === 0 && "transition-transform duration-200",
          className,
        )}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
      >
        <div {...dragHandlers} className="shrink-0">
          <div className="flex justify-center pb-2 pt-2.5">
            <div className="h-1 w-10 rounded-full bg-[var(--border-subtle)]" />
          </div>
          {header}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: "max(0.75rem, var(--safe-area-bottom))" }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A rounded group of sheet rows (Discord's grouped list). */
export function SheetGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-2 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl bg-[var(--bg-card)]">
      {children}
    </div>
  );
}

/** One tappable row in a sheet. */
export function SheetRow({
  icon: Icon,
  label,
  onClick,
  danger,
  trailing,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 w-full touch-manipulation items-center gap-3 px-4 text-left text-[15px] font-medium active:bg-[var(--bg-hover)]",
        danger ? "text-red-500" : "text-[var(--text-primary)]",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0", danger ? "text-red-500" : "text-[var(--text-secondary)]")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
