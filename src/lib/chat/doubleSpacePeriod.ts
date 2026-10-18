/**
 * Android keyboards turn a quick double space after a word into ". ", but
 * that relies on platform text-field APIs Chrome's contentEditable doesn't
 * fully provide, so in the composer it typed two spaces (CORD-62). The
 * composer replays the shortcut itself; this decides when it applies.
 */

/** Max gap between the two spaces, matching the keyboards' own timing. */
export const DOUBLE_SPACE_WINDOW_MS = 450;

/**
 * Whether a space typed now should turn the space before the caret into ". ".
 * `textBeforeCaret` is the composer text up to the caret (the first space
 * already typed); `msSinceLastSpace` is the time since that space.
 */
export function shouldInsertDoubleSpacePeriod(textBeforeCaret: string, msSinceLastSpace: number): boolean {
  if (!(msSinceLastSpace >= 0 && msSinceLastSpace <= DOUBLE_SPACE_WINDOW_MS)) return false;
  // "word␠" exactly: a letter or digit, then the single space just typed.
  return /[\p{L}\p{N}] $/u.test(textBeforeCaret);
}
