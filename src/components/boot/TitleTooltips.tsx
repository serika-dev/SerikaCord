"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  computeTooltipPlacement,
  findTitleTarget,
  hasAccessibleName,
  splitTitleShortcut,
  type TooltipSide,
} from "@/lib/ui/titleTooltip";

/** Same timing as the app-wide Radix TooltipProvider. */
const SHOW_DELAY_MS = 300;
const SKIP_DELAY_MS = 300;
const TOOLTIP_ID = "serika-title-tooltip";
const SVG_NS = "http://www.w3.org/2000/svg";
const SIDES: readonly TooltipSide[] = ["top", "bottom", "left", "right"];
/** Entry slide per side: the tooltip drifts in from the anchor. */
const DRIFT: Record<TooltipSide, [string, string]> = {
  top: ["0px", "3px"],
  bottom: ["0px", "-3px"],
  left: ["3px", "0px"],
  right: ["-3px", "0px"],
};

interface Armed {
  el: Element;
  title: string;
  via: "pointer" | "focus";
  /** Clicked / Escaped / scrolled: stay hidden until the pointer leaves. */
  suppressed: boolean;
  /** We added aria-label (the element had no name besides its title). */
  addedLabel: boolean;
  /** aria-describedby before we pointed it at the tooltip (undefined = untouched). */
  prevDescribedBy: string | null | undefined;
  observer: MutationObserver | null;
}

interface TipNodes {
  root: HTMLDivElement;
  label: HTMLSpanElement;
  keys: HTMLSpanElement;
}

function createTip(): TipNodes {
  const root = document.createElement("div");
  root.id = TOOLTIP_ID;
  root.setAttribute("role", "tooltip");
  // tooltip-surface: identical look to the Radix Tooltip; theme-solid keeps
  // any surface token inside it opaque on gradient themes.
  root.className = "tooltip-surface title-tooltip theme-solid";
  root.hidden = true;

  const row = document.createElement("span");
  row.className = "tooltip-label-row";
  const label = document.createElement("span");
  label.className = "tooltip-label";
  const keys = document.createElement("span");
  keys.className = "tooltip-kbd-row";
  keys.setAttribute("aria-hidden", "true");
  row.append(label, keys);

  const arrow = document.createElementNS(SVG_NS, "svg");
  arrow.setAttribute("class", "title-tooltip-arrow");
  arrow.setAttribute("viewBox", "0 0 30 10");
  arrow.setAttribute("preserveAspectRatio", "none");
  arrow.setAttribute("aria-hidden", "true");
  const fill = document.createElementNS(SVG_NS, "polygon");
  fill.setAttribute("points", "0,0 30,0 15,10");
  fill.setAttribute("class", "tooltip-arrow-fill");
  const edge = document.createElementNS(SVG_NS, "polyline");
  edge.setAttribute("points", "0,0 15,10 30,0");
  edge.setAttribute("class", "tooltip-arrow-edge");
  edge.setAttribute("vector-effect", "non-scaling-stroke");
  arrow.append(fill, edge);

  root.append(row, arrow);
  document.body.appendChild(root);
  return { root, label, keys };
}

/**
 * Upgrades native `title` tooltips app-wide without touching call sites.
 *
 * One set of delegated listeners on `document`: hovering (mouse/pen) or
 * keyboard-focusing an element with a `title` moves the attribute to
 * `data-tooltip-title` (so the browser's tooltip never appears), keeps the
 * element's accessible name (aria-label only if it had none, otherwise the
 * tooltip is linked with aria-describedby), and shows a single fixed tooltip
 * styled like the Radix one. Leaving, blur, clicking, Escape, scrolling the
 * anchor's container, resizing, route changes and the element being removed
 * all hide it and put the `title` back. Touch input is ignored, so tap-scrolling
 * never pops tooltips. Eligibility rules live in `findTitleTarget`
 * (src/lib/ui/titleTooltip.ts): form fields, iframes, SVG <title>,
 * contenteditable, Radix tooltip triggers and `[data-native-title]` opt out.
 */
