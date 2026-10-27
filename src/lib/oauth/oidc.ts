/**
 * OpenID Connect pieces for the Discord-compatible OAuth2 API (pure, no I/O):
 * the userinfo object (GET /oauth2/userinfo), RS256 id_token signing and the
 * JWKS entry for GET /oauth2/keys. The signing key lives in
 * src/lib/services/oidcKeys.ts. Tested in tests/appapi-oidc.test.ts.
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'crypto';

/** Lifetime of an id_token (Discord uses one week, like the access token). */
export const ID_TOKEN_TTL_S = 604_800;

export interface OidcUserLike {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  email?: string | null;
  isVerified?: boolean | null;
  locale?: string | null;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

/** An avatar URL (stored avatars are absolute CDN URLs); anything else is dropped. */
function pictureOf(avatar: string | null | undefined): string | undefined {
  return typeof avatar === 'string' && /^https:\/\//i.test(avatar) ? avatar : undefined;
}

/**
 * Discord's OpenID Connect userinfo: `sub` plus basic profile with `openid`
 * (preferred_username, nickname, picture, locale); `email` and
 * `email_verified` only with the `email` scope.
 */
export function buildUserInfo(user: OidcUserLike, scopes: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sub: user.id,
    preferred_username: user.username,
    nickname: user.displayName || user.username,
    locale: user.locale || 'en-US',
  };
  const picture = pictureOf(user.avatar);
  if (picture) out.picture = picture;
  if (scopes.includes('email')) {
    out.email = user.email ?? null;
    out.email_verified = Boolean(user.isVerified && user.email);
  }
  return out;
}

/** OIDC `at_hash`: base64url of the left half of SHA-256(access_token). */
export function atHash(accessToken: string): string {
  const d = createHash('sha256').update(accessToken).digest();
  return b64url(d.subarray(0, d.length / 2));
}

/** RFC 7638 thumbprint of an RSA public key: the `kid` we publish. */
export function rsaThumbprint(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { e: string; n: string; kty: string };
  return b64url(createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest());
}

/** The public JWK of a signing key (GET /oauth2/keys entry). */
export function publicJwk(key: KeyObject, kid: string): { kty: string; use: 'sig'; alg: 'RS256'; kid: string; n: string; e: string } {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  const jwk = pub.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return { kty: jwk.kty, use: 'sig', alg: 'RS256', kid, n: jwk.n, e: jwk.e };
}

/** Compact JWS (RS256). */
export function signJwtRS256(claims: Record<string, unknown>, privateKey: KeyObject, kid: string): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Verify a compact RS256 JWS and return its claims (null when invalid). For tests and debugging. */
export function verifyJwtRS256(token: string, publicKey: KeyObject): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'RS256') return null;
    const ok = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
    return ok ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** id_token claims (OIDC Core 2): iss, sub, aud, exp, iat, auth_time, at_hash, nonce + the userinfo claims. */
export function idTokenClaims(opts: {
  issuer: string;
  clientId: string;
  user: OidcUserLike;
  scopes: readonly string[];
  accessToken: string;
  nonce?: string | null;
  authTime?: number;
  now?: number;
}): Record<string, unknown> {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const info = buildUserInfo(opts.user, opts.scopes);
  return {
    iss: opts.issuer,
    sub: opts.user.id,
    aud: opts.clientId,
    exp: iat + ID_TOKEN_TTL_S,
    iat,
    auth_time: opts.authTime ?? iat,
    at_hash: atHash(opts.accessToken),
    ...(opts.nonce ? { nonce: opts.nonce } : {}),
    ...Object.fromEntries(Object.entries(info).filter(([k]) => k !== 'sub')),
  };
}

/** An OIDC `nonce` from the authorize request (opaque, bounded), or null. */
export function parseNonce(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v && v.length <= 256 && /^[\x21-\x7e]+$/.test(v) ? v : null;
}
