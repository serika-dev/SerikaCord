import { Elysia, t } from 'elysia';
import { createHash } from 'crypto';
import { config } from '../config';
import {
  verifyEmail,
  resetPassword,
  deleteSession,
  verifyToken,
  handleDiscordOAuth,
  authenticateRequest,
} from '../services/auth';
import { UserConnection, User } from '../models';
import { getPlatformSettings } from '../models/PlatformSettings';
import {
  accountsRegister,
  accountsLogin,
  accountsRefresh,
  accountsVerifyEmail,
  accountsResendVerification,
  accountsForgotPassword,
  accountsResetPassword,
  accountsInternalGetUser,
} from '../services/accountsClient';

interface SavedAccountEntry {
  email: string;
  username: string;
  displayName?: string;
  avatar?: string;
  token?: string;
  refreshToken?: string;
  savedAt: number;
}

function parseSavedAccounts(cookieValue: unknown): SavedAccountEntry[] {
  if (Array.isArray(cookieValue)) return cookieValue as SavedAccountEntry[];
  if (!cookieValue || typeof cookieValue !== 'string') return [];
  try {
    return JSON.parse(decodeURIComponent(cookieValue));
  } catch {
    return [];
  }
}

function encodeSavedAccountsCookie(accounts: SavedAccountEntry[]): string {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  return `saved_accounts=${encodeURIComponent(JSON.stringify(accounts))}; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

function getAccountEmail(user: { email?: string | null; username: string }): string {
  return user.email || `${user.username}@serika.dev`;
}

function upsertSavedAccount(
  accounts: SavedAccountEntry[],
  entry: SavedAccountEntry
): SavedAccountEntry[] {
  const entryEmail = entry.email.toLowerCase();
  const entryUsername = entry.username.toLowerCase();
  const filtered = accounts.filter((a) => {
    if (a.email.toLowerCase() === entryEmail) return false;
    if (a.username.toLowerCase() === entryUsername) return false;
    return true;
  });
  filtered.push(entry);
  return filtered;
}

async function getLocalUserFromToken(token: string) {
  const result = await authenticateRequest(`Bearer ${token}`, { auth_token: token });
  return result.user;
}

// Raw 302 redirect. Elysia's `redirect()` helper mutates an immutable Response
// header map under the Next.js adapter ("TypeError: immutable"), so we return a
// plain Response with an explicit Location header (and optional Set-Cookie).
function oauthRedirect(url: string, setCookie?: string | string[]): Response {
  const headers = new Headers({ Location: url });
  if (setCookie) {
    for (const c of Array.isArray(setCookie) ? setCookie : [setCookie]) {
      headers.append('Set-Cookie', c);
    }
  }
  return new Response(null, { status: 302, headers });
}

// ── OAuth2 provider configurations ──────────────────────────────────────────
// Each provider reads client ID/secret from env vars and implements:
//   getAuthUrl  – build the provider's authorisation URL
//   exchangeCode – swap the auth code for an access token
//   fetchUser   – call the provider's /me endpoint for user info
interface OAuth2Provider {
  clientId: string;
  clientSecret: string;
  scopes: string;
  getAuthUrl: (clientId: string, redirectUri: string, scopes: string) => string;
  exchangeCode: (clientId: string, clientSecret: string, code: string, redirectUri: string) => Promise<{ access_token: string; refreshToken?: string }>;
  fetchUser: (accessToken: string) => Promise<{ accountId: string; username?: string; displayName?: string; avatar?: string }>;
}

const OAUTH2_PROVIDERS: Record<string, OAuth2Provider> = {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    scopes: 'read:user',
    getAuthUrl: (clientId, redirectUri) =>
      `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user`,
    exchangeCode: async (_clientId, clientSecret, code, redirectUri) => {
      const resp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: _clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const data = await resp.json() as any;
      return { access_token: data.access_token, refreshToken: data.refresh_token };
    },
    fetchUser: async (accessToken) => {
      const resp = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await resp.json() as any;
      return {
        accountId: String(data.id),
        username: data.login,
        displayName: data.name || data.login,
        avatar: data.avatar_url,
      };
    },
  },

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    scopes: 'user-read-private user-read-email',
    getAuthUrl: (clientId, redirectUri, scopes) =>
      `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scopes)}`,
    exchangeCode: async (clientId, clientSecret, code, redirectUri) => {
      const resp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      const data = await resp.json() as any;
      return { access_token: data.access_token, refreshToken: data.refresh_token };
    },
    fetchUser: async (accessToken) => {
      const resp = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await resp.json() as any;
      return {
        accountId: data.id,
        username: data.id,
        displayName: data.display_name || data.id,
        avatar: data.images?.[0]?.url,
      };
    },
  },

  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
    scopes: 'user:read:email',
    getAuthUrl: (clientId, redirectUri, scopes) =>
      `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}`,
    exchangeCode: async (clientId, clientSecret, code, redirectUri) => {
      const resp = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const data = await resp.json() as any;
      return { access_token: data.access_token, refreshToken: data.refresh_token };
    },
    fetchUser: async (accessToken) => {
      const resp = await fetch('https://api.twitch.tv/helix/users', {
        headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': process.env.TWITCH_CLIENT_ID || '' },
      });
      const data = await resp.json() as any;
      const u = data.data?.[0];
      if (!u) return { accountId: '' };
      return {
        accountId: u.id,
        username: u.login,
        displayName: u.display_name || u.login,
        avatar: u.profile_image_url,
      };
    },
  },

  steam: {
    clientId: process.env.STEAM_API_KEY || '',
    clientSecret: process.env.STEAM_API_KEY || '',
    scopes: '',
    getAuthUrl: (_clientId, redirectUri) =>
      `https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to=${redirectUri}&openid.realm=${redirectUri}&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select`,
    exchangeCode: async () => {
      // Steam uses OpenID, not OAuth2 code exchange — the "code" is the SteamID
      // extracted from the openid.identity return URL. We handle it in fetchUser.
      return { access_token: '' };
    },
    fetchUser: async (steamId: string) => {
      const apiKey = process.env.STEAM_API_KEY || '';
      const resp = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`);
      const data = await resp.json() as any;
      const p = data.response?.players?.[0];
      if (!p) return { accountId: steamId };
      return {
        accountId: steamId,
        username: p.personaname,
        displayName: p.personaname,
        avatar: p.avatarfull,
      };
    },
  },

  discord: {
    clientId: config.DISCORD_CLIENT_ID,
    clientSecret: config.DISCORD_CLIENT_SECRET,
    scopes: 'identify',
    getAuthUrl: (clientId, redirectUri, scopes) =>
      `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}`,
    exchangeCode: async (clientId, clientSecret, code, redirectUri) => {
      const resp = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      const data = await resp.json() as any;
      return { access_token: data.access_token, refreshToken: data.refresh_token };
    },
    fetchUser: async (accessToken) => {
      const resp = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await resp.json() as any;
      const avatar = data.avatar
        ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith('a_') ? 'gif' : 'png'}`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(data.discriminator || '0') % 5}.png`;
      return {
        accountId: data.id,
        username: data.username,
        displayName: data.global_name || data.username,
        avatar,
      };
    },
  },
};

