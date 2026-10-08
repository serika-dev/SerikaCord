import { config } from '../config';
import { User, type IUser } from '../models';
import { cache } from '../db';
import { accountsInternalVerify } from './accountsClient';
import { BoundedMap } from '../utils/boundedMap';
import { canAdoptLocalUser, dedupeUsername } from './authPolicy';
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

// Auth result
interface AuthResult {
  user: IUser | null;
  error?: string;
  session?: Session;
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
export async function verifyToken(token: string): Promise<{ valid: boolean; payload?: JWTPayload; error?: string; accountsUser?: any }> {
  // First try local verification
  try {
    const secret = getJWTSecret();
    const { payload } = await jose.jwtVerify(token, secret);
    
    return {
      valid: true,
      payload: payload as unknown as JWTPayload,
    };
  } catch (localError) {
    // Local verification failed - try accounts API fallback.
    // Two cache layers keep the slow (5–10s worst case) external verify off the
    // hot path: L1 in-memory (per process) and L2 Redis (shared across all app
    // instances under load balancing). Both use the same short TTL so the
    // token-revocation window is unchanged.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
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
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
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
        
        const result = {
          valid: true,
          payload: {
            ...payload,
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
    ipAddress: options?.ipAddress,
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

// Convert MongoDB ObjectId (24 hex chars) to UUID format (36 chars with hyphens)
function mongoIdToUUID(mongoId: string): string {
  // Pad with zeros to 32 hex chars, then format as UUID
  const padded = mongoId.padEnd(32, '0');
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

// Authenticate request and return user
export async function authenticateRequest(
  authHeader: string | null,
  cookies: Record<string, string>
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

  // Support both local tokens (sub, sid) and accounts.serika.dev tokens (user.id, userId)
  let userId = verification.payload.sub || verification.payload.user?.id || verification.payload.userId;
  const sessionId = verification.payload.sid;
  const type = verification.payload.type;

  if (!userId) {
    return { user: null, error: 'Invalid token: no user ID' };
  }

  // Convert MongoDB ObjectId to UUID if needed (24 hex chars = MongoDB ObjectId)
  if (userId.length === 24 && /^[0-9a-f]{24}$/i.test(userId)) {
    userId = mongoIdToUUID(userId);
  }

  // For local tokens, verify session exists
  // For accounts.serika.dev tokens, skip session check (they manage their own sessions)
  if (sessionId) {
    if (type && type !== 'access') {
      return { user: null, error: 'Invalid token type' };
    }
    const session = await getSession(sessionId);
    if (!session) {
      return { user: null, error: 'Session expired or invalid' };
    }
  }

  // Get user from cache or database
  const cacheKey = `user:${userId}`;
  let user = await cache.get<IUser>(cacheKey);

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

  // Check if user is banned
  if (user.isBanned) {
    return {
      user: null,
      error: 'Account banned',
    };
  }

  return { user: user as IUser, session: undefined };
}


// Refresh access token
export async function refreshAccessToken(refreshToken: string): Promise<{ tokens?: TokenPair; error?: string }> {
  const verification = await verifyToken(refreshToken);

  if (!verification.valid || !verification.payload) {
    return { error: verification.error || 'Invalid refresh token' };
  }

  let userId = verification.payload.sub || verification.payload.user?.id || verification.payload.userId;
  const sessionId = verification.payload.sid;
  const type = verification.payload.type;

  if (!userId) {
    return { error: 'Invalid token: no user ID' };
  }

  // Convert MongoDB ObjectId to UUID if needed (24 hex chars = MongoDB ObjectId)
  if (userId.length === 24 && /^[0-9a-f]{24}$/i.test(userId)) {
    userId = mongoIdToUUID(userId);
  }

  // Only check type for local tokens
  if (type && type !== 'refresh') {
    return { error: 'Invalid token type' };
  }

  // Verify session still exists (only for local tokens)
  if (sessionId) {
    const session = await getSession(sessionId);
    if (!session) {
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

  // Check if banned
  if (user.isBanned) {
    return { error: 'Account banned' };
  }

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
