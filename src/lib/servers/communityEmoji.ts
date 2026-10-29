// Emojis on community surfaces (CORD-71): onboarding question options, Server
// Guide to-dos and resources, and welcome screen recommended channels.
//
// A value is either one unicode emoji ("🎮") or one of the server's own custom
// emojis, stored as Discord's token `<:name:id>` / `<a:name:id>`. Welcome
// channels keep Discord's split `emojiId` + `emojiName` instead.
//
// Pure (no DB, no React): the normalizers in onboarding.ts / community.ts, the
// API routes, the bot API shapes and the client's EmojiOrIcon all use it.
// Tests: tests/community-emoji.test.ts.

export interface CommunityCustomEmoji {
  id: string;
  name: string;
  animated: boolean;
}

/** A custom emoji resolved for display (url from the server's upload record). */
export interface CommunityEmojiView extends CommunityCustomEmoji {
  url: string;
}

export type ParsedCommunityEmoji =
  | { kind: 'unicode'; value: string }
  | ({ kind: 'custom' } & CommunityCustomEmoji);

/** The server's emojis by lower-cased id: what a stored custom emoji must belong to. */
export type ServerEmojiLookup = ReadonlyMap<string, { name: string; animated?: boolean | null }>;

const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_RE = new RegExp(`^${UUID_SRC}$`);
const CUSTOM_TOKEN_RE = new RegExp(`^<(a?):([A-Za-z0-9_-]{1,32}):(${UUID_SRC})>$`);

/** Emoji code points only (plus keycap bases), at least one real pictograph. */
const UNICODE_EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[0-9#*‍️⃣]|[\u{E0020}-\u{E007F}])+$/u;
const PICTOGRAPH_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
export const UNICODE_EMOJI_MAX = 32;

export function isCustomEmojiId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** A custom emoji name as it goes into a token (word characters only). */
export function tokenEmojiName(name: unknown): string {
  const clean = typeof name === 'string' ? name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) : '';
  return clean || 'emoji';
}

/** One unicode emoji (a single grapheme of emoji code points), or null. */
export function validUnicodeEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > UNICODE_EMOJI_MAX || !UNICODE_EMOJI_RE.test(value) || !PICTOGRAPH_RE.test(value)) return null;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg && [...new Seg(undefined, { granularity: 'grapheme' }).segment(value)].length !== 1) return null;
  return value;
}

/**
 * Reads a stored or submitted emoji value. Accepts the HTML-escaped token
 * (`&lt;:name:id&gt;`) too, since older saves went through sanitizeInput.
 */
export function parseCommunityEmoji(raw: unknown): ParsedCommunityEmoji | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const token = value.startsWith('&lt;') && value.endsWith('&gt;') ? `<${value.slice(4, -4)}>` : value;
  const m = CUSTOM_TOKEN_RE.exec(token);
  if (m) return { kind: 'custom', id: m[3].toLowerCase(), name: m[2], animated: m[1] === 'a' };
  if (token.startsWith('<')) return null;
  const unicode = validUnicodeEmoji(value);
  return unicode ? { kind: 'unicode', value: unicode } : null;
}

export function formatCustomEmoji(e: { id: string; name: string; animated?: boolean | null }): string {
  return `<${e.animated ? 'a' : ''}:${tokenEmojiName(e.name)}:${e.id.toLowerCase()}>`;
}

/**
 * The canonical stored value, or null. With `emojis` (on save) a custom emoji
 * must be one of this server's and takes its current name; without (reading
 * what is already stored) any well-formed token is kept.
 */
export function normalizeCommunityEmoji(raw: unknown, emojis?: ServerEmojiLookup): string | null {
  const parsed = parseCommunityEmoji(raw);
  if (!parsed) return null;
  if (parsed.kind === 'unicode') return parsed.value;
  if (!emojis) return formatCustomEmoji(parsed);
  const own = emojis.get(parsed.id);
  return own ? formatCustomEmoji({ id: parsed.id, name: own.name, animated: Boolean(own.animated) }) : null;
}

/**
 * A welcome channel's emoji (Discord: `emoji_id` + `emoji_name`). A custom
 * emoji must belong to the server when `emojis` is given; its name follows the
 * emoji. `emojiName` may also carry a full token.
 */
