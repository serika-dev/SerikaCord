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

/** Lists shown on someone else's profile when no single list is featured. */
export const WISHLIST_MAX_LISTS_SHOWN = 3;

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
  emoji: string;
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
  enabled: boolean;
  listSlug: string | null;
  /** False when the user has never used Serika Wishlist. */
  found?: boolean;
  profileUrl?: string | null;
  lists?: WishlistList[];
  error?: string;
}

/** Widget placement as stored in users.profile_widgets. */
export interface WishlistPlacement {
  id: string;
  type: "builtin";
  builtin: typeof SERIKA_WISHLIST_BUILTIN;
  applicationId: null;
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
    emoji: str(r.emoji, 16),
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

export function findWishlistPlacement(profileWidgets: unknown): WishlistPlacement | null {
  if (!Array.isArray(profileWidgets)) return null;
  const p = profileWidgets.find(
    (w) => w && typeof w === "object" && (w as Record<string, unknown>).builtin === SERIKA_WISHLIST_BUILTIN
  ) as Record<string, unknown> | undefined;
  if (!p) return null;
  const opts = (p.options && typeof p.options === "object" ? p.options : {}) as Record<string, unknown>;
  const slug = typeof opts.listSlug === "string" && WISHLIST_SLUG_RE.test(opts.listSlug) ? opts.listSlug : null;
  return {
    id: `builtin:${SERIKA_WISHLIST_BUILTIN}`,
    type: "builtin",
    builtin: SERIKA_WISHLIST_BUILTIN,
    applicationId: null,
    options: { listSlug: slug },
    position: typeof p.position === "number" ? p.position : undefined,
  };
}

/**
 * Return `profileWidgets` with the wishlist placement added, updated or
 * removed. An existing placement keeps its position in the list.
 */
export function withWishlistPlacement(
  profileWidgets: unknown,
  next: { enabled: boolean; listSlug: string | null }
): Array<Record<string, unknown>> {
  const list = (Array.isArray(profileWidgets) ? profileWidgets : []).filter(
    (w): w is Record<string, unknown> => !!w && typeof w === "object"
  );
  const idx = list.findIndex((w) => w.builtin === SERIKA_WISHLIST_BUILTIN);
  if (!next.enabled) return idx === -1 ? list : list.filter((_, i) => i !== idx);
  const placement: WishlistPlacement = {
    id: `builtin:${SERIKA_WISHLIST_BUILTIN}`,
    type: "builtin",
    builtin: SERIKA_WISHLIST_BUILTIN,
    applicationId: null,
    options: { listSlug: next.listSlug && WISHLIST_SLUG_RE.test(next.listSlug) ? next.listSlug : null },
  };
  if (idx === -1) return [...list, { ...placement, position: list.length }];
  return list.map((w, i) => (i === idx ? { ...placement, position: typeof w.position === "number" ? w.position : i } : w));
}

/**
 * Which lists a viewer sees: everything for the owner (so they can pick),
 * otherwise the featured list (falling back to all if it is no longer
 * public), capped at WISHLIST_MAX_LISTS_SHOWN. Lists with no items are kept
 * only when nothing else exists.
 */
export function visibleWishlists(lists: WishlistList[], listSlug: string | null, isOwner: boolean): WishlistList[] {
  if (isOwner) return lists;
  if (listSlug) {
    const featured = lists.find((l) => l.slug === listSlug);
    if (featured) return [featured];
  }
  const withItems = lists.filter((l) => l.itemCount > 0);
  return (withItems.length > 0 ? withItems : lists).slice(0, WISHLIST_MAX_LISTS_SHOWN);
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
