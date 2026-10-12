"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useBackHandler } from "@/hooks/useBackHandler";

import { gestureAxis, GESTURE_IGNORE_SELECTOR, shouldDismissSheet, type GestureAxis } from "@/lib/mobile/gestures";

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
  containerClassName,
}: {
  onClose: () => void;
  /** Accessible name of the sheet. */
  label: string;
  /** Pinned above the scrolling body (and draggable). */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const reducedMotion = useReducedMotion();
  const sheet = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; lastY: number; lastTime: number; velocity: number } | null>(null);
  const axis = useRef<GestureAxis>(null);
  const closeRequested = useRef(false);
  const closeFinished = useRef(false);
  const suppressClick = useRef(false);

  const requestClose = useCallback(() => {
    if (closeRequested.current) return;
    closeRequested.current = true;
    setDragging(false);
    setClosing(true);
  }, []);
  useBackHandler(true, requestClose);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
      if (event.key !== "Tab" || !sheet.current) return;
      const focusable = Array.from(sheet.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [requestClose]);

  const cancelDrag = () => {
    dragStart.current = null;
    axis.current = null;
    setDragging(false);
    setDragY(0);
  };
  const onDragStart = (e: React.TouchEvent) => {
    cancelDrag();
    suppressClick.current = false;
    if (e.touches.length !== 1 || closing || (e.target as Element).closest(GESTURE_IGNORE_SELECTOR)) return;
    const touch = e.touches[0];
    dragStart.current = { x: touch.clientX, y: touch.clientY, lastY: touch.clientY, lastTime: performance.now(), velocity: 0 };
  };
  const onDragMove = (e: React.TouchEvent) => {
    const start = dragStart.current;
    if (!start) return;
    if (e.touches.length !== 1) {
      cancelDrag();
      return;
    }
    const touch = e.touches[0];
    const dy = touch.clientY - start.y;
    axis.current ??= gestureAxis(touch.clientX - start.x, dy);
    if (axis.current !== "vertical") return;
    const now = performance.now();
    start.velocity = (touch.clientY - start.lastY) / Math.max(1, now - start.lastTime);
    start.lastTime = now;
    start.lastY = touch.clientY;
    suppressClick.current = true;
    setDragging(true);
    setDragY(Math.max(0, dy));
  };
  const onDragEnd = (e: React.TouchEvent) => {
    const start = dragStart.current;
    const touch = e.changedTouches[0];
    const distance = start && touch ? Math.max(0, touch.clientY - start.y) : 0;
    const velocity = start && performance.now() - start.lastTime < 100 ? start.velocity : 0;
    const dismiss = axis.current === "vertical" && shouldDismissSheet(distance, velocity);
    cancelDrag();
    if (dismiss) requestClose();
  };
  const dragHandlers = { onTouchStart: onDragStart, onTouchMove: onDragMove, onTouchEnd: onDragEnd, onTouchCancel: cancelDrag };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-[9990]", containerClassName)}
      data-message-sheet=""
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onPointerDownCapture={() => { suppressClick.current = false; }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <motion.div
        className="absolute inset-0 bg-black/50 touch-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : Math.max(0.15, 1 - dragY / 450) }}
        transition={{ duration: reducedMotion || dragging ? 0 : 0.2 }}
        onClick={requestClose}
        aria-hidden="true"
      />
      <motion.div
        ref={sheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-app)] shadow-2xl",
          "outline-none",
          className,
        )}
        initial={{ y: reducedMotion ? 0 : "100%" }}
        animate={{ y: closing ? "100%" : dragY }}
        transition={reducedMotion || dragging ? { duration: 0 } : closing ? { duration: 0.22, ease: [0.32, 0, 0.67, 0] } : { type: "spring", stiffness: 390, damping: 36, mass: 0.9 }}
        onAnimationComplete={() => {
          if (closing && !closeFinished.current) {
            closeFinished.current = true;
            onClose();
          }
        }}
      >
        <div {...dragHandlers} className="shrink-0 touch-none select-none">
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
      </motion.div>
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
