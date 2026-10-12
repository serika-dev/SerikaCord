"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { classifySwipe } from "@/lib/native/navigation";
import { gestureAxis, GESTURE_IGNORE_SELECTOR, GESTURE_SETTLE_CLASS, resistedDrag, type GestureAxis } from "@/lib/mobile/gestures";
import { isRowSwipe } from "@/components/chat/SwipeReplyRow";

/** Phone navigation follows a deliberate horizontal drag, then settles softly. */
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
  const axis = useRef<GestureAxis>(null);
  const consumed = useRef(false);
  const suppressClick = useRef(false);
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    start.current = null;
    axis.current = null;
    consumed.current = false;
    setDragging(false);
    setShift(0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    reset();
    suppressClick.current = false;
    if (!enabled || e.touches.length !== 1) return;
    const target = e.target as Element | null;
    if (target?.closest?.(GESTURE_IGNORE_SELECTOR)) return;
    if (document.querySelector('[data-message-sheet], [role="dialog"][data-state="open"]')) return;
    if (window.getSelection?.()?.isCollapsed === false) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    if (e.touches.length !== 1) {
      reset();
      return;
    }
    if (isRowSwipe(e.nativeEvent)) {
      consumed.current = true;
      setShift(0);
      return;
    }
    if (consumed.current) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    axis.current ??= gestureAxis(dx, dy);
    if (axis.current !== "horizontal") return;
    const allowed = dx > 0 ? onSwipeRight : onSwipeLeft;
    if (!allowed) {
      setShift(0);
      return;
    }
    suppressClick.current = true;
    setDragging(true);
    setShift(Math.sign(dx) * resistedDrag(Math.abs(dx) * 0.4, 64, 20));
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    const touch = e.changedTouches[0];
    const eligible = enabled && s && touch && axis.current === "horizontal" && !consumed.current && !isRowSwipe(e.nativeEvent);
    const direction = eligible ? classifySwipe({
      dx: touch.clientX - s.x,
      dy: touch.clientY - s.y,
      dt: performance.now() - s.t,
      width: window.innerWidth,
    }) : null;
    reset();
    if (window.getSelection?.()?.isCollapsed === false) return;
    if (direction === "right") onSwipeRight?.();
    else if (direction === "left") onSwipeLeft?.();
  };

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-1", !dragging && GESTURE_SETTLE_CLASS, className)}
      style={{ transform: shift ? `translate3d(${shift}px, 0, 0)` : undefined }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
