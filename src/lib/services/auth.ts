import { config } from '../config';
import { User, type IUser } from '../models';
import { cache, getRedis } from '../db';
import { accountsInternalVerify, accountsLogout } from './accountsClient';
import { BoundedMap } from '../utils/boundedMap';
import { canAdoptLocalUser, dedupeUsername } from './authPolicy';
import { anonymizeIp } from '../security/ipPrivacy';
import * as jose from 'jose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// Short-lived in-memory cache for accounts.serika.dev token verification.
// Without this, every API call with an accounts token hits the accounts service.
// Bounded: keyed by token hash, so unique keys accumulate as tokens rotate.
const tokenVerifyCache = new BoundedMap<string, { result: any; expiresAt: number }>(5000);
const TOKEN_VERIFY_CACHE_TTL_MS = 30_000;
// Past the TTL a cached success is still served (and re-verified in the
// background) for this long, so an idle tab's first burst of requests doesn't
// all wait on the accounts service.
const TOKEN_VERIFY_STALE_MS = 5 * 60_000;
// One accounts round-trip per token at a time; concurrent requests share it.
const tokenVerifyInflight = new Map<string, Promise<any>>();

// Session interface
interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

// JWT payload structure (supports both local and accounts.serika.dev tokens)
interface JWTPayload {
  // Local token fields
  sub?: string;
  sid?: string;
  type?: 'access' | 'refresh';
  // Accounts.serika.dev token fields
  user?: { id: string; email?: string };
  userId?: string;
  username?: string;
  // Common fields
  iat: number;
  exp: number;
}

// Token response
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Which credential authenticated a request: a local session (Redis
 * `session:<sid>`) or an accounts.serika.dev token (known here only by its
 * hash). Used to link a device row to what it signed in with, so "Log out"
 * on the Devices page can revoke it.
 */
export type AuthCredential =
  | { kind: 'local'; sessionId: string }
  | { kind: 'accounts'; tokenHash: string };

// Auth result
interface AuthResult {
  user: IUser | null;
  error?: string;
  session?: Session;
  credential?: AuthCredential;
  /** Set when the account is suspended (the error is then 'Account banned'). */
  banned?: boolean;
}

/** Same user id, ignoring case and surrounding whitespace (UUIDs may arrive upper-cased). */
function sameUserId(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  return x.length > 0 && x === b.trim().toLowerCase();
}

/** Key for an accounts token in the verify cache and the revocation list. */
function accountsTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

const SERVICE_KEY_DEFAULT = 'serika-internal-auth-key-change-in-production';

/**
 * Constant-time check of an `x-service-key` header against the configured
 * accounts service key. Refuses everything while the key is unset or still the
 * public default, so a deployment without AUTH_INTERNAL_KEY has no internal API.
 */
