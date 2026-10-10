"use client";

import { useEffect, useRef } from "react";
import { backStack, type BackHandler } from "@/lib/native/navigation";

/**
 * While `active`, the Android back button (and other "go back" gestures)
 * calls `handler` first — use it to close sheets, drawers and menus. The
 * newest active handler wins; return `false` to pass the press on.
 */
export function useBackHandler(active: boolean, handler: BackHandler): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;
    return backStack.push(() => ref.current());
  }, [active]);
}
