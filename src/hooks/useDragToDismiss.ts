"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  gestureAxis,
  SHEET_DRAG_IGNORE_SELECTOR,
  sheetBackdropOpacity,
  sheetDragOffset,
  sheetTakesOver,
  shouldDismissSheet,
  type GestureAxis,
} from "@/lib/mobile/gestures";
import { releaseVelocity } from "@/lib/mobile/pager";
import { hapticTick } from "@/lib/native/haptics";

export interface DragToDismissOptions {
  /** Close the sheet (called once the drag or `dismiss()` decided to close). */
  onDismiss: () => void;
  /**
   * "animate" (default): the hook slides the sheet out, then calls
   * `onDismiss` (sheets that unmount on close). "handoff": `onDismiss` runs at
   * once and the component's own exit animation continues from the dragged
   * position (Radix dialogs); if the close was refused the sheet springs back.
   */
  mode?: "animate" | "handoff";
  /** Media query the drag is active for (the sheet presentation). */
  media?: string;
  /** Turn the drag off (e.g. while an editor inside the sheet is open). */
  disabled?: boolean;
}

export interface DragToDismiss {
  /** Ref for the sheet element (the part that moves). */
  sheetRef: (el: HTMLElement | null) => void | (() => void);
  /** Ref for the backdrop (fades with the drag). Optional. */
  backdropRef: (el: HTMLElement | null) => void;
  /** Slide the sheet out and close it (backdrop tap, back button). */
  dismiss: () => void;
}

const SPRING = "cubic-bezier(0.34, 1.3, 0.64, 1)";
const OUT = "cubic-bezier(0.2, 0.6, 0.35, 1)";

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function matches(media: string | undefined): boolean {
  if (!media) return true;
  try {
    return window.matchMedia(media).matches;
  } catch {
    return true;
  }
}

/** Nearest vertically scrollable element from `from` up to (and including) `sheet`. */
function verticalScroller(from: Element | null, sheet: HTMLElement): HTMLElement | null {
  for (let node = from as HTMLElement | null; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") return node;
    }
    if (node === sheet) break;
  }
  return null;
}

/**
 * Drag-to-dismiss for every phone bottom sheet (one implementation): the
 * sheet follows the finger 1:1 from the handle and from its content once that
 * content is scrolled to the top (the content scrolls first), the backdrop
 * fades with the drag, and release closes on distance or a downward flick or
 * springs back. Transform/opacity only, written straight to the DOM; no React
 * state per move.
 */
