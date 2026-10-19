/**
 * Server profile extras stored in `servers.settings` (jsonb, no schema change):
 *
 * - `serverTag`     short tag + badge members can show next to their name (CORD-53)
 * - `discoveryTags` free-form traits shown and searchable in discovery (CORD-52)
 * - `games`         games the community plays, from the IGDB catalog (CORD-51)
 *
 * Pure helpers shared by the API (validation) and the client (rendering).
 * A member's chosen tag lives in `users.customization.serverTag` as a pointer
 * `{ serverId }`; the API swaps it for the resolved tag when it builds user
 * payloads (see services/serverTags.ts), so clients only ever render resolved
 * tags and a stale or forged pointer renders nothing.
 */
import { DEFAULT_CDN_URL } from '@/lib/appearance/customization';

// ── Server tag (CORD-53) ────────────────────────────────────────────────────

export const SERVER_TAG_ICONS = [
  'leaf', 'star', 'heart', 'flame', 'zap', 'crown', 'shield', 'sword',
  'gamepad', 'music', 'moon', 'sun', 'skull', 'ghost', 'gem', 'rocket',
  'paw', 'flower', 'coffee', 'sparkles',
] as const;
export type ServerTagIcon = (typeof SERVER_TAG_ICONS)[number];

/** Preset badge colors offered by the editor (any #rrggbb is accepted). */
export const SERVER_TAG_COLORS = [
  '#8B5CF6', '#5865F2', '#3B82F6', '#06B6D4', '#10B981', '#22C55E',
  '#EAB308', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#94A3B8',
] as const;

export const SERVER_TAG_MIN = 2;
export const SERVER_TAG_MAX = 4;

/** What a server stores in settings.serverTag. */
export interface ServerTagConfig {
  enabled: boolean;
  tag: string;
  icon: ServerTagIcon;
  color: string;
  /** Optional unicode emoji used as the badge instead of the preset icon. */
  emoji?: string | null;
  /** Optional server custom emoji used as the badge (url resolved server-side). */
  emojiId?: string | null;
  emojiUrl?: string | null;
}

/** The tag as rendered next to a user's name. */
export interface ResolvedServerTag {
  serverId: string;
  serverName?: string;
  tag: string;
  icon: ServerTagIcon;
  color: string;
  emoji?: string | null;
  emojiUrl?: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const TAG_RE = /^[\p{L}\p{N}]+$/u;

export function validateServerTagText(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Must be text' };
  const value = raw.trim().normalize('NFC');
  const length = [...value].length;
  if (length < SERVER_TAG_MIN || length > SERVER_TAG_MAX) {
    return { ok: false, error: `Must be ${SERVER_TAG_MIN} to ${SERVER_TAG_MAX} characters` };
  }
  if (!TAG_RE.test(value)) return { ok: false, error: 'Only letters and numbers are allowed' };
  return { ok: true, value };
}

export function isServerTagIcon(v: unknown): v is ServerTagIcon {
  return typeof v === 'string' && (SERVER_TAG_ICONS as readonly string[]).includes(v);
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[‍️⃣]|[\u{E0020}-\u{E007F}])+$/u;

/** A single unicode emoji (one grapheme, emoji code points only). */
export function validateTagEmoji(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Must be an emoji' };
  const value = raw.trim();
  if (!value || value.length > 32 || !EMOJI_RE.test(value) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)) {
    return { ok: false, error: 'Must be a single emoji' };
  }
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg && [...new Seg(undefined, { granularity: 'grapheme' }).segment(value)].length !== 1) {
    return { ok: false, error: 'Must be a single emoji' };
  }
  return { ok: true, value };
}

/**
 * Read a stored server tag config defensively. Returns null when the server
 * has no usable, enabled tag (bad data never renders).
 */
export function readServerTagConfig(raw: unknown, cdnUrl: string = DEFAULT_CDN_URL): ServerTagConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const tag = validateServerTagText(r.tag);
  if (!tag.ok) return null;
  const emoji = r.emoji == null || r.emoji === '' ? null : validateTagEmoji(r.emoji);
  return {
    enabled: true,
    tag: tag.value,
    icon: isServerTagIcon(r.icon) ? r.icon : 'star',
    color: isHexColor(r.color) ? r.color : SERVER_TAG_COLORS[0],
    emoji: emoji && emoji.ok ? emoji.value : null,
    emojiId: typeof r.emojiId === 'string' && r.emojiId ? r.emojiId : null,
    emojiUrl: isCdnEmojiUrl(r.emojiUrl, cdnUrl) ? r.emojiUrl : null,
  };
}

/**
 * Server emoji images live on our CDN; anything else is refused so a forged
 * tag can't make every viewer load an outside image (and leak their IP).
 */
