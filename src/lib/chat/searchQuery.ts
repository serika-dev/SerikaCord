/**
 * Discord-style search bar grammar, shared by the client (search bar, filter
 * chips, autocomplete) and the server (search routes). Pure: no DOM, no DB.
 *
 *   hello world from:alice mentions:bob has:image in:#general
 *   before:2026-01-01 after:2025-12-01 during:2026-03-14 pinned:true
 *   authorType:bot from:"Display Name With Spaces"
 *
 * `from:`, `mentions:`, `has:`, `in:` and `authorType:` may repeat; the last
 * `before:` / `after:` / `during:` / `pinned:` wins. Values may be quoted.
 */

export const SEARCH_HAS_VALUES = ["link", "embed", "file", "image", "video", "sound", "sticker", "poll"] as const;
export type SearchHas = (typeof SEARCH_HAS_VALUES)[number];

export const SEARCH_AUTHOR_TYPES = ["user", "bot", "webhook"] as const;
export type SearchAuthorType = (typeof SEARCH_AUTHOR_TYPES)[number];

export const SEARCH_FILTER_KEYS = ["from", "mentions", "has", "before", "after", "during", "in", "pinned", "authorType"] as const;
export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number];

export type SearchSort = "newest" | "oldest" | "relevant";

/** One `key:value` filter as it appears in the raw query (for chips/autocomplete). */
export interface SearchToken {
  key: SearchFilterKey;
  /** Value with quotes and a leading @ / # removed. */
  value: string;
  /** Start/end offsets of the whole token in the raw string. */
  start: number;
  end: number;
  /** Whether the value is acceptable for this key (bad ones are ignored). */
  valid: boolean;
}

/** Structured search filters parsed from a raw search bar string. */
export interface ParsedSearchQuery {
  /** Free-text portion (everything that isn't a filter token). */
  text: string;
  from: string[];
  mentions: string[];
  has: SearchHas[];
  /** in:<#channel> values (names or ids; the client resolves names to ids). */
  inChannels: string[];
  authorTypes: SearchAuthorType[];
  /** YYYY-MM-DD (local calendar date). */
  before?: string;
  after?: string;
  during?: string;
  pinned?: boolean;
  tokens: SearchToken[];
}

