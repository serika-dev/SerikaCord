"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { gestureAxis, GESTURE_SETTLE_CLASS, resistedDrag } from "@/lib/mobile/gestures";
import { markRowSwipe } from "@/components/chat/SwipeReplyRow";

export interface SwipeAction {
  icon: React.ReactNode;
  label: string;
  /** Tailwind background class using the action's theme token. */
  className: string;
  onAction: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  /** Actions revealed by swiping left, rendered right-to-left */
  actions: SwipeAction[];
  disabled?: boolean;
  className?: string;
}

const ACTION_WIDTH = 72;

/**
 * iOS-style swipe-to-reveal actions for list rows on touch devices.
 * Swipe left to reveal the action buttons; tap the row or swipe right to
 * close. Mouse users are unaffected (touch events only) — desktop should
 * provide the same actions through hover buttons or menus.
 */
export function SwipeableRow({ children, actions, disabled = false, className }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; offset: number } | null>(null);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const claimed = useRef(false);
  const suppressClick = useRef(false);

  const maxOffset = actions.length * ACTION_WIDTH;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      const originalOffset = startRef.current?.offset;
      startRef.current = null;
      directionLocked.current = null;
      claimed.current = false;
      setIsDragging(false);
      if (originalOffset !== undefined) setOffset(originalOffset);
      return;
    }
    startRef.current = null;
    directionLocked.current = null;
    claimed.current = false;
    suppressClick.current = false;
    if (disabled || actions.length === 0) return;
    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY, offset };
    directionLocked.current = null;
  }, [disabled, actions.length, offset]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;
    if (e.touches.length !== 1) {
      startRef.current = null;
      directionLocked.current = null;
      setIsDragging(false);
      setOffset(start.offset);
      return;
    }
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (!directionLocked.current) {
      directionLocked.current = gestureAxis(dx, dy);
      claimed.current = directionLocked.current === "horizontal" && (start.offset !== 0 || dx < 0);
    }
    // A rightward drag on a closed row belongs to page navigation.
    if (!claimed.current) return;

    markRowSwipe(e);
    suppressClick.current = true;
    setIsDragging(true);
    // Negative offset slides content left; clamp with soft resistance past max
    const raw = start.offset + dx;
    const clamped = -resistedDrag(-raw, maxOffset, 24);
    setOffset(clamped);
  }, [maxOffset]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (suppressClick.current) markRowSwipe(e);
    startRef.current = null;
    directionLocked.current = null;
    setIsDragging(false);
    // Snap open if past half of the action area, otherwise closed
    setOffset((current) => (current < -maxOffset / 2 ? -maxOffset : 0));
  }, [maxOffset]);

  const handleTouchCancel = useCallback(() => {
    const originalOffset = startRef.current?.offset;
    startRef.current = null;
    directionLocked.current = null;
    setIsDragging(false);
    if (originalOffset !== undefined) setOffset(originalOffset);
  }, []);

  const close = useCallback(() => setOffset(0), []);

  const isOpen = actions.length > 0 && offset <= -maxOffset;

  // Only clip while the row is displaced. A permanent overflow-hidden would
  // also clip hover toolbars/popovers that children position outside the row.
  const isDisplaced = offset !== 0;

  return (
    <div className={cn("relative", isDisplaced && "overflow-hidden", className)}>
      {/* Action buttons behind the row */}
      {actions.length > 0 && isDisplaced && (
        <div className="absolute inset-y-0 right-0 flex" aria-hidden={!isOpen}>
          {actions.map((action) => {
            return (
              <button
                key={action.label}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => {
                  close();
                  action.onAction();
                }}
                aria-label={action.label}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-white text-[10px] font-medium active:brightness-90 transition-[filter]",
                  action.className
                )}
                style={{ width: ACTION_WIDTH }}
              >
                {action.icon}
                {action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Row content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClickCapture={(e) => {
          // A tap while open just closes the row
          if (suppressClick.current || isOpen) {
            e.stopPropagation();
            e.preventDefault();
            if (!suppressClick.current) close();
            suppressClick.current = false;
          }
        }}
        className={cn(
          "relative",
          // Opaque background only while sliding, so the buttons stay hidden
          // behind the row; when idle it must not mask hover highlights.
          isDisplaced && "bg-[var(--bg-app)]",
          !isDragging && GESTURE_SETTLE_CLASS
        )}
        style={{ transform: offset ? `translate3d(${offset}px, 0, 0)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
