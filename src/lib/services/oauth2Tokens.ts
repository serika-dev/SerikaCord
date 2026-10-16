/**
 * OAuth2 grants for the Discord-compatible API: authorization codes (Redis,
 * one-time, 10 min), access + refresh tokens (Postgres `oauth2_tokens`, hashes
 * only), client authentication and Bearer token resolution.
 *
 * Used by the unversioned routes (/api/oauth2/*, src/lib/api/developers.ts),
 * their /api/v10 aliases and Bearer auth on /api/v10 (src/lib/api/botApi.ts),
 * and the guilds.join helper (src/lib/oauth/guildsJoin.ts).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import { processShared } from '@/lib/realtime/processShared';
import { BoundedMap } from '@/lib/utils/boundedMap';
import type { IApplication } from '@/lib/models';
import {
  ACCESS_TOKEN_TTL_S, AUTH_CODE_TTL_S, CLIENT_CREDENTIALS_ONLY_SCOPES, REFRESH_TOKEN_TTL_S, clientCredentialsOf,
  clientCredentialsScopes, oauthError, parseScopeParam, pkceVerifierOk,
} from '@/lib/oauth/scopes';

// ─── Schema ───────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __oauth2TokenSchema?: Promise<void> | null };

/** Create `oauth2_tokens` if it is missing (drizzle/manual_oauth2_tokens.sql). */
export function ensureOAuth2TokenSchema(): Promise<void> {
  if (g.__oauth2TokenSchema) return g.__oauth2TokenSchema;
  g.__oauth2TokenSchema = ensureSchema(
    'oauth2-tokens',
    {
      tables: {
        oauth2_tokens: ['id', 'application_id', 'user_id', 'scopes', 'grant_type', 'access_token_hash', 'refresh_token_hash', 'expires_at', 'refresh_expires_at', 'revoked_at'],
        // Read by every authorized_apps query (src/lib/db/schema.ts).
        authorized_apps: ['application_id'],
      },
    },
    () => withLockTimeout([
      sql`ALTER TABLE authorized_apps ADD COLUMN IF NOT EXISTS application_id uuid`,
      sql`CREATE TABLE IF NOT EXISTS oauth2_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id uuid NOT NULL,
        user_id uuid NOT NULL,
        scopes text[] NOT NULL DEFAULT '{}',
        grant_type text NOT NULL,
        access_token_hash text NOT NULL,
        refresh_token_hash text,
        expires_at timestamp NOT NULL,
        refresh_expires_at timestamp,
        revoked_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS oauth2_tokens_access_token_hash_unique ON oauth2_tokens (access_token_hash)`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS oauth2_tokens_refresh_token_hash_unique ON oauth2_tokens (refresh_token_hash)`,
      sql`CREATE INDEX IF NOT EXISTS oauth2_tokens_application_id_user_id_idx ON oauth2_tokens (application_id, user_id)`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__oauth2TokenSchema = null; // retry on the next call
    throw err;
  });
  return g.__oauth2TokenSchema;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export const hashSecret = (token: string) => createHash('sha256').update(token).digest('hex');

/** 30 random bytes, url-safe (like Discord's 30-character tokens, longer). */
function newToken(): string {
  return randomBytes(30).toString('base64url');
}

/** Constant-time string compare (via fixed-length digests). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export interface OAuthGrant {
  tokenId: string;
  applicationId: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
  grantType: string;
}

const BEARER_TTL_MS = 15_000;
const bearerCache = processShared(
  'oauth2BearerCache',
  () => new BoundedMap<string, { grant: OAuthGrant | null; at: number; gen: string }>(10_000),
);

/**
 * Cross-instance cache busting: every revoke / rotation bumps a Redis
 * generation counter; cached grants remember the generation they were read
 * under and are dropped when it moved, so a revoked token stops working on
 * every instance at once (the counter itself is read at most once a second).
 */
const BUST_KEY = 'oauth2:bearer-gen';
const genState = processShared('oauth2BearerGen', () => ({ value: '0', at: 0 }));

async function bearerGeneration(): Promise<string> {
  const now = Date.now();
  if (now - genState.at < 1000) return genState.value;
  try {
    const v = await getRedis()?.get(BUST_KEY);
    genState.value = v ?? '0';
  } catch { /* keep the last known value */ }
  genState.at = now;
  return genState.value;
}

/** Drop cached grants here and on every other instance. */
async function bustBearerCache(): Promise<void> {
  bearerCache.clear();
  try {
    const v = await getRedis()?.incr(BUST_KEY);
    if (v !== undefined && v !== null) { genState.value = String(v); genState.at = Date.now(); }
  } catch { /* local clear still applies */ }
}

/** Most live tokens one user keeps per application; older ones are revoked. */
const MAX_TOKENS_PER_APP_USER = 25;

export interface IssuedToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/** Store a new token for (app, user) and return Discord's token response. */
export async function mintToken(opts: {
  applicationId: string;
  userId: string;
  scopes: string[];
  grantType: 'authorization_code' | 'implicit' | 'client_credentials' | 'refresh_token';
  withRefresh: boolean;
}): Promise<IssuedToken> {
  await ensureOAuth2TokenSchema();
  const access = newToken();
  const refresh = opts.withRefresh ? newToken() : null;
  const now = Date.now();
  await db.insert(schema.oauth2Tokens).values({
    applicationId: opts.applicationId,
    userId: opts.userId,
    scopes: opts.scopes,
    grantType: opts.grantType,
    accessTokenHash: hashSecret(access),
    refreshTokenHash: refresh ? hashSecret(refresh) : null,
    expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
    refreshExpiresAt: refresh ? new Date(now + REFRESH_TOKEN_TTL_S * 1000) : null,
  });
  void pruneTokens(opts.applicationId, opts.userId).catch(() => {});
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: opts.scopes.join(' '),
  };
}

/** Drop dead rows of (app, user) and revoke the oldest beyond the per-user cap. */
async function pruneTokens(applicationId: string, userId: string) {
  const t = schema.oauth2Tokens;
  const now = new Date();
  await db.delete(t).where(and(
    eq(t.applicationId, applicationId),
    eq(t.userId, userId),
    or(
      and(lt(t.expiresAt, now), or(isNull(t.refreshExpiresAt), lt(t.refreshExpiresAt, now))),
      isNotNull(t.revokedAt),
    ),
  ));
  const live = await db.select({ id: t.id }).from(t)
    .where(and(eq(t.applicationId, applicationId), eq(t.userId, userId), isNull(t.revokedAt)))
    .orderBy(sql`${t.createdAt} DESC`);
  const extra = live.slice(MAX_TOKENS_PER_APP_USER).map((r) => r.id);
  if (extra.length > 0) {
    await db.update(t).set({ revokedAt: now }).where(inArray(t.id, extra));
    await bustBearerCache();
  }
}

/** The live grant behind an access token, or null (unknown, expired or revoked). */
export async function resolveBearerToken(token: string): Promise<OAuthGrant | null> {
  if (!token || token.length > 512) return null;
  const key = hashSecret(token);
  const hit = bearerCache.get(key);
  const now = Date.now();
  const gen = await bearerGeneration();
  if (hit && now - hit.at < BEARER_TTL_MS && hit.gen === gen) {
    if (!hit.grant || hit.grant.expiresAt.getTime() <= now) return null;
    return hit.grant;
  }
  let grant: OAuthGrant | null = null;
  try {
    await ensureOAuth2TokenSchema();
    const t = schema.oauth2Tokens;
    const rows = await db.select().from(t).where(eq(t.accessTokenHash, key)).limit(1);
    const row = rows[0];
    if (row && !row.revokedAt && row.expiresAt.getTime() > now) {
      grant = {
        tokenId: row.id,
        applicationId: row.applicationId,
        userId: row.userId,
        scopes: row.scopes ?? [],
        expiresAt: row.expiresAt,
        grantType: row.grantType,
      };
    }
  } catch (err) {
    console.error('[oauth2] bearer lookup failed:', (err as Error)?.message ?? err);
    return null; // don't cache a transient failure
  }
  bearerCache.set(key, { grant, at: now, gen });
  return grant;
}

/** Revoke every token a user granted to these applications (deauthorize). */
export async function revokeUserAppTokens(userId: string, applicationIds: string[]): Promise<void> {
  if (applicationIds.length === 0) return;
  await ensureOAuth2TokenSchema();
  const t = schema.oauth2Tokens;
  await db.update(t).set({ revokedAt: new Date() })
    .where(and(eq(t.userId, userId), isNull(t.revokedAt), inArray(t.applicationId, applicationIds)));
  await bustBearerCache();
}

/**
 * Deauthorizing an app in User Settings: revoke the user's tokens for it.
 * Rows carry the application id; rows from before it existed fall back to the
 * app name (apps can be renamed, so new rows never rely on it).
 */
export async function revokeTokensForAuthorizedApp(userId: string, row: { applicationId?: string | null; name?: string | null }): Promise<void> {
  if (row.applicationId) { await revokeUserAppTokens(userId, [row.applicationId]); return; }
  if (!row.name) return;
  const apps = await db.select({ id: schema.applications.id }).from(schema.applications).where(eq(schema.applications.name, row.name)).limit(50);
  await revokeUserAppTokens(userId, apps.map((a) => a.id));
}

// ─── Authorization codes ──────────────────────────────────────────────────────

interface StoredCode {
  applicationId: string;
  userId: string;
  scopes: string[];
  redirectUri: string | null;
  /** PKCE S256 challenge bound to the code (the exchange must send its verifier). */
  codeChallenge?: string | null;
}

const codeKey = (code: string) => `oauth2:code:${hashSecret(code)}`;

/** A one-time authorization code for the consent the user just gave. */
export async function issueAuthorizationCode(grant: StoredCode): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis unavailable');
  const code = newToken();
  await redis.set(codeKey(code), JSON.stringify(grant), 'EX', AUTH_CODE_TTL_S);
  return code;
}

async function consumeAuthorizationCode(code: string): Promise<StoredCode | null> {
  if (!code || code.length > 256) return null;
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.getdel(codeKey(code)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCode;
  } catch {
    return null;
  }
}

// ─── Token endpoint ───────────────────────────────────────────────────────────

export interface OAuthResult { status: number; body: unknown }

/** The application named by the request's client credentials, or null. */
export async function authenticateClient(
  body: Record<string, unknown> | null | undefined,
  authorization: string | null | undefined,
): Promise<IApplication | null> {
  const creds = clientCredentialsOf(body, authorization);
  if (!creds) return null;
  const { Application } = await import('@/lib/models');
  const app = await Application.findOne({ clientId: creds.clientId }).catch(() => null);
  if (!app || !app.clientSecret) return null;
  return safeEqual(app.clientSecret, creds.clientSecret) ? app : null;
}

/** POST /oauth2/token: authorization_code, refresh_token and client_credentials grants. */
export async function handleTokenRequest(
  rawBody: unknown,
  authorization: string | null | undefined,
  validScopes: ReadonlySet<string>,
): Promise<OAuthResult> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const grantType = typeof body.grant_type === 'string' ? body.grant_type : '';
  if (!grantType) return { status: 400, body: oauthError('invalid_request', 'Missing "grant_type"') };
  if (!['authorization_code', 'refresh_token', 'client_credentials'].includes(grantType)) {
    return { status: 400, body: oauthError('unsupported_grant_type', `Unsupported grant type "${grantType.slice(0, 40)}"`) };
  }
  const app = await authenticateClient(body, authorization);
  if (!app) return { status: 401, body: oauthError('invalid_client') };

  if (grantType === 'authorization_code') {
    const code = typeof body.code === 'string' ? body.code : '';
    const stored = await consumeAuthorizationCode(code);
    if (!stored || stored.applicationId.toLowerCase() !== app.id.toLowerCase()) {
      return { status: 400, body: oauthError('invalid_grant', 'Invalid "code" in request.') };
    }
    const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : null;
    if (stored.redirectUri && redirectUri !== stored.redirectUri) {
      return { status: 400, body: oauthError('invalid_grant', 'Invalid "redirect_uri" in request.') };
    }
    if (stored.codeChallenge && !pkceVerifierOk(body.code_verifier, stored.codeChallenge)) {
      return { status: 400, body: oauthError('invalid_grant', 'Invalid "code_verifier" in request.') };
    }
    // Defence in depth: a user-consented token never carries client_credentials-only scopes.
    if (stored.scopes.some((s) => CLIENT_CREDENTIALS_ONLY_SCOPES.has(s))) {
      return { status: 400, body: oauthError('invalid_scope') };
    }
    const issued = await mintToken({ applicationId: app.id, userId: stored.userId, scopes: stored.scopes, grantType: 'authorization_code', withRefresh: true });
    return { status: 200, body: issued };
  }

  if (grantType === 'refresh_token') {
    const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!refresh || refresh.length > 256) return { status: 400, body: oauthError('invalid_grant', 'Invalid "refresh_token" in request.') };
    await ensureOAuth2TokenSchema();
    const t = schema.oauth2Tokens;
    // Rotate atomically: the old pair stops working in the same statement
    // that proves it was still valid, so a refresh token works once.
    const now = new Date();
    const old = await db.update(t).set({ revokedAt: now, refreshTokenHash: null, updatedAt: now })
      .where(and(
        eq(t.refreshTokenHash, hashSecret(refresh)),
        eq(t.applicationId, app.id),
        isNull(t.revokedAt),
        gt(t.refreshExpiresAt, now),
      ))
      .returning({ userId: t.userId, scopes: t.scopes });
    if (old.length === 0) return { status: 400, body: oauthError('invalid_grant', 'Invalid "refresh_token" in request.') };
    await bustBearerCache();
    const issued = await mintToken({ applicationId: app.id, userId: old[0].userId, scopes: old[0].scopes ?? [], grantType: 'refresh_token', withRefresh: true });
    return { status: 200, body: issued };
  }

  // client_credentials: a token for the application's owner (Discord).
  const requested = parseScopeParam(body.scope);
  if (requested.length === 0) return { status: 400, body: oauthError('invalid_scope', 'Missing "scope"') };
  const allowed = clientCredentialsScopes(requested, validScopes);
  if (!allowed.ok) return { status: 400, body: oauthError('invalid_scope', `Invalid scope: ${allowed.scope.slice(0, 64)}`) };
  if (!app.ownerId) return { status: 400, body: oauthError('invalid_client') };
  const issued = await mintToken({ applicationId: app.id, userId: app.ownerId, scopes: allowed.scopes, grantType: 'client_credentials', withRefresh: false });
  return { status: 200, body: issued };
}

/** POST /oauth2/token/revoke: revoke an access or refresh token of the calling client. */
export async function handleRevokeRequest(rawBody: unknown, authorization: string | null | undefined): Promise<OAuthResult> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return { status: 400, body: oauthError('invalid_request', 'Missing "token"') };
  const app = await authenticateClient(body, authorization);
  if (!app) return { status: 401, body: oauthError('invalid_client') };
  if (token.length <= 512) {
    await ensureOAuth2TokenSchema();
    const t = schema.oauth2Tokens;
    const h = hashSecret(token);
    await db.update(t).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(t.applicationId, app.id), isNull(t.revokedAt), or(eq(t.accessTokenHash, h), eq(t.refreshTokenHash, h))));
    await bustBearerCache();
  }
  // RFC 7009: unknown tokens are not an error.
  return { status: 200, body: {} };
}
