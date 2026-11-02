/**
 * Where the on-screen keyboard is, from the visual viewport (pure).
 *
 * Browsers report the keyboard three ways:
 * - Chrome / Samsung Internet with `interactive-widget=resizes-content`
 *   (our viewport meta): the whole layout viewport shrinks, so
 *   `innerHeight - visualViewport.height` stays 0 and only the drop in
 *   height against the keyboard-closed height gives the keyboard away.
 * - iOS Safari and resizes-visual browsers: only the visual viewport shrinks
 *   (and pans, `offsetTop`), the layout keeps its full height.
 * - The Android app's WebView: the view itself is resized (adjustResize,
 *   Capacitor's margins on Android 15+ with WebView <= 139), or the WebView
 *   shrinks its viewport itself (WebView 140+ drawn edge to edge), or nothing
 *   does and the keyboard covers the page (native inset measurement).
 *
 * The phone shell is sized to `visualViewport.height` in every case, so the
 * composer sits right on the keyboard; this only decides "is it open" and how
 * much of the page the keyboard still covers. Covered by
 * tests/keyboard-viewport.test.ts.
 */

/** Overlay (px) of the layout viewport that counts as a keyboard. */
export const KEYBOARD_OVERLAY_PX = 80;
/** Shrink (px) against the keyboard-closed height that counts as a keyboard
 *  (above browser toolbars appearing, ~56px, and below the smallest keyboards). */
export const KEYBOARD_SHRINK_PX = 120;

export interface ViewportSample {
  /** window.innerWidth: a change (rotation, split screen) resets the baseline. */
  width: number;
  innerHeight: number;
  vvHeight: number;
  vvOffsetTop: number;
  /** A text field has focus (a resize without one is a toolbar or a window resize). */
  editableFocused: boolean;
}

/** The keyboard-closed visible height at a given width. */
export interface ViewportBaseline {
  width: number;
  height: number;
}

export interface KeyboardMeasure {
  /** How much of the layout viewport the keyboard covers (overlay browsers). */
  inset: number;
  /** How far the visible height dropped below the keyboard-closed height. */
  shrink: number;
  open: boolean;
  baseline: ViewportBaseline;
}

export function measureKeyboard(sample: ViewportSample, prev: ViewportBaseline | null): KeyboardMeasure {
  const vvHeight = Math.round(sample.vvHeight);
  const inset = Math.max(0, Math.round(sample.innerHeight - sample.vvHeight - sample.vvOffsetTop));
  const sameWidth = !!prev && prev.width === sample.width;
  const baseHeight = sameWidth ? prev!.height : vvHeight;
  const shrink = Math.max(0, baseHeight - vvHeight);
  const open = inset > KEYBOARD_OVERLAY_PX || (sample.editableFocused && shrink > KEYBOARD_SHRINK_PX);
  // The baseline is the keyboard-closed height at this width: with no text
  // field focused there is no keyboard, so it is simply the current height
  // (window resizes, split screen); while one is focused it only grows, so it
  // never learns the keyboard-open height.
  const height = !sameWidth || !sample.editableFocused ? vvHeight : open ? baseHeight : Math.max(baseHeight, vvHeight);
  return { inset, shrink, open, baseline: { width: sample.width, height } };
}

/**
 * The app: how much padding the keyboard still needs once the WebView's own
 * handling is accounted for. `keyboard` is the native measurement (how much
 * of the WebView view the IME covers); if the page's visible height already
 * shrank by that much (the WebView handled it), nothing is left to pad.
 * Small leftovers (rounding, the suggestion strip animating) count as 0.
 */
export function remainingKeyboardInset(input: {
  keyboard: number;
  keyboardVisible: boolean;
  closedHeight: number;
  vvHeight: number;
}): number {
  if (!input.keyboardVisible || !(input.keyboard > 0)) return 0;
  const shrink = input.closedHeight > 0 ? Math.max(0, input.closedHeight - input.vvHeight) : 0;
  const left = Math.round(input.keyboard - shrink);
  return left > 8 ? left : 0;
}
