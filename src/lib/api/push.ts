// Mobile push device registration for the Capacitor app.
//   POST   /api/users/@me/push-devices        { token, platform }  register / refresh
//   DELETE /api/users/@me/push-devices        { token }            forget (sign-out)
//   POST   /api/users/@me/push-devices/state  { away }             app backgrounded / foregrounded
// Only the signed-in user's own devices; tokens are opaque FCM strings.
import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit } from '@/lib/security';
import { isPlausibleDeviceToken } from '@/lib/push/fcm';
import { registerPushDevice, setPushAway, unregisterPushDevice } from '@/lib/services/pushNotifications';

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

const PLATFORMS = new Set(['android', 'ios']);

export const pushRoutes = new Elysia({ prefix: '/users/@me/push-devices' })
  .post('/', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const limit = await checkRateLimit('pushDevice', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: limit.retryAfter };
    }
    if (!isPlausibleDeviceToken(body.token)) {
      set.status = 400;
      return { error: 'Invalid token' };
    }
    const platform = PLATFORMS.has(body.platform ?? '') ? (body.platform as string) : 'android';
    try {
      await registerPushDevice(user.id, body.token, platform);
      return { success: true };
    } catch (err) {
      console.error('[push] register failed:', (err as Error)?.message ?? err);
      set.status = 500;
      return { error: 'Failed to register device' };
    }
  }, {
    body: t.Object({
      token: t.String({ minLength: 20, maxLength: 4096 }),
      platform: t.Optional(t.String({ maxLength: 16 })),
    }),
  })
  .delete('/', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const limit = await checkRateLimit('pushDevice', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: limit.retryAfter };
    }
    if (!isPlausibleDeviceToken(body.token)) {
      set.status = 400;
      return { error: 'Invalid token' };
    }
    try {
      await unregisterPushDevice(user.id, body.token);
      return { success: true };
    } catch (err) {
      console.error('[push] unregister failed:', (err as Error)?.message ?? err);
      set.status = 500;
      return { error: 'Failed to remove device' };
    }
  }, {
    body: t.Object({ token: t.String({ minLength: 20, maxLength: 4096 }) }),
  })
  .post('/state', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const limit = await checkRateLimit('pushState', user.id);
    if (!limit.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: limit.retryAfter };
    }
    try {
      await setPushAway(user.id, body.away);
      return { success: true };
    } catch {
      set.status = 500;
      return { error: 'Failed to update state' };
    }
  }, {
    body: t.Object({ away: t.Boolean() }),
  });
