/**
 * `:shortcode:` handling in the composer, Discord style. Pure: positions are
 * offsets in the composer's token string (custom emoji are `<:name:id>`,
 * mentions `<@id>`), and emoji lookups come in through a resolver so this
 * module carries no emoji data.
 *
 * - findClosingShortcode: the `:` just typed closes a known `:name:` → replace it.
 * - findShortcodesForSend: every known `:name:` left in a message (pasted text).
 * - emojiQueryAt: the `:qu` token the autocomplete is showing results for.
 *
 * Never inside code (`x`, ```x```), links, `<...>` tokens (`<t:1700000000:R>`),
 * or glued to a letter / digit (`12:30:`, `re:ok:`). Unknown names stay as typed.
 *
 * Backslash escape (Discord): `\:sob:` is never converted or autocompleted
 * while typing; on send it becomes `\😭` / `\<:name:id>` (the backslash stays,
 * so the message shows the raw emoji / token as text).
 */

export type SkinToneNumber = 1 | 2 | 3 | 4 | 5;

export interface ResolvedCustomEmoji {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
}

export type ResolvedEmoji =
  | { kind: "unicode"; char: string }
  | { kind: "custom"; emoji: ResolvedCustomEmoji };

/** Shortcode name (no colons) → emoji, or null when unknown. */
export type ShortcodeResolver = (name: string) => ResolvedEmoji | null;

export interface ShortcodeOptions {
  resolve: ShortcodeResolver;
  /**
   * `:skin-tone-N:` typed right after an emoji that takes a skin tone: the
   * toned emoji and how many characters at the end of `before` it replaces.
   */
  retone?: (before: string, tone: SkinToneNumber) => { length: number; char: string } | null;
}

export interface ShortcodeMatch {
  /** [start, end) in the token string. */
  start: number;
  end: number;
  /** The text that was there (for undo). */
  typed: string;
  emoji: ResolvedEmoji;
}

const NAME_CHAR = /[A-Za-z0-9_+-]/;
const WORD_CHAR = /[A-Za-z0-9]/;
const MAX_NAME = 40;
/** Autocomplete opens after `:` plus this many name characters. */
export const EMOJI_QUERY_MIN = 2;
const EMOJI_QUERY_MAX = 32;

/** `skin-tone-3`, `skin_tone_3`, `tone3` → 3. */
export function skinToneFromName(name: string): SkinToneNumber | null {
  const m = /^(?:skin[-_]tone[-_]|tone)([1-5])$/i.exec(name);
  return m ? (Number(m[1]) as SkinToneNumber) : null;
}

export interface CodeRanges {
  /** Closed code spans / blocks, [start, end). */
  ranges: Array<[number, number]>;
  /** Start of a code span or block that is still open (being typed), if any. */
  openFrom: number | null;
}

/** Inline code (any backtick run length) and fenced blocks. */
export function codeRanges(text: string): CodeRanges {
  const ranges: Array<[number, number]> = [];
  let openFrom: number | null = null;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("```", i)) {
      const close = text.indexOf("```", i + 3);
      if (close < 0) {
        if (openFrom === null) openFrom = i;
        break;
      }
      ranges.push([i, close + 3]);
      i = close + 3;
      continue;
    }
    if (text[i] === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      // The closing run must be exactly as long (`` a ` b `` is one span).
      let close = -1;
      for (let k = i + run; k < text.length; ) {
        if (text[k] !== "`") {
          k++;
          continue;
        }
        let len = 1;
        while (text[k + len] === "`") len++;
        if (len === run) {
          close = k;
          break;
        }
        k += len;
      }
      if (close < 0) {
        if (openFrom === null) openFrom = i;
        i += run;
        continue;
      }
      ranges.push([i, close + run]);
      i = close + run;
      continue;
    }
    i++;
  }
  return { ranges, openFrom };
}

function inCode(code: CodeRanges, pos: number, live: boolean): boolean {
  for (const [a, b] of code.ranges) if (pos >= a && pos < b) return true;
  return live && code.openFrom !== null && pos >= code.openFrom;
}

/** Is `pos` inside a link (`https://…`, `www.…`)? */
export function inUrl(text: string, pos: number): boolean {
  let start = pos;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = pos;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const token = text.slice(start, end);
  return /^[<(]?[a-z][a-z0-9+.-]*:\/\//i.test(token) || /^[<(]?www\./i.test(token);
}

/** Inside an unclosed `<…` token: `<t:1700000000:R>`, `<:name:id>`, `<@id>`. */
function inAngleToken(text: string, pos: number): boolean {
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ">" || /\s/.test(c)) return false;
    if (c === "<") return true;
  }
  return false;
}

