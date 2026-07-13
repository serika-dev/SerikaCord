import { config } from '../config';

/**
 * Typed client for the serika-accounts service (accounts.serika.dev).
 *
 * All communication with the accounts service goes through this module so
 * URLs, headers, timeouts and error handling live in one place instead of
 * being re-implemented per route.
 */

const REQUEST_TIMEOUT_MS = 5_000;

export interface AccountsUser {
  id: string;
  email?: string;
  username: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  isPremium?: boolean;
  isVerified?: boolean;
  isBanned?: boolean;
  discordId?: string;
  discordUsername?: string;
  serikaMoeId?: string;
  serikaMoeUsername?: string;
}

export interface AccountsResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; message?: string };
}

async function accountsFetchOnce<T>(
  path: string,
  init: RequestInit & { internal?: boolean }
): Promise<AccountsResult<T>> {
  const { internal, ...requestInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(requestInit.headers as Record<string, string> | undefined),
  };
  if (internal) {
    headers['x-service-key'] = config.ACCOUNTS_SERVICE_KEY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.ACCOUNTS_API_URL}${path}`, {
      ...requestInit,
      headers,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch with transient-failure handling: network errors / timeouts are
 * retried once, and if they persist a normalized 503 result is returned so
 * routes surface "accounts service unavailable" instead of a raw 500.
 */
async function accountsFetch<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { internal?: boolean } = {}
): Promise<AccountsResult<T>> {
  try {
    return await accountsFetchOnce<T>(path, init);
  } catch {
    try {
      return await accountsFetchOnce<T>(path, init);
    } catch (error) {
      console.error(`Accounts service unreachable (${path}):`, error);
      return {
        ok: false,
        status: 503,
        data: { error: 'Accounts service is temporarily unavailable. Please try again.' } as T & {
          error?: string;
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public auth endpoints
// ---------------------------------------------------------------------------

export function accountsRegister(body: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}) {
  return accountsFetch<{ user?: AccountsUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function accountsLogin(
  body: { email: string; password: string },
  client?: { userAgent?: string; ip?: string }
) {
  return accountsFetch<{ token?: string; refreshToken?: string; user?: AccountsUser }>(
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        'User-Agent': client?.userAgent || 'SerikaCord/1.0',
        'X-Forwarded-For': client?.ip || '',
      },
      body: JSON.stringify({ ...body, rememberMe: true, productId: 'serikacord' }),
    }
  );
}

export function accountsRefresh(refreshToken: string) {
  return accountsFetch<{ tokens?: { accessToken: string; refreshToken?: string } }>(
    '/api/auth/refresh',
    {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    }
  );
}

export function accountsVerifyEmail(token: string) {
  return accountsFetch(`/api/auth/verify/${encodeURIComponent(token)}`, { method: 'GET' });
}

export function accountsResendVerification(email: string) {
  return accountsFetch('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function accountsForgotPassword(email: string) {
  return accountsFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function accountsResetPassword(token: string, password: string) {
  return accountsFetch(`/api/auth/reset-password/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

// ---------------------------------------------------------------------------
// Internal (service-to-service) endpoints
// ---------------------------------------------------------------------------

export function accountsInternalVerify(token: string) {
  return accountsFetch<{ valid?: boolean; user?: AccountsUser }>('/internal/verify', {
    method: 'POST',
    internal: true,
    body: JSON.stringify({ token, checkBan: true }),
  });
}

export function accountsInternalGetUser(identifier: string) {
  // The accounts service /internal/get-user accepts { id }, { email }, or { originalUserId }.
  // Detect which one we're passing: if it contains '@', it's an email; otherwise treat as ID.
  const body = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { id: identifier };
  return accountsFetch<{ user?: AccountsUser }>('/internal/get-user', {
    method: 'POST',
    internal: true,
    body: JSON.stringify(body),
  });
}

export function accountsInternalGetUserByOriginalId(originalUserId: string) {
  return accountsFetch<{ user?: AccountsUser }>('/internal/get-user', {
    method: 'POST',
    internal: true,
    body: JSON.stringify({ originalUserId }),
  });
}


/**
 * Push profile changes made in SerikaCord back to the accounts service so
 * the profile stays consistent across Serika products. Only fields the
 * accounts service whitelists (avatar, banner, username, ...) are synced.
 * Best-effort: callers should not fail their request when this errors.
 */
export async function accountsSyncProfile(
  email: string,
  updates: { avatar?: string; banner?: string; username?: string }
): Promise<void> {
  const fields = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );
  if (!email || Object.keys(fields).length === 0) return;

  try {
    await accountsFetch('/internal/update-profile', {
      method: 'POST',
      internal: true,
      body: JSON.stringify({ email, updates: fields }),
    });
  } catch (error) {
    console.error('Failed to sync profile to accounts service:', error);
  }
}
