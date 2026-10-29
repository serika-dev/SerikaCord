/**
 * One index over every Unicode emoji and all its shortcode names, built once
 * on first use: Discord names and aliases (emojiAliases.ts), `flag_xx`, the
 * legacy EMOJI_NAMES map, then the CLDR names of the full Unicode dataset
 * (emojiData.generated.ts). Also the `:` autocomplete ranking and the picker
 * search. Pure (no React, no DOM); the composer loads it lazily through
 * emojiIndexLoader.ts, the picker imports it from its own lazy chunk.
 */
import { EMOJI_DATA } from "./emojiData.generated";
import { EMOJI_ALIAS_LINES } from "./emojiAliases";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import type { ResolvedEmoji, ShortcodeResolver, SkinToneNumber } from "./emojiShortcodes";

export interface UnicodeEmoji {
  /** The emoji as inserted (fully qualified, no skin tone). */
  char: string;
  /** Shortcode names, the Discord one first. */
  names: string[];
  /** canonicalName() of each name, same order (ranking compares these). */
  keys: string[];
  /** Extra search words (picker search only). */
  keywords: string[];
  /** Takes a skin-tone modifier. */
  skin: boolean;
}

export interface EmojiIndex {
  entries: UnicodeEmoji[];
  /** By canonical shortcode (see canonicalName). */
  byName: Map<string, UnicodeEmoji>;
  /** By emoji with variation selectors stripped. */
  byChar: Map<string, UnicodeEmoji>;
}

/** 1-5 like Discord's `:skin-tone-N:` (light → dark); 0 = default yellow. */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;
export const SKIN_TONE_MODIFIERS = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"] as const;

const VARIATION_SELECTOR = /️/g;
const TONE_MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/gu;

/** Lookup key for an emoji: VS16 is optional in the wild (❤ vs ❤️). */
export function charKey(char: string): string {
  return char.replace(VARIATION_SELECTOR, "");
}

/** Names compare case-insensitively with `-` and `_` the same (`skin-tone-1`, `t_rex`). */
export function canonicalName(name: string): string {
  const lower = name.toLowerCase();
  return lower === "-1" ? lower : lower.replace(/-/g, "_");
}

/** `👍` + tone 3 → `👍🏽`; ZWJ sequences take the modifier after their first person. */
export function applySkinTone(char: string, tone: SkinTone): string {
  if (!tone) return char;
  const cps = Array.from(char);
  if (cps.length === 0) return char;
  const rest = cps.slice(1);
  if (rest[0] === "️") rest.shift();
  return cps[0] + SKIN_TONE_MODIFIERS[tone - 1] + rest.join("");
}

export function stripSkinTone(char: string): string {
  return char.replace(TONE_MODIFIER, "");
}

function regionalFlagCode(char: string): string | null {
  const cps = Array.from(char).map((c) => c.codePointAt(0) ?? 0);
  if (cps.length !== 2 || cps.some((cp) => cp < 0x1f1e6 || cp > 0x1f1ff)) return null;
  return cps.map((cp) => String.fromCharCode(cp - 0x1f1e6 + 97)).join("");
}

export function buildEmojiIndex(): EmojiIndex {
  const entries: UnicodeEmoji[] = [];
  const byName = new Map<string, UnicodeEmoji>();
  const byChar = new Map<string, UnicodeEmoji>();

  const entryFor = (char: string): UnicodeEmoji => {
    const key = charKey(char);
    let entry = byChar.get(key);
    if (!entry) {
      entry = { char, names: [], keys: [], keywords: [], skin: false };
      byChar.set(key, entry);
      entries.push(entry);
    }
    return entry;
  };
  const claim = (entry: UnicodeEmoji, name: string) => {
    const key = canonicalName(name);
    if (!key || byName.has(key)) return;
    byName.set(key, entry);
    entry.names.push(name);
    entry.keys.push(key);
  };

  // Dataset order (the picker's category order) decides the entry order.
  for (const [char, , keywords, skin] of EMOJI_DATA) {
    const entry = entryFor(char);
    entry.skin = skin === 1;
    if (keywords) entry.keywords = keywords.split(" ");
  }
  // 1. Discord names and aliases win every conflict.
  for (const line of EMOJI_ALIAS_LINES) {
    const [char, ...names] = line.split(" ");
    if (!char) continue;
    const entry = entryFor(char);
    for (const name of names) claim(entry, name);
  }
  // 2. Discord's flag names: flag_us, flag_gb, ...
  for (const entry of entries) {
    const code = regionalFlagCode(entry.char);
    if (code) claim(entry, `flag_${code}`);
  }
  // 3. Legacy names (older Serika names keep working).
  for (const [name, char] of Object.entries(EMOJI_NAMES)) claim(entryFor(char), name);
  // 4. CLDR names for everything else.
  for (const [char, cldr] of EMOJI_DATA) if (cldr) claim(entryFor(char), cldr);

  return { entries, byName, byChar };
}