export function isValidServiceKey(given: unknown): boolean {
  const expected = config.ACCOUNTS_SERVICE_KEY;
  if (!expected || expected === SERVICE_KEY_DEFAULT) return false;
  if (typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Generate JWT secret from config
const getJWTSecret = () => new TextEncoder().encode(config.JWT_SECRET);

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate session ID
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Generate verification/reset token
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Create JWT tokens
export async function createTokenPair(userId: string, sessionId: string): Promise<TokenPair> {
  const secret = getJWTSecret();
  const now = Math.floor(Date.now() / 1000);
  
  // Access token (30 days)
  const accessTokenExpiry = now + (30 * 24 * 60 * 60);
  const accessToken = await new jose.SignJWT({
    sub: userId,
    sid: sessionId,
    type: 'access',
  } satisfies Omit<JWTPayload, 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(accessTokenExpiry)
    .sign(secret);

  // Refresh token (90 days)
  const refreshTokenExpiry = now + (90 * 24 * 60 * 60);
  const refreshToken = await new jose.SignJWT({
    sub: userId,
    sid: sessionId,
    type: 'refresh',
  } satisfies Omit<JWTPayload, 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(refreshTokenExpiry)
    .sign(secret);

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(accessTokenExpiry * 1000),
  };
}

// Verify JWT token
export async function verifyToken(token: string): Promise<{ valid: boolean; payload?: JWTPayload; error?: string; accountsUser?: any; local?: boolean }> {
  // First try local verification
  let localError: unknown;
  try {
    const secret = getJWTSecret();
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] });
    const local = payload as unknown as JWTPayload;
    // A local token is only ever minted by createTokenPair, always with a
    // session id. JWT_SECRET may be the public default (it is unset on some
    // deployments), so a valid signature proves nothing by itself: callers
    // must still find the Redis session and check it belongs to `sub`. A
    // token without `sid` is never trusted locally; only the accounts
    // service can vouch for it.
    if (typeof local.sid === 'string' && local.sid && typeof local.sub === 'string' && local.sub) {
      return { valid: true, payload: local, local: true };
    }
    localError = new Error('Local token without a session');
  } catch (err) {
    localError = err;
  }
  {
    // Local verification failed - try accounts API fallback.
    // Two cache layers keep the slow (5–10s worst case) external verify off the
    // hot path: L1 in-memory (per process) and L2 Redis (shared across all app
    // instances under load balancing). Both use the same short TTL so the
    // token-revocation window is unchanged.
    const tokenHash = accountsTokenHash(token);
    const cached = tokenVerifyCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
    if (cached && cached.result?.valid && cached.expiresAt + TOKEN_VERIFY_STALE_MS > Date.now()) {
      if (!tokenVerifyInflight.has(tokenHash)) {
        const refresh = verifyWithAccounts(token, tokenHash, localError)
          .then((result) => { if (!result.valid) tokenVerifyCache.delete(tokenHash); })
          .catch(() => {})
          .finally(() => tokenVerifyInflight.delete(tokenHash));
        tokenVerifyInflight.set(tokenHash, refresh);
      }
      return cached.result;
    }
    const pending = tokenVerifyInflight.get(tokenHash);
    if (pending) {
      await pending.catch(() => {});
      const fresh = tokenVerifyCache.get(tokenHash);
      if (fresh && fresh.expiresAt > Date.now()) return fresh.result;
    }
    const lookup = verifyWithAccounts(token, tokenHash, localError);
    tokenVerifyInflight.set(tokenHash, lookup);
    try {
      return await lookup;
    } finally {
      if (tokenVerifyInflight.get(tokenHash) === lookup) tokenVerifyInflight.delete(tokenHash);
    }
  }
}

/**
 * Forget the cached accounts verification for a token (L1 + Redis L2), so a
 * token revoked on logout stops validating immediately instead of after the
 * cache window.
 */
export async function invalidateTokenVerifyCache(token: string): Promise<void> {
  const tokenHash = accountsTokenHash(token);
  tokenVerifyCache.delete(tokenHash);
  tokenVerifyInflight.delete(tokenHash);
  await cache.del(`tokenverify:${tokenHash}`);
}

async function verifyWithAccounts(
  token: string,
  tokenHash: string,
  localError: unknown,
): Promise<{ valid: boolean; payload?: JWTPayload; error?: string; accountsUser?: any }> {
  {
    const redisKey = `tokenverify:${tokenHash}`;
    const l2 = await cache.get<{ valid: boolean; payload?: JWTPayload; accountsUser?: any }>(redisKey);
    if (l2) {
      tokenVerifyCache.set(tokenHash, { result: l2, expiresAt: Date.now() + TOKEN_VERIFY_CACHE_TTL_MS });
      return l2;
    }

    try {
      const { data } = await accountsInternalVerify(token);

      if (data.valid && data.user) {
        // Decode the token payload for consistent interface
        const parts = token.split('.');
        let payload: JWTPayload = { iat: 0, exp: 0 };
        
        if (parts.length === 3) {
          try {
            payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          } catch {
            // Use defaults
          }
        }
        // Local-session claims mean nothing on an accounts token: drop them so
        // nothing downstream mistakes it for a local session or reads the
        // user from `sub` instead of what accounts vouched for.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sid: _sid, sub: _sub, type: _type, ...claims } = payload;
        
        const result = {
          valid: true,
          payload: {
            ...claims,
            user: { id: data.user.id, email: data.user.email },
            userId: data.user.id,
            username: data.user.username,
          },
          accountsUser: data.user,
        };
        tokenVerifyCache.set(tokenHash, { result, expiresAt: Date.now() + TOKEN_VERIFY_CACHE_TTL_MS });
        // Share across instances (best-effort; TTL matches the in-memory window).
        void cache.set(redisKey, result, Math.ceil(TOKEN_VERIFY_CACHE_TTL_MS / 1000));
        return result;
      }
      
      return { valid: false, error: data.error || 'Token verification failed' };
    } catch (accountsError) {
      console.error('Accounts API verification failed:', accountsError);
      
      if (localError instanceof jose.errors.JWTExpired) {
        return { valid: false, error: 'Token expired' };
      }
      return { valid: false, error: 'Invalid token' };
    }
  }
}