function blocked(text: string, colon: number, code: CodeRanges, live: boolean): boolean {
  if (colon > 0 && WORD_CHAR.test(text[colon - 1])) return true;
  return inCode(code, colon, live) || inUrl(text, colon) || inAngleToken(text, colon);
}

/**
 * The `:` before `caret` was just typed: if it closes a known `:name:`, the
 * range to replace and the emoji. `:skin-tone-N:` right after an emoji that
 * takes a tone re-tones that emoji instead.
 */
export function findClosingShortcode(text: string, caret: number, opts: ShortcodeOptions): ShortcodeMatch | null {
  if (caret < 3 || caret > text.length || text[caret - 1] !== ":") return null;
  const close = caret - 1;
  let open = close - 1;
  while (open >= 0 && close - open <= MAX_NAME + 1 && NAME_CHAR.test(text[open])) open--;
  if (open < 0 || text[open] !== ":" || open === close - 1) return null;
  const name = text.slice(open + 1, close);
  if (text[open - 1] === "\\") return null; // `\:sob:` stays as typed until send
  if (blocked(text, open, codeRanges(text.slice(0, caret)), true)) return null;

  const tone = skinToneFromName(name);
  if (tone && opts.retone) {
    const toned = opts.retone(text.slice(0, open), tone);
    if (toned) {
      const start = open - toned.length;
      return { start, end: caret, typed: text.slice(start, caret), emoji: { kind: "unicode", char: toned.char } };
    }
  }
  const emoji = opts.resolve(name);
  if (!emoji) return null;
  return { start: open, end: caret, typed: text.slice(open, caret), emoji };
}

/**
 * Every known `:name:` in `text` (left to right, non-overlapping), for
 * converting a message on send. `:thumbsup::skin-tone-3:` is one match.
 */
export function findShortcodesForSend(text: string, opts: ShortcodeOptions): ShortcodeMatch[] {
  const out: ShortcodeMatch[] = [];
  if (text.indexOf(":") < 0) return out;
  const code = codeRanges(text);
  let i = 0;
  while (i < text.length) {
    if (text[i] !== ":") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && j - i - 1 < MAX_NAME && NAME_CHAR.test(text[j])) j++;
    if (j < text.length && text[j] === ":" && j > i + 1 && !blocked(text, i, code, false)) {
      const name = text.slice(i + 1, j);
      let end = j + 1;
      let emoji: ResolvedEmoji | null = null;
      const toneMatch = /^:(skin[-_]tone[-_]|tone)([1-5]):/i.exec(text.slice(end, end + 16));
      if (toneMatch && !skinToneFromName(name)) {
        emoji = opts.resolve(`${name}_tone${toneMatch[2]}`);
        if (emoji) end += toneMatch[0].length;
      }
      emoji ??= opts.resolve(name);
      if (emoji) {
        out.push({ start: i, end, typed: text.slice(i, end), emoji });
        i = end;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** The token string for an emoji (`<a:name:id>` for custom ones). */
export function emojiText(emoji: ResolvedEmoji): string {
  return emoji.kind === "unicode" ? emoji.char : `<${emoji.emoji.animated ? "a" : ""}:${emoji.emoji.name}:${emoji.emoji.id}>`;
}

/** `text` with the matches replaced (matches ascending, non-overlapping). */
export function applyShortcodeMatches(text: string, matches: readonly ShortcodeMatch[]): string {
  let out = "";
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.start) + emojiText(m.emoji);
    at = m.end;
  }
  return out + text.slice(at);
}

/** The `:query` token the caret sits at the end of (autocomplete), if any. */
export function emojiQueryAt(text: string, caret: number): { start: number; query: string } | null {
  if (caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && caret - i <= EMOJI_QUERY_MAX && NAME_CHAR.test(text[i])) i--;
  if (i < 0 || text[i] !== ":") return null;
  const query = text.slice(i + 1, caret);
  if (query.length < EMOJI_QUERY_MIN || query.length > EMOJI_QUERY_MAX) return null;
  if (text[i - 1] === "\\") return null;
  if (blocked(text, i, codeRanges(text.slice(0, caret)), true)) return null;
  return { start: i, query };
}