let cached: EmojiIndex | null = null;
export function getEmojiIndex(): EmojiIndex {
  if (!cached) cached = buildEmojiIndex();
  return cached;
}

/**
 * Resolve a shortcode name (no colons) to an emoji: `sob`, `+1`, `PUKE`,
 * `thumbsup_tone3` / `wave_tone2` (skin tone). `defaultTone` applies to
 * emoji that take one when the name doesn't say.
 */
export function lookupShortcode(index: EmojiIndex, name: string, defaultTone: SkinTone = 0): string | null {
  const key = canonicalName(name);
  const direct = index.byName.get(key);
  if (direct) return direct.skin ? applySkinTone(direct.char, defaultTone) : direct.char;
  const toned = /^(.+)_tone([1-5])$/.exec(key);
  if (toned) {
    const base = index.byName.get(toned[1]);
    if (base?.skin) return applySkinTone(base.char, Number(toned[2]) as SkinTone);
  }
  return null;
}

/** The entry for an emoji as typed or stored (any skin tone / VS16 form). */
export function entryForChar(index: EmojiIndex, char: string): UnicodeEmoji | undefined {
  return index.byChar.get(charKey(stripSkinTone(char))) ?? index.byChar.get(charKey(char));
}

/** Discord-style name for an emoji (hover titles, reaction tooltips). */
export function primaryName(index: EmojiIndex, char: string): string | undefined {
  return entryForChar(index, char)?.names[0];
}

/**
 * Shortcode → emoji for the composer: Unicode names first (with the user's
 * skin tone), then custom emoji in the order given (current server first),
 * exact case before any case (`:KEKW:` vs `:kekw:`).
 */
export function createShortcodeResolver(
  index: EmojiIndex,
  opts: { customEmojis?: readonly CustomEmojiCandidate[]; tone?: SkinTone } = {},
): ShortcodeResolver {
  let exact: Map<string, CustomEmojiCandidate> | null = null;
  let loose: Map<string, CustomEmojiCandidate> | null = null;
  const custom = (name: string): CustomEmojiCandidate | undefined => {
    if (!exact || !loose) {
      exact = new Map();
      loose = new Map();
      for (const e of opts.customEmojis ?? []) {
        if (!e.id || !e.name) continue;
        if (!exact.has(e.name)) exact.set(e.name, e);
        const key = e.name.toLowerCase();
        if (!loose.has(key)) loose.set(key, e);
      }
    }
    return exact.get(name) ?? loose.get(name.toLowerCase());
  };
  return (name: string): ResolvedEmoji | null => {
    const char = lookupShortcode(index, name, opts.tone ?? 0);
    if (char) return { kind: "unicode", char };
    const e = custom(name);
    return e ? { kind: "custom", emoji: { id: e.id, name: e.name, url: e.url, animated: e.animated } } : null;
  };
}

/**
 * For `:skin-tone-N:` typed right after an emoji: the emoji ending `before`
 * that takes a tone, re-toned (an existing tone is replaced).
 */
export function createRetone(index: EmojiIndex) {
  return (before: string, tone: SkinToneNumber): { length: number; char: string } | null => {
    for (let len = Math.min(16, before.length); len >= 1; len--) {
      const candidate = before.slice(-len);
      const base = charKey(stripSkinTone(candidate));
      const entry = index.byChar.get(base);
      if (!entry?.skin || base !== charKey(entry.char)) continue;
      // Not the tail of a longer ZWJ sequence (👨‍👩‍👧 is not 👧).
      if (before[before.length - len - 1] === "\u200D") return null;
      return { length: len, char: applySkinTone(entry.char, tone) };
    }
    return null;
  };
}

// ---- Ranking ---------------------------------------------------------------

export interface CustomEmojiCandidate {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
  serverId?: string;
  serverName?: string;
}

export type EmojiSuggestion =
  | {
      kind: "unicode";
      key: string;
      char: string;
      /** The name that matched (shown as `:name:`). */
      name: string;
      /** Other names worth showing next to it. */
      aliases: string[];
      skin: boolean;
      favorite: boolean;
      score: number;
    }
  | {
      kind: "custom";
      key: string;
      emoji: CustomEmojiCandidate;
      name: string;
      aliases: string[];
      favorite: boolean;
      /** From the server the user is in right now. */
      local: boolean;
      score: number;
    };

export interface RankContext {
  /** Favourited emoji: custom emoji ids, and unicode as emojiRankKey(char). */
  favorites?: ReadonlySet<string>;
  /** Frequent-use score, keyed like `favorites` (see emojiFrecency.ts). */
  frecency?: ReadonlyMap<string, number>;
  /** Custom emoji of the current server first, then the user's other servers. */
  customEmojis?: readonly CustomEmojiCandidate[];
  /** Ids of the current server's emoji (ranked above other servers'). */
  localEmojiIds?: ReadonlySet<string>;
  limit?: number;
}

