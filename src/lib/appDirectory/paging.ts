/**
 * App Directory search, sort and keyset paging over the cached list of listed
 * apps (pure; the list itself comes from src/lib/services/appDirectory.ts).
 *
 * Every sort turns an app into a tuple key that ends with the app id, so the
 * order is total. A cursor is the key of the last app on a page; the next
 * page starts with the first app whose key is greater. Apps added or removed
 * between requests never cause duplicates or skipped neighbours.
 */
import { isAppCategory, type AppCategory } from './listing';

export const DIRECTORY_SORTS = ['popular', 'new', 'name'] as const;
export type DirectorySort = typeof DIRECTORY_SORTS[number];

export function isDirectorySort(value: unknown): value is DirectorySort {
  return typeof value === 'string' && (DIRECTORY_SORTS as readonly string[]).includes(value);
}

export const DIRECTORY_PAGE_DEFAULT = 24;
export const DIRECTORY_PAGE_MAX = 48;
export const DIRECTORY_SEARCH_MAX = 100;

export interface DirectoryEntry {
  id: string;
  name: string;
  shortDescription: string;
  categories: string[];
  tags: string[];
  verified: boolean;
  /** Made by SerikaCord (staff-only flag); optional for older callers. */
  official?: boolean;
  featured: boolean;
  serverCount: number;
  /** When the app was listed (falls back to creation), ms since epoch. */
  listedAtMs: number;
}

type KeyPart = number | string;
export type SortKey = KeyPart[];

export function sortKey(app: DirectoryEntry, sort: DirectorySort): SortKey {
  const name = app.name.toLowerCase();
  switch (sort) {
    case 'new': return [-app.listedAtMs, app.id];
    case 'name': return [name, app.id];
    case 'popular':
    default:
      // Most servers first; verified apps win ties.
      return [-app.serverCount, app.verified ? 0 : 1, name, app.id];
  }
}

export function compareKeys(a: SortKey, b: SortKey): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    const xs = String(x);
    const ys = String(y);
    if (xs !== ys) return xs < ys ? -1 : 1;
  }
  return a.length - b.length;
}

const KEY_SHAPES: Record<DirectorySort, ('n' | 's')[]> = {
  popular: ['n', 'n', 's', 's'],
  new: ['n', 's'],
  name: ['s', 's'],
};

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function encodeCursor(key: SortKey): string {
  return toBase64Url(JSON.stringify(key));
}

/** The key a cursor carries, or null when it is malformed or from another sort. */
export function decodeCursor(raw: unknown, sort: DirectorySort): SortKey | null {
  if (typeof raw !== 'string') return null;
  const json = fromBase64Url(raw);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const shape = KEY_SHAPES[sort];
  if (!Array.isArray(parsed) || parsed.length !== shape.length) return null;
  for (let i = 0; i < shape.length; i++) {
    const v = parsed[i];
    if (shape[i] === 'n' ? typeof v !== 'number' || !Number.isFinite(v) : typeof v !== 'string' || v.length > 200) return null;
  }
  return parsed as SortKey;
}

/** Lowercased, whitespace-collapsed search terms (at most 8). */
export function searchTerms(search: string | null | undefined): string[] {
  if (!search) return [];
  return search.toLowerCase().slice(0, DIRECTORY_SEARCH_MAX).split(/\s+/).filter(Boolean).slice(0, 8);
}

/** Every term must appear in the name, short description, tags or category ids. */
export function matchesSearch(app: DirectoryEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${app.name}\n${app.shortDescription}\n${app.tags.join('\n')}\n${app.categories.join('\n')}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export interface DirectoryQuery {
  search?: string | null;
  category?: AppCategory | null;
  sort?: DirectorySort;
  cursor?: SortKey | null;
  limit?: number;
  featuredOnly?: boolean;
  /** Only official ("Made by SerikaCord") apps. */
  officialOnly?: boolean;
}

export interface DirectoryPage<T extends DirectoryEntry> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return DIRECTORY_PAGE_DEFAULT;
  return Math.min(DIRECTORY_PAGE_MAX, Math.floor(n));
}

export function pageDirectory<T extends DirectoryEntry>(entries: readonly T[], query: DirectoryQuery = {}): DirectoryPage<T> {
  const sort = query.sort ?? 'popular';
  const limit = clampLimit(query.limit);
  const terms = searchTerms(query.search);
  const category = query.category && isAppCategory(query.category) ? query.category : null;
  const filtered = entries
    .filter((a) => (!category || a.categories.includes(category)) && (!query.featuredOnly || a.featured) && (!query.officialOnly || a.official === true) && matchesSearch(a, terms))
    .map((a) => ({ a, k: sortKey(a, sort) }))
    .sort((x, y) => compareKeys(x.k, y.k));
  const cursor = query.cursor ?? null;
  const start = cursor ? filtered.findIndex((x) => compareKeys(x.k, cursor) > 0) : 0;
  const from = start < 0 ? filtered.length : start;
  const slice = filtered.slice(from, from + limit);
  const more = from + limit < filtered.length;
  return {
    items: slice.map((x) => x.a),
    nextCursor: more && slice.length > 0 ? encodeCursor(slice[slice.length - 1].k) : null,
    total: filtered.length,
  };
}
