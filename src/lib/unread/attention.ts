/**
 * "Is the user looking at the app?" — the rule that decides when the
 * conversation on screen counts as read and when alerts stay quiet.
 *
 * `document.hasFocus()` alone is too strict: it is false on a second monitor
 * while the user reads without clicking, inside the Qt/Tauri shells, and after
 * a click into an embed iframe or devtools, so badges never cleared while the
 * user was plainly reading. Discord's rule instead: the page is visible AND
 * (the window has focus OR the user touched the page — pointer, keyboard,
 * wheel, scroll — within the last minute). On touch devices (Capacitor,
 * mobile browsers) a visible page is enough.
 */

/** How long an interaction keeps an unfocused window "attended". */
export const ATTENTION_WINDOW_MS = 60_000;

export interface AttentionInput {
  visible: boolean;
  focused: boolean;
  /** Epoch ms of the last pointer/keyboard/wheel/scroll on the page (0 = never). */
  lastInteractionAt: number;
  now: number;
  /** Touch-first device or native mobile shell. */
  touchDevice?: boolean;
}

export function isAttending(input: AttentionInput): boolean {
  if (!input.visible) return false;
  if (input.touchDevice) return true;
  if (input.focused) return true;
  return input.lastInteractionAt > 0 && input.now - input.lastInteractionAt < ATTENTION_WINDOW_MS;
}

/** When an unfocused window stops counting as attended (null = no expiry pending). */
export function attentionExpiresAt(input: AttentionInput): number | null {
  if (!input.visible || input.touchDevice || input.focused) return null;
  if (!input.lastInteractionAt) return null;
  const at = input.lastInteractionAt + ATTENTION_WINDOW_MS;
  return at > input.now ? at : null;
}
