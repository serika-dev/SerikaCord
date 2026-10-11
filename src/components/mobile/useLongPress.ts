"use client";

import { useEffect, useRef } from "react";
import { haptic } from "@/lib/native/bridge";
import { exceedsLongPressSlop, LONG_PRESS_MS } from "@/lib/mobile/channelGroups";

/**
 * Touch long-press for list rows on phones (server icons, channels, DMs).
 * Spread the returned handlers on the row; `wasLongPress()` tells the row's
 * onClick to ignore the tap that ends a long-press. Scrolling (moving past a
 * small slop) cancels it, so lists still scroll normally.
 */
export function useLongPress<T>(onLongPress: (item: T) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  const bind = (item: T) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      fired.current = false;
      origin.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        haptic("medium");
        callback.current(item);
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const o = origin.current;
      if (!o) return;
      if (exceedsLongPressSlop(e.touches[0].clientX - o.x, e.touches[0].clientY - o.y)) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Desktop-width emulators / mice: right click opens the same menu.
      // On touch devices the browser's own long-press contextmenu can race
      // our timer; whichever comes first wins and the other is dropped.
      e.preventDefault();
      if (fired.current) return;
      const fromTouch = origin.current !== null;
      cancel();
      // Only a touch is followed by a click that must be swallowed.
      fired.current = fromTouch;
      callback.current(item);
    },
  });

  /** True once for the click that ends a long-press (then resets). */
  const wasLongPress = () => {
    const was = fired.current;
    fired.current = false;
    return was;
  };

  return { bind, wasLongPress };
}
