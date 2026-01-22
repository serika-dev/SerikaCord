import { config } from '../config';
import { User, type IUser } from '../models';
import { cache } from '../db';
import * as jose from 'jose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

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
    
    console.log('✅ Local JWT verification succeeded');
    return {
      valid: true,
      payload: payload as unknown as JWTPayload,
    };
  } catch (localError) {
    console.log('⚠️ Local JWT verification failed, trying accounts API...');
    console.log('   Accounts URL:', config.ACCOUNTS_API_URL);
    console.log('   Service key set:', !!config.ACCOUNTS_SERVICE_KEY);
    
    // Local verification failed - try accounts.serika.dev internal verify
    try {
      const verifyResponse = await fetch(`${config.ACCOUNTS_API_URL}/internal/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-key': config.ACCOUNTS_SERVICE_KEY,
        },
        body: JSON.stringify({ token, checkBan: true }),
      });
      
      const data = await verifyResponse.json();
      console.log('   Accounts API response:', JSON.stringify(data));
      
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
        
        return {
          valid: true,
          payload: {
            ...payload,
            user: { id: data.user.id, email: data.user.email },
            userId: data.user.id,
            username: data.user.username,
          },
          accountsUser: data.user,
        };
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
  await cache.set(`session:${sessionId}`, session, 90 * 24 * 60 * 60);

  // Create JWT tokens
  const tokens = await createTokenPair(userId, sessionId);

  return { session, tokens };
}

// Get session
export async function getSession(sessionId: string): Promise<Session | null> {
  return cache.get<Session>(`session:${sessionId}`);
}

// Delete session (logout)
export async function deleteSession(sessionId: string): Promise<void> {
  await cache.del(`session:${sessionId}`);
}

// Delete all sessions for user
export async function deleteAllUserSessions(userId: string): Promise<void> {
  // Note: This is a simplified implementation. In production, you'd want to track
  // all session IDs per user in Redis for efficient deletion
  const user = await User.findById(userId);
  if (user) {
    // Clear user cache
    await cache.del(`user:${userId}`);
  }
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
  const userId = verification.payload.sub || verification.payload.user?.id || verification.payload.userId;
  const sessionId = verification.payload.sid;
  const type = verification.payload.type;

  if (!userId) {
    return { user: null, error: 'Invalid token: no user ID' };
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
      
      // Create or update user in local database
      dbUser = await User.findOneAndUpdate(
        { _id: userId },
        {
          $setOnInsert: {
            _id: userId,
            username: accountsUser.username,
            email: accountsUser.email || `${accountsUser.username}@serika.dev`,
            status: 'online',
          },
          $set: {
            displayName: accountsUser.displayName || accountsUser.username,
            avatar: accountsUser.avatar,
            banner: accountsUser.banner,
            isPremium: accountsUser.isPremium || false,
            isVerified: accountsUser.isVerified || true,
          },
        },
        { upsert: true, new: true }
      );
    }
    
    if (!dbUser) {
      return { user: null, error: 'User not found' };
    }
    user = dbUser.toJSON() as IUser;
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

  const userId = verification.payload.sub || verification.payload.user?.id || verification.payload.userId;
  const sessionId = verification.payload.sid;
  const type = verification.payload.type;

  if (!userId) {
    return { error: 'Invalid token: no user ID' };
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
  const existingUsername = await User.findOne({ 
    username: { $regex: new RegExp(`^${data.username}$`, 'i') } 
  });
  if (existingUsername) {
    return { error: 'Username already taken' };
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Generate verification token
  const verificationToken = generateToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const user = new User({
    email: data.email.toLowerCase(),
    username: data.username,
    displayName: data.displayName || data.username,
    passwordHash,
    verificationToken,
    verificationExpires,
    isVerified: false,
  });

  await user.save();

  return { user: user.toJSON() as IUser };
}

// Verify email
export async function verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
  const user = await User.findOne({
    verificationToken: token,
    verificationExpires: { $gt: new Date() },
  });

  if (!user) {
    return { success: false, error: 'Invalid or expired verification token' };
  }

  user.isVerified = true;
  user.verificationToken = undefined;
  user.verificationExpires = undefined;
  await user.save();

  return { success: true };
}

// Login
export async function login(
  emailOrUsername: string,
  password: string,
  options?: { userAgent?: string; ipAddress?: string }
): Promise<{ user?: IUser; tokens?: TokenPair; error?: string }> {
  // Find user by email or username
  const user = await User.findOne({
    $or: [
      { email: emailOrUsername.toLowerCase() },
      { username: { $regex: new RegExp(`^${emailOrUsername}$`, 'i') } },
    ],
  }).select('+passwordHash');

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
  const { tokens } = await createSession(user._id.toString(), options);

  // Remove sensitive data
  const userObj = user.toJSON() as IUser;

  return { user: userObj, tokens };
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

  user.resetToken = resetToken;
  user.resetExpires = resetExpires;
  await user.save();

  return { success: true, token: resetToken };
}

// Reset password
export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const user = await User.findOne({
    resetToken: token,
    resetExpires: { $gt: new Date() },
  });

  if (!user) {
    return { success: false, error: 'Invalid or expired reset token' };
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetToken = undefined;
  user.resetExpires = undefined;
  await user.save();

  // Invalidate all sessions
  await deleteAllUserSessions(user._id.toString());

  return { success: true };
}

// Invalidate user cache
export async function invalidateUserCache(userId: string): Promise<void> {
  await cache.del(`user:${userId}`);
}

// Discord OAuth
export async function handleDiscordOAuth(discordUser: {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
}, options?: { userAgent?: string; ipAddress?: string }): Promise<{ user?: IUser; tokens?: TokenPair; isNew: boolean; error?: string }> {
  // Find existing user with Discord ID
  let user = await User.findOne({ discordId: discordUser.id });

  if (user) {
    // Update Discord info
    user.discordUsername = discordUser.username;
    if (discordUser.avatar && !user.avatar) {
      user.avatar = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`;
    }
    await user.save();

    const { tokens } = await createSession(user._id.toString(), options);
    return { user: user.toJSON() as IUser, tokens, isNew: false };
  }

  // Check if email already exists
  if (discordUser.email) {
    user = await User.findOne({ email: discordUser.email.toLowerCase() });
    if (user) {
      // Link Discord to existing account
      user.discordId = discordUser.id;
      user.discordUsername = discordUser.username;
      await user.save();

      const { tokens } = await createSession(user._id.toString(), options);
      return { user: user.toJSON() as IUser, tokens, isNew: false };
    }
  }

  // Create new user
  user = new User({
    discordId: discordUser.id,
    discordUsername: discordUser.username,
    username: discordUser.username,
    displayName: discordUser.username,
    email: discordUser.email?.toLowerCase(),
    avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : undefined,
    isVerified: !!discordUser.email, // Auto-verify if Discord provides email
  });
  await user.save();

  const { tokens } = await createSession(user._id.toString(), options);
  return { user: user.toJSON() as IUser, tokens, isNew: true };
}
