"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/native/bridge";

/** Drag distance (px) past which releasing triggers a reply. */
export const SWIPE_REPLY_THRESHOLD = 56;
const MAX_SWIPE = 84;
const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 8;

/** Marks a touch the row consumed, so screen-level swipe navigation skips it. */
export function markRowSwipe(e: { nativeEvent: Event }) {
  (e.nativeEvent as Event & { __serikaRowSwipe?: boolean }).__serikaRowSwipe = true;
}

export function isRowSwipe(e: Event): boolean {
  return Boolean((e as Event & { __serikaRowSwipe?: boolean }).__serikaRowSwipe);
}

/**
 * Discord-mobile message gestures: drag a message to the left to reply (with a
 * haptic tick at the release point) and press-and-hold for the action sheet.
 * Touch only; mouse users keep hover actions and right-click.
 */
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
  const lock = useRef<"h" | "v" | null>(null);
  const armed = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clearPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || e.touches.length !== 1) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    lock.current = null;
    armed.current = false;
    longPressed.current = false;
    clearPress();
    if (onLongPress) {
      const { clientX, clientY } = t;
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        longPressed.current = true;
        onLongPress(clientX, clientY);
      }, LONG_PRESS_MS);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) clearPress();
    if (!lock.current) {
      if (Math.abs(dx) < MOVE_TOLERANCE && Math.abs(dy) < MOVE_TOLERANCE) return;
      // Only a leftward, mostly-horizontal drag is a reply swipe; rightward
      // drags belong to the screen (back / channel list).
      lock.current = Math.abs(dx) > Math.abs(dy) * 1.2 && dx < 0 ? "h" : "v";
    }
    if (lock.current !== "h") return;
    markRowSwipe(e);
    setDragging(true);
    const next = Math.max(-MAX_SWIPE, Math.min(0, dx * 0.7));
    setOffset(next);
    if (!armed.current && next <= -SWIPE_REPLY_THRESHOLD) {
      armed.current = true;
      haptic("light");
    } else if (armed.current && next > -SWIPE_REPLY_THRESHOLD) {
      armed.current = false;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    clearPress();
    if (lock.current === "h") markRowSwipe(e);
    const fire = armed.current;
    start.current = null;
    lock.current = null;
    armed.current = false;
    setDragging(false);
    setOffset(0);
    if (fire) onReply();
  };

  const progress = Math.min(1, Math.abs(offset) / SWIPE_REPLY_THRESHOLD);

  return (
    <div className={cn("relative", offset !== 0 && "overflow-hidden", className)}>
      {offset !== 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
          aria-hidden="true"
          style={{ opacity: progress }}
        >
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              progress >= 1 ? "bg-[var(--app-accent)] text-[var(--text-on-accent,#fff)]" : "bg-[var(--app-surface-alt)] text-[var(--text-secondary)]",
            )}
            style={{ transform: `scale(${0.6 + progress * 0.4})` }}
          >
            <Reply className="h-4 w-4" />
          </div>
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          // The finger lifting after a long-press must not also "tap" a link.
          if (longPressed.current) {
            longPressed.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={cn("relative", !dragging && "transition-transform duration-200 ease-out")}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}