export const MATCH_EXACT = 1000;
export const MATCH_PREFIX = 700;
export const MATCH_WORD = 450;
export const MATCH_CONTAINS = 250;

/**
 * How well `name` matches `q` (both canonical): exact > prefix > a word of the
 * name starts with it (`_face` in `pleading_face`) > contains. 0 = no match.
 * Shorter names score a little higher inside each tier.
 */
export function nameMatchScore(name: string, q: string): number {
  if (!q) return 0;
  if (name === q) return MATCH_EXACT;
  const lengthBonus = Math.max(0, 40 - (name.length - q.length));
  if (name.startsWith(q)) return MATCH_PREFIX + lengthBonus;
  const at = name.indexOf(q);
  if (at < 0) return 0;
  if (name[at - 1] === "_") return MATCH_WORD + lengthBonus;
  // One-letter queries only match prefixes and words; "contains" is noise.
  return q.length >= 2 ? MATCH_CONTAINS + lengthBonus : 0;
}

/** Favourite / frecency key for a unicode emoji: any skin tone or VS16 form counts. */
export function emojiRankKey(char: string): string {
  return charKey(stripSkinTone(char));
}

function matchTier(score: number): number {
  if (score >= MATCH_EXACT) return 4;
  if (score >= MATCH_PREFIX) return 3;
  if (score >= MATCH_WORD) return 2;
  return score > 0 ? 1 : 0;
}

function boost(key: string, ctx: RankContext): { bonus: number; favorite: boolean } {
  const favorite = ctx.favorites?.has(key) ?? false;
  const frecency = ctx.frecency?.get(key) ?? 0;
  return { favorite, bonus: (favorite ? 220 : 0) + Math.min(200, Math.round(frecency / 4)) };
}

/**
 * `:` autocomplete results for `query` (without the colon), best first.
 * Unicode names and aliases plus custom emoji; favourites and frequently used
 * emoji float up inside their match tier.
 */
export function rankEmojiSuggestions(index: EmojiIndex, query: string, ctx: RankContext = {}): EmojiSuggestion[] {
  const q = canonicalName(query.trim());
  if (!q) return [];
  const out: EmojiSuggestion[] = [];

  for (const entry of index.entries) {
    // The best tier wins; inside a tier the earlier (Discord) name is shown,
    // so `:thumb` lists 👍 as :thumbsup:, not :thumbup:.
    let best = 0;
    let bestName = "";
    for (let i = 0; i < entry.keys.length; i++) {
      const s = nameMatchScore(entry.keys[i], q);
      if (s > best && matchTier(s) > matchTier(best)) {
        best = s;
        bestName = entry.names[i];
      }
    }
    if (!best) continue;
    const { bonus, favorite } = boost(emojiRankKey(entry.char), ctx);
    const primary = entry.names[0];
    const aliases = bestName === primary ? entry.names.slice(1, 3) : [primary];
    out.push({ kind: "unicode", key: `u:${entry.char}`, char: entry.char, name: bestName, aliases, skin: entry.skin, favorite, score: best + bonus });
  }

  const seen = new Set<string>();
  for (const emoji of ctx.customEmojis ?? []) {
    if (!emoji.id || seen.has(emoji.id)) continue;
    seen.add(emoji.id);
    const s = nameMatchScore(canonicalName(emoji.name), q);
    if (!s) continue;
    const local = ctx.localEmojiIds?.has(emoji.id) ?? false;
    const { bonus, favorite } = boost(emoji.id, ctx);
    out.push({
      kind: "custom",
      key: `c:${emoji.id}`,
      emoji,
      name: emoji.name,
      aliases: [],
      favorite,
      local,
      // Exact-case custom names (KEKW) and this server's emoji edge ahead.
      score: s + bonus + (local ? 60 : 0) + (emoji.name === query.trim() ? 5 : 0),
    });
  }

  out.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return out.slice(0, ctx.limit ?? 20);
}

/**
 * Picker search: does this emoji match `query`? Any name or keyword that
 * starts with it, or a name containing it (`puke` finds 🤮, `cry` finds 😭).
 */
export function createEmojiSearch(index: EmojiIndex, query: string): (char: string) => boolean {
  const q = canonicalName(query.trim()).replace(/\s+/g, "_");
  if (!q) return () => true;
  const words = q.split("_").filter(Boolean);
  const matches = new Map<UnicodeEmoji, boolean>();
  const test = (entry: UnicodeEmoji): boolean => {
    for (const key of entry.keys) {
      if (nameMatchScore(key, q) > 0) return true;
    }
    if (words.length === 1) {
      for (const kw of entry.keywords) if (kw.startsWith(words[0])) return true;
    }
    return false;
  };
  return (char: string) => {
    const entry = entryForChar(index, char);
    if (!entry) return false;
    let hit = matches.get(entry);
    if (hit === undefined) {
      hit = test(entry);
      matches.set(entry, hit);
    }
    return hit;
  };
}
