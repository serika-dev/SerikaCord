import { Elysia, t } from 'elysia';
import { config } from '../config';
import { 
  verifyEmail, 
  requestPasswordReset, 
  resetPassword, 
  deleteSession,
  verifyToken,
  handleDiscordOAuth,
  authenticateRequest,
} from '../services/auth';

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
      // Proxy to accounts API
      const accountsResponse = await fetch(`${config.ACCOUNTS_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, username, password, displayName }),
      });

      const data = await accountsResponse.json();

      if (!accountsResponse.ok) {
        set.status = accountsResponse.status;
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
      // Proxy to accounts API
      const accountsResponse = await fetch(`${config.ACCOUNTS_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': headers['user-agent'] || 'SerikaCord/1.0',
          'X-Forwarded-For': headers['x-forwarded-for'] || headers['x-real-ip'] || '',
        },
        body: JSON.stringify({ 
          email, 
          password,
          rememberMe: true,
          productId: 'serikacord',
        }),
      });

      const data = await accountsResponse.json();

      if (!accountsResponse.ok) {
        set.status = accountsResponse.status;
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
      const accountsResponse = await fetch(`${config.ACCOUNTS_API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `refresh_token=${refreshToken}`,
        },
      });

      const data = await accountsResponse.json();

      if (!accountsResponse.ok) {
        set.status = accountsResponse.status;
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

  // Verify email
  .get('/verify/:token', async ({ params, set }) => {
    const result = await verifyEmail(params.token);

    if (!result.success) {
      set.status = 400;
      return { error: result.error };
    }

    return { success: true, message: 'Email verified successfully' };
  })

  // Request password reset
  .post('/forgot-password', async ({ body }) => {
    await requestPasswordReset(body.email);

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

  // Reset password
  .post('/reset-password', async ({ body, set }) => {
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
  });