// Create session
export async function createSession(
  userId: string,
  options?: { userAgent?: string; ipAddress?: string }
): Promise<{ session: Session; tokens: TokenPair }> {
  const sessionId = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

  const session: Session = {
    id: sessionId,
    userId,
    createdAt: now,
    expiresAt,
    userAgent: options?.userAgent,
    // Sessions live for 90 days: keep only the network part of the address.
    ipAddress: anonymizeIp(options?.ipAddress) ?? undefined,
  };

  // Store session in Redis
  const sessionTtl = 90 * 24 * 60 * 60;
  await cache.set(`session:${sessionId}`, session, sessionTtl);
  // Index the session under the user so it can be revoked on suspension.
  await cache.trackUserSession(userId, sessionId, sessionTtl);

  // Create JWT tokens
  const tokens = await createTokenPair(userId, sessionId);

  return { session, tokens };
}

// Get session
export async function getSession(sessionId: string): Promise<Session | null> {
  return cache.get<Session>(`session:${sessionId}`);
}

// Delete session (logout)
export async function deleteSession(sessionId: string, userId?: string): Promise<void> {
  await cache.del(`session:${sessionId}`);
  if (userId) await cache.untrackUserSession(userId, sessionId);
}

// Delete all sessions for user
export async function deleteAllUserSessions(userId: string): Promise<void> {
  await revokeAllUserSessions(userId);
}

/**
 * Immediately revoke every session for a user (e.g. on suspension/ban). Kills
 * all Redis session records + the cached user, so the next authenticated
 * request from any device fails auth and the client is signed out.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  return cache.revokeUserSessions(userId);
}

// ── Device logout (Settings → Devices) ─────────────────────────────────────
// Device rows (user_device_sessions) are not tied to a credential in the
// schema, so the link lives in Redis: `device:creds:<deviceId>` holds
// `s:<sid>` for local sessions and `t:<tokenHash>` for accounts tokens seen
// on that device. Accounts tokens can't be deleted here, so a logged-out one
// goes on a revocation list (`revokedtoken:<hash>`), and "log out all other
// devices" sets a per-user cut-off (`authcutoff:<userId>`): accounts tokens
// issued before it stop working here, except the one that asked. A revoked
// token that is used again is also revoked at accounts (retireAccountsToken),
// which kills its refresh token there.
const DEVICE_LINK_TTL = 90 * 24 * 60 * 60;
// Accounts access tokens live at most 30 days.
const ACCOUNTS_TOKEN_REVOKE_TTL = 30 * 24 * 60 * 60;
// A cut-off has to outlive the refresh tokens (90 days) issued before it.
const AUTH_CUTOFF_TTL = 90 * 24 * 60 * 60;

function credentialMember(credential: AuthCredential): string {
  return credential.kind === 'local' ? `s:${credential.sessionId}` : `t:${credential.tokenHash}`;
}

/** Remember which credential signed in on a device row (called when the row is created/touched). */
export async function linkDeviceCredential(deviceId: string, credential: AuthCredential | undefined): Promise<void> {
  const redis = getRedis();
  if (!redis || !credential || !deviceId) return;
  try {
    const key = `device:creds:${deviceId}`;
    await redis.multi().sadd(key, credentialMember(credential)).expire(key, DEVICE_LINK_TTL).exec();
  } catch (error) {
    console.error('linkDeviceCredential error:', error);
  }
}

