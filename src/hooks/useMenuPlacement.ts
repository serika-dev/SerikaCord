"use client";

import { useCallback } from "react";

const EDGE = 8;

/**
 * Where a context menu opened at (x, y) should go so it stays on screen:
 * opens down-right of the pointer, flips up / left when there's no room, and
 * is clamped to the viewport (8px margin) when it fits neither way.
 */
export function placeMenu(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let left = x;
  if (left + size.width > viewport.width - EDGE) left = x - size.width;
  left = Math.max(EDGE, Math.min(left, viewport.width - EDGE - size.width));
  let top = y;
  if (top + size.height > viewport.height - EDGE) top = y - size.height;
  top = Math.max(EDGE, Math.min(top, viewport.height - EDGE - size.height));
  return { left, top };
}

/**
 * Ref callback for a `position: fixed` context menu opened at the pointer.
 * Measures the menu once it's in the DOM and positions it directly on the
 * element (no state, no re-render). Don't also pass left/top in `style`, or a
 * re-render would undo the placement.
 */
export function useMenuPlacement(x: number, y: number) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { left, top } = placeMenu(x, y, rect, { width: window.innerWidth, height: window.innerHeight });
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = "visible";
    },
    [x, y],
  );
}