export function normalizeWelcomeEmoji(
  emojiId: unknown,
  emojiName: unknown,
  emojis?: ServerEmojiLookup,
): { emojiId: string | null; emojiName: string | null } {
  const none = { emojiId: null, emojiName: null };
  const id = typeof emojiId === 'string' ? emojiId.trim() : typeof emojiId === 'number' ? String(emojiId) : '';
  if (id) {
    if (!isCustomEmojiId(id)) return none;
    const key = id.toLowerCase();
    if (emojis) {
      const own = emojis.get(key);
      return own ? { emojiId: key, emojiName: tokenEmojiName(own.name) } : none;
    }
    return { emojiId: key, emojiName: tokenEmojiName(emojiName) };
  }
  const parsed = parseCommunityEmoji(emojiName);
  if (!parsed) return none;
  if (parsed.kind === 'unicode') return { emojiId: null, emojiName: parsed.value };
  return normalizeWelcomeEmoji(parsed.id, parsed.name, emojis);
}

/** The single-string form of a welcome channel's emoji (for EmojiOrIcon). */
export function welcomeEmojiValue(c: { emojiId?: string | null; emojiName?: string | null }): string | null {
  if (c.emojiId) return isCustomEmojiId(c.emojiId) ? formatCustomEmoji({ id: c.emojiId, name: c.emojiName ?? '' }) : null;
  return validUnicodeEmoji(c.emojiName);
}

/** Custom emoji ids in a list of stored values. */
export function customEmojiIds(values: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const p = parseCommunityEmoji(v);
    if (p?.kind === 'custom') out.add(p.id);
  }
  return out;
}

/** Discord's emoji object for a stored value: `{ id, name, animated }`. */
export function toDiscordEmoji(value: string | null | undefined): { id: string | null; name: string; animated: boolean } | null {
  const p = parseCommunityEmoji(value);
  if (!p) return null;
  return p.kind === 'unicode' ? { id: null, name: p.value, animated: false } : { id: p.id, name: p.name, animated: p.animated };
}

/** A Discord emoji (object or `emoji_id` / `emoji_name` / `emoji_animated` fields) as a stored value. */
export function fromDiscordEmoji(obj: Record<string, unknown>): string | null {
  const e = obj.emoji && typeof obj.emoji === 'object' ? (obj.emoji as Record<string, unknown>) : null;
  const id = e ? e.id : obj.emoji_id;
  const name = e ? e.name : obj.emoji_name;
  const animated = e ? e.animated === true : obj.emoji_animated === true;
  const idStr = typeof id === 'string' ? id.trim() : '';
  if (idStr) return isCustomEmojiId(idStr) ? formatCustomEmoji({ id: idStr, name: typeof name === 'string' ? name : '', animated }) : null;
  return typeof name === 'string' ? name : null;
}

/** The server's emojis keyed for normalizeCommunityEmoji (unavailable ones left out). */
export function serverEmojiLookup(rows: ReadonlyArray<{ id: string; name: string; animated?: boolean | null; available?: boolean | null }>): Map<string, { name: string; animated: boolean }> {
  const map = new Map<string, { name: string; animated: boolean }>();
  for (const r of rows) {
    if (r.available === false || !r.id) continue;
    map.set(String(r.id).toLowerCase(), { name: r.name, animated: Boolean(r.animated) });
  }
  return map;
}

/** Display data for the custom emojis a page uses (deleted / unavailable ones are left out). */
export function communityEmojiViews(
  rows: ReadonlyArray<{ id: string; name: string; imageUrl?: string | null; animated?: boolean | null; available?: boolean | null }>,
  ids?: ReadonlySet<string>,
): CommunityEmojiView[] {
  const out: CommunityEmojiView[] = [];
  for (const r of rows) {
    const id = String(r.id).toLowerCase();
    if (r.available === false || (ids && !ids.has(id))) continue;
    const url = typeof r.imageUrl === 'string' ? r.imageUrl : '';
    if (!/^https:\/\/[^\s"'()\\]+$/.test(url) || url.length > 1024) continue;
    out.push({ id, name: r.name, animated: Boolean(r.animated), url });
  }
  return out;
}
