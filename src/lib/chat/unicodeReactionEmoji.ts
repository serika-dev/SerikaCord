/**
 * Server-side check that a reaction's unicode emoji is exactly ONE emoji
 * (pure). Nothing a client sends is trusted: without this a modded client
 * could react with arbitrary text, URLs or kilobytes of junk, which every
 * viewer then renders and which bloats the message row.
 *
 * Accepted (the whole string must be one of these):
 *   - keycaps:              1️⃣  #️⃣  *⃣ (digit / # / *, optional VS16, U+20E3)
 *   - flags:                🇯🇵 (a pair of regional indicators)
 *   - tag sequences:        🏴󠁧󠁢󠁥󠁮󠁧󠁿 (subdivision flags)
 *   - pictographs:          😀 ❤️ ©️ ™️, with VS16, a skin tone and tags
 *   - ZWJ sequences of those: 👨‍👩‍👧‍👦 🏳️‍🌈 👩🏽‍💻
 * Capped at MAX_REACTION_EMOJI_LENGTH UTF-16 code units (the longest RGI
 * sequences are well under it).
 */

export const MAX_REACTION_EMOJI_LENGTH = 32;

/** A pictograph (or bare skin-tone swatch) with its VS16 / skin tone / tag parts. */
const PART = '(?:\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}])(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}]|[\\u{E0020}-\\u{E007F}])*';
const KEYCAP = '[0-9#*]\\uFE0F?\\u20E3';
const FLAG = '\\p{Regional_Indicator}{2}';

const SINGLE_EMOJI_RE = new RegExp(`^(?:${KEYCAP}|${FLAG}|${PART}(?:\\u200D${PART})*)$`, 'u');

/** True when `value` is a single unicode emoji usable as a reaction. */
export function isValidUnicodeReactionEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_REACTION_EMOJI_LENGTH) return false;
  return SINGLE_EMOJI_RE.test(value);
}
