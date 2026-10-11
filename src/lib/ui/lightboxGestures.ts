/**
 * Pure touch-gesture maths for the image lightbox on phones (Discord-mobile
 * style): horizontal swipe flips through the gallery, a downward swipe
 * dismisses, two fingers pinch-zoom and a double tap toggles zoom.
 */

export type SwipeAction = "next" | "prev" | "dismiss" | null;

export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 5;
export const LIGHTBOX_DOUBLE_TAP_SCALE = 2.5;
/** Two taps closer together than this (ms) count as a double tap. */
export const DOUBLE_TAP_MS = 280;

const SWIPE_DISTANCE_PX = 60;
const DISMISS_DISTANCE_PX = 110;
/** A short, quick flick counts even when it travels less than the distance. */
const FLICK_VELOCITY_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 25;

/**
 * Decide what a finished one-finger swipe (at scale 1) should do.
 * dx/dy are the finger travel in px, dt the gesture duration in ms.
 */
export function classifySwipe(dx: number, dy: number, dt: number, canNavigate: boolean): SwipeAction {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const time = Math.max(dt, 1);

  if (ay > ax) {
    // Only a downward pull dismisses (upward is reserved, like Discord).
    if (dy <= 0) return null;
    const flick = dy >= FLICK_MIN_PX && dy / time >= FLICK_VELOCITY_PX_PER_MS;
    return dy >= DISMISS_DISTANCE_PX || flick ? "dismiss" : null;
  }

  if (!canNavigate) return null;
  const flick = ax >= FLICK_MIN_PX && ax / time >= FLICK_VELOCITY_PX_PER_MS;
  if (ax < SWIPE_DISTANCE_PX && !flick) return null;
  // Finger moving left reveals the next image.
  return dx < 0 ? "next" : "prev";
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return LIGHTBOX_MIN_SCALE;
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale));
}

/** New zoom level for a pinch that started at `startDistance` with `startScale`. */
export function pinchScale(startScale: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return clampScale(startScale);
  return clampScale(startScale * (currentDistance / startDistance));
}

export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Zoom a double tap toggles to: back to 1 when zoomed, otherwise the preset. */
export function doubleTapScale(current: number): number {
  return current > LIGHTBOX_MIN_SCALE ? LIGHTBOX_MIN_SCALE : LIGHTBOX_DOUBLE_TAP_SCALE;
}

/** Backdrop opacity while the image is being pulled down to dismiss. */
export function dismissProgressOpacity(dy: number): number {
  if (dy <= 0) return 1;
  return Math.max(0.35, 1 - dy / 400);
}
