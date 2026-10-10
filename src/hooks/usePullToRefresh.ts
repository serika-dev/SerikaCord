"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { haptic } from "@/lib/native/bridge";

/** Distance (px, after resistance) that triggers a refresh on release. */
export const PULL_THRESHOLD = 72;
const MAX_PULL = 120;

/** Rubber-band resistance: the indicator moves slower than the finger. */
export function pullResistance(rawDy: number): number {
  if (rawDy <= 0) return 0;
  return Math.min(MAX_PULL, rawDy * 0.5);
}

/**
 * Native-feeling pull-to-refresh for a scroll container: only engages when the
 * list is scrolled to the very top and the drag is mostly vertical, ticks a
 * haptic when the release point is reached, then calls `onRefresh`.
 */
export function usePullToRefresh(scrollRef: RefObject<HTMLElement | null>, onRefresh: () => unknown) {
  const [pullDistance, setPullDistance] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const distance = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0 || e.touches.length !== 1) {
      start.current = null;
      return;
    }
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    armed.current = false;
    distance.current = 0;
  }, [scrollRef]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = start.current;
    const el = scrollRef.current;
    if (!s || !el) return;
    if (el.scrollTop > 0) {
      start.current = null;
      if (distance.current) {
        distance.current = 0;
        setPullDistance(0);
      }
      return;
    }
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      if (distance.current) {
        distance.current = 0;
        setPullDistance(0);
      }
      return;
    }
    const next = pullResistance(dy);
    distance.current = next;
    setPullDistance(next);
    if (!armed.current && next >= PULL_THRESHOLD) {
      armed.current = true;
      haptic("light");
    } else if (armed.current && next < PULL_THRESHOLD) {
      armed.current = false;
    }
  }, [scrollRef]);

  const onTouchEnd = useCallback(() => {
    const trigger = distance.current >= PULL_THRESHOLD;
    start.current = null;
    armed.current = false;
    distance.current = 0;
    setPullDistance(0);
    if (trigger) void onRefresh();
  }, [onRefresh]);

  return {
    pullDistance,
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
