/**
 * The `{emoji}` path segment of the bot API reaction routes (pure).
 *
 * Discord sends a unicode emoji as itself (URL-encoded) and a custom emoji as
 * `name:id` (also `a:name:id`). We also accept the message-token forms
 * `<:name:id>` / `<a:name:id>`. Custom emoji ids are Serika UUIDs; a numeric
 * Discord snowflake id is reported as `snowflakeId` so the caller can resolve
 * it (or answer Unknown Emoji).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9_~-]{1,32}$/;

export type ParsedReactionEmoji =
  | { kind: 'unicode'; name: string }
  | { kind: 'custom'; name: string; id: string; animated: boolean }
  | { kind: 'snowflake'; name: string; snowflakeId: string; animated: boolean };

function safeDecode(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Loose check that a string is one emoji (or a short ZWJ / flag / keycap
 * sequence), not arbitrary text. Discord answers 10014 Unknown Emoji otherwise.
 */
export function isUnicodeEmoji(s: string): boolean {
  if (!s || s.length > 64) return false;
  if (/[\s<>:]/.test(s)) return false;
  if (/[A-Za-z]/.test(s)) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s);
}

export function parseReactionEmojiParam(raw: string | null | undefined): ParsedReactionEmoji | null {
  if (typeof raw !== 'string') return null;
  let s = safeDecode(raw).trim();
  if (!s) return null;
  // <a:name:id> / <:name:id>
  const token = /^<(a?):([^:<>]+):([^:<>]+)>$/.exec(s);
  if (token) s = `${token[1] ? 'a:' : ''}${token[2]}:${token[3]}`;
  const parts = s.split(':');
  if (parts.length === 2 || parts.length === 3) {
    const animated = parts.length === 3;
    if (animated && parts[0] !== 'a') return null;
    const name = parts[parts.length - 2];
    const id = parts[parts.length - 1];
    // Discord allows an empty name when the id is given ("_:id" in practice).
    if (name && !NAME_RE.test(name)) return null;
    if (UUID_RE.test(id)) return { kind: 'custom', name, id: id.toLowerCase(), animated };
    if (/^\d{1,20}$/.test(id)) return { kind: 'snowflake', name, snowflakeId: id, animated };
    return null;
  }
  if (parts.length > 1) return null;
  if (UUID_RE.test(s)) return { kind: 'custom', name: '', id: s.toLowerCase(), animated: false };
  return isUnicodeEmoji(s) ? { kind: 'unicode', name: s } : null;
}

/** The emoji string the web client's reaction events use (`<:name:id>` or the unicode itself). */
export function clientEmojiString(e: { name: string; id?: string | null; animated?: boolean | null }): string {
  return e.id ? `<${e.animated ? 'a' : ''}:${e.name || '_'}:${e.id}>` : e.name;
}

/** A Discord emoji object for reactions and gateway events. */
export function discordEmoji(e: { name: string; id?: string | null; animated?: boolean | null }) {
  return e.id ? { id: e.id, name: e.name || null, animated: Boolean(e.animated) } : { id: null, name: e.name };
}
