/**
 * Ranking for the Ctrl+K quick switcher (Discord's): prefixes narrow the
 * search, matches are fuzzy, and mentions / unread / recently visited places
 * float up. Pure: no React, no network.
 *
 *   @name   users and DMs
 *   #name   text channels (text, announcement, forum)
 *   !name   voice channels (voice, stage)
 *   *name   servers
 */

export type SwitcherKind = "server" | "channel" | "dm" | "group" | "user";
export type SwitcherMode = "all" | "user" | "text" | "voice" | "server";

export interface SwitcherItem {
  key: string;
  kind: SwitcherKind;
  label: string;
  /** Searched as a weaker match (server name, group members, username). */
  sublabel?: string;
  /** Extra search terms (e.g. @username for a nickname). */
  aliases?: string[];
  channelType?: string;
  href: string;
  unread?: boolean;
  mentions?: number;
}

const TEXT_TYPES = new Set(["text", "announcement", "forum"]);
const VOICE_TYPES = new Set(["voice", "stage"]);

export function parseSwitcherQuery(raw: string): { mode: SwitcherMode; term: string } {
  const value = raw.trimStart();
  const first = value.charAt(0);
  const rest = value.slice(1).trim().toLowerCase();
  switch (first) {
    case "@":
      return { mode: "user", term: rest };
    case "#":
      return { mode: "text", term: rest };
    case "!":
      return { mode: "voice", term: rest };
    case "*":
      return { mode: "server", term: rest };
    default:
      return { mode: "all", term: value.trim().toLowerCase() };
  }
}

export function itemMatchesMode(item: SwitcherItem, mode: SwitcherMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "user":
      return item.kind === "user" || item.kind === "dm" || item.kind === "group";
    case "text":
      return item.kind === "channel" && TEXT_TYPES.has(item.channelType ?? "text");
    case "voice":
      return item.kind === "channel" && VOICE_TYPES.has(item.channelType ?? "");
    case "server":
      return item.kind === "server";
  }
}

/**
 * How well `text` matches `term` (0 = no match): exact > prefix > start of a
 * word > substring > in-order letters (fuzzy, "gnrl" finds "general").
 */
export function matchScore(text: string | undefined, term: string): number {
  if (!term) return 1;
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t === term) return 100;
  if (t.startsWith(term)) return 80 - Math.min(20, t.length - term.length) * 0.5;
  const wordStart = new RegExp(`(^|[\\s\\-_.·,/])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (wordStart.test(t)) return 60;
  const idx = t.indexOf(term);
  if (idx >= 0) return 45 - Math.min(15, idx);
  // Subsequence: every letter in order; tighter spans score higher.
  let pos = -1;
  let first = -1;
  for (const ch of term) {
    pos = t.indexOf(ch, pos + 1);
    if (pos < 0) return 0;
    if (first < 0) first = pos;
  }
  const span = pos - first + 1;
  return Math.max(5, 30 - (span - term.length) * 2);
}

export interface RankOptions {
  /** key → recency rank (0 = most recent). */
  recent?: Map<string, number>;
  limit?: number;
}

function boost(item: SwitcherItem, recent: Map<string, number> | undefined): number {
  let b = 0;
  if (item.mentions && item.mentions > 0) b += 30;
  else if (item.unread) b += 12;
  const r = recent?.get(item.key);
  if (r !== undefined) b += Math.max(0, 25 - r * 2);
  return b;
}

const KIND_ORDER: Record<SwitcherKind, number> = { dm: 0, group: 0, channel: 1, user: 2, server: 3 };

/** Filters and orders the switcher rows for a query. */
export function rankSwitcherItems(items: readonly SwitcherItem[], rawQuery: string, opts: RankOptions = {}): SwitcherItem[] {
  const { mode, term } = parseSwitcherQuery(rawQuery);
  const limit = opts.limit ?? 50;
  const pool = items.filter((i) => itemMatchesMode(i, mode));

  if (!term) {
    // Discord with an empty box: places with mentions, then where you were
    // recently, then anything unread. With a prefix only, everything of that kind.
    const scored = pool
      .map((item) => ({ item, score: boost(item, opts.recent) }))
      .filter(({ score }) => mode !== "all" || score > 0);
    scored.sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.label.localeCompare(b.item.label));
    return scored.slice(0, limit).map((s) => s.item);
  }

  const scored: Array<{ item: SwitcherItem; score: number }> = [];
  for (const item of pool) {
    const main = matchScore(item.label, term);
    const alias = Math.max(0, ...(item.aliases || []).map((a) => matchScore(a, term) * 0.9));
    const sub = matchScore(item.sublabel, term) * 0.4;
    const base = Math.max(main, alias, sub);
    if (base <= 0) continue;
    scored.push({ item, score: base + boost(item, opts.recent) * 0.6 });
  }
  scored.sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((s) => s.item);
}

/** Moves `key` to the front of a recent-visits list (deduped, capped). */
export function pushRecent(list: readonly string[], key: string, max = 30): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}

/** The switcher key for the place at `pathname` (`/channels/<s>/<c>`, `/dm/<id>`, `/channels/<s>`). */
export function switcherKeyForPath(pathname: string): string | null {
  const ch = /^\/channels\/([^/]+)\/([^/?#]+)/.exec(pathname);
  if (ch && ch[1] !== "@me") return `c-${ch[2]}`;
  const group = /^\/dm\/group\/([^/?#]+)/.exec(pathname);
  if (group) return `g-${group[1]}`;
  const dm = /^\/dm\/([^/?#]+)/.exec(pathname);
  if (dm) return `d-${dm[1]}`;
  const server = /^\/channels\/([^/?#]+)\/?$/.exec(pathname);
  if (server && server[1] !== "@me") return `s-${server[1]}`;
  return null;
}