/**
 * Revoke everything that signed in on a device row: its local sessions (only
 * ones belonging to `userId`) and its accounts tokens. Never the credential of
 * the request doing it.
 */
export async function revokeDeviceCredentials(userId: string, deviceId: string, keep?: AuthCredential): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const key = `device:creds:${deviceId}`;
  const keepMember = keep ? credentialMember(keep) : null;
  let revoked = 0;
  try {
    const members = await redis.smembers(key);
    for (const member of members) {
      if (member === keepMember) continue;
      if (member.startsWith('s:')) {
        const sid = member.slice(2);
        const session = await getSession(sid);
        if (session && sameUserId(session.userId, userId)) {
          await deleteSession(sid, session.userId);
          revoked++;
        }
      } else if (member.startsWith('t:')) {
        await redis.setex(`revokedtoken:${member.slice(2)}`, ACCOUNTS_TOKEN_REVOKE_TTL, '1');
        revoked++;
      }
    }
    if (keepMember && members.includes(keepMember)) {
      await redis.multi().del(key).sadd(key, keepMember).expire(key, DEVICE_LINK_TTL).exec();
    } else {
      await redis.del(key);
    }
  } catch (error) {
    console.error('revokeDeviceCredentials error:', error);
  }
  return revoked;
}

/**
 * "Log out all other devices": delete every local session of the user except
 * the current one, and cut off every accounts token issued before now except
 * the current one.
 */
export async function revokeOtherUserSessions(userId: string, keep?: AuthCredential): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const keepSid = keep?.kind === 'local' ? keep.sessionId : null;
  let revoked = 0;
  try {
    const sessionIds = await redis.smembers(`user:sessions:${userId}`);
    const others = sessionIds.filter((sid) => sid !== keepSid);
    if (others.length > 0) {
      await redis.del(...others.map((sid) => `session:${sid}`));
      await redis.srem(`user:sessions:${userId}`, ...others);
      revoked += others.length;
    }
    await redis.setex(`authcutoff:${userId}`, AUTH_CUTOFF_TTL, JSON.stringify({
      at: Date.now(),
      keep: keep?.kind === 'accounts' ? keep.tokenHash : null,
    }));
  } catch (error) {
    console.error('revokeOtherUserSessions error:', error);
  }
  return revoked;
}

/**
 * Has this accounts token been logged out from the Devices page (by itself or
 * by a "log out all other devices" cut-off)? Fails open when Redis is down,
 * like the rest of the cache layer.
 */
async function isAccountsTokenRevoked(tokenHash: string, userId: string, iat: unknown): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const [denied, cutoffRaw] = await redis.mget(`revokedtoken:${tokenHash}`, `authcutoff:${userId}`);
    if (denied) return true;
    if (!cutoffRaw) return false;
    const cutoff = JSON.parse(cutoffRaw) as { at?: number; keep?: string | null };
    if (typeof cutoff.at !== 'number' || cutoff.keep === tokenHash) return false;
    // iat is whole seconds: a token from the cut-off's own second survives, so
    // the device that asked can refresh right away.
    const issuedAt = typeof iat === 'number' ? iat : 0;
    return issuedAt < Math.floor(cutoff.at / 1000);
  } catch (error) {
    console.error('isAccountsTokenRevoked error:', error);
    return false;
  }
}

/** Revoke a logged-out accounts token at accounts too (once), so its refresh token dies with it. */
async function retireAccountsToken(token: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const first = await redis.set(`revokedtoken:retired:${accountsTokenHash(token)}`, '1', 'EX', 3600, 'NX');
    if (first !== 'OK') return;
    await accountsLogout(token).catch(() => {});
    await invalidateTokenVerifyCache(token);
  } catch (error) {
    console.error('retireAccountsToken error:', error);
  }
}

/**
 * For /auth/refresh: is the access token this browser still holds one that was
 * logged out from the Devices page? Then it must not be refreshed. The claims
 * are read unverified, which is fine here: the answer can only refuse.
 */
