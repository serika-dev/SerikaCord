"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/native/bridge";
import { classifySwipe } from "@/lib/native/navigation";
import { isRowSwipe } from "@/components/chat/SwipeReplyRow";

/** Touches starting here never navigate (typing, sliders, horizontal scrollers). */
const IGNORE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-no-swipe], [role="slider"], pre, code';

/**
 * Screen-level swipe navigation for phone layouts, Discord style: swipe right
 * to go back to the channel list, swipe left for the member list. The content
 * follows the finger a little so the gesture feels physical. Message rows
 * consume their own left swipes (reply), so those never reach here.
 */
export function SwipeNav({
  children,
  onSwipeRight,
  onSwipeLeft,
  enabled = true,
  className,
}: {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  enabled?: boolean;
  className?: string;
}) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const consumed = useRef(false);
  const [shift, setShift] = useState(0);

  const reset = () => {
    start.current = null;
    consumed.current = false;
    setShift(0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!enabled || e.touches.length !== 1) return;
    const target = e.target as Element | null;
    if (target?.closest?.(IGNORE_SELECTOR)) return;
    // Text being selected, or an overlay open: leave the touch alone.
    if (document.querySelector('[data-message-sheet], [role="dialog"][data-state="open"]')) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    consumed.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    if (isRowSwipe(e.nativeEvent)) {
      consumed.current = true;
      if (shift) setShift(0);
      return;
    }
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (shift) setShift(0);
      return;
    }
    if (dx > 0 && onSwipeRight) setShift(Math.min(48, dx * 0.25));
    else if (dx < 0 && onSwipeLeft) setShift(Math.max(-48, dx * 0.25));
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s || consumed.current || isRowSwipe(e.nativeEvent)) {
      reset();
      return;
    }
    const touch = e.changedTouches[0];
    const direction = classifySwipe({
      dx: touch.clientX - s.x,
      dy: touch.clientY - s.y,
      dt: Date.now() - s.t,
      width: window.innerWidth,
    });
    reset();
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    if (direction === "right" && onSwipeRight) {
      haptic("light");
      onSwipeRight();
    } else if (direction === "left" && onSwipeLeft) {
      haptic("light");
      onSwipeLeft();
    }
  };

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-1", shift === 0 && "transition-transform duration-200 ease-out", className)}
      style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
    >
      {children}
    </div>
  );
}
