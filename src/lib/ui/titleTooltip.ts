/**
 * Pure helpers for the global `title` tooltip upgrade (TitleTooltips in
 * src/components/boot). Everything here works on a minimal element shape so it
 * can be unit tested without a DOM.
 */

/** The bits of a DOM Element the helpers read. A real `Element` satisfies it. */
export interface TitleNodeLike {
  tagName: string;
  namespaceURI: string | null;
  parentElement: TitleNodeLike | null;
  getAttribute(name: string): string | null;
  textContent?: string | null;
  children?: ArrayLike<{ tagName: string }>;
  querySelector?(selectors: string): unknown;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/**
 * Elements whose native tooltip we leave alone: form fields (the title often
 * doubles as validation help and moving it would break `:invalid` messages),
 * embedded documents, and anything the browser renders itself.
 */
const SKIP_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "OPTGROUP",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
]);

/** Whether this element itself may have its `title` upgraded. */
export function isTitleElementEligible(el: TitleNodeLike): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return false;
  // SVG/MathML: `title` attributes there don't show natively, and SVG uses
  // <title> children instead (left to the browser).
  if (el.namespaceURI === SVG_NS || el.namespaceURI === MATHML_NS) return false;
  return true;
}

/** An SVG element with a direct <title> child: the browser shows that one. */
function isSvgWithTitleChild(el: TitleNodeLike): boolean {
  if (el.namespaceURI !== SVG_NS || !el.children) return false;
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].tagName.toLowerCase() === "title") return true;
  }
  return false;
}

/**
 * Walks up from the hovered/focused node and returns the element whose
 * `title` should become a custom tooltip, or null to leave things native.
 *
 * Mirrors the browser: the nearest element with a `title` wins, an empty
 * `title=""` suppresses ancestors' titles, an SVG <title> child owns the
 * tooltip for its subtree. `active` is the element currently upgraded (its
 * `title` has been moved off, so it is matched by identity).
 *
 * Opt-outs anywhere on the path: `data-native-title`, a contenteditable
 * region, or a Radix tooltip trigger (`data-slot="tooltip-trigger"`, which
 * shows its own tooltip, so upgrading would double up).
 */
export function findTitleTarget<E extends TitleNodeLike>(start: E | null, active: E | null = null): E | null {
  let candidate: E | null = null;
  for (let n: TitleNodeLike | null = start; n; n = n.parentElement) {
    if (n.getAttribute("data-native-title") !== null) return null;
    if (n.getAttribute("data-slot") === "tooltip-trigger") return null;
    const editable = n.getAttribute("contenteditable");
    if (editable !== null && editable !== "false") return null;
    if (candidate) continue;
    if (n === active) {
      candidate = n as E;
      continue;
    }
    if (isSvgWithTitleChild(n)) return null;
    const title = n.getAttribute("title");
    if (title !== null) {
      if (!title.trim()) return null;
      if (!isTitleElementEligible(n)) return null;
      candidate = n as E;
    }
  }
  return candidate;
}

/**
 * Whether the element already has an accessible name without its `title`
 * (so we must not overwrite it with `aria-label`, and should describe it with
 * the tooltip instead).
 */
export function hasAccessibleName(el: TitleNodeLike): boolean {
  if (el.getAttribute("aria-label")?.trim()) return true;
  if (el.getAttribute("aria-labelledby")?.trim()) return true;
  if (el.tagName.toUpperCase() === "IMG" && el.getAttribute("alt")?.trim()) return true;
  if (el.textContent && el.textContent.trim()) return true;
  if (el.querySelector?.('img[alt]:not([alt=""]), [aria-label]:not([aria-label=""])')) return true;
  return false;
}

// ── Shortcut hints ──────────────────────────────────────────────────────────

const MODIFIERS = new Set(["ctrl", "control", "cmd", "command", "⌘", "shift", "⇧", "alt", "option", "opt", "⌥", "meta", "win", "super"]);
const NAMED_KEYS = new Set([
  "esc", "escape", "enter", "return", "tab", "space", "backspace", "delete", "del",
  "home", "end", "pageup", "pagedown", "page up", "page down", "insert",
  "↑", "↓", "←", "→", "up", "down", "left", "right", "click",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
]);

/**
 * Splits a key combo ("Ctrl+Shift+Z", "⌘ + K", "Esc") into its keys.
 * Returns null if it doesn't look like a shortcut.
 */