export async function isLoggedOutAccountsToken(token: string): Promise<boolean> {
  let claims: { userId?: unknown; user?: { id?: unknown }; iat?: unknown; sid?: unknown } = {};
  try {
    claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
  } catch {
    return false;
  }
  if (claims.sid) return false;
  const rawId = typeof claims.user?.id === 'string' ? claims.user.id : (typeof claims.userId === 'string' ? claims.userId : '');
  if (!rawId) return false;
  const userId = rawId.length === 24 && /^[0-9a-f]{24}$/i.test(rawId) ? mongoIdToUUID(rawId) : rawId;
  const revoked = await isAccountsTokenRevoked(accountsTokenHash(token), userId, claims.iat);
  if (revoked) await retireAccountsToken(token);
  return revoked;
}

// Convert MongoDB ObjectId (24 hex chars) to UUID format (36 chars with hyphens)
function mongoIdToUUID(mongoId: string): string {
  // Pad with zeros to 32 hex chars, then format as UUID
  const padded = mongoId.padEnd(32, '0');
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

// Authenticate request and return user
export async function authenticateRequest(
  authHeader: string | null,
  cookies: Record<string, string>,
  opts: { allowBanned?: boolean } = {},
): Promise<AuthResult> {
  // Get token from Authorization header or cookie
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookies.auth_token) {
    token = cookies.auth_token;
  }

  if (!token) {
    return { user: null, error: 'No authentication token provided' };
  }

  // Verify JWT
  const verification = await verifyToken(token);

  if (!verification.valid || !verification.payload) {
    return { user: null, error: verification.error || 'Invalid token' };
  }

  // Local tokens carry (sub, sid); accounts.serika.dev tokens are identified
  // by what the accounts service vouched for (user.id / userId).
  const local = verification.local === true;
  const tokenSub = verification.payload.sub;
  let userId = local
    ? tokenSub
    : (verification.accountsUser?.id || verification.payload.user?.id || verification.payload.userId);
  const sessionId = local ? verification.payload.sid : undefined;

  if (!userId) {
    return { user: null, error: 'Invalid token: no user ID' };
  }

  // Convert MongoDB ObjectId to UUID if needed (24 hex chars = MongoDB ObjectId)
  if (userId.length === 24 && /^[0-9a-f]{24}$/i.test(userId)) {
    userId = mongoIdToUUID(userId);
  }

  // Local tokens must be access tokens backed by a live session of the same
  // user (see verifyToken). Accounts tokens are checked against our own
  // revocation list (Devices page "Log out").
  if (local && verification.payload.type !== 'access') {
    return { user: null, error: 'Invalid token type' };
  }
  const tokenHash = local ? undefined : accountsTokenHash(token);

  // Session check, revocation check and the cached-user read are independent
  // Redis GETs: run them together so every request pays one round-trip.
  const cacheKey = `user:${userId}`;
  const [session, cachedUser, revoked] = await Promise.all([
    sessionId ? getSession(sessionId) : Promise.resolve(null),
    cache.get<IUser>(cacheKey),
    tokenHash ? isAccountsTokenRevoked(tokenHash, userId, verification.payload.iat) : Promise.resolve(false),
  ]);
  if (local && (!session || !sameUserId(session.userId, tokenSub))) {
    return { user: null, error: 'Session expired or invalid' };
  }
  if (revoked) {
    void retireAccountsToken(token);
    return { user: null, error: 'Session expired or invalid' };
  }
  const credential: AuthCredential = sessionId
    ? { kind: 'local', sessionId }
    : { kind: 'accounts', tokenHash: tokenHash as string };

  // Get user from cache or database
  let user = cachedUser;

  if (!user) {
    let dbUser = await User.findById(userId);
    
    // If user not found locally but we have accountsUser from verification, create locally
    if (!dbUser && verification.accountsUser) {
      const accountsUser = verification.accountsUser;
      const accountsUsername = typeof accountsUser.username === 'string' ? accountsUser.username.trim() : '';
      if (!accountsUsername) {
        // findOne({ username: undefined }) would drop the filter and match an
        // arbitrary row — never guess.
        return { user: null, error: 'User not found' };
      }

      // A local row with this username but a different id is only adopted for
      // legacy pre-accounts users (same verified email, not a bot/system row).
      // Otherwise this accounts user gets their own row under a de-duplicated
      // username — never someone else's identity (bots, system users,
      // Discord-created users exist only locally).
      const existingByUsername = await User.findOne({ username: accountsUsername });
      if (existingByUsername && canAdoptLocalUser(existingByUsername, {
        id: userId,
        email: accountsUser.email,
        isVerified: accountsUser.isVerified,
      })) {
        dbUser = existingByUsername;
        const updateFields: Record<string, any> = {
          isPremium: accountsUser.isPremium || false,
          isVerified: accountsUser.isVerified || true,
        };
        dbUser = await User.updateById(dbUser.id, updateFields) || dbUser;
      } else {
        let username = accountsUsername;
        if (existingByUsername) {
          username = dedupeUsername(accountsUsername, userId);
          if (await User.findOne({ username })) username = dedupeUsername(accountsUsername, userId, 1);
        }
        // email is UNIQUE locally: don't collide with a row we refused to adopt.
        let email: string | undefined = accountsUser.email ? String(accountsUser.email).toLowerCase() : `${username}@serika.dev`;
        if (email && await User.findOne({ email })) email = undefined;
        dbUser = await User.create({
          id: userId,
          username,
          email,
          displayName: accountsUser.displayName || accountsUsername,
          status: 'online',
          avatar: accountsUser.avatar,
          banner: accountsUser.banner,
          isPremium: accountsUser.isPremium || false,
          isVerified: accountsUser.isVerified || true,
        });
      }
    } else if (dbUser && verification.accountsUser) {
      const accountsUser = verification.accountsUser;
      const updateFields: Record<string, any> = {
        isPremium: accountsUser.isPremium || false,
        isVerified: accountsUser.isVerified || true,
      };
      dbUser = await User.updateById(userId, updateFields) || dbUser;
    }
    
    if (!dbUser) {
      return { user: null, error: 'User not found' };
    }
    user = dbUser as IUser;
    // Cache for 5 minutes
    await cache.set(cacheKey, user, 300);
  }

  // Suspended accounts are refused everywhere except Account Standing /
  // appeals, which opt in with allowBanned.
  if (user.isBanned && !opts.allowBanned) {
    return {
      user: null,
      error: 'Account banned',
      banned: true,
    };
  }

  return { user: user as IUser, session: session ?? undefined, credential };
}