export function useDragToDismiss(options: DragToDismissOptions): DragToDismiss {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const sheetEl = useRef<HTMLElement | null>(null);
  const backdropEl = useRef<HTMLElement | null>(null);
  const closing = useRef(false);

  const setBackdrop = (opacity: number | null, duration = 0) => {
    const b = backdropEl.current;
    if (!b) return;
    b.style.transition = duration > 0 ? `opacity ${duration}ms ease-out` : "none";
    b.style.opacity = opacity === null ? "" : String(opacity);
  };

  const springBack = useCallback(() => {
    const el = sheetEl.current;
    if (!el) return;
    const d = reducedMotion() ? 0 : 320;
    el.style.transition = d ? `transform ${d}ms ${SPRING}` : "none";
    el.style.transform = "";
    setBackdrop(null, d ? 200 : 0);
    window.setTimeout(() => {
      if (sheetEl.current !== el) return;
      el.style.transition = "";
      el.style.willChange = "";
      if (backdropEl.current) backdropEl.current.style.transition = "";
    }, d + 20);
  }, []);

  const finish = useCallback((velocity = 0) => {
    const el = sheetEl.current;
    if (!el || closing.current) return;
    closing.current = true;
    const { mode = "animate" } = opts.current;
    if (mode === "handoff") {
      // The exit animation starts from where the finger left the sheet.
      el.style.transition = "none";
      el.style.willChange = "";
      opts.current.onDismiss();
      window.setTimeout(() => {
        closing.current = false;
        // Still open: the close was refused (e.g. unsaved changes).
        if (el.isConnected && el.getAttribute("data-state") === "open") springBack();
      }, 180);
      return;
    }
    const height = el.getBoundingClientRect().height || window.innerHeight;
    const d = reducedMotion() ? 0 : Math.round(Math.max(140, Math.min(240, 240 - Math.abs(velocity) * 60)));
    el.style.transition = d ? `transform ${d}ms ${OUT}` : "none";
    el.style.transform = `translate3d(0, ${Math.ceil(height + 24)}px, 0)`;
    setBackdrop(0, d);
    window.setTimeout(() => {
      closing.current = false;
      opts.current.onDismiss();
    }, d + 10);
  }, [springBack]);

  const sheetRef = useCallback((el: HTMLElement | null) => {
    sheetEl.current = el;
    if (!el) return;
    closing.current = false;
    let g: {
      x: number;
      y: number;
      anchor: number;
      axis: GestureAxis;
      active: boolean;
      scroller: HTMLElement | null;
      samples: Array<{ x: number; t: number }>;
      offset: number;
      frame: number;
    } | null = null;
    let suppressClick = false;

    const write = () => {
      if (!g) return;
      g.frame = 0;
      el.style.transform = `translate3d(0, ${Math.round(g.offset * 100) / 100}px, 0)`;
      setBackdrop(sheetBackdropOpacity(g.offset, el.getBoundingClientRect().height));
    };

    const onStart = (e: TouchEvent) => {
      g = null;
      suppressClick = false;
      const o = opts.current;
      if (o.disabled || closing.current || e.touches.length !== 1 || !matches(o.media)) return;
      const target = e.target as Element | null;
      if (!target || target.closest(SHEET_DRAG_IGNORE_SELECTOR)) return;
      const t = e.touches[0];
      g = { x: t.clientX, y: t.clientY, anchor: t.clientY, axis: null, active: false, scroller: verticalScroller(target, el), samples: [], offset: 0, frame: 0 };
    };

    const onMove = (e: TouchEvent) => {
      if (!g) return;
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const t = e.touches[0];
      if (!g.active) {
        g.axis ??= gestureAxis(t.clientX - g.x, t.clientY - g.y);
        if (!g.axis) return;
        if (g.axis === "horizontal") {
          g = null;
          return;
        }
        const scrollTop = g.scroller ? g.scroller.scrollTop : null;
        const dy = t.clientY - g.anchor;
        if (sheetTakesOver(dy, scrollTop)) {
          // From the very start (nothing scrolled): follow from the touch point;
          // handed over mid-scroll: start from here.
          if (g.scroller && g.samples.length > 0) g.anchor = t.clientY;
          g.active = true;
          el.style.transition = "none";
          el.style.willChange = "transform";
        } else if (dy < 0 && !g.scroller) {
          g.active = true; // nothing to scroll: a little upward give
          el.style.transition = "none";
        } else {
          // The content scrolls; keep watching for the top.
          g.samples.push({ x: t.clientY, t: e.timeStamp });
          g.anchor = t.clientY;
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      g.samples.push({ x: t.clientY, t: e.timeStamp });
      if (g.samples.length > 8) g.samples.shift();
      g.offset = sheetDragOffset(t.clientY - g.anchor);
      if (!g.frame) g.frame = requestAnimationFrame(write);
    };

    const cancel = () => {
      const was = g;
      g = null;
      if (was?.frame) cancelAnimationFrame(was.frame);
      if (was?.active) springBack();
    };

    const onEnd = (e: TouchEvent) => {
      const was = g;
      g = null;
      if (!was?.active) return;
      if (was.frame) cancelAnimationFrame(was.frame);
      const t = e.changedTouches[0];
      if (t) {
        was.samples.push({ x: t.clientY, t: e.timeStamp });
        was.offset = sheetDragOffset(t.clientY - was.anchor);
        el.style.transform = `translate3d(0, ${was.offset}px, 0)`;
      }
      suppressClick = Math.abs(was.offset) > 4;
      const velocity = releaseVelocity(was.samples, e.timeStamp, 100);
      if (shouldDismissSheet(was.offset, velocity)) {
        hapticTick();
        finish(velocity);
      }
      else springBack();
    };

    const onClick = (e: MouseEvent) => {
      // Only the tap that ended a drag; the hook's own close (a programmatic click) passes.
      if (!suppressClick || !e.isTrusted) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("click", onClick, true);
      if (sheetEl.current === el) sheetEl.current = null;
    };
  }, [finish, springBack]);

  const backdropRef = useCallback((el: HTMLElement | null) => {
    backdropEl.current = el;
  }, []);

  return { sheetRef, backdropRef, dismiss: finish };
}