export function TitleTooltips() {
  const pathname = usePathname();
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let armed: Armed | null = null;
    let tip: TipNodes | null = null;
    let visible = false;
    let showTimer: number | null = null;
    let raf = 0;
    let lastHiddenAt = 0;
    let lastRectKey = "";
    // Offset of the fixed tooltip's containing block (non-zero when <body> has
    // a filter/transform, e.g. the saturation setting).
    let originX = 0;
    let originY = 0;

    const clearTimer = () => {
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
    };

    const setContent = (title: string) => {
      if (!tip) return;
      const { label, keys } = splitTitleShortcut(title);
      tip.label.textContent = label;
      tip.keys.replaceChildren(
        ...(keys ?? []).map((k) => {
          const kbd = document.createElement("kbd");
          kbd.className = "tooltip-kbd";
          kbd.textContent = k;
          return kbd;
        }),
      );
      tip.keys.hidden = !keys;
    };

    /** Places the tooltip at the anchor; false (and hidden) if the anchor isn't rendered. */
    const position = (): boolean => {
      if (!tip || !armed) return false;
      const r = armed.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        hide();
        if (tip) tip.root.hidden = true;
        return false;
      }
      lastRectKey = `${r.left},${r.top},${r.width},${r.height}`;
      const sideAttr = armed.el.getAttribute("data-tooltip-side") as TooltipSide | null;
      const root = tip.root;
      const p = computeTooltipPlacement(
        r,
        { width: root.offsetWidth, height: root.offsetHeight },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        // offset = Radix's sideOffset (6) + arrow height (6), so both kinds sit alike.
        { side: sideAttr && SIDES.includes(sideAttr) ? sideAttr : "top", offset: 12 },
      );
      root.style.translate = `${p.left - originX}px ${p.top - originY}px`;
      root.dataset.side = p.side;
      root.style.setProperty("--tt-arrow", `${p.arrow}px`);
      root.style.setProperty("--tt-dx", DRIFT[p.side][0]);
      root.style.setProperty("--tt-dy", DRIFT[p.side][1]);
      root.style.transformOrigin =
        p.side === "top" ? `${p.arrow}px 100%`
        : p.side === "bottom" ? `${p.arrow}px 0`
        : p.side === "left" ? `100% ${p.arrow}px`
        : `0 ${p.arrow}px`;
      return true;
    };

    // While visible: follow the anchor if it moves, drop it if it's removed.
    const track = () => {
      raf = 0;
      if (!visible || !armed) return;
      if (!armed.el.isConnected) {
        disarm();
        return;
      }
      const r = armed.el.getBoundingClientRect();
      if (`${r.left},${r.top},${r.width},${r.height}` !== lastRectKey) position();
      if (visible) raf = window.requestAnimationFrame(track);
    };

    function hide() {
      clearTimer();
      if (!visible) return;
      visible = false;
      lastHiddenAt = performance.now();
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      if (tip) {
        tip.root.hidden = true;
        tip.root.removeAttribute("data-animate");
      }
      if (armed && armed.prevDescribedBy !== undefined) {
        if (armed.prevDescribedBy === null) armed.el.removeAttribute("aria-describedby");
        else armed.el.setAttribute("aria-describedby", armed.prevDescribedBy);
        armed.prevDescribedBy = undefined;
      }
    }

    function show(instant: boolean) {
      clearTimer();
      if (!armed || armed.suppressed) return;
      if (!armed.el.isConnected) {
        disarm();
        return;
      }
      if (!tip) tip = createTip();
      const root = tip.root;
      setContent(armed.title);
      root.removeAttribute("data-animate");
      root.style.translate = "0px 0px";
      root.hidden = false;
      const origin = root.getBoundingClientRect();
      originX = origin.left;
      originY = origin.top;
      if (!position()) return;
      if (!instant) {
        root.getBoundingClientRect(); // flush styles so the entry animation restarts
        root.setAttribute("data-animate", "");
      }
      if (!armed.addedLabel) {
        armed.prevDescribedBy = armed.el.getAttribute("aria-describedby");
        armed.el.setAttribute(
          "aria-describedby",
          armed.prevDescribedBy ? `${armed.prevDescribedBy} ${TOOLTIP_ID}` : TOOLTIP_ID,
        );
      }
      visible = true;
      if (!raf) raf = window.requestAnimationFrame(track);
    }

    function disarm() {
      hide();
      const a = armed;
      if (!a) return;
      armed = null;
      a.observer?.disconnect();
      if (!a.el.hasAttribute("title")) a.el.setAttribute("title", a.title);
      a.el.removeAttribute("data-tooltip-title");
      if (a.addedLabel && a.el.getAttribute("aria-label") === a.title) a.el.removeAttribute("aria-label");
    }

    const arm = (el: Element, title: string, via: Armed["via"]) => {
      disarm();
      const addedLabel = !hasAccessibleName(el);
      el.removeAttribute("title");
      el.setAttribute("data-tooltip-title", title);
      if (addedLabel) el.setAttribute("aria-label", title);
      const next: Armed = { el, title, via, suppressed: false, addedLabel, prevDescribedBy: undefined, observer: null };
      // React re-rendering a new title while hovered ("Copy" → "Copied!"):
      // take the new text and strip it again. Scoped to this one element.
      if (typeof MutationObserver !== "undefined") {
        next.observer = new MutationObserver(() => {
          if (armed !== next) return;
          const fresh = el.getAttribute("title");
          if (fresh === null) return;
          el.removeAttribute("title");
          next.title = fresh;
          el.setAttribute("data-tooltip-title", fresh);
          if (next.addedLabel) el.setAttribute("aria-label", fresh);
          if (!fresh.trim()) hide();
          else if (visible) {
            setContent(fresh);
            position();
          }
        });
        next.observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      }
      armed = next;
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const current = armed?.el ?? null;
      const found = findTitleTarget(target, current);
      if (found && found === current) return;
      if (!found) {
        if (armed?.via === "pointer") disarm();
        return;
      }
      const title = found.getAttribute("title");
      if (!title) return;
      const instant = visible || performance.now() - lastHiddenAt < SKIP_DELAY_MS;
      arm(found, title, "pointer");
      if (instant) show(true);
      else showTimer = window.setTimeout(() => show(false), SHOW_DELAY_MS);
    };

    const onPointerOut = (e: PointerEvent) => {
      if (!armed || armed.via !== "pointer") return;
      const rel = e.relatedTarget;
      if (rel instanceof Node && armed.el.contains(rel)) return;
      disarm();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!armed) return;
      if (e.pointerType === "touch") {
        disarm();
        return;
      }
      armed.suppressed = true;
      hide();
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      try {
        if (!target.matches(":focus-visible")) return;
      } catch {
        return;
      }
      const found = findTitleTarget(target, armed?.el ?? null);
      // Native titles never show on focus; only upgrade the focused element itself.
      if (!found || found !== target) return;
      if (found === armed?.el) {
        armed.suppressed = false;
        if (!visible) show(true);
        return;
      }
      const title = found.getAttribute("title");
      if (!title) return;
      arm(found, title, "focus");
      show(true);
    };

    const onFocusOut = (e: FocusEvent) => {
      if (armed?.via === "focus" && e.target === armed.el) disarm();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && armed && visible) {
        armed.suppressed = true;
        hide();
      }
    };

    const onScroll = (e: Event) => {
      if (!armed) return;
      const t = e.target;
      // Only scrolls that move the anchor (its container or the page).
      if (t instanceof Node && t !== document && !t.contains(armed.el)) return;
      if (armed.via === "focus") disarm();
      else {
        armed.suppressed = true;
        hide();
      }
    };

    const onResize = () => {
      if (armed) disarm();
    };
    const onVisibility = () => {
      if (document.hidden) disarm();
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("pointerover", onPointerOver, opts);
    document.addEventListener("pointerout", onPointerOut, opts);
    document.addEventListener("pointerdown", onPointerDown, opts);
    document.addEventListener("focusin", onFocusIn, opts);
    document.addEventListener("focusout", onFocusOut, opts);
    document.addEventListener("keydown", onKeyDown, opts);
    document.addEventListener("scroll", onScroll, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("blur", disarm);
    resetRef.current = disarm;

    return () => {
      document.removeEventListener("pointerover", onPointerOver, opts);
      document.removeEventListener("pointerout", onPointerOut, opts);
      document.removeEventListener("pointerdown", onPointerDown, opts);
      document.removeEventListener("focusin", onFocusIn, opts);
      document.removeEventListener("focusout", onFocusOut, opts);
      document.removeEventListener("keydown", onKeyDown, opts);
      document.removeEventListener("scroll", onScroll, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", disarm);
      resetRef.current = null;
      disarm();
      tip?.root.remove();
      tip = null;
    };
  }, []);

  // Route change: the anchor is usually gone; restore and hide right away.
  useEffect(() => {
    resetRef.current?.();
  }, [pathname]);

  return null;
}