export function isCdnEmojiUrl(url: unknown, cdnUrl: string = DEFAULT_CDN_URL): url is string {
  if (typeof url !== 'string' || url.length > 1024) return false;
  const base = cdnUrl.replace(/\/+$/, '');
  return url.startsWith(`${base}/`) && !/[\s"'()\\]/.test(url);
}

/**
 * User payloads that don't resolve server tags (see services/serverTags.ts)
 * drop the stored value entirely, so only resolved tags ever reach clients.
 */
export function withoutServerTag<T>(customization: T): T {
  return stripServerTagWrite(customization);
}

/** The serverId a user's customization points at, if any. */
export function serverTagPointer(customization: unknown): string | null {
  if (!customization || typeof customization !== 'object') return null;
  const st = (customization as Record<string, unknown>).serverTag;
  if (!st || typeof st !== 'object') return null;
  const id = (st as Record<string, unknown>).serverId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Customization as sent to clients: `serverTag` is replaced by the resolved
 * tag, or removed when there is none. Returns a new object (never mutates).
 */
export function withServerTag<T>(customization: T, resolved: ResolvedServerTag | null | undefined): T {
  if (!customization || typeof customization !== 'object') {
    return (resolved ? { serverTag: resolved } : customization) as T;
  }
  const rest = { ...(customization as Record<string, unknown>) };
  delete rest.serverTag;
  return (resolved ? { ...rest, serverTag: resolved } : rest) as T;
}

/** Client customization writes may never set serverTag (it has its own route). */
export function stripServerTagWrite<T>(customization: T): T {
  if (!customization || typeof customization !== 'object' || Array.isArray(customization)) return customization;
  if (!('serverTag' in (customization as Record<string, unknown>))) return customization;
  const rest = { ...(customization as Record<string, unknown>) };
  delete rest.serverTag;
  return rest as T;
}

// ── Discovery tags / traits (CORD-52) ───────────────────────────────────────

export const DISCOVERY_TAGS_MAX = 5;
export const DISCOVERY_TAG_MAX_LENGTH = 24;
const DISCOVERY_TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&+#.-]*$/u;

export function normalizeDiscoveryTags(raw: unknown): Result<string[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Must be a list of tags' };
  if (raw.length > DISCOVERY_TAGS_MAX) return { ok: false, error: `At most ${DISCOVERY_TAGS_MAX} tags` };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'Tags must be text' };
    const value = item.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if ([...value].length > DISCOVERY_TAG_MAX_LENGTH) {
      return { ok: false, error: `Tags must be at most ${DISCOVERY_TAG_MAX_LENGTH} characters` };
    }
    if (!DISCOVERY_TAG_RE.test(value)) {
      return { ok: false, error: 'Tags may only use letters, numbers, spaces and - \' & + # .' };
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return { ok: true, value: out };
}

/** Stored discovery tags, read defensively. */
export function readDiscoveryTags(settings: unknown): string[] {
  const raw = (settings as { discoveryTags?: unknown } | null | undefined)?.discoveryTags;
  const parsed = normalizeDiscoveryTags(Array.isArray(raw) ? raw.slice(0, DISCOVERY_TAGS_MAX) : []);
  return parsed.ok ? parsed.value : [];
}

/** Exact (case-insensitive) tag match, used by the discovery tag filter. */
export function hasDiscoveryTag(tags: string[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  return w.length > 0 && tags.some((t) => t.toLowerCase() === w);
}

// ── Games (CORD-51) ─────────────────────────────────────────────────────────

export const SERVER_GAMES_MAX = 10;
export const SERVER_GAME_NAME_MAX = 128;

export interface ServerGame {
  igdbId: number;
  name: string;
  coverUrl: string | null;
}

/** Covers come from the IGDB catalog image host only. */
export function isIgdbCoverUrl(v: unknown): v is string {
  return typeof v === 'string'
    && v.length <= 512
    && /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\.(?:jpg|png|webp)$/.test(v);
}

export function normalizeServerGames(raw: unknown): Result<ServerGame[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Must be a list of games' };
  if (raw.length > SERVER_GAMES_MAX) return { ok: false, error: `At most ${SERVER_GAMES_MAX} games` };
  const out: ServerGame[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Invalid game' };
    const g = item as Record<string, unknown>;
    const igdbId = g.igdbId;
    if (typeof igdbId !== 'number' || !Number.isInteger(igdbId) || igdbId <= 0) {
      return { ok: false, error: 'Pick games from the catalog' };
    }
    const name = typeof g.name === 'string' ? g.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > SERVER_GAME_NAME_MAX || /[<>]/.test(name)) return { ok: false, error: 'Invalid game name' };
    if (g.coverUrl != null && g.coverUrl !== '' && !isIgdbCoverUrl(g.coverUrl)) {
      return { ok: false, error: 'Invalid game cover' };
    }
    if (seen.has(igdbId)) continue;
    seen.add(igdbId);
    out.push({ igdbId, name, coverUrl: isIgdbCoverUrl(g.coverUrl) ? g.coverUrl : null });
  }
  return { ok: true, value: out };
}

/** Stored games, read defensively (invalid entries are dropped). */
export function readServerGames(settings: unknown): ServerGame[] {
  const raw = (settings as { games?: unknown } | null | undefined)?.games;
  if (!Array.isArray(raw)) return [];
  const out: ServerGame[] = [];
  for (const item of raw.slice(0, SERVER_GAMES_MAX)) {
    const one = normalizeServerGames([item]);
    if (one.ok && one.value[0]) out.push(one.value[0]);
  }
  return out;
}

/**
 * The resolved tag carried in a payload's customization, or null. Validates
 * every field so a client never renders malformed data.
 */
export function resolvedTagOf(customization: unknown, cdnUrl: string = DEFAULT_CDN_URL): ResolvedServerTag | null {
  if (!customization || typeof customization !== 'object') return null;
  const st = (customization as Record<string, unknown>).serverTag;
  if (!st || typeof st !== 'object') return null;
  const r = st as Record<string, unknown>;
  const tag = validateServerTagText(r.tag);
  if (!tag.ok || typeof r.serverId !== 'string') return null;
  const emoji = r.emoji == null || r.emoji === '' ? null : validateTagEmoji(r.emoji);
  return {
    serverId: r.serverId,
    serverName: typeof r.serverName === 'string' ? r.serverName : undefined,
    tag: tag.value,
    icon: isServerTagIcon(r.icon) ? r.icon : 'star',
    color: isHexColor(r.color) ? r.color : SERVER_TAG_COLORS[0],
    emoji: emoji && emoji.ok ? emoji.value : null,
    emojiUrl: isCdnEmojiUrl(r.emojiUrl, cdnUrl) ? r.emojiUrl : null,
  };
}
