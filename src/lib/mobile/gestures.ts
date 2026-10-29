/** Shared intent rules keep scrolls, row actions and page swipes from competing. */
export type GestureAxis = "horizontal" | "vertical" | null;

export const GESTURE_SLOP = 8;
export const GESTURE_SETTLE_CLASS = "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
export const GESTURE_IGNORE_SELECTOR = 'input, textarea, select, button, a, [contenteditable="true"], [data-no-swipe], [role="slider"], audio, video, pre, code';

/** Decide once after the slop; callers keep that axis until the finger lifts. */
export function gestureAxis(dx: number, dy: number): GestureAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical";
}

/** Follow the finger normally up to the limit, then ease into a soft boundary. */
export function resistedDrag(distance: number, limit: number, extra = 28): number {
  const positive = Math.max(0, distance);
  if (positive <= limit) return positive;
  return limit + extra * (1 - Math.exp(-(positive - limit) / (extra * 2)));
}

/** A deliberate short flick can dismiss a sheet without a long downward drag. */
export function shouldDismissSheet(distance: number, velocity: number): boolean {
  return distance >= 90 || (distance >= 28 && velocity >= 0.55);
}

/** Where a sheet drag must not start: text entry, sliders, opt-outs. Buttons and rows stay draggable. */
export const SHEET_DRAG_IGNORE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-no-drag], [role="slider"], audio, video';

/**
 * Sheet offset for a vertical drag of `dy` (down is positive): follows the
 * finger 1:1 downward, and only rubber-bands a little upward (a sheet can't
 * be pulled past its open height).
 */
export function sheetDragOffset(dy: number, upLimit = 24): number {
  if (dy >= 0) return dy;
  const over = -dy;
  return -upLimit * (1 - 1 / ((over * 0.55) / upLimit + 1));
}

/** Backdrop opacity (0–1) while a sheet of `height` px is dragged down by `offset`. */
export function sheetBackdropOpacity(offset: number, height: number): number {
  if (offset <= 0 || height <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - offset / height));
}

/**
 * Whether a downward drag should hand over from the content's own scroll to
 * the sheet: only once the scroller is at its top (it scrolls first).
 */
export function sheetTakesOver(dy: number, scrollTop: number | null): boolean {
  return dy > 0 && (scrollTop === null || scrollTop <= 0);
}
