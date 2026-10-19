/**
 * Pure channel rules shared by the client dialogs and the server routes:
 * channel name cleanup (CORD-56) and category NSFW inheritance (CORD-60).
 * No DOM, no DB.
 */

export const CHANNEL_NAME_MAX = 100;

// C0/C1 controls (tabs and newlines included) and bidi overrides/isolates,
// which can make a name render as something else. Zero-width joiners stay
// (emoji sequences need them).
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Clean a channel name for storage. Spaces and capital letters are allowed
 * for every channel type (like voice channels and categories always were);
 * control characters are removed, runs of whitespace collapse to one space,
 * and the result is trimmed and capped at 100 characters. Returns "" when
 * nothing usable is left.
 */
export function normalizeChannelName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHANNEL_NAME_MAX)
    .trim();
}

/** Lowercase, with spaces, dashes and underscores treated as the same separator. */
function matchKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '-');
}

/**
 * Whether a `#query` typed in the composer matches a channel name. Names may
 * now contain spaces, but the `#` trigger stops at whitespace, so
 * "#general-chat" also matches a channel called "General Chat".
 */
export function channelNameMatches(name: string, query: string): boolean {
  if (!query) return true;
  return matchKey(name).includes(matchKey(query));
}

type NsfwChannel = { id: string; type?: string | null; parentId?: string | null; nsfw?: boolean | null };

/**
 * The NSFW flag a channel is stored with. A channel inside an age-restricted
 * category is always age-restricted (the category's flag is copied onto its
 * channels, so every existing NSFW check keeps reading `channel.nsfw`).
 */
export function resolveChannelNsfw(opts: { type?: string | null; requested?: boolean | null; parentNsfw?: boolean | null }): boolean {
  if (opts.type === 'category') return Boolean(opts.requested);
  return Boolean(opts.requested) || Boolean(opts.parentNsfw);
}

/** Channels directly inside `categoryId` that are not yet marked NSFW. */
export function channelsToMarkNsfw<C extends NsfwChannel>(categoryId: string, channels: readonly C[]): C[] {
  const id = categoryId.toLowerCase();
  return channels.filter(
    (c) => c.type !== 'category' && !!c.parentId && c.parentId.toLowerCase() === id && c.nsfw !== true,
  );
}
