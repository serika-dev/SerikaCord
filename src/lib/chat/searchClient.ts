/**
 * Client-side helpers for message search: turning a parsed search bar into
 * request params (resolving from:/mentions:/in: names to ids), grouping hits
 * for the results panel, pagination, and recent-search history. Pure.
 */
import {
  searchTimeWindow,
  type ParsedSearchQuery,
  type SearchSort,
} from "./searchQuery";

export const SEARCH_RESULTS_PER_PAGE = 25;

export interface SearchUserOption {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

export interface SearchChannelOption {
  id: string;
  name: string;
  type?: string | null;
}

const lower = (s: string | null | undefined) => (s || "").toLowerCase();

/** Exact (case-insensitive) username / display name / id match. */
export function resolveSearchUser(value: string, users: readonly SearchUserOption[]): SearchUserOption | null {
  const v = lower(value);
  return (
    users.find((u) => u.id === value) ||
    users.find((u) => lower(u.username) === v) ||
    users.find((u) => lower(u.displayName) === v) ||
    null
  );
}

export function resolveSearchChannel(value: string, channels: readonly SearchChannelOption[]): SearchChannelOption | null {
  const v = lower(value);
  return channels.find((c) => c.id === value) || channels.find((c) => lower(c.name) === v) || null;
}

export interface SearchRequest {
  params: Record<string, string>;
  /** An in: channel couldn't be resolved: nothing can match. */
  impossible: boolean;
}

/** Build the query params for /messages/search from a parsed query. */
export function buildSearchRequest(
  parsed: ParsedSearchQuery,
  opts: {
    users: readonly SearchUserOption[];
    channels?: readonly SearchChannelOption[];
    sort: SearchSort;
    page: number;
    tzOffsetMinutes: number;
  },
): SearchRequest {
  const params: Record<string, string> = {};
  let impossible = false;
  if (parsed.text) params.q = parsed.text;

  const authorIds: string[] = [];
  const authorNames: string[] = [];
  for (const f of parsed.from) {
    const u = resolveSearchUser(f, opts.users);
    if (u) authorIds.push(u.id);
    else authorNames.push(f);
  }
  if (authorIds.length) params.authorId = authorIds.join(",");
  if (authorNames.length) params.author = authorNames.join(",");

  const mentionIds: string[] = [];
  const mentionNames: string[] = [];
  for (const f of parsed.mentions) {
    const u = resolveSearchUser(f, opts.users);
    if (u) mentionIds.push(u.id);
    else mentionNames.push(f);
  }
  if (mentionIds.length) params.mentions = mentionIds.join(",");
  if (mentionNames.length) params.mentionName = mentionNames.join(",");

  if (parsed.inChannels.length) {
    const ids: string[] = [];
    for (const name of parsed.inChannels) {
      const c = opts.channels ? resolveSearchChannel(name, opts.channels) : null;
      if (c) ids.push(c.id);
    }
    if (ids.length === 0) impossible = true;
    else params.channelId = ids.join(",");
  }
  if (parsed.has.length) params.has = parsed.has.join(",");
  if (parsed.authorTypes.length) params.authorType = parsed.authorTypes.join(",");
  if (parsed.pinned !== undefined) params.pinned = String(parsed.pinned);
  const { minTime, maxTime } = searchTimeWindow(parsed, opts.tzOffsetMinutes);
  if (minTime) params.minTime = minTime;
  if (maxTime) params.maxTime = maxTime;
  if (minTime && maxTime && minTime >= maxTime) impossible = true;
  params.sort = opts.sort;
  params.offset = String(Math.max(0, opts.page) * SEARCH_RESULTS_PER_PAGE);
  params.limit = String(SEARCH_RESULTS_PER_PAGE);
  return { params, impossible };
}

/** Consecutive hits from the same channel share one header, like Discord. */
export function groupSearchHits<H extends { id: string; channelId: string }>(hits: readonly H[]): Array<{ channelId: string; hits: H[] }> {
  const groups: Array<{ channelId: string; hits: H[] }> = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last && last.channelId === hit.channelId) last.hits.push(hit);
    else groups.push({ channelId: hit.channelId, hits: [hit] });
  }
  return groups;
}

/**
 * Page buttons for `current` (0-based) of `count` pages: first, last, and a
 * window around the current page, with null marking an ellipsis.
 */
export function searchPageNumbers(current: number, count: number): Array<number | null> {
  if (count <= 1) return count === 1 ? [0] : [];
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const out: Array<number | null> = [0];
  const start = Math.max(1, Math.min(current - 1, count - 5));
  const end = Math.min(count - 2, Math.max(current + 1, 4));
  if (start > 1) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < count - 2) out.push(null);
  out.push(count - 1);
  return out;
}

export const SEARCH_HISTORY_MAX = 5;

/** Most-recent-first history with `entry` added (deduped, capped). */
export function pushSearchHistory(history: readonly string[], entry: string): string[] {
  const e = entry.trim();
  if (!e) return [...history];
  return [e, ...history.filter((h) => h !== e)].slice(0, SEARCH_HISTORY_MAX);
}

/** Calendar date (YYYY-MM-DD) in local time, `daysAgo` days back. */
export function localDateString(daysAgo = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
