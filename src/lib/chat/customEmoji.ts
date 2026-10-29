/**
 * The one definition of a custom emoji token, `<:name:id>` / `<a:name:id>`,
 * shared by the composer, the message renderer, the server routes (token
 * preservation, emoji resolution), search, TTS, threads and the Discord
 * bridge. Pure, no imports.
 *
 * Names: letters, digits, `_` and `-` (renamed emoji could get a hyphen, e.g.
 * `soncresity-industries`), 1-32 characters. Ids: SerikaCord's UUIDs, or a
 * numeric snowflake (Discord-format content from bots / the bridge).
 */

export const CUSTOM_EMOJI_NAME_SRC = "[A-Za-z0-9_-]{1,32}";
export const UUID_SRC = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const SNOWFLAKE_SRC = "\\d{15,21}";
export const CUSTOM_EMOJI_ID_SRC = `(?:${UUID_SRC}|${SNOWFLAKE_SRC})`;
/** No capture groups (for embedding in a larger regex). */
export const CUSTOM_EMOJI_TOKEN_PLAIN_SRC = `<a?:${CUSTOM_EMOJI_NAME_SRC}:${CUSTOM_EMOJI_ID_SRC}>`;
/** Groups: 1 = "a" when animated, 2 = name, 3 = id. */
export const CUSTOM_EMOJI_TOKEN_SRC = `<(a)?:(${CUSTOM_EMOJI_NAME_SRC}):(${CUSTOM_EMOJI_ID_SRC})>`;

const NAME_RE = new RegExp(`^${CUSTOM_EMOJI_NAME_SRC}$`);
const UUID_RE = new RegExp(`^${UUID_SRC}$`);
const TOKEN_RE = new RegExp(`^${CUSTOM_EMOJI_TOKEN_SRC}$`);

/** A fresh regex over custom emoji tokens (`g` by default; never share a /g regex). */
export function customEmojiTokenRegex(flags = "g"): RegExp {
  return new RegExp(CUSTOM_EMOJI_TOKEN_SRC, flags);
}

export interface CustomEmojiToken {
  animated: boolean;
  name: string;
  id: string;
}

/** `<a:name:id>` → its parts; null when `token` is not exactly one token. */
export function parseCustomEmojiToken(token: string): CustomEmojiToken | null {
  const m = TOKEN_RE.exec(token);
  return m ? { animated: m[1] === "a", name: m[2], id: m[3] } : null;
}

export function formatCustomEmojiToken(e: { name: string; id: string; animated?: boolean | null }): string {
  return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
}

export function isValidCustomEmojiName(name: string): boolean {
  return NAME_RE.test(name);
}

export function isUuidEmojiId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * A name an emoji can be saved under: anything outside the allowed set
 * becomes `_` (so tokens built from it always parse), cut to 32 characters.
 * Returns "" when nothing usable is left.
 */
export function normalizeCustomEmojiName(raw: string): string {
  const name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 32);
  return /[A-Za-z0-9]/.test(name) ? name : "";
}

/** Every custom emoji token → `:name:` (plain-text previews, TTS, bridges). */
export function customEmojiTokensToNames(text: string): string {
  return text.replace(customEmojiTokenRegex(), ":$2:");
}

/**
 * Merge a message's own resolved emoji with the viewer's lookup (message
 * emoji first, ids unique). Cached by input identity so memoized renderers
 * get a stable array.
 */
const mergeCache = new WeakMap<object, WeakMap<object, unknown[]>>();
export function mergeEmojiLookups<T extends { id?: string; _id?: string }>(
  own: readonly T[] | null | undefined,
  fallback: readonly T[] | null | undefined,
): readonly T[] {
  if (!own?.length) return fallback ?? [];
  if (!fallback?.length) return own;
  let inner = mergeCache.get(own);
  if (!inner) {
    inner = new WeakMap();
    mergeCache.set(own, inner);
  }
  const cached = inner.get(fallback);
  if (cached) return cached as T[];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of [...own, ...fallback]) {
    const id = e.id || e._id || "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(e);
  }
  inner.set(fallback, out);
  return out;
}
