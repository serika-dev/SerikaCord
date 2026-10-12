"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { gestureAxis, type GestureAxis } from "@/lib/mobile/gestures";

/** Distance (px, after resistance) that triggers a refresh on release. */
export const PULL_THRESHOLD = 72;
const MAX_PULL = 120;
// Lists use buttons for their rows; pulling on one must still refresh.
const IGNORE_PULL_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-no-pull-refresh], [role="slider"], audio, video';

/** Rubber-band resistance: the indicator moves slower than the finger. */
export function pullResistance(rawDy: number): number {
  if (rawDy <= 0) return 0;
  return Math.min(MAX_PULL, rawDy * 0.5);
}

/** A deliberate downward pull at the top refreshes once when released. */
export function usePullToRefresh(scrollRef: RefObject<HTMLElement | null>, onRefresh: () => unknown) {
  const [pullDistance, setPullDistance] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<GestureAxis>(null);
  const distance = useRef(0);
  const refreshing = useRef(false);

  const reset = useCallback(() => {
    start.current = null;
    axis.current = null;
    distance.current = 0;
    setPullDistance(0);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    reset();
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0 || e.touches.length !== 1 || refreshing.current) return;
    if ((e.target as Element | null)?.closest?.(IGNORE_PULL_SELECTOR)) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, [scrollRef, reset]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = start.current;
    const el = scrollRef.current;
    if (!s || !el) return;
    if (el.scrollTop > 0 || e.touches.length !== 1) {
      reset();
      return;
    }
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    axis.current ??= gestureAxis(dx, dy);
    if (axis.current === "horizontal" || dy < -8) {
      reset();
      return;
    }
    if (axis.current !== "vertical") return;
    const next = pullResistance(dy);
    distance.current = next;
    setPullDistance(next);
  }, [scrollRef, reset]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = start.current;
    const touch = e.changedTouches[0];
    const trigger = s && touch && axis.current === "vertical" && distance.current >= PULL_THRESHOLD && pullResistance(touch.clientY - s.y) >= PULL_THRESHOLD;
    reset();
    if (trigger && !refreshing.current) {
      refreshing.current = true;
      // The caller owns error presentation. Always release the gesture lock.
      Promise.resolve().then(onRefresh).then(
        () => { refreshing.current = false; },
        () => { refreshing.current = false; },
      );
    }
  }, [onRefresh, reset]);

  return {
    pullDistance,
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset },
  };
}