export const authRoutes = new Elysia({ prefix: '/auth' })
  // Register - proxies to accounts.serika.dev
  .post('/register', async ({ body, set }) => {
    const { email, username, password, displayName } = body;

    // Validate password strength
    if (password.length < 8) {
      set.status = 400;
      return { error: 'Password must be at least 8 characters' };
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      set.status = 400;
      return { error: 'Username can only contain letters, numbers, and underscores' };
    }

    try {
      const { ok, status, data } = await accountsRegister({ email, username, password, displayName });

      if (!ok) {
        set.status = status;
        return { error: data.error || 'Registration failed' };
      }

      set.status = 201;
      return { 
        success: true, 
        message: data.message || 'Account created. Please check your email to verify your account.',
        user: data.user,
      };
    } catch (error) {
      console.error('Register proxy error:', error);
      set.status = 500;
      return { error: 'Failed to connect to authentication service' };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      username: t.String({ minLength: 3, maxLength: 32 }),
      password: t.String({ minLength: 8, maxLength: 128 }),
      displayName: t.Optional(t.String({ maxLength: 32 })),
    }),
  })

  // Login - proxies to accounts.serika.dev
  .post('/login', async ({ body, set, headers, cookie }) => {
    const { email, password } = body;

    try {
      const { ok, status, data } = await accountsLogin(
        { email, password },
        {
          userAgent: headers['user-agent'],
          ip: headers['x-forwarded-for'] || headers['x-real-ip'],
        }
      );

      if (!ok) {
        set.status = status;
        return { error: data.error || 'Authentication failed' };
      }

      // Start from current saved_accounts cookie and preserve currently logged-in account
      let savedAccounts = parseSavedAccounts(cookie.saved_accounts?.value as unknown);
      const currentToken = cookie.auth_token?.value;
      if (typeof currentToken === 'string' && currentToken) {
        const currentUser = await getLocalUserFromToken(currentToken);
        if (currentUser) {
          const email = getAccountEmail(currentUser);
          savedAccounts = upsertSavedAccount(savedAccounts, {
            email,
            username: currentUser.username,
            displayName: currentUser.displayName ?? undefined,
            avatar: currentUser.avatar ?? undefined,
            token: currentToken,
            refreshToken: typeof cookie.refresh_token?.value === 'string' ? cookie.refresh_token.value : undefined,
            savedAt: Date.now(),
          });
        }
      }

      // Add newly logged-in account only if it maps to a local SerikaCord user
      if (data.token) {
        const newUser = await getLocalUserFromToken(data.token);
        if (newUser) {
          const email = getAccountEmail(newUser);
          savedAccounts = upsertSavedAccount(savedAccounts, {
            email,
            username: newUser.username || email.split('@')[0],
            displayName: newUser.displayName ?? undefined,
            avatar: newUser.avatar ?? undefined,
            token: data.token,
            refreshToken: data.refreshToken,
            savedAt: Date.now(),
          });

          // Fetch full accounts profile if login response is missing serikaMoe/discord fields.
          // The accounts /internal/get-user endpoint already returns serikaMoeUsername/serikaMoeId
          // and (after redeployment) discordId/discordUsername.
          let accountsUser = data.user as any;
          if (!accountsUser?.serikaMoeUsername || !accountsUser?.discordId) {
            try {
              const lookupKey = accountsUser?.id || email || '';
              if (lookupKey) {
                const { ok: guOk, data: guData } = await accountsInternalGetUser(lookupKey);
                if (guOk && guData.user) {
                  accountsUser = { ...accountsUser, ...guData.user };
                }
              }
            } catch {
              // Best-effort — continue with whatever we have
            }
          }

          // Auto-create/update 'serika' connection using serikaMoeUsername from accounts API
          // The serika.moe profile URL is /u/<serikaMoeUsername>, not /u/<serikacord username>
          try {
            const moeUsername = accountsUser?.serikaMoeUsername?.toLowerCase() || null;
            const moeId = accountsUser?.serikaMoeId || null;
            // Only create serika connection if user has a linked serika.moe account
            if (moeUsername) {
              const existingSerikaConn = await UserConnection.findOne({ userId: newUser.id, provider: 'serika' });
              // Use the accounts service avatar (serika.moe avatar) if available,
              // fall back to the SerikaCord user avatar.
              const moeAvatar = accountsUser?.avatar || newUser.avatar || null;
              const connData = {
                accountId: moeUsername,
                username: moeUsername,
                displayName: moeUsername,
                avatar: moeAvatar,
                metadata: moeId ? { serikaMoeId: moeId } : undefined,
              };
              if (existingSerikaConn) {
                await UserConnection.updateById(existingSerikaConn.id, connData);
              } else {
                await UserConnection.create({
                  userId: newUser.id,
                  provider: 'serika',
                  ...connData,
                });
              }
            }
          } catch (e) {
            // Non-critical — don't fail login if connection sync fails
            console.error('[Auth] Failed to auto-create serika connection:', e);
          }

          // Auto-create/update Discord connection from accounts API or local DB
          try {
            const discordId = accountsUser?.discordId || newUser.discordId || null;
            let discordUsername = accountsUser?.discordUsername || newUser.discordUsername || null;
            if (discordId) {
              const existingDiscordConn = await UserConnection.findOne({ userId: newUser.id, provider: 'discord' });
              // Fetch fresh Discord profile (avatar, username, display name) from the bot API.
              let discordAvatar: string | null = null;
              let discordDisplayName = discordUsername || newUser.username;
              try {
                const botToken = process.env.SERIKA_DISCORD_TOKEN;
                if (botToken) {
                  const dUser = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
                    headers: { Authorization: `Bot ${botToken}` },
                  });
                  if (dUser.ok) {
                    const dData = await dUser.json() as any;
                    // Use the actual Discord username (not global_name) for the connection username
                    if (dData.username) discordUsername = dData.username;
                    // Use global_name (display name) if available, otherwise the username
                    discordDisplayName = dData.global_name || dData.username || discordUsername;
                    if (dData.avatar) {
                      const ext = dData.avatar.startsWith('a_') ? 'gif' : 'png';
                      discordAvatar = `https://cdn.discordapp.com/avatars/${discordId}/${dData.avatar}.${ext}?size=64`;
                    }
                  }
                }
              } catch {
                // Best-effort — avatar/name is non-critical
              }
              if (existingDiscordConn) {
                await UserConnection.updateById(existingDiscordConn.id, {
                  accountId: discordId,
                  username: discordUsername || newUser.username,
                  displayName: discordDisplayName,
                  avatar: discordAvatar,
                });
              } else {
                await UserConnection.create({
                  userId: newUser.id,
                  provider: 'discord',
                  accountId: discordId,
                  username: discordUsername || newUser.username,
                  displayName: discordDisplayName,
                  avatar: discordAvatar,
                });
              }
            }
          } catch (e) {
            console.error('[Auth] Failed to auto-create discord connection:', e);
          }
        }
      }

      // Set cookies from accounts response (accounts returns token/refreshToken directly)
      if (data.token) {
        (set.headers as any)['Set-Cookie'] = [
          `auth_token=${data.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
          `refresh_token=${data.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${90 * 24 * 60 * 60}`,
          encodeSavedAccountsCookie(savedAccounts),
        ];
      }

      return {
        success: true,
        user: data.user,
        tokens: {
          accessToken: data.token,
          refreshToken: data.refreshToken,
        },
      };
    } catch (error) {
      console.error('Login proxy error:', error);
      set.status = 500;
      return { error: 'Failed to connect to authentication service' };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String(),
    }),
  })

  // Save current account to saved_accounts cookie
  .post('/save-account', async ({ headers, cookie, set }) => {
    const authHeader = headers.authorization;
    const cookieToken = cookie.auth_token?.value;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (typeof cookieToken === 'string' ? cookieToken : undefined);

    if (!token) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    const user = await getLocalUserFromToken(token);
    if (!user) {
      set.status = 404;
      return { error: 'SerikaCord user not found' };
    }

    const email = getAccountEmail(user);

    // Parse existing saved_accounts cookie and upsert current account
    const savedAccounts = upsertSavedAccount(parseSavedAccounts(cookie.saved_accounts?.value as unknown), {
      email,
      username: user.username,
      displayName: user.displayName ?? undefined,
      avatar: user.avatar ?? undefined,
      token,
      refreshToken: typeof cookie.refresh_token?.value === 'string' ? cookie.refresh_token.value : undefined,
      savedAt: Date.now(),
    });

    set.headers['Set-Cookie'] = encodeSavedAccountsCookie(savedAccounts);

    return { success: true };
  })

  // Switch account - use saved token from saved_accounts cookie
  .post('/switch', async ({ body, cookie, set }) => {
    const { email } = body;

    // Preserve currently logged-in account first
    let savedAccounts = parseSavedAccounts(cookie.saved_accounts?.value as unknown);
    const currentToken = cookie.auth_token?.value;
    if (typeof currentToken === 'string' && currentToken) {
      const currentUser = await getLocalUserFromToken(currentToken);
      if (currentUser) {
        const email = getAccountEmail(currentUser);
        savedAccounts = upsertSavedAccount(savedAccounts, {
          email,
          username: currentUser.username,
          displayName: currentUser.displayName ?? undefined,
          avatar: currentUser.avatar ?? undefined,
          token: currentToken,
          refreshToken: typeof cookie.refresh_token?.value === 'string' ? cookie.refresh_token.value : undefined,
          savedAt: Date.now(),
        });
      }
    }

    const targetAccount = savedAccounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!targetAccount || !targetAccount.token) {
      set.status = 404;
      return { error: 'Account not found or no saved token' };
    }

    // Set the new auth_token cookie and update saved_accounts
    (set.headers as any)['Set-Cookie'] = [
      `auth_token=${targetAccount.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
      targetAccount.refreshToken
        ? `refresh_token=${targetAccount.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${90 * 24 * 60 * 60}`
        : 'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=0',
      encodeSavedAccountsCookie(savedAccounts),
    ];

    return { success: true };
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
    }),
  })

  // Logout
  .post('/logout', async ({ headers, cookie, set }) => {
    const authHeader = headers.authorization;
    const cookieToken = cookie.auth_token?.value;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : (typeof cookieToken === 'string' ? cookieToken : undefined);

    if (token) {
      const verification = await verifyToken(token);
      if (verification.valid && verification.payload && verification.payload.sid) {
        await deleteSession(verification.payload.sid);
      }
    }

    // Clear cookies
    set.headers['Set-Cookie'] = [
      'auth_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=0',
    ].join(', ');

    return { success: true };
  })

  // Refresh token - proxies to accounts.serika.dev
  .post('/refresh', async ({ cookie, set, headers }) => {
    const cookieValue = cookie.refresh_token?.value;
    const refreshToken = typeof cookieValue === 'string' ? cookieValue : undefined;

    if (!refreshToken) {
      set.status = 401;
      return { error: 'No refresh token provided' };
    }

    try {
      const { ok, status, data } = await accountsRefresh(refreshToken);

      if (!ok) {
        set.status = status;
        return { error: data.error || 'Failed to refresh token' };
      }

      // Set new access token cookie
      if (data.tokens?.accessToken) {
        set.headers['Set-Cookie'] = `auth_token=${data.tokens.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
      }

      return {
        success: true,
        tokens: data.tokens,
      };
    } catch (error) {
      console.error('Refresh token proxy error:', error);
      set.status = 500;
      return { error: 'Failed to connect to authentication service' };
    }
  })

  // Verify email — accounts service owns verification; fall back to legacy
  // local tokens for accounts created before the accounts migration.
  .get('/verify/:token', async ({ params, set }) => {
    try {
      const { ok } = await accountsVerifyEmail(params.token);
      if (ok) {
        return { success: true, message: 'Email verified successfully' };
      }
    } catch (error) {
      console.error('Accounts verify proxy error:', error);
    }

    const result = await verifyEmail(params.token);
    if (!result.success) {
      set.status = 400;
      return { error: result.error };
    }
    return { success: true, message: 'Email verified successfully' };
  })

  // Resend verification email (handled by the accounts service)
  .post('/resend-verification', async ({ body }) => {
    try {
      await accountsResendVerification(body.email);
    } catch (error) {
      console.error('Resend verification proxy error:', error);
    }
    // Always the same response to prevent email enumeration
    return {
      success: true,
      message: 'If an account exists, a verification email has been sent.',
    };
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
    }),
  })

  // Request password reset — passwords live in the accounts service
  .post('/forgot-password', async ({ body }) => {
    try {
      await accountsForgotPassword(body.email);
    } catch (error) {
      console.error('Forgot password proxy error:', error);
    }
    // Always return success to prevent email enumeration
    return {
      success: true,
      message: 'If an account exists with that email, a reset link has been sent.',
    };
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
    }),
  })

  // Reset password — proxy to accounts first (source of truth for
  // credentials), fall back to legacy local reset tokens.
  .post('/reset-password', async ({ body, set }) => {
    try {
      const { ok } = await accountsResetPassword(body.token, body.password);
      if (ok) {
        return { success: true, message: 'Password reset successfully' };
      }
    } catch (error) {
      console.error('Reset password proxy error:', error);
    }

    const result = await resetPassword(body.token, body.password);
    if (!result.success) {
      set.status = 400;
      return { error: result.error };
    }
    return { success: true, message: 'Password reset successfully' };
  }, {
    body: t.Object({
      token: t.String(),
      password: t.String({ minLength: 8, maxLength: 128 }),
    }),
  })

  // Get current user (me)
  .get('/me', async ({ headers, cookie, set }) => {
    const cookieValue = cookie.auth_token?.value;
    const authTokenString = typeof cookieValue === 'string' ? cookieValue : '';
    
    const result = await authenticateRequest(
      headers.authorization || null,
      { auth_token: authTokenString }
    );

    if (!result.user) {
      set.status = 401;
      return { error: result.error || 'Not authenticated' };
    }

    return {
      user: {
        id: result.user.id,
        username: result.user.username,
        displayName: result.user.displayName,
        avatar: result.user.avatar,
        banner: result.user.banner,
        bio: result.user.bio,
        email: result.user.email,
        isPremium: result.user.isPremium,
        isVerified: result.user.isVerified,
        status: result.user.status,
        customStatus: result.user.customStatus,
        createdAt: result.user.createdAt,
      },
    };
  })

  // Discord OAuth - initiate
  .get('/discord', () => {
    const params = new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      redirect_uri: config.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify email',
    });

    return oauthRedirect(`https://discord.com/api/oauth2/authorize?${params}`);
  })

  // Discord OAuth - callback (handles both login AND connection linking)
  .get('/discord/callback', async ({ query, set, headers, cookie }) => {
    const { code, error: discordError } = query;
    const base = config.FRONTEND_URL || config.API_BASE_URL;
    const redirectBase = `${base}/channels/me?openSettings=connections`;

    if (discordError || !code) {
      // Check if this was a connection attempt
      const state = (cookie as any).oauth2_state?.value as string | undefined;
      if (state && state.startsWith('discord:')) {
        return oauthRedirect(`${redirectBase}&error=discord_denied`, 'oauth2_state=; Path=/; Max-Age=0');
      }
      set.status = 400;
      return { error: discordError || 'No authorization code provided' };
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.DISCORD_CLIENT_ID,
          client_secret: config.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: config.DISCORD_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        set.status = 400;
        return { error: 'Failed to exchange code for tokens' };
      }

      const tokens = await tokenResponse.json() as { access_token: string };

      // Get user info
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        set.status = 400;
        return { error: 'Failed to get Discord user info' };
      }

      const discordUser = await userResponse.json() as {
        id: string;
        username: string;
        global_name?: string;
        email?: string;
        avatar?: string;
      };

      // ── Check if this is a CONNECTION request (via oauth2_state cookie) ──
      const state = (cookie as any).oauth2_state?.value as string | undefined;
      if (state && state.startsWith('discord:')) {
        const userId = state.split(':')[1];
        const avatar = discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${discordUser.avatar.startsWith('a_') ? 'gif' : 'png'}`
          : undefined;

        // Upsert UserConnection
        const existingConn = await UserConnection.findOne({ userId, provider: 'discord' });
        if (existingConn) {
          await UserConnection.updateById(existingConn.id, {
            accountId: discordUser.id,
            username: discordUser.username,
            displayName: discordUser.global_name || discordUser.username,
            avatar,
            metadata: { accessToken: tokens.access_token },
          });
        } else {
          await UserConnection.create({
            userId,
            provider: 'discord',
            accountId: discordUser.id,
            username: discordUser.username,
            displayName: discordUser.global_name || discordUser.username,
            avatar,
            metadata: { accessToken: tokens.access_token },
          });
        }

        // Also link discordId on the user model if not already set
        const serikaUser = await User.findById(userId);
        if (serikaUser && !serikaUser.discordId) {
          await User.updateById(userId, {
            discordId: discordUser.id,
            discordUsername: discordUser.username,
          });
        }

        return oauthRedirect(`${redirectBase}&success=discord`, 'oauth2_state=; Path=/; Max-Age=0');
      }

      // ── Otherwise, treat as LOGIN ──
      // Handle OAuth login/registration
      const result = await handleDiscordOAuth(discordUser, {
        userAgent: headers['user-agent'],
        ipAddress: headers['x-forwarded-for'] || headers['x-real-ip'],
      });

      if (result.error || !result.tokens) {
        set.status = 400;
        return { error: result.error || 'Authentication failed' };
      }

      // Set cookies
      const authCookies = [
        `auth_token=${result.tokens.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
        `refresh_token=${result.tokens.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${90 * 24 * 60 * 60}`,
      ];
      set.headers['Set-Cookie'] = authCookies.join(', ');

      // Redirect to app (or return JSON for API clients)
      if (headers.accept?.includes('text/html')) {
        return oauthRedirect('/', authCookies);
      }

      return {
        success: true,
        isNew: result.isNew,
        user: {
          id: result.user!.id,
          username: result.user!.username,
          displayName: result.user!.displayName,
          avatar: result.user!.avatar,
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: result.tokens.expiresAt,
        },
      };
    } catch (err) {
      console.error('Discord OAuth error:', err);
      set.status = 500;
      return { error: 'OAuth authentication failed' };
    }
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
      error: t.Optional(t.String()),
    }),
  })

  // ── OAuth provider routes (Last.fm + generic OAuth2) ───────────────────────
  // Last.fm uses a custom flow; other providers (GitHub, Spotify, etc.) use
  // standard OAuth2. Both are handled under /:provider/initiate and
  // /:provider/callback to avoid route conflicts between static and dynamic
  // paths in Elysia.

  .get('/:provider/initiate', async ({ params, headers, cookie }) => {
    const provider = params.provider;
    const base = config.FRONTEND_URL || config.API_BASE_URL;

    // Authenticate user
    const authHeader = headers.authorization ?? null;
    const authToken = cookie.auth_token?.value;
    const cookies: Record<string, string> = {};
    if (typeof authToken === 'string' && authToken) {
      cookies.auth_token = authToken;
    }
    const { user } = await authenticateRequest(authHeader, cookies);
    if (!user) {
      return oauthRedirect(`${base}/channels/me?openSettings=connections&error=unauthorized`);
    }

    // Check if connections are enabled
    const platformSettings = await getPlatformSettings();
    if (platformSettings.connectionsEnabled === false) {
      return oauthRedirect(`${base}/channels/me?openSettings=connections&error=connections_disabled`);
    }

    if (platformSettings.disabledProviders?.includes(provider)) {
      return oauthRedirect(`${base}/channels/me?openSettings=connections&error=provider_disabled`);
    }

    const userId = user.id;

    // ── Last.fm initiate ────────────────────────────────────────────────────
    if (provider === 'lastfm') {
      const apiKey = config.LASTFM_API_KEY;
      if (!apiKey) {
        return oauthRedirect(`${base}/channels/me?openSettings=connections&error=lastfm_not_configured`);
      }

      const stateCookie = `lastfm_state=${userId}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`;
      const callbackUrl = encodeURIComponent(`${base}/api/auth/lastfm/callback`);
      return oauthRedirect(`https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${callbackUrl}`, stateCookie);
    }

    // ── Generic OAuth2 initiate ─────────────────────────────────────────────
    const prov = OAUTH2_PROVIDERS[provider];
    if (!prov || !prov.clientId) {
      return oauthRedirect(`${base}/channels/me?openSettings=connections&error=${provider}_not_configured`);
    }

    const state = `${provider}:${userId}`;
    const stateCookie = `oauth2_state=${encodeURIComponent(state)}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`;
    const callbackUrl = encodeURIComponent(`${base}/api/auth/${provider}/callback`);
    const authUrl = prov.getAuthUrl(prov.clientId, callbackUrl, prov.scopes);
    return oauthRedirect(authUrl, stateCookie);
  })

  .get('/:provider/callback', async ({ params, query, cookie }) => {
    const provider = params.provider;
    const redirectBase = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/me?openSettings=connections`;

    // ── Last.fm callback ─────────────────────────────────────────────────────
    if (provider === 'lastfm') {
      const { token } = query as { token?: string };
      const userId = (cookie as any).lastfm_state?.value;

      if (!token) {
        return oauthRedirect(`${redirectBase}&error=lastfm_denied`);
      }
      if (!userId) {
        return oauthRedirect(`${redirectBase}&error=lastfm_state_missing`);
      }

      const apiKey = config.LASTFM_API_KEY;
      const secret = config.LASTFM_API_SECRET;
      if (!apiKey || !secret) {
        return oauthRedirect(`${redirectBase}&error=lastfm_not_configured`);
      }

      try {
        const params: Record<string, string> = {
          api_key: apiKey,
          method: 'auth.getSession',
          token,
        };
        const sigStr =
          Object.keys(params)
            .sort()
            .map((k) => `${k}${params[k]}`)
            .join('') + secret;
        const apiSig = createHash('md5').update(sigStr, 'utf8').digest('hex');

        const url = new URL('https://ws.audioscrobbler.com/2.0/');
        url.searchParams.set('method', 'auth.getSession');
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('token', token);
        url.searchParams.set('api_sig', apiSig);
        url.searchParams.set('format', 'json');

        const resp = await fetch(url.toString());
        const data = await resp.json() as any;

        if (data.error || !data.session) {
          return oauthRedirect(`${redirectBase}&error=lastfm_session_failed`);
        }

        const lfmUsername: string = data.session.name;
        const sessionKey: string = data.session.key;

        const infoUrl = new URL('https://ws.audioscrobbler.com/2.0/');
        infoUrl.searchParams.set('method', 'user.getInfo');
        infoUrl.searchParams.set('user', lfmUsername);
        infoUrl.searchParams.set('api_key', apiKey);
        infoUrl.searchParams.set('format', 'json');
        const infoResp = await fetch(infoUrl.toString());
        const infoData = await infoResp.json() as any;
        const avatar: string | undefined = infoData.user?.image?.find((img: any) => img.size === 'large')?.['#text'] || undefined;

        const existingConn = await UserConnection.findOne({ userId, provider: 'lastfm' });
        if (existingConn) {
          await UserConnection.updateById(existingConn.id, {
            accountId: lfmUsername,
            username: lfmUsername,
            displayName: lfmUsername,
            avatar,
            metadata: { sessionKey },
          });
        } else {
          await UserConnection.create({
            userId,
            provider: 'lastfm',
            accountId: lfmUsername,
            username: lfmUsername,
            displayName: lfmUsername,
            avatar,
            metadata: { sessionKey },
          });
        }

        return oauthRedirect(`${redirectBase}&success=lastfm`, 'lastfm_state=; Path=/; Max-Age=0');
      } catch (err) {
        console.error('Last.fm callback error:', err);
        return oauthRedirect(`${redirectBase}&error=lastfm_error`);
      }
    }

    // ── Generic OAuth2 / Steam callback ──────────────────────────────────────

    // Steam uses OpenID — extract SteamID from openid.identity
    if (provider === 'steam') {
      const state = (cookie as any).oauth2_state?.value as string | undefined;
      if (!state || !state.startsWith('steam:')) {
        return oauthRedirect(`${redirectBase}&error=steam_state_missing`);
      }
      const userId = state.split(':')[1];
      const prov = OAUTH2_PROVIDERS.steam;
      if (!prov.clientId) {
        return oauthRedirect(`${redirectBase}&error=steam_not_configured`);
      }
      const openidIdentity = (query as any)['openid.identity'] as string | undefined;
      if (!openidIdentity) {
        return oauthRedirect(`${redirectBase}&error=steam_denied`);
      }
      // Extract SteamID from the identity URL
      const steamId = openidIdentity.split('/').pop() || '';
      if (!steamId) {
        return oauthRedirect(`${redirectBase}&error=steam_session_failed`);
      }
      try {
        const userInfo = await prov.fetchUser(steamId);
        const existingConn = await UserConnection.findOne({ userId, provider: 'steam' });
        if (existingConn) {
          await UserConnection.updateById(existingConn.id, {
            accountId: userInfo.accountId,
            username: userInfo.username || userInfo.accountId,
            displayName: userInfo.displayName || userInfo.username || userInfo.accountId,
            avatar: userInfo.avatar,
            metadata: { steamId },
          });
        } else {
          await UserConnection.create({
            userId,
            provider: 'steam',
            accountId: userInfo.accountId,
            username: userInfo.username || userInfo.accountId,
            displayName: userInfo.displayName || userInfo.username || userInfo.accountId,
            avatar: userInfo.avatar,
            metadata: { steamId },
          });
        }
        return oauthRedirect(`${redirectBase}&success=steam`, 'oauth2_state=; Path=/; Max-Age=0');
      } catch (err) {
        console.error('Steam callback error:', err);
        return oauthRedirect(`${redirectBase}&error=steam_error`);
      }
    }

    const code = (query as any).code as string | undefined;
    const state = (cookie as any).oauth2_state?.value as string | undefined;

    if (!code) {
      return oauthRedirect(`${redirectBase}&error=${provider}_denied`);
    }
    if (!state || !state.startsWith(`${provider}:`)) {
      return oauthRedirect(`${redirectBase}&error=${provider}_state_missing`);
    }

    const userId = state.split(':')[1];
    const prov = OAUTH2_PROVIDERS[provider];
    if (!prov || !prov.clientId || !prov.clientSecret) {
      return oauthRedirect(`${redirectBase}&error=${provider}_not_configured`);
    }

    const callbackUrl = `${config.FRONTEND_URL || config.API_BASE_URL}/api/auth/${provider}/callback`;

    try {
      // Exchange code for access token
      const tokenResp = await prov.exchangeCode(prov.clientId, prov.clientSecret, code, callbackUrl);
      if (!tokenResp.access_token) {
        return oauthRedirect(`${redirectBase}&error=${provider}_session_failed`);
      }

      // Fetch user info
      const userInfo = await prov.fetchUser(tokenResp.access_token);
      if (!userInfo.accountId) {
        return oauthRedirect(`${redirectBase}&error=${provider}_session_failed`);
      }

      // Upsert connection
      const existingConn = await UserConnection.findOne({ userId, provider });
      if (existingConn) {
        await UserConnection.updateById(existingConn.id, {
          accountId: userInfo.accountId,
          username: userInfo.username || userInfo.accountId,
          displayName: userInfo.displayName || userInfo.username || userInfo.accountId,
          avatar: userInfo.avatar,
          metadata: { accessToken: tokenResp.access_token, refreshToken: tokenResp.refreshToken },
        });
      } else {
        await UserConnection.create({
          userId,
          provider: provider as 'discord' | 'twitch' | 'youtube' | 'github' | 'spotify' | 'website' | 'lastfm' | 'steam' | 'xbox' | 'psn' | 'roblox' | 'twitter' | 'instagram' | 'battlenet',
          accountId: userInfo.accountId,
          username: userInfo.username || userInfo.accountId,
          displayName: userInfo.displayName || userInfo.username || userInfo.accountId,
          avatar: userInfo.avatar,
          metadata: { accessToken: tokenResp.access_token, refreshToken: tokenResp.refreshToken },
        });
      }

      return oauthRedirect(`${redirectBase}&success=${provider}`, 'oauth2_state=; Path=/; Max-Age=0');
    } catch (err) {
      console.error(`${provider} callback error:`, err);
      return oauthRedirect(`${redirectBase}&error=${provider}_error`);
    }
  }, {
    query: t.Object({
      token: t.Optional(t.String()),
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
      ['openid.identity']: t.Optional(t.String()),
      ['openid.mode']: t.Optional(t.String()),
      ['openid.ns']: t.Optional(t.String()),
      ['openid.op_endpoint']: t.Optional(t.String()),
      ['openid.return_to']: t.Optional(t.String()),
      ['openid.signed']: t.Optional(t.String()),
      ['openid.sig']: t.Optional(t.String()),
      ['openid.claimed_id']: t.Optional(t.String()),
    }, { additionalProperties: true }),
  });
