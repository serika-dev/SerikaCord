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
