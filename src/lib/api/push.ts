// Mobile push device registration for the Capacitor app.
//   POST   /api/users/@me/push-devices        { token, platform, notifyKeyId? }  register / refresh
//                                             (notifyKeyId: this phone's E2EE notification key)
//   DELETE /api/users/@me/push-devices        { token }            forget (sign-out)
//   POST   /api/users/@me/push-devices/state  { away }             app backgrounded / foregrounded
// Only the signed-in user's own devices; tokens are opaque FCM strings.
import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit } from '@/lib/security';
import { isPlausibleDeviceToken, normalizePushPlatform } from '@/lib/push/fcm';
import { registerPushDevice, setPushAway, unregisterPushDevice } from '@/lib/services/pushNotifications';

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

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
    // 'android-2'+ = the APK draws rich message notifications itself (fcm.ts).
    const platform = normalizePushPlatform(body.platform);
    try {
      // Only the caller's own active notification key (else: keep / clear as registerPushDevice says).
      let notifyId: string | null = null;
      if (typeof body.notifyKeyId === 'string' && /^[A-Za-z0-9_-]{22}$/.test(body.notifyKeyId)) {
        const { isActiveNotifyKeyOf } = await import('@/lib/services/e2ee');
        if (await isActiveNotifyKeyOf(user.id, body.notifyKeyId).catch(() => false)) notifyId = body.notifyKeyId;
      }
      await registerPushDevice(user.id, body.token, platform, notifyId);
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
      notifyKeyId: t.Optional(t.String({ maxLength: 32 })),
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