export function parseShortcut(combo: string): string[] | null {
  const raw = combo.trim();
  if (!raw || raw.length > 32) return null;
  // "+" on its own as the final key: "Ctrl++".
  const keys = raw.endsWith("++")
    ? [...raw.slice(0, -2).split("+"), "+"]
    : raw.split("+");
  const cleaned = keys.map((k) => k.trim());
  if (cleaned.some((k) => !k)) return null;
  const lower = cleaned.map((k) => k.toLowerCase());
  const mods = lower.slice(0, -1);
  const last = lower[lower.length - 1];
  if (!mods.every((m) => MODIFIERS.has(m))) return null;
  const lastIsKey = NAMED_KEYS.has(last) || MODIFIERS.has(last) || /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(cleaned[cleaned.length - 1]);
  if (!lastIsKey) return null;
  // A lone character "(A)" is too ambiguous; a lone named key "(Esc)" is fine.
  if (mods.length === 0 && !NAMED_KEYS.has(last)) return null;
  return cleaned;
}

/**
 * "Undo (Ctrl+Z)" → { label: "Undo", keys: ["Ctrl", "Z"] }. Titles without a
 * trailing shortcut come back unchanged with `keys: null`.
 */
export function splitTitleShortcut(title: string): { label: string; keys: string[] | null } {
  const m = /^([\s\S]*\S)\s*[(（]([^()（）]+)[)）]\s*$/.exec(title);
  if (!m) return { label: title, keys: null };
  const keys = parseShortcut(m[2]);
  if (!keys) return { label: title, keys: null };
  return { label: m[1], keys };
}

// ── Placement ───────────────────────────────────────────────────────────────

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPlacementOptions {
  /** Preferred side; flips to the opposite one when it doesn't fit. */
  side?: TooltipSide;
  /** Gap between anchor and tooltip (px). */
  offset?: number;
  /** Minimum distance from the viewport edge (px). */
  padding?: number;
  /** Keep the arrow this far from the tooltip's corners (px). */
  arrowPadding?: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  side: TooltipSide;
  /** Arrow centre along the tooltip edge facing the anchor (px from its start). */
  arrow: number;
}

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function clamp(v: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(v, min), max);
}

/**
 * Places a tooltip of `size` next to `anchor` inside a viewport of
 * `viewport` size (all in viewport/client coordinates): preferred side,
 * flipped when that side lacks room and the other has more, then shifted
 * along the cross axis to stay `padding` from the edges. The arrow keeps
 * pointing at the anchor's centre.
 */
export function computeTooltipPlacement(
  anchor: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: TooltipPlacementOptions = {},
): TooltipPlacement {
  const offset = opts.offset ?? 8;
  const padding = opts.padding ?? 8;
  const arrowPadding = opts.arrowPadding ?? 10;
  const preferred = opts.side ?? "top";

  const space: Record<TooltipSide, number> = {
    top: anchor.top - padding,
    bottom: viewport.height - (anchor.top + anchor.height) - padding,
    left: anchor.left - padding,
    right: viewport.width - (anchor.left + anchor.width) - padding,
  };
  const needs = (s: TooltipSide) => (s === "top" || s === "bottom" ? size.height : size.width) + offset;

  let side = preferred;
  if (space[side] < needs(side)) {
    const other = OPPOSITE[side];
    if (space[other] >= needs(other) || space[other] > space[side]) side = other;
  }

  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  let left: number;
  let top: number;
  if (side === "top" || side === "bottom") {
    top = side === "top" ? anchor.top - offset - size.height : anchor.top + anchor.height + offset;
    top = clamp(top, padding, viewport.height - padding - size.height);
    left = clamp(cx - size.width / 2, padding, viewport.width - padding - size.width);
  } else {
    left = side === "left" ? anchor.left - offset - size.width : anchor.left + anchor.width + offset;
    left = clamp(left, padding, viewport.width - padding - size.width);
    top = clamp(cy - size.height / 2, padding, viewport.height - padding - size.height);
  }

  const along = side === "top" || side === "bottom" ? cx - left : cy - top;
  const extent = side === "top" || side === "bottom" ? size.width : size.height;
  const arrow = clamp(along, Math.min(arrowPadding, extent / 2), Math.max(extent - arrowPadding, extent / 2));

  return { left: Math.round(left), top: Math.round(top), side, arrow: Math.round(arrow) };
}