// Refresh access token
export async function refreshAccessToken(refreshToken: string): Promise<{ tokens?: TokenPair; error?: string }> {
  const verification = await verifyToken(refreshToken);

  if (!verification.valid || !verification.payload) {
    return { error: verification.error || 'Invalid refresh token' };
  }

  // Only local session tokens are refreshed here (accounts tokens refresh at
  // accounts.serika.dev). Same rule as authenticateRequest: a refresh token
  // backed by a live session that belongs to its `sub`.
  if (verification.local) {
    const userId = verification.payload.sub as string;
    const sessionId = verification.payload.sid as string;
    if (verification.payload.type !== 'refresh') {
      return { error: 'Invalid token type' };
    }
    const session = await getSession(sessionId);
    if (!session || !sameUserId(session.userId, userId)) {
      return { error: 'Session expired' };
    }
    // Generate new token pair
    const tokens = await createTokenPair(userId, sessionId);
    return { tokens };
  }

  // For accounts.serika.dev tokens, proxy to accounts API
  return { error: 'Use accounts.serika.dev refresh endpoint' };
}

// Register new user
export async function registerUser(data: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user?: IUser; error?: string }> {
  // Check if email already exists
  const existingEmail = await User.findOne({ email: data.email.toLowerCase() });
  if (existingEmail) {
    return { error: 'Email already registered' };
  }

  // Check if username already exists
  const existingUsername = await User.findOne({ username: data.username });
  if (existingUsername) {
    return { error: 'Username already taken' };
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Generate verification token
  const verificationToken = generateToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const user = await User.create({
    email: data.email.toLowerCase(),
    username: data.username,
    displayName: data.displayName || data.username,
    passwordHash,
    verificationToken,
    verificationExpires,
    isVerified: false,
  });

  return { user: user as IUser };
}

// Verify email
export async function verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
  const user = await User.findOne({ verificationToken: token });

  if (!user || (user.verificationExpires && new Date(user.verificationExpires) <= new Date())) {
    return { success: false, error: 'Invalid or expired verification token' };
  }

  await User.updateById(user.id, {
    isVerified: true,
    verificationToken: null,
    verificationExpires: null,
  });

  return { success: true };
}

