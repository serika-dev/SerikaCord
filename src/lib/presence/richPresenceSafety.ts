/**
 * Rich presence (game / app activity) values that other people's clients
 * render: image URLs go into `<img src>` on profiles and buttons become links.
 * Reports come from any authenticated client (desktop app, Serika RPC, or a
 * modded client), so URLs are limited to https on the image hosts the app and
 * SDK actually produce. Anything else is dropped (the card falls back to its
 * icon) rather than rejected, so one bad field never kills a heartbeat.
 *
 * Pure (no env, DB or React): shared by the API, the client and
 * tests/rich-presence-safety.test.ts.
 */

/** Exact hosts allowed for activity images. */
export const RICH_PRESENCE_IMAGE_HOSTS: readonly string[] = [
  "cdn.serika.chat",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "i.scdn.co", // Spotify album art
  "images.igdb.com", // IGDB covers (desktop app via /api/igdb/game)
  "steamcdn-a.akamaihd.net", // Steam header images (older URLs)
  "wsrv.nl",
  "images.weserv.nl",
  "lastfm.freetls.fastly.net", // Last.fm album art
  "coverartarchive.org",
];

/** Host suffixes allowed for activity images (any subdomain). */
export const RICH_PRESENCE_IMAGE_HOST_SUFFIXES: readonly string[] = [
  ".steamstatic.com", // shared./cdn.akamai./cdn.cloudflare.steamstatic.com
  ".coverartarchive.org",
  ".archive.org", // coverartarchive redirects to ia*.us.archive.org
];

export const RICH_PRESENCE_LIMITS = {
  maxActivities: 10,
  type: 32,
  name: 128,
  text: 128,
  url: 512,
  partyId: 128,
  buttonLabel: 32,
  maxButtons: 2,
} as const;

function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (RICH_PRESENCE_IMAGE_HOSTS.includes(h)) return true;
  return RICH_PRESENCE_IMAGE_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** An https image URL on an allowed host, or null. */
export function safeRichPresenceImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > RICH_PRESENCE_LIMITS.url) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!isAllowedImageHost(u.hostname)) return null;
  return u.toString();
}

const ASSET_KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * A Serika RPC asset image: an Application Asset key (plain name) is kept,
 * anything URL-like must pass `safeRichPresenceImageUrl`.
 */
export function safeRichPresenceAssetImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (ASSET_KEY_RE.test(v)) return v;
  return safeRichPresenceImageUrl(v);
}

/** An http(s) link for an activity button, or null. */
export function safeRichPresenceLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > RICH_PRESENCE_LIMITS.url) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Control characters out; one line; clamped by code points.
  const v = value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  if (!v) return null;
  const chars = Array.from(v);
  return chars.length > max ? chars.slice(0, max).join("") : v;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export interface RichPresenceAssets {
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

export interface SanitizedRichPresence {
  type: string;
  name: string;
  details: string | null;
  state: string | null;
  largeImageUrl: string | null;
  largeImageText: string | null;
  smallImageUrl: string | null;
  smallImageText: string | null;
  startedAt: Date | null;
  endsAt: Date | null;
  applicationId: string | null;
  assets: RichPresenceAssets | null;
  buttons: { label: string; url: string }[] | null;
  partyId: string | null;
  partySize: [number, number] | null;
}

const TYPE_RE = /^[a-z0-9_-]{1,32}$/;
// rich_presence.application_id is a uuid column: anything else would fail the insert.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One reported activity, cleaned; null when it has no usable name. */
export function sanitizeRichPresenceItem(raw: unknown): SanitizedRichPresence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name, RICH_PRESENCE_LIMITS.name);
  if (!name) return null;
  const rawType = typeof r.type === "string" ? r.type.trim().toLowerCase() : "";
  const type = TYPE_RE.test(rawType) ? rawType : "other";

  let assets: RichPresenceAssets | null = null;
  if (r.assets && typeof r.assets === "object" && !Array.isArray(r.assets)) {
    const a = r.assets as Record<string, unknown>;
    const out: RichPresenceAssets = {};
    const largeImage = safeRichPresenceAssetImage(a.largeImage);
    const smallImage = safeRichPresenceAssetImage(a.smallImage);
    const largeText = text(a.largeText, RICH_PRESENCE_LIMITS.text);
    const smallText = text(a.smallText, RICH_PRESENCE_LIMITS.text);
    if (largeImage) out.largeImage = largeImage;
    if (largeText) out.largeText = largeText;
    if (smallImage) out.smallImage = smallImage;
    if (smallText) out.smallText = smallText;
    if (Object.keys(out).length > 0) assets = out;
  }

  let buttons: { label: string; url: string }[] | null = null;
  if (Array.isArray(r.buttons)) {
    const list = r.buttons
      .slice(0, RICH_PRESENCE_LIMITS.maxButtons)
      .map((b) => {
        if (!b || typeof b !== "object") return null;
        const label = text((b as Record<string, unknown>).label, RICH_PRESENCE_LIMITS.buttonLabel);
        const url = safeRichPresenceLink((b as Record<string, unknown>).url);
        return label && url ? { label, url } : null;
      })
      .filter((b): b is { label: string; url: string } => b !== null);
    if (list.length > 0) buttons = list;
  }

  let partySize: [number, number] | null = null;
  if (Array.isArray(r.partySize) && r.partySize.length === 2) {
    const [cur, max] = r.partySize.map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : NaN));
    if (cur >= 0 && max >= 0 && cur <= 1_000_000 && max <= 1_000_000) partySize = [cur, max];
  }

  return {
    type,
    name,
    details: text(r.details, RICH_PRESENCE_LIMITS.text),
    state: text(r.state, RICH_PRESENCE_LIMITS.text),
    largeImageUrl: safeRichPresenceImageUrl(r.largeImageUrl),
    largeImageText: text(r.largeImageText, RICH_PRESENCE_LIMITS.text),
    smallImageUrl: safeRichPresenceImageUrl(r.smallImageUrl),
    smallImageText: text(r.smallImageText, RICH_PRESENCE_LIMITS.text),
    startedAt: date(r.startedAt),
    endsAt: date(r.endsAt),
    applicationId: typeof r.applicationId === "string" && UUID_RE.test(r.applicationId.trim()) ? r.applicationId.trim().toLowerCase() : null,
    assets,
    buttons,
    partyId: text(r.partyId, RICH_PRESENCE_LIMITS.partyId),
    partySize,
  };
}

/** The activities of one report (single object or `{ activities: [] }`), deduped and capped. */
export function sanitizeRichPresenceReport(body: unknown): SanitizedRichPresence[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const rawList: unknown[] = Array.isArray(b.activities) ? b.activities : b.name ? [b] : [];
  const seen = new Set<string>();
  const out: SanitizedRichPresence[] = [];
  for (const raw of rawList) {
    if (out.length >= RICH_PRESENCE_LIMITS.maxActivities) break;
    const item = sanitizeRichPresenceItem(raw);
    if (!item) continue;
    const key = `${item.type}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
