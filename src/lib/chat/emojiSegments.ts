/**
 * Split one-line preview text (reply bar, thread rows, pins) into text,
 * custom emoji and Unicode emoji runs, so previews can show small emoji
 * images like the message itself. Pure.
 */
import { customEmojiTokenRegex } from "./customEmoji";

export type EmojiSegment =
  | { kind: "text"; text: string }
  | { kind: "custom"; name: string; id: string; animated: boolean }
  | { kind: "unicode"; char: string };

/**
 * One emoji: keycaps, flags (regional indicator pairs), and pictographs with
 * their variation selector, skin tone, tag and ZWJ parts.
 */
const PART = "\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}]|[\\u{E0020}-\\u{E007F}])*";
const UNICODE_EMOJI_SRC = `[0-9#*]\\uFE0F?\\u20E3|\\p{Regional_Indicator}{2}|${PART}(?:\\u200D${PART})*`;

// Custom emoji tokens are swapped for private-use placeholders while a
// formatter (collapse spaces, strip markdown, truncate) runs over the text.
const PLACEHOLDER_BASE = 0xf0000;

export interface ProtectedText {
  text: string;
  tokens: string[];
}

/** Hide custom emoji tokens from a formatter (it may strip `_` or cut text). */
export function protectEmojiTokens(text: string): ProtectedText {
  const tokens: string[] = [];
  const out = text.replace(customEmojiTokenRegex(), (token) => {
    tokens.push(token);
    return String.fromCodePoint(PLACEHOLDER_BASE + tokens.length - 1);
  });
  return { text: out, tokens };
}

/**
 * Text → segments. `tokens` are the placeholders' tokens from
 * protectEmojiTokens (raw tokens in `text` are found too). A backslash
 * before an emoji or token (Discord's escape) keeps it as plain text.
 */
export function splitEmojiSegments(text: string, tokens: readonly string[] = []): EmojiSegment[] {
  const restored = tokens.length
    ? text.replace(/[\u{F0000}-\u{FFFFD}]/gu, (ch) => tokens[(ch.codePointAt(0) ?? 0) - PLACEHOLDER_BASE] ?? "")
    : text;
  const re = new RegExp(`(\\\\)?(?:${customEmojiTokenRegex("").source}|(${UNICODE_EMOJI_SRC}))`, "gu");
  const out: EmojiSegment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  let at = 0;
  for (const m of restored.matchAll(re)) {
    const index = m.index ?? 0;
    pushText(restored.slice(at, index));
    at = index + m[0].length;
    const [, escaped, animated, name, id, char] = m;
    if (escaped) pushText(m[0].slice(1));
    else if (id) out.push({ kind: "custom", name, id, animated: animated === "a" });
    else if (char) out.push({ kind: "unicode", char });
  }
  pushText(restored.slice(at));
  return out;
}
