"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { useGT } from "gt-next";
import { gestureAxis, type GestureAxis } from "@/lib/mobile/gestures";
import {
  PAGER_EDGE_DEAD_ZONE,
  PAGER_MAX_SIDE,
  PAGER_PEEK,
  dragOffset,
  pagerLayout,
  releaseVelocity,
  snapDuration,
  snapIndex,
  type PagerPanel,
} from "@/lib/mobile/pager";
import { isRowSwipe } from "@/components/chat/SwipeReplyRow";
import { isNativeApp } from "@/lib/native/bridge";
import { hapticTick } from "@/lib/native/haptics";

export interface MobilePagerHandle {
  /** Animate to a panel now (no React render); `onSettle` reports it when done. */
  goTo: (panel: PagerPanel) => void;
  /** Hide the chat's content while another conversation renders (no flash of the old one). */
  blankChat: (blank: boolean) => void;
}

/** Where a horizontal drag must not start: text entry, sliders, code, media, opt-outs. */
const PAGER_IGNORE = 'input, textarea, select, [contenteditable="true"], [data-no-swipe], [role="slider"], audio, video, pre, code';
/** An open modal surface owns every touch. */
const MODAL_OPEN = '[data-message-sheet], [data-mobile-sheet], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** True when `el` (or an ancestor below `root`) scrolls horizontally. */
function inHorizontalScroller(el: Element | null, root: Element): boolean {
  for (let node = el; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Discord-mobile style three-panel pager: [list | chat | members], all kept
 * mounted. The strip follows the finger 1:1 (transform only, written straight
 * to the DOM, no React state while dragging), rubber-bands at the ends and
 * snaps by position + release velocity. `panel` is the resting panel the
 * parent wants; gestures and `goTo` animate first and report through
 * `onSettle`, so React work (URL, inert flags) happens after the motion.
 */
export function MobilePager({
  panel,
  hasChat,
  hasMembers,
  list,
  chat,
  members,
  onSettle,
  ref,
}: {
  panel: PagerPanel;
  hasChat: boolean;
  hasMembers: boolean;
  list: React.ReactNode;
  chat: React.ReactNode;
  members?: React.ReactNode;
  onSettle: (panel: PagerPanel) => void;
  ref?: Ref<MobilePagerHandle>;
}) {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  // Live gesture/animation state: refs only (no re-render while moving).
  const live = useRef({
    width: 0,
    offset: 0,
    index: 0,
    panels: ["list"] as PagerPanel[],
    positions: [0],
    settleTimer: 0 as number | ReturnType<typeof setTimeout>,
    /** A move the parent hasn't been told about yet (its `panel` lags until onSettle). */
    settling: false,
    /** The strip carries a transform (moving) rather than resting on `left`. */
    moving: false,
    /** The resting panel the parent last asked for (or was told about). */
    parentPanel: panel as PagerPanel,
    suppressClick: false,
  });
  const onSettleRef = useRef(onSettle);
  useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  /**
   * At rest the strip is placed with `left` and has no transform: a transform
   * (or will-change) would make it the containing block of every
   * `position: fixed` element inside the panels (image viewer, menus, bars),
   * pinning them to the strip instead of the screen. It only carries a
   * transform while it moves.
   */
  const rest = (offset: number) => {
    const strip = stripRef.current;
    live.current.offset = offset;
    live.current.moving = false;
    if (!strip) return;
    strip.style.transition = "none";
    strip.style.willChange = "";
    strip.style.transform = "none";
    strip.style.left = `${Math.round(offset * 100) / 100}px`;
  };

  /** Move with a transform; `duration` > 0 animates (a compositor-driven CSS transition). */
  const move = (offset: number, duration: number) => {
    const strip = stripRef.current;
    const st = live.current;
    if (!strip) {
      st.offset = offset;
      return;
    }
    if (!st.moving) {
      // From rest: same place, now as a transform (no visible change).
      st.moving = true;
      strip.style.transition = "none";
      strip.style.left = "0px";
      strip.style.transform = `translate3d(${Math.round(st.offset * 100) / 100}px,0,0)`;
      strip.style.willChange = "transform";
      // Commit that start point before a transition runs from it.
      if (duration > 0) void strip.getBoundingClientRect();
    }
    st.offset = offset;
    strip.style.transition = duration > 0 ? `transform ${duration}ms ${SNAP_EASING}` : "none";
    strip.style.transform = `translate3d(${Math.round(offset * 100) / 100}px,0,0)`;
  };

  /** Animate to panel index `i`; back to rest after, reporting a move the parent doesn't know about. */
  const animateTo = (i: number, duration: number, report: boolean) => {
    const st = live.current;
    const target = st.positions[i] ?? 0;
    clearTimeout(st.settleTimer as ReturnType<typeof setTimeout>);
    const landed = st.panels[i];
    const changed = report && landed !== st.parentPanel;
    st.index = i;
    st.settling = changed;
    if (duration <= 0) rest(target);
    else move(target, duration);
    st.settleTimer = setTimeout(() => {
      st.settling = false;
      if (st.index === i) rest(st.positions[i] ?? target);
      if (changed) {
        st.parentPanel = landed;
        onSettleRef.current(landed);
      }
    }, duration > 0 ? duration + 20 : 0);
  };

  /** Settle on panel index `i` (gesture end / button), then report it. */
  const settleTo = (i: number, velocity = 0) => {
    const st = live.current;
    const target = st.positions[i] ?? 0;
    animateTo(i, reducedMotion() ? 0 : snapDuration(target - st.offset, velocity), true);
  };

  // Geometry: recompute when the panels present or the width change, and keep
  // the strip on the resting panel (no animation for a layout change).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const st = live.current;
    const relayout = () => {
      st.width = root.clientWidth;
      const layout = pagerLayout(st.width, { hasChat, hasMembers });
      const current = st.panels[st.index];
      st.panels = layout.panels;
      st.positions = layout.positions;
      st.index = Math.max(0, layout.panels.indexOf(current));
      clearTimeout(st.settleTimer as ReturnType<typeof setTimeout>);
      rest(st.positions[st.index] ?? 0);
    };
    relayout();
    const ro = new ResizeObserver(relayout);
    ro.observe(root);
    return () => ro.disconnect();
  }, [hasChat, hasMembers]);

  // Follow the parent's resting panel (deep links, back button, router
  // navigations). Checked after every render, not only when `panel` changes:
  // a quick list → chat flip can be batched into one render. Skipped while a
  // gesture's settle hasn't been reported yet (the parent's value lags then).
  useLayoutEffect(() => {
    const st = live.current;
    if (st.settling) return;
    st.parentPanel = panel;
    const i = st.panels.indexOf(panel);
    if (i < 0 || (i === st.index && Math.abs(st.offset - st.positions[i]) < 0.5)) return;
    // Moving because the parent asked: report nothing back (it already knows).
    const first = st.width === 0;
    animateTo(i, first || reducedMotion() ? 0 : snapDuration(st.positions[i] - st.offset), false);
  });

  useImperativeHandle(ref, () => ({
    goTo: (p: PagerPanel) => {
      const i = live.current.panels.indexOf(p);
      if (i >= 0) settleTo(i);
    },
    blankChat: (blank: boolean) => {
      if (chatContentRef.current) chatContentRef.current.style.visibility = blank ? "hidden" : "";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Touch handling on window (bubble): runs after React's root listeners, so
  // a message row's swipe-to-reply mark (SwipeReplyRow) is visible here.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const st = live.current;
    const deadZone = isNativeApp() ? 0 : PAGER_EDGE_DEAD_ZONE;
    let drag: {
      x: number;
      y: number;
      base: number;
      baseIndex: number;
      axis: GestureAxis;
      active: boolean;
      samples: Array<{ x: number; t: number }>;
      frame: number;
      pending: number | null;
    } | null = null;

    const currentOffset = () => {
      // Grabbed mid-animation: start from where the strip actually is.
      const strip = stripRef.current;
      if (!strip || !st.moving || !strip.style.transition || strip.style.transition === "none") return st.offset;
      const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
      return m.m41;
    };

    const onStart = (e: TouchEvent) => {
      drag = null;
      st.suppressClick = false;
      if (e.touches.length !== 1 || st.panels.length < 2) return;
      const target = e.target as Element | null;
      if (!target || !root.contains(target)) return;
      if (target.closest?.(PAGER_IGNORE)) return;
      if (document.querySelector(MODAL_OPEN)) return;
      const t = e.touches[0];
      if (t.clientX < deadZone) return;
      const base = currentOffset();
      if (base !== st.offset) move(base, 0);
      drag = { x: t.clientX, y: t.clientY, base, baseIndex: st.index, axis: null, active: false, samples: [{ x: t.clientX, t: e.timeStamp }], frame: 0, pending: null };
    };

    const onMove = (e: TouchEvent) => {
      const d = drag;
      if (!d) return;
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const t = e.touches[0];
      if (!d.active) {
        d.axis ??= gestureAxis(t.clientX - d.x, t.clientY - d.y);
        if (!d.axis) return;
        if (d.axis === "vertical" || isRowSwipe(e) || window.getSelection?.()?.isCollapsed === false || inHorizontalScroller(e.target as Element, root)) {
          drag = null;
          return;
        }
        // Lock: re-anchor so the strip moves exactly with the finger from here.
        d.active = true;
        d.x = t.clientX;
        clearTimeout(st.settleTimer as ReturnType<typeof setTimeout>);
        move(d.base, 0);
      }
      if (isRowSwipe(e)) {
        cancel();
        return;
      }
      if (e.cancelable) e.preventDefault();
      d.samples.push({ x: t.clientX, t: e.timeStamp });
      if (d.samples.length > 8) d.samples.shift();
      const min = st.positions[st.positions.length - 1];
      d.pending = dragOffset(d.base, t.clientX - d.x, min, 0);
      if (!d.frame) {
        d.frame = requestAnimationFrame(() => {
          if (!drag) return;
          drag.frame = 0;
          if (drag.pending !== null) move(drag.pending, 0);
        });
      }
    };

    const cancel = () => {
      const d = drag;
      drag = null;
      if (!d?.active) return;
      if (d.frame) cancelAnimationFrame(d.frame);
      settleTo(d.baseIndex);
    };

    const onEnd = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d?.active) return;
      if (d.frame) cancelAnimationFrame(d.frame);
      if (d.pending !== null) st.offset = d.pending;
      const t = e.changedTouches[0];
      if (t) d.samples.push({ x: t.clientX, t: e.timeStamp });
      const velocity = releaseVelocity(d.samples, e.timeStamp);
      st.suppressClick = true;
      const target = snapIndex(st.positions, d.baseIndex, st.offset, velocity);
      // Native apps: a light tick when a swipe lands on another panel.
      if (target !== d.baseIndex) hapticTick();
      settleTo(target, velocity);
    };

    const onClick = (e: MouseEvent) => {
      if (!st.suppressClick) return;
      st.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    root.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", cancel);
      root.removeEventListener("click", onClick, true);
      clearTimeout(st.settleTimer as ReturnType<typeof setTimeout>);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sideWidth = hasChat ? `min(calc(100% - ${PAGER_PEEK}px), ${PAGER_MAX_SIDE}px)` : "100%";
  const atList = panel === "list";
  const atMembers = panel === "members";

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0 min-h-0 overflow-hidden" data-mobile-pager="">
      <div
        ref={stripRef}
        // Panels sit side by side; only this element ever moves.
        className="absolute inset-y-0 left-0 flex w-full"
      >
        <section
          aria-label={gt("Channels")}
          inert={hasChat && !atList ? true : undefined}
          className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-app)]"
          style={{ width: sideWidth }}
        >
          {list}
        </section>
        {hasChat && (
          <section
            aria-label={gt("Conversation")}
            className="relative flex h-full w-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-app)] shadow-[0_0_24px_rgba(0,0,0,0.25)]"
          >
            <div ref={chatContentRef} inert={atList || atMembers ? true : undefined} className="flex h-full min-h-0 flex-col">
              {chat}
            </div>
            {(atList || atMembers) && (
              // The peeking edge of the chat: tap (or swipe) to go back to it.
              <button
                type="button"
                aria-label={gt("Back to conversation")}
                onClick={() => {
                  const i = live.current.panels.indexOf("chat");
                  if (i >= 0) settleTo(i);
                }}
                className="absolute inset-0 z-10 cursor-default bg-transparent"
              />
            )}
          </section>
        )}
        {hasChat && hasMembers && (
          <section
            aria-label={gt("Members")}
            inert={!atMembers ? true : undefined}
            className="theme-solid relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-app)]"
            style={{ width: sideWidth }}
          >
            {members}
          </section>
        )}
      </div>
    </div>
  );
}