// Login
export async function login(
  emailOrUsername: string,
  password: string,
  options?: { userAgent?: string; ipAddress?: string }
): Promise<{ user?: IUser; tokens?: TokenPair; error?: string }> {
  // Find user by email or username
  let user = await User.findOne({ email: emailOrUsername.toLowerCase() });
  if (!user) {
    user = await User.findOne({ username: emailOrUsername });
  }

  if (!user) {
    return { error: 'Invalid credentials' };
  }

  // Verify password
  if (!user.passwordHash) {
    return { error: 'Account uses social login' };
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return { error: 'Invalid credentials' };
  }

  // Suspended accounts may still sign in: authenticateRequest only lets them
  // reach Account Standing and appeals (allowBanned), nothing else.

  // Create session
  const { tokens } = await createSession(user.id, options);

  return { user: user as IUser, tokens };
}

// Request password reset
export async function requestPasswordReset(email: string): Promise<{ success: boolean; token?: string }> {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    // Don't reveal if email exists
    return { success: true };
  }

  const resetToken = generateToken();
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await User.updateById(user.id, {
    resetToken,
    resetExpires,
  });

  return { success: true, token: resetToken };
}

// Reset password
export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const user = await User.findOne({ resetToken: token });

  if (!user || (user.resetExpires && new Date(user.resetExpires) <= new Date())) {
    return { success: false, error: 'Invalid or expired reset token' };
  }

  const passwordHash = await hashPassword(newPassword);
  await User.updateById(user.id, {
    passwordHash,
    resetToken: null,
    resetExpires: null,
  });

  // Invalidate all sessions
  await deleteAllUserSessions(user.id);

  return { success: true };
}

// Invalidate user cache
export async function invalidateUserCache(userId: string): Promise<void> {
  await cache.del(`user:${userId}`);
}

// Discord OAuth (login via GET /api/auth/discord). Only logs in users whose
// discordId is already linked (through the authenticated connection flow) or
// creates a fresh account. It never links by email: Discord returns `email`
// even when it is unverified, so matching on it would hand any account to
// whoever set that address on their Discord profile.
export async function handleDiscordOAuth(discordUser: {
  id: string;
  username: string;
  email?: string;
  verified?: boolean;
  avatar?: string;
}, options?: { userAgent?: string; ipAddress?: string }): Promise<{ user?: IUser; tokens?: TokenPair; isNew: boolean; error?: string }> {
  // Find existing user with Discord ID
  let user = await User.findOne({ discordId: discordUser.id });

  if (user) {
    // Only update discordUsername — NEVER set the user's avatar from Discord
    const updateFields: Record<string, any> = {
      discordUsername: discordUser.username,
    };
    user = await User.updateById(user.id, updateFields) || user;

    const { tokens } = await createSession(user.id, options);
    return { user: user as IUser, tokens, isNew: false };
  }

  const verifiedEmail = discordUser.verified === true && discordUser.email
    ? discordUser.email.toLowerCase()
    : undefined;

  // An account with this email already exists: its owner links Discord from
  // Settings → Connections while signed in, not by logging in here.
  if (verifiedEmail && await User.findOne({ email: verifiedEmail })) {
    return { isNew: false, error: 'account_exists_link_from_settings' };
  }

  let username = (discordUser.username || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'user';
  if (await User.findOne({ username })) {
    const base = username;
    username = dedupeUsername(base, discordUser.id);
    if (await User.findOne({ username })) username = dedupeUsername(base, discordUser.id, 1);
  }

  // Create new user — do NOT set avatar from Discord; it belongs only in the connection
  user = await User.create({
    discordId: discordUser.id,
    discordUsername: discordUser.username,
    username,
    displayName: discordUser.username,
    email: verifiedEmail,
    isVerified: !!verifiedEmail,
  });

  const { tokens } = await createSession(user.id, options);
  return { user: user as IUser, tokens, isNew: true };
}
