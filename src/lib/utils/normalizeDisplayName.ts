export const DISPLAY_NAME_MAX_LENGTH = 32;

// Zero-width / invisible characters that would otherwise survive trim() and
// render as a blank name (ZWSP, ZWNJ, ZWJ, word joiner, BOM, Hangul filler).
const INVISIBLE_CHARS = /[​-‍⁠﻿ㅤᅟᅠ]/g;

/**
 * Normalize a user-supplied display name: strip invisible characters, trim,
 * cap the length. A name that ends up empty becomes null so every renderer's
 * `displayName || username` fallback shows the username instead of a blank.
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(INVISIBLE_CHARS, '').trim();
  if (!s) return null;
  return Array.from(s).slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim() || null;
}