const KEY_LOOKUP: Record<string, SearchFilterKey> = {
  from: "from",
  mentions: "mentions",
  has: "has",
  before: "before",
  after: "after",
  during: "during",
  on: "during",
  in: "in",
  pinned: "pinned",
  authortype: "authorType",
  author_type: "authorType",
};

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** Normalize a typed date (YYYY-MM-DD, YYYY/MM/DD) to YYYY-MM-DD, or null. */
export function normalizeSearchDate(value: string): string | null {
  const m = value.trim().replace(/\//g, "-").match(DATE_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2200) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1) return null; // e.g. 2026-02-31
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function validFor(key: SearchFilterKey, value: string): boolean {
  if (!value) return false;
  switch (key) {
    case "has": return (SEARCH_HAS_VALUES as readonly string[]).includes(value.toLowerCase());
    case "authorType": return (SEARCH_AUTHOR_TYPES as readonly string[]).includes(value.toLowerCase());
    case "pinned": return value.toLowerCase() === "true" || value.toLowerCase() === "false";
    case "before":
    case "after":
    case "during": return normalizeSearchDate(value) !== null;
    default: return true;
  }
}

/** Split the raw query into whitespace-separated words, keeping quoted spans together. */
function scan(raw: string): Array<{ word: string; start: number; end: number }> {
  const out: Array<{ word: string; start: number; end: number }> = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    const start = i;
    let inQuote = false;
    while (i < raw.length && (inQuote || !/\s/.test(raw[i]))) {
      if (raw[i] === '"') inQuote = !inQuote;
      i++;
    }
    out.push({ word: raw.slice(start, i), start, end: i });
  }
  return out;
}

function cleanValue(v: string): string {
  let value = v;
  if (value.startsWith('"')) value = value.slice(1);
  if (value.endsWith('"')) value = value.slice(0, -1);
  return value.replace(/^[@#]/, "").trim();
}

/** Parse Discord-style search filters out of a raw query. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    text: "",
    from: [],
    mentions: [],
    has: [],
    inChannels: [],
    authorTypes: [],
    tokens: [],
  };
  const textParts: string[] = [];

  for (const { word, start, end } of scan(raw || "")) {
    const m = word.match(/^([a-zA-Z_]+):(.*)$/);
    const key = m ? KEY_LOOKUP[m[1].toLowerCase()] : undefined;
    if (!m || !key) {
      textParts.push(word);
      continue;
    }
    const value = cleanValue(m[2]);
    if (!value) {
      // "from:" with nothing after it is still being typed: keep it out of
      // the text but don't apply anything.
      textParts.push(word);
      continue;
    }
    const valid = validFor(key, value);
    result.tokens.push({ key, value, start, end, valid });
    if (!valid) continue;
    const lower = value.toLowerCase();
    switch (key) {
      case "from": if (!result.from.includes(value)) result.from.push(value); break;
      case "mentions": if (!result.mentions.includes(value)) result.mentions.push(value); break;
      case "has": if (!result.has.includes(lower as SearchHas)) result.has.push(lower as SearchHas); break;
      case "in": if (!result.inChannels.includes(value)) result.inChannels.push(value); break;
      case "authorType": if (!result.authorTypes.includes(lower as SearchAuthorType)) result.authorTypes.push(lower as SearchAuthorType); break;
      case "before": result.before = normalizeSearchDate(value) ?? undefined; break;
      case "after": result.after = normalizeSearchDate(value) ?? undefined; break;
      case "during": result.during = normalizeSearchDate(value) ?? undefined; break;
      case "pinned": result.pinned = lower === "true"; break;
    }
  }

  result.text = textParts.filter((w) => !/^[a-zA-Z_]+:$/.test(w) || !KEY_LOOKUP[w.slice(0, -1).toLowerCase()]).join(" ").trim();
  return result;
}

/** Whether the parsed query carries at least one active filter. */
export function hasActiveFilters(p: ParsedSearchQuery): boolean {
  return Boolean(
    p.from.length || p.mentions.length || p.has.length || p.inChannels.length || p.authorTypes.length ||
    p.before || p.after || p.during || p.pinned !== undefined,
  );
}

/** Whether there is anything to search for at all. */
export function isSearchable(p: ParsedSearchQuery): boolean {
  return p.text.trim().length > 0 || hasActiveFilters(p);
}

/**
 * Turn before/after/during calendar dates into an absolute time window in the
 * searcher's local time zone. `tzOffsetMinutes` is `Date#getTimezoneOffset()`
 * (minutes to add to local time to get UTC). Discord semantics: `before:` is
 * exclusive of that day, `after:` starts the day after, `during:` is that day.
 */
export function searchTimeWindow(
  p: Pick<ParsedSearchQuery, "before" | "after" | "during">,
  tzOffsetMinutes = 0,
): { minTime?: string; maxTime?: string } {
  const dayStartUtc = (ymd: string, addDays = 0): number => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d + addDays) + tzOffsetMinutes * 60_000;
  };
  let min: number | undefined;
  let max: number | undefined;
  if (p.after) min = dayStartUtc(p.after, 1);
  if (p.before) max = dayStartUtc(p.before);
  if (p.during) {
    const s = dayStartUtc(p.during);
    const e = dayStartUtc(p.during, 1);
    min = min === undefined ? s : Math.max(min, s);
    max = max === undefined ? e : Math.min(max, e);
  }
  return {
    minTime: min === undefined ? undefined : new Date(min).toISOString(),
    maxTime: max === undefined ? undefined : new Date(max).toISOString(),
  };
}

/**
 * The filter token (or partial `key:` / bare word) the caret is in, for the
 * autocomplete popover. `key` is null for a free-text word.
 */
export function tokenAtCaret(raw: string, caret: number): {
  key: SearchFilterKey | null;
  /** Whatever is typed after the colon (or the bare word). */
  partial: string;
  start: number;
  end: number;
} {
  const words = scan(raw);
  for (const w of words) {
    if (caret < w.start || caret > w.end) continue;
    const m = w.word.match(/^([a-zA-Z_]+):(.*)$/);
    const key = m ? KEY_LOOKUP[m[1].toLowerCase()] : undefined;
    if (m && key) return { key, partial: cleanValue(m[2]), start: w.start, end: w.end };
    return { key: null, partial: w.word, start: w.start, end: w.end };
  }
  return { key: null, partial: "", start: caret, end: caret };
}

/** Quote a value for insertion when it contains spaces. */
export function quoteSearchValue(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
}

/** Replace the span [start, end) of `raw` with `insert`, returning the new string and caret. */
export function replaceSearchSpan(raw: string, start: number, end: number, insert: string): { value: string; caret: number } {
  const before = raw.slice(0, start);
  let after = raw.slice(end);
  const needsSpace = !after.startsWith(" ");
  after = (needsSpace ? " " : "") + after;
  const value = before + insert + after;
  return { value, caret: before.length + insert.length + 1 };
}
