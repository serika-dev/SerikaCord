import { createHash } from 'crypto';

/**
 * Pure OAuth2 helpers for the token endpoint and Bearer authentication on the
 * Discord-compatible API (/api/v10). No DB, no Redis: unit tested in
 * tests/oauth2-bearer.test.ts. Storage lives in src/lib/services/oauth2Tokens.ts.
 */

/** Lifetime of an access token (Discord: 7 days). */
export const ACCESS_TOKEN_TTL_S = 604_800;
/** Lifetime of a refresh token (Discord does not document one; 30 days here). */
export const REFRESH_TOKEN_TTL_S = 30 * 86_400;
/** Lifetime of an authorization code (Discord: 10 minutes). */
export const AUTH_CODE_TTL_S = 600;

/**
 * Scopes a client_credentials token may carry (allowlist). The token acts as
 * the app's owner, but anyone holding the client secret (team members, a
 * leaked bot repo) can mint one, so it never reads the owner's private data
 * (email, connections, server list): commands management and the public
 * profile only.
 */
const CLIENT_CREDENTIALS_ALLOWED = new Set(['identify', 'applications.commands', 'applications.commands.update', 'applications.commands.permissions.update']);

/** `scope` from a request: space (or `+`/comma) separated, de-duplicated, at most 32 entries. */
export function parseScopeParam(raw: unknown): string[] {
  if (Array.isArray(raw)) raw = raw.join(' ');
  if (typeof raw !== 'string') return [];
  const out: string[] = [];
  for (const s of raw.split(/[\s+,]+/)) {
    const v = s.trim();
    if (v && /^[a-z0-9._]{1,64}$/i.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= 32) break;
  }
  return out;
}

/** Scopes a client_credentials request may be granted (unknown or forbidden ones dropped). */
export function clientCredentialsScopes(requested: string[], valid: ReadonlySet<string>): { ok: true; scopes: string[] } | { ok: false; scope: string } {
  for (const s of requested) {
    if (!valid.has(s) || !CLIENT_CREDENTIALS_ALLOWED.has(s)) return { ok: false, scope: s };
  }
  return { ok: true, scopes: requested };
}

export function hasScope(scopes: readonly string[] | null | undefined, scope: string): boolean {
  return !!scopes && scopes.includes(scope);
}

/** The token of `Authorization: Bearer <token>`, or null. */
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/-]{16,256}=*)\s*$/i.exec(authorization);
  return m ? m[1] : null;
}

/** Client credentials from `Authorization: Basic base64(id:secret)`, or null. */
export function parseBasicAuth(authorization: string | null | undefined): { clientId: string; clientSecret: string } | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Basic\s+([A-Za-z0-9+/=_-]{4,1024})\s*$/i.exec(authorization);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i <= 0) return null;
  // RFC 6749 2.3.1: both parts are form-urlencoded before base64.
  const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  return { clientId: dec(decoded.slice(0, i)), clientSecret: dec(decoded.slice(i + 1)) };
}

/** Client id + secret from the request body, or HTTP Basic (body wins only when Basic is absent). */
export function clientCredentialsOf(
  body: Record<string, unknown> | null | undefined,
  authorization: string | null | undefined,
): { clientId: string; clientSecret: string } | null {
  const basic = parseBasicAuth(authorization);
  if (basic) return basic;
  const id = body?.client_id;
  const secret = body?.client_secret;
  if (typeof id !== 'string' || typeof secret !== 'string' || !id || !secret) return null;
  if (id.length > 128 || secret.length > 256) return null;
  return { clientId: id, clientSecret: secret };
}

/** RFC 6749 error body (Discord uses the same shape on /oauth2/token). */
export function oauthError(error: string, description?: string): { error: string; error_description?: string } {
  return description ? { error, error_description: description } : { error };
}

/**
 * Bearer scope each bearer-capable /api/v10 route needs (Discord's docs).
 * Keys are `METHOD route-template` without the /api/v10 prefix.
 */
export const BEARER_ROUTE_SCOPES: Record<string, string> = {
  'GET /users/@me': 'identify',
  'GET /users/@me/guilds': 'guilds',
  'GET /users/@me/guilds/:guildId/member': 'guilds.members.read',
  'GET /users/@me/connections': 'connections',
};

/**
 * Whether a Bearer grant may use the application command routes. Managing
 * commands (`read` / `write`) is the app's own business: only a
 * client_credentials token (minted with the client secret) with
 * applications.commands.update, as on Discord. Command permissions take a
 * user's token with applications.commands.permissions.update (the route then
 * requires that user to manage the guild and its roles).
 */
export function commandsGrantOk(grant: { scopes: readonly string[]; grantType: string }, mode: 'read' | 'write' | 'permissions'): boolean {
  if (mode === 'permissions') return hasScope(grant.scopes, 'applications.commands.permissions.update');
  return grant.grantType === 'client_credentials' && hasScope(grant.scopes, 'applications.commands.update');
}

/** Scopes only the client_credentials grant may carry, never user consent (Discord). */
export const CLIENT_CREDENTIALS_ONLY_SCOPES: ReadonlySet<string> = new Set(['applications.commands.update']);
/** Install-time scopes: the consent itself acts on them; they are never put on a token. */
const INSTALL_ONLY_SCOPES: ReadonlySet<string> = new Set(['bot', 'webhook.incoming']);

/**
 * The scopes a user-consented grant (authorization code or implicit) gets for
 * `requested`: client_credentials-only scopes are refused, install-time
 * scopes are dropped from the token.
 */
export function userGrantScopes(requested: readonly string[]): { ok: true; scopes: string[] } | { ok: false; scope: string } {
  for (const s of requested) if (CLIENT_CREDENTIALS_ONLY_SCOPES.has(s)) return { ok: false, scope: s };
  return { ok: true, scopes: requested.filter((s) => !INSTALL_ONLY_SCOPES.has(s)) };
}

// ─── PKCE (RFC 7636) ──────────────────────────────────────────────────────────

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * Validate an authorize request's `code_challenge` / `code_challenge_method`.
 * Only S256 is supported (plain would give no protection over the code
 * itself); a method without a challenge, or a malformed challenge, is an error
 * so clients never assume protection they don't get.
 */
export function parsePkceChallenge(challenge: unknown, method: unknown): { ok: true; challenge: string | null } | { ok: false; error: string } {
  const c = typeof challenge === 'string' ? challenge : '';
  const m = typeof method === 'string' ? method : '';
  if (!c && !m) return { ok: true, challenge: null };
  if (!c) return { ok: false, error: 'code_challenge_method requires code_challenge' };
  if ((m || 'plain') !== 'S256') return { ok: false, error: 'Only code_challenge_method=S256 is supported' };
  if (!/^[A-Za-z0-9_-]{43}$/.test(c)) return { ok: false, error: 'Invalid code_challenge' };
  return { ok: true, challenge: c };
}

/** Whether `verifier` matches an S256 `challenge` (base64url(sha256(verifier))). */
export function pkceVerifierOk(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VALUE.test(verifier)) return false;
  return createHash('sha256').update(verifier).digest('base64url') === challenge;
}
