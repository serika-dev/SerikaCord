/**
 * Linking a SerikaCord application to its Discord bot (pure helpers, unit
 * tested in tests/discord-link-*.test.ts).
 *
 * A developer proves they own a Discord bot by sending its token once
 * (PUT /api/v10/applications/@me/discord-link or the Developer Portal). The
 * server asks Discord who the token belongs to and stores only the Discord
 * bot user id (+ application id). The token itself is never stored or logged.
 * The Discord bridge then relays that Discord bot's messages into a bridged
 * server as the app's real SerikaCord bot user instead of a DiscordUser copy.
 *
 * I/O lives in src/lib/services/applicationDiscordLink.ts.
 */
import { invalidFormBody, type DiscordError } from '@/lib/botapi/errors';

/** The link as the API returns it (bot API and portal). */
export interface DiscordLinkView {
  discord_bot_user_id: string;
  discord_application_id: string | null;
  linked_at: string;
}

const SNOWFLAKE = /^\d{15,21}$/;
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function isDiscordSnowflake(v: unknown): v is string {
  return typeof v === 'string' && SNOWFLAKE.test(v);
}

/** Decode a base64 / base64url segment (no padding needed); null when it isn't valid. */
function decodeBase64Segment(seg: string): string | null {
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The Discord user id a bot token claims (its first segment is the base64 of
 * the bot's user id), or null when `token` does not look like a Discord bot
 * token. Discord tokens have three dot-separated segments; SerikaCord bot
 * tokens (`<client id>.<hex>`) have two, so a pasted SerikaCord token is
 * refused here and never sent to Discord.
 */
export function discordTokenClaimedId(token: string): string | null {
  if (token.length < 50 || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((p) => p.length > 0 && TOKEN_SEGMENT.test(p))) return null;
  if (parts[0].length < 16 || parts[1].length < 4 || parts[2].length < 20) return null;
  const id = decodeBase64Segment(parts[0]);
  return id && SNOWFLAKE.test(id) ? id : null;
}

/** Strip whitespace and an optional "Bot " prefix people copy along with the token. */
export function normalizeDiscordToken(raw: string): string {
  return raw.trim().replace(/^Bot\s+/i, '').trim();
}

/** Error body when Discord rejects the token (or it isn't a bot's). */
export const INVALID_DISCORD_TOKEN: DiscordError = { code: 50035, message: 'Invalid Discord bot token' };
/** Error body when Discord could not be asked (network, 5xx, rate limited). */
export const DISCORD_UNAVAILABLE: DiscordError = { code: 0, message: 'Could not verify the token with Discord. Try again later.' };
/** GET when the application has no linked Discord bot. */
export const NOT_LINKED: DiscordError = { code: 10002, message: 'Unknown Application' };

export type LinkBodyResult = { ok: true; token: string } | { ok: false; error: DiscordError };

/** Validate the PUT body `{ "discord_bot_token": "..." }` (50035 on anything else). */
export function parseDiscordLinkBody(body: unknown): LinkBodyResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: invalidFormBody([{ path: 'discord_bot_token', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]) };
  }
  const raw = (body as { discord_bot_token?: unknown }).discord_bot_token;
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, error: invalidFormBody([{ path: 'discord_bot_token', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]) };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: invalidFormBody([{ path: 'discord_bot_token', code: 'BASE_TYPE_STRING', message: 'Must be a string.' }]) };
  }
  const token = normalizeDiscordToken(raw);
  if (!discordTokenClaimedId(token)) {
    const tree = invalidFormBody([{ path: 'discord_bot_token', code: 'DISCORD_BOT_TOKEN_INVALID', message: 'Not a Discord bot token.' }]);
    return { ok: false, error: { ...INVALID_DISCORD_TOKEN, ...(tree.errors ? { errors: tree.errors } : {}) } };
  }
  return { ok: true, token };
}

export type DiscordTokenCheck =
  | { kind: 'ok'; id: string; username: string | null }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

/**
 * Classify Discord's answer to GET /users/@me made with the pasted token.
 * 401/403 (and any 4xx) = the token is not valid; a user that isn't a bot,
 * or whose id differs from the one the token claims, is refused too.
 */
export function classifyDiscordUserResponse(status: number, body: unknown, claimedId: string | null): DiscordTokenCheck {
  if (status === 0 || status === 429 || status >= 500) return { kind: 'unavailable' };
  if (status < 200 || status >= 300) return { kind: 'invalid' };
  if (!body || typeof body !== 'object') return { kind: 'unavailable' };
  const u = body as { id?: unknown; bot?: unknown; username?: unknown };
  if (!isDiscordSnowflake(u.id) || u.bot !== true) return { kind: 'invalid' };
  if (claimedId && claimedId !== u.id) return { kind: 'invalid' };
  return { kind: 'ok', id: u.id, username: typeof u.username === 'string' ? u.username.slice(0, 64) : null };
}

/** Stored row -> API view (null when nothing is linked). */
export function serializeDiscordLink(row: {
  discordBotUserId?: string | null;
  discordApplicationId?: string | null;
  discordLinkedAt?: Date | string | null;
} | null | undefined): DiscordLinkView | null {
  if (!row || !isDiscordSnowflake(row.discordBotUserId)) return null;
  const at = row.discordLinkedAt ? new Date(row.discordLinkedAt) : null;
  return {
    discord_bot_user_id: row.discordBotUserId,
    discord_application_id: isDiscordSnowflake(row.discordApplicationId) ? row.discordApplicationId : null,
    linked_at: (at && !Number.isNaN(at.getTime()) ? at : new Date(0)).toISOString(),
  };
}

/** The SerikaCord bot user a linked Discord bot's bridged messages are posted as. */
export interface LinkedBotUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isBot?: boolean | null;
  isVerified?: boolean | null;
  badges?: string[] | null;
}

/**
 * The author object of the live web payload for a relayed message posted as
 * the linked SerikaCord bot: a real account (BOT tag, verified / official
 * badges), never marked as a Discord copy.
 */
export function linkedBotWebAuthor(u: LinkedBotUser) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar ?? null,
    status: 'online',
    badges: Array.isArray(u.badges) ? u.badges : [],
    isBot: true,
    isSystem: false,
    isVerified: Boolean(u.isVerified),
    isDiscord: false,
  };
}

/**
 * Whether a Discord message author may be posted as a linked SerikaCord bot:
 * only bot accounts (a person can never be swapped for a bot), with a valid id.
 */
export function canRelayAsLinkedBot(author: { id?: unknown; bot?: unknown } | null | undefined): boolean {
  return Boolean(author && author.bot === true && isDiscordSnowflake(author.id));
}
