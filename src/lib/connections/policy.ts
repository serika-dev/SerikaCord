/**
 * Pure rules for profile connections (user_connections rows).
 *
 * - Providers that have an OAuth/sign-in flow can only be created by that flow,
 *   never self-declared through POST /api/users/me/connections.
 * - Only connections an OAuth callback marked as verified may be trusted for
 *   identity (e.g. mapping a Discord author to a SerikaCord user in the bridge).
 */

/**
 * Providers a user may type in themselves; they are display-only. Websites are
 * not here: they go through DNS verification (see ./domain.ts).
 */
export const SELF_DECLARABLE_PROVIDERS = [
  'twitter',
  'instagram',
  'youtube',
  'xbox',
  'psn',
  'roblox',
  'battlenet',
] as const;

/** Providers whose rows only their OAuth/sign-in callbacks may create. */
export const OAUTH_ONLY_PROVIDERS = [
  'discord',
  'github',
  'spotify',
  'twitch',
  'steam',
  'lastfm',
  'serika',
] as const;

export function isSelfDeclarableProvider(provider: unknown): boolean {
  return typeof provider === 'string' && (SELF_DECLARABLE_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Metadata key set only by server-side OAuth callbacks. Self-declared rows
 * never carry client metadata, so this cannot be forged through the API.
 */
export const OAUTH_VERIFIED_KEY = 'oauthVerified';

/**
 * Metadata keys that hold credentials (OAuth tokens, Last.fm session keys).
 * The UserConnection model encrypts them at rest; every other key (e.g.
 * `oauthVerified`, `domainVerification`) stays readable.
 */
export const CONNECTION_SECRET_KEYS = [
  'accessToken', 'refreshToken', 'sessionKey', 'idToken',
  'access_token', 'refresh_token', 'session_key', 'id_token',
  'token', 'secret', 'apiKey',
] as const;

export function isOAuthVerifiedConnection(conn: { metadata?: unknown } | null | undefined): boolean {
  const meta = conn?.metadata;
  return !!meta && typeof meta === 'object' && (meta as Record<string, unknown>)[OAUTH_VERIFIED_KEY] === true;
}

/** Hidden connections are only returned to their owner. NULL visibility means visible. */
export function filterVisibleConnections<T extends { visible?: boolean | null }>(rows: T[], isSelf: boolean): T[] {
  return isSelf ? rows : rows.filter((c) => c.visible !== false);
}

/** A connection row as returned to its owner: everything except OAuth metadata (tokens, session keys). */
export function toOwnConnection<T extends { metadata?: unknown }>(row: T): Omit<T, 'metadata'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { metadata, ...rest } = row;
  return rest;
}
