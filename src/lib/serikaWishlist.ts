/**
 * Serika Wishlist (wish.serika.dev) — shared types and pure helpers for the
 * profile Wishlist widget. Used by the server proxy
 * (`src/lib/services/serikaWishlist.ts`) and the client widget, so nothing here
 * may touch the DB, network or browser APIs.
 *
 * Upstream contract (read-only, CORS-enabled, public lists only):
 *   GET {base}/api/public/users/{serikaAccountId}/wishlists?items=N
 *   GET {base}/api/public/users/by-username/{username}/wishlists?items=N
 *   → { user, profileUrl, lists: [...] } | 404 { error }
 */

/** `builtin` id of the placement in `users.profile_widgets`. */
export const SERIKA_WISHLIST_BUILTIN = "serika_wishlist";

/** Wishlist slugs as accepted from clients when featuring one list. */
export const WISHLIST_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const SERIKA_WISHLIST_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_SERIKA_WISHLIST_URL || "https://wish.serika.dev"
).replace(/\/+$/, "");

export interface WishlistMoney {
  amount: number;
  currency: string;
}

export interface WishlistItem {
  title: string;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  url: string | null;
  store: string | null;
  priority: 0 | 1;
  received: boolean;
}

export interface WishlistList {
  slug: string;
  title: string;
  /** List icon image (absolute URL) when the owner set one. Never show `emoji`. */
  iconUrl: string | null;
  description: string;
  url: string;
  itemCount: number;
  totalValue: WishlistMoney | null;
  updatedAt: string | null;
  items: WishlistItem[];
}

export interface WishlistUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

export interface WishlistProfile {
  user: WishlistUser | null;
  profileUrl: string | null;
  lists: WishlistList[];
}

/** Shape returned by GET /api/users/:id/serika-wishlist. */
export interface WishlistWidgetResponse {
  /** Slugs of the wishlist widgets on this Board (null = legacy "first list"). */
  placedSlugs: Array<string | null>;
  /** False when the user has never used Serika Wishlist. */
  found?: boolean;
  profileUrl?: string | null;
  /** Owner: every public list. Visitors: only the placed ones. */
  lists?: WishlistList[];
  error?: string;
  /** Pre-1-list-per-widget fields, kept for clients still running the old bundle. */
  enabled?: boolean;
  listSlug?: string | null;
}

/** Widget placement as stored in users.profile_widgets (one per list). */
export interface WishlistPlacement {
  id: string;
  type: "builtin";
  builtin: typeof SERIKA_WISHLIST_BUILTIN;
  applicationId: null;
  /** null only on placements saved before one-list-per-widget (migrated lazily). */
  options: { listSlug: string | null };
  position?: number;
}

// ── Sanitising ───────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function optStr(v: unknown, max: number): string | null {
  const s = str(v, max);
  return s ? s : null;
}

/** Only absolute http(s) URLs survive; everything else (javascript:, data:, relative) is dropped. */
export function safeHttpUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function currency(v: unknown): string | null {
  const s = str(v, 8).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function sanitizeItem(raw: unknown): WishlistItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 200);
  if (!title) return null;
  const price = num(r.price);
  return {
    title,
    imageUrl: safeHttpUrl(r.imageUrl),
    price: price != null && price >= 0 ? price : null,
    currency: currency(r.currency),
    url: safeHttpUrl(r.url),
    store: optStr(r.store, 80),
    priority: r.priority === 1 ? 1 : 0,
    received: r.received === true,
  };
}

function sanitizeList(raw: unknown, maxItems: number): WishlistList | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = str(r.slug, 64);
  const url = safeHttpUrl(r.url);
  if (!slug || !url) return null;
  const items = (Array.isArray(r.items) ? r.items : [])
    .map(sanitizeItem)
    .filter((i): i is WishlistItem => i !== null)
    .slice(0, maxItems);
  const tv = r.totalValue as Record<string, unknown> | null | undefined;
  const tvAmount = tv && typeof tv === "object" ? num(tv.amount) : null;
  const tvCurrency = tv && typeof tv === "object" ? currency(tv.currency) : null;
  const count = num(r.itemCount);
  return {
    slug,
    title: str(r.title, 120) || slug,
    iconUrl: safeHttpUrl(r.iconUrl),
    description: str(r.description, 500),
    url,
    itemCount: count != null && count >= 0 ? Math.floor(count) : items.length,
    totalValue: tvAmount != null && tvCurrency ? { amount: tvAmount, currency: tvCurrency } : null,
    updatedAt: optStr(r.updatedAt, 40),
    items,
  };
}

function sanitizeUser(raw: unknown): WishlistUser | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const username = str(r.username, 64);
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: optStr(r.displayName, 80),
    avatar: safeHttpUrl(r.avatar),
  };
}

/** Validate an upstream `/wishlists` response into a safe, bounded shape. */
export function sanitizeWishlistProfile(raw: unknown, maxItems = 12, maxLists = 25): WishlistProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.lists)) return null;
  return {
    user: sanitizeUser(r.user),
    profileUrl: safeHttpUrl(r.profileUrl),
    lists: r.lists
      .map((l) => sanitizeList(l, maxItems))
      .filter((l): l is WishlistList => l !== null)
      .slice(0, maxLists),
  };
}

// ── Placement helpers ─────────────────────────────────────────────────────────

const LEGACY_PLACEMENT_ID = `builtin:${SERIKA_WISHLIST_BUILTIN}`;

export function wishlistPlacementId(slug: string): string {
  return `${SERIKA_WISHLIST_BUILTIN}:${slug}`;
}

function isWishlist(w: unknown): w is Record<string, unknown> {
  return !!w && typeof w === "object" && (w as Record<string, unknown>).builtin === SERIKA_WISHLIST_BUILTIN;
}

