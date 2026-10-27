/**
 * Name matching for GET /channels/{id}/threads/search (pure, unit tested in
 * tests/msgparity-thread-search.test.ts).
 *
 * Discord matches the search words against the words of the thread title:
 * every search word must match (prefix) some title word, and `slop` is how
 * many other words may sit between the matched ones (default 2, 0..100).
 * `sort_by=relevance` ranks tighter, earlier and exact matches first.
 * `min_id` / `max_id` bound the thread ids; ids are derived from creation
 * time, so the bounds are compared as creation timestamps.
 */
import { DISCORD_EPOCH } from './snowflake';

export const DEFAULT_SLOP = 2;
export const MAX_SLOP = 100;

/** Lowercase title / query words (letters and digits, any script). */
export function searchWords(text: string | null | undefined): string[] {
  return (text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** `slop` query value: integer 0..100, default 2; null when invalid. */
export function parseSlop(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SLOP;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SLOP) return null;
  return n;
}

export interface NameMatch {
  /** Words between the matched ones (the smallest window). */
  gap: number;
  /** Position of the first matched title word. */
  start: number;
  /** The query words appear in order and adjacent. */
  phrase: boolean;
  /** The title is exactly the query. */
  exact: boolean;
}

/**
 * Match `query` words against `title`. Null = no match (a word is missing or
 * the words are further apart than `slop`). An empty query matches anything.
 */
export function matchThreadName(title: string | null | undefined, query: string[], slop: number): NameMatch | null {
  const words = [...new Set(query.map((w) => w.toLowerCase()).filter(Boolean))];
  const tokens = searchWords(title);
  if (words.length === 0) return { gap: 0, start: 0, phrase: true, exact: false };
  // (title position, query word index) for every prefix hit.
  const hits: Array<[number, number]> = [];
  tokens.forEach((t, pos) => words.forEach((w, wi) => { if (t.startsWith(w)) hits.push([pos, wi]); }));
  if (new Set(hits.map((h) => h[1])).size < words.length) return null;

  // Smallest window of title positions that covers every query word.
  let best: { gap: number; start: number } | null = null;
  const counts = new Map<number, number>();
  let covered = 0;
  let lo = 0;
  for (let hi = 0; hi < hits.length; hi++) {
    const wi = hits[hi][1];
    counts.set(wi, (counts.get(wi) ?? 0) + 1);
    if (counts.get(wi) === 1) covered++;
    while (covered === words.length) {
      const span = hits[hi][0] - hits[lo][0] + 1;
      const gap = Math.max(0, span - words.length);
      if (!best || gap < best.gap || (gap === best.gap && hits[lo][0] < best.start)) best = { gap, start: hits[lo][0] };
      const lw = hits[lo][1];
      counts.set(lw, counts.get(lw)! - 1);
      if (counts.get(lw) === 0) covered--;
      lo++;
    }
  }
  if (!best || best.gap > slop) return null;
  const joinedTitle = tokens.join(' ');
  const joinedQuery = words.join(' ');
  return {
    gap: best.gap,
    start: best.start,
    phrase: joinedTitle.includes(joinedQuery),
    exact: joinedTitle === joinedQuery,
  };
}

/** Higher = more relevant (exact > phrase > tight > early). */
export function relevanceScore(m: NameMatch): number {
  return (m.exact ? 1000 : 0) + (m.phrase ? 500 : 0) - m.gap * 20 - Math.min(m.start, 20);
}

/**
 * A `min_id` / `max_id` snowflake as a creation time (ms). Undefined = no
 * bound, NaN = not a snowflake (the caller resolves UUIDs from legacy apps).
 */
export function snowflakeBoundMs(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw);
  if (!/^\d{1,20}$/.test(s)) return NaN;
  try {
    const ms = Number(BigInt(s) >> 22n) + DISCORD_EPOCH;
    return Number.isFinite(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
}
