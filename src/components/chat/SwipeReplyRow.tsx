"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { gestureAxis, GESTURE_IGNORE_SELECTOR, GESTURE_SETTLE_CLASS, GESTURE_SLOP, resistedDrag, type GestureAxis } from "@/lib/mobile/gestures";

/** Drag distance (px) past which releasing triggers a reply. */
export const SWIPE_REPLY_THRESHOLD = 56;
const LONG_PRESS_MS = 420;

/** Marks a touch the row consumed, so screen-level swipe navigation skips it. */
export function markRowSwipe(e: { nativeEvent: Event }) {
  (e.nativeEvent as Event & { __serikaRowSwipe?: boolean }).__serikaRowSwipe = true;
}

export function isRowSwipe(e: Event): boolean {
  return Boolean((e as Event & { __serikaRowSwipe?: boolean }).__serikaRowSwipe);
}

/** Touch-only reply and long-press gestures, with visual readiness feedback. */
export function SwipeReplyRow({
  children,
  onReply,
  onLongPress,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  onReply: () => void;
  onLongPress?: (x: number, y: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<GestureAxis>(null);
  const replying = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const clearPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const reset = () => {
    clearPress();
    start.current = null;
    axis.current = null;
    replying.current = false;
    setDragging(false);
    setOffset(0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    reset();
    suppressClick.current = false;
    if (disabled || e.touches.length !== 1) return;
    if ((e.target as Element | null)?.closest?.(GESTURE_IGNORE_SELECTOR)) return;
    if (window.getSelection?.()?.isCollapsed === false) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    if (onLongPress) {
      const { clientX, clientY } = t;
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        suppressClick.current = true;
        start.current = null;
        onLongPress(clientX, clientY);
      }, LONG_PRESS_MS);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    if (e.touches.length !== 1 || disabled) {
      reset();
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= GESTURE_SLOP) clearPress();
    if (!axis.current) {
      axis.current = gestureAxis(dx, dy);
      // Rightward drags remain owned by page navigation for this whole touch.
      replying.current = axis.current === "horizontal" && dx < 0;
    }
    if (!replying.current) return;
    markRowSwipe(e);
    suppressClick.current = true;
    setDragging(true);
    setOffset(-resistedDrag(-dx * 0.75, SWIPE_REPLY_THRESHOLD, 28));
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    const touch = e.changedTouches[0];
    if (replying.current || suppressClick.current) markRowSwipe(e);
    // Read the final position: moving back below the threshold disarms reply.
    const fire = !disabled && replying.current && s && touch && (s.x - touch.clientX) * 0.75 >= SWIPE_REPLY_THRESHOLD;
    reset();
    if (fire) onReply();
  };

  const progress = Math.min(1, Math.abs(offset) / SWIPE_REPLY_THRESHOLD);

  return (
    <div className={cn("relative", className)}>
      <div
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center transition-opacity duration-200 motion-reduce:transition-none"
        aria-hidden="true"
        style={{ opacity: progress }}
      >
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,transform] duration-200 motion-reduce:transition-none",
            progress >= 1 ? "bg-[var(--app-accent)] text-[var(--text-on-accent)]" : "bg-[var(--app-surface-alt)] text-[var(--text-secondary)]",
          )}
          style={{ transform: `scale(${0.65 + progress * 0.35}) rotate(${(1 - progress) * 30}deg)` }}
        >
          <Reply className="h-4 w-4" />
        </div>
      </div>
      <div
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
        className={cn("relative", !dragging && GESTURE_SETTLE_CLASS)}
        style={{ transform: offset ? `translate3d(${offset}px, 0, 0)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