function slugOf(w: Record<string, unknown>): string | null {
  const opts = (w.options && typeof w.options === "object" ? w.options : {}) as Record<string, unknown>;
  if (typeof opts.listSlug === "string" && WISHLIST_SLUG_RE.test(opts.listSlug)) return opts.listSlug;
  if (typeof w.id === "string" && w.id.startsWith(`${SERIKA_WISHLIST_BUILTIN}:`)) {
    const s = w.id.slice(SERIKA_WISHLIST_BUILTIN.length + 1);
    if (WISHLIST_SLUG_RE.test(s)) return s;
  }
  return null;
}

export function makeWishlistPlacement(slug: string): WishlistPlacement {
  return {
    id: wishlistPlacementId(slug),
    type: "builtin",
    builtin: SERIKA_WISHLIST_BUILTIN,
    applicationId: null,
    options: { listSlug: slug },
  };
}

/** Every wishlist widget on the Board, in Board order. */
export function findWishlistPlacements(profileWidgets: unknown): WishlistPlacement[] {
  if (!Array.isArray(profileWidgets)) return [];
  return profileWidgets.filter(isWishlist).map((w) => {
    const slug = slugOf(w);
    return {
      id: slug ? wishlistPlacementId(slug) : LEGACY_PLACEMENT_ID,
      type: "builtin" as const,
      builtin: SERIKA_WISHLIST_BUILTIN,
      applicationId: null,
      options: { listSlug: slug },
      position: typeof w.position === "number" ? w.position : undefined,
    };
  });
}

/** Whether a placement predates one-list-per-widget and still needs a list. */
export function hasLegacyWishlistPlacement(profileWidgets: unknown): boolean {
  return findWishlistPlacements(profileWidgets).some((p) => p.options.listSlug === null);
}

/** Add a widget for `slug` at the end of the Board (no-op if it is already there). */
export function addWishlistPlacement(profileWidgets: unknown, slug: string): Array<Record<string, unknown>> {
  const list = (Array.isArray(profileWidgets) ? profileWidgets : []).filter(
    (w): w is Record<string, unknown> => !!w && typeof w === "object"
  );
  if (!WISHLIST_SLUG_RE.test(slug) || list.some((w) => isWishlist(w) && slugOf(w) === slug)) return list;
  return [...list, { ...makeWishlistPlacement(slug), position: list.length }];
}

/** Remove the widget for `slug`, or every wishlist widget when `slug` is null. */
export function removeWishlistPlacements(profileWidgets: unknown, slug: string | null): Array<Record<string, unknown>> {
  return (Array.isArray(profileWidgets) ? profileWidgets : []).filter(
    (w): w is Record<string, unknown> => !!w && typeof w === "object" && !(isWishlist(w) && (slug === null || slugOf(w) === slug))
  );
}

/**
 * Lazy migration of the one pre-1-list-per-widget placement (listSlug null):
 * it becomes the widget for the owner's first public list (keeping its Board
 * position), or disappears when they have none or that list is already on
 * the Board. Returns null when nothing needs to change.
 */
export function migrateLegacyWishlistPlacements(
  profileWidgets: unknown,
  publicLists: WishlistList[]
): Array<Record<string, unknown>> | null {
  const list = (Array.isArray(profileWidgets) ? profileWidgets : []).filter(
    (w): w is Record<string, unknown> => !!w && typeof w === "object"
  );
  if (!list.some((w) => isWishlist(w) && slugOf(w) === null)) return null;
  const placed = new Set(list.filter(isWishlist).map(slugOf).filter((s): s is string => !!s));
  const candidate = [...publicLists.filter((l) => l.itemCount > 0), ...publicLists].find((l) => !placed.has(l.slug));
  let used = false;
  const out: Array<Record<string, unknown>> = [];
  for (const w of list) {
    if (isWishlist(w) && slugOf(w) === null) {
      if (candidate && !used) {
        out.push({ ...makeWishlistPlacement(candidate.slug), position: w.position });
        used = true;
      }
      continue;
    }
    out.push(w);
  }
  return out.map((w, i) => ({ ...w, position: i }));
}

/**
 * The list a widget shows: its own slug, or for a not-yet-migrated legacy
 * placement the first public list that isn't on the Board already.
 */
export function listForPlacement(lists: WishlistList[], slug: string | null, placedSlugs: Array<string | null>): WishlistList | null {
  if (slug) return lists.find((l) => l.slug === slug) ?? null;
  const placed = new Set(placedSlugs.filter((s): s is string => !!s));
  return [...lists.filter((l) => l.itemCount > 0), ...lists].find((l) => !placed.has(l.slug)) ?? null;
}

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * SerikaCord stores accounts-service ids (24-hex Mongo ObjectIds) as UUIDs by
 * right-padding with zeros (see mongoIdToUUID in services/auth.ts). Undo that
 * so the id matches what other Serika products store. Returns null for real
 * UUIDs that were not derived from an accounts id.
 */
export function accountsIdFromUserId(userId: string): string | null {
  const hex = userId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex) || !hex.endsWith("00000000")) return null;
  return hex.slice(0, 24);
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Product photos come from arbitrary stores. Route them through the wsrv.nl
 * image proxy (which the Serika CDN already uses) so viewers' IPs are not sent
 * to every shop, hotlink blocks matter less, and we get a small WebP.
 */
export function wishlistThumb(url: string, size = 256): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${size}&h=${size}&fit=inside&we&output=webp`;
}

export function formatWishlistMoney(amount: number, currencyCode: string, locale?: string): string {
  try {
    // Whole amounts and anything from 100 up drop the cents: "€812", "€81", "€39.99".
    const digits = amount >= 100 || Number.isInteger(amount) ? 0 : 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}
