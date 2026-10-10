/**
 * Emoji frecency (frequency + recency), the way Discord ranks "Frequently
 * Used": every use is remembered with its time (the last few), each recent use
 * is weighted by its age, and the total use count scales the average weight.
 * Pure; the client store lives in emojiFrecencyStore.ts.
 */

export type FrecencyEmoji =
  | { kind: "unicode"; emoji: string }
  | { kind: "custom"; id: string; name: string; url: string; animated?: boolean };

export interface FrecencyEntry {
  emoji: FrecencyEmoji;
  /** Total uses. */
  count: number;
  /** Times (ms) of the most recent uses, newest first. */
  recent: number[];
}

export type FrecencyState = Readonly<Record<string, FrecencyEntry>>;

/** Recent use times kept per emoji. */
export const MAX_RECENT_USES = 10;
/** Emojis remembered at all (lowest scores are dropped). */
export const MAX_FRECENCY_ENTRIES = 120;

const DAY = 24 * 60 * 60 * 1000;

export function emojiKey(emoji: FrecencyEmoji): string {
  return emoji.kind === "custom" ? `c:${emoji.id}` : `u:${emoji.emoji}`;
}

/** The reaction / composer token for an emoji. */
export function emojiToken(emoji: FrecencyEmoji): string {
  return emoji.kind === "custom" ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.emoji;
}

function ageWeight(ageMs: number): number {
  if (ageMs <= 3 * DAY) return 100;
  if (ageMs <= 7 * DAY) return 70;
  if (ageMs <= 30 * DAY) return 50;
  if (ageMs <= 90 * DAY) return 30;
  return 10;
}

export function frecencyScore(entry: FrecencyEntry, now: number): number {
  if (entry.recent.length === 0 || entry.count <= 0) return 0;
  let sum = 0;
  for (const t of entry.recent) sum += ageWeight(Math.max(0, now - t));
  return Math.round((entry.count * sum) / entry.recent.length);
}

/** Record one use of `emoji` at `now`. */
export function recordEmojiUse(state: FrecencyState, emoji: FrecencyEmoji, now: number): FrecencyState {
  const key = emojiKey(emoji);
  const prev = state[key];
  const entry: FrecencyEntry = {
    // Custom emoji metadata (name / url) refreshes with every use.
    emoji,
    count: (prev?.count ?? 0) + 1,
    recent: [now, ...(prev?.recent ?? [])].slice(0, MAX_RECENT_USES),
  };
  const next: Record<string, FrecencyEntry> = { ...state, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length > MAX_FRECENCY_ENTRIES) {
    const ranked = keys
      .filter((k) => k !== key)
      .sort((a, b) => frecencyScore(next[a], now) - frecencyScore(next[b], now));
    for (const k of ranked.slice(0, keys.length - MAX_FRECENCY_ENTRIES)) delete next[k];
  }
  return next;
}

/** Emojis by frecency, best first (ties: most recently used first). */
export function rankFrecentEmojis(state: FrecencyState, now: number, limit = 36): FrecencyEmoji[] {
  return Object.values(state)
    .map((entry) => ({ entry, score: frecencyScore(entry, now) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.recent[0] ?? 0) - (a.entry.recent[0] ?? 0))
    .slice(0, limit)
    .map((x) => x.entry.emoji);
}

/** Validate stored state (localStorage can hold anything). */
export function sanitizeFrecencyState(raw: unknown): FrecencyState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, FrecencyEntry> = {};
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Partial<FrecencyEntry>;
    const e = v.emoji as FrecencyEmoji | undefined;
    if (!e || (e.kind !== "unicode" && e.kind !== "custom")) continue;
    if (e.kind === "unicode" && (typeof e.emoji !== "string" || !e.emoji)) continue;
    if (e.kind === "custom" && (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.url !== "string")) continue;
    const recent = Array.isArray(v.recent) ? v.recent.filter((t): t is number => typeof t === "number" && Number.isFinite(t)).slice(0, MAX_RECENT_USES) : [];
    const count = typeof v.count === "number" && v.count > 0 ? Math.floor(v.count) : recent.length;
    if (!recent.length || count <= 0) continue;
    out[emojiKey(e)] = { emoji: e, count, recent };
  }
  return out;
}

/** Seed frecency from the old "recently used" list (newest first). */
export function frecencyFromRecentList(list: FrecencyEmoji[], now: number): FrecencyState {
  let state: FrecencyState = {};
  // Oldest first, a minute apart, so the order survives.
  [...list].reverse().forEach((emoji, i) => {
    state = recordEmojiUse(state, emoji, now - (list.length - i) * 60_000);
  });
  return state;
}

/** Discord's default quick reactions, used until the user has history. */
export const DEFAULT_QUICK_REACTIONS: FrecencyEmoji[] = ["👍", "❤️", "😂", "😮", "😢", "🔥"].map((emoji) => ({
  kind: "unicode" as const,
  emoji,
}));

/** `count` quick reactions: frecent first, padded with the defaults. */
export function quickReactions(frecent: FrecencyEmoji[], count: number): FrecencyEmoji[] {
  const out: FrecencyEmoji[] = [];
  const seen = new Set<string>();
  for (const e of [...frecent, ...DEFAULT_QUICK_REACTIONS]) {
    const k = emojiKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}
