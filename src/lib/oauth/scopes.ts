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

/** Whether a grant may touch application commands (`write`) or their permissions. */
export function commandsScopeOk(scopes: readonly string[], mode: 'read' | 'write' | 'permissions'): boolean {
  if (mode === 'permissions') return hasScope(scopes, 'applications.commands.permissions.update');
  return hasScope(scopes, 'applications.commands.update');
}
