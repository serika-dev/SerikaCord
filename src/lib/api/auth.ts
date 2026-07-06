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
import { UserConnection } from '../models';
import {
  accountsRegister,
  accountsLogin,
  accountsRefresh,
  accountsVerifyEmail,
  accountsResendVerification,
  accountsForgotPassword,
  accountsResetPassword,
} from '../services/accountsClient';

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
  .post('/login', async ({ body, set, headers }) => {
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

      // Set cookies from accounts response (accounts returns token/refreshToken directly)
      if (data.token) {
        set.headers['Set-Cookie'] = [
          `auth_token=${data.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
          `refresh_token=${data.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${90 * 24 * 60 * 60}`,
        ].join(', ');
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
        id: result.user._id,
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
  .get('/discord', ({ redirect }) => {
    const params = new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      redirect_uri: config.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify email',
    });

    return redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  })

  // Discord OAuth - callback
  .get('/discord/callback', async ({ query, set, headers }) => {
    const { code, error: discordError } = query;

    if (discordError || !code) {
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
        email?: string;
        avatar?: string;
      };

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
      set.headers['Set-Cookie'] = [
        `auth_token=${result.tokens.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
        `refresh_token=${result.tokens.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${90 * 24 * 60 * 60}`,
      ].join(', ');

      // Redirect to app (or return JSON for API clients)
      if (headers.accept?.includes('text/html')) {
        set.redirect = '/';
        return;
      }

      return {
        success: true,
        isNew: result.isNew,
        user: {
          id: result.user!._id,
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

  // ── Last.fm OAuth ──────────────────────────────────────────────────────────
  // Step 1: Redirect the user to Last.fm's auth page.
  // The frontend calls /api/auth/lastfm/initiate (with the user's auth token in
  // header/cookie) which sets a short-lived state cookie then redirects.
  .get('/lastfm/initiate', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await authenticateRequest(
      headers.authorization ?? null,
      { auth_token: typeof cookie.auth_token?.value === 'string' ? cookie.auth_token.value : '' },
    );
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const apiKey = config.LASTFM_API_KEY;
    if (!apiKey) {
      set.status = 503;
      return { error: 'Last.fm is not configured on this instance' };
    }

    // Store the user id in a short-lived cookie so the callback can associate
    // the session key with the right account.
    const userId = (user._id as { toString(): string }).toString();
    (cookie as any).lastfm_state = {
      value: userId,
      httpOnly: true,
      path: '/',
      maxAge: 600, // 10 minutes
      sameSite: 'lax',
    };

    const callbackUrl = encodeURIComponent(`${config.API_BASE_URL}/api/auth/lastfm/callback`);
    set.redirect = `https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${callbackUrl}`;
  })

  // Step 2: Last.fm redirects back here with ?token=...
  // We exchange the token for a session key, fetch the user info, then save
  // the connection and redirect back to the settings page.
  .get('/lastfm/callback', async ({ query, cookie, set }) => {
    const { token } = query as { token?: string };
    const userId = (cookie as any).lastfm_state?.value;

    if (!token) {
      set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?error=lastfm_denied`;
      return;
    }
    if (!userId) {
      set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?error=lastfm_state_missing`;
      return;
    }

    const apiKey = config.LASTFM_API_KEY;
    const secret = config.LASTFM_API_SECRET;
    if (!apiKey || !secret) {
      set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?error=lastfm_not_configured`;
      return;
    }

    try {
      // Build signed getSession call
      const params: Record<string, string> = {
        api_key: apiKey,
        method: 'auth.getSession',
        token,
      };
      // Signature: alphabetical params concatenated (no &= separators) + secret, then MD5
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
        set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?error=lastfm_session_failed`;
        return;
      }

      const lfmUsername: string = data.session.name;
      const sessionKey: string = data.session.key;

      // Fetch user info for avatar
      const infoUrl = new URL('https://ws.audioscrobbler.com/2.0/');
      infoUrl.searchParams.set('method', 'user.getInfo');
      infoUrl.searchParams.set('user', lfmUsername);
      infoUrl.searchParams.set('api_key', apiKey);
      infoUrl.searchParams.set('format', 'json');
      const infoResp = await fetch(infoUrl.toString());
      const infoData = await infoResp.json() as any;
      const avatar: string | undefined = infoData.user?.image?.find((img: any) => img.size === 'large')?.['#text'] || undefined;

      // Upsert the connection
      await UserConnection.findOneAndUpdate(
        { userId, provider: 'lastfm' },
        {
          $set: {
            userId,
            provider: 'lastfm',
            accountId: lfmUsername,
            username: lfmUsername,
            displayName: lfmUsername,
            avatar,
            metadata: { sessionKey },
          },
        },
        { upsert: true, new: true },
      );

      // Clear the state cookie
      (cookie as any).lastfm_state = { value: '', maxAge: 0, path: '/' };

      set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?success=lastfm`;
    } catch (err) {
      console.error('Last.fm callback error:', err);
      set.redirect = `${config.FRONTEND_URL || config.API_BASE_URL}/channels/settings/connections?error=lastfm_error`;
    }
  }, {
    query: t.Object({
      token: t.Optional(t.String()),
    }),
  });
