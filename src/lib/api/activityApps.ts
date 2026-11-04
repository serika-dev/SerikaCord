/**
 * Built-in Activities served by this server (CORD-92). Reached through the
 * Activities proxy (the app's URL mapping), never by SerikaCord's own pages.
 * The WebSocket lives in server.ts (DOODLE_WS_PATH).
 */
import { Elysia } from 'elysia';
import { checkRateLimit, getClientIP } from '@/lib/security';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function doodleClientId(): Promise<string | null> {
  const { doodleAppId } = await import('@/lib/activityApps/doodle/server');
  const id = doodleAppId();
  if (!id) return null;
  const { Application } = await import('@/lib/models');
  return (await Application.findById(id))?.clientId ?? null;
}

async function page(): Promise<Response> {
  const clientId = await doodleClientId();
  if (!clientId) return new Response('Not found', { status: 404, headers: NO_STORE });
  const { doodlePage } = await import('@/lib/activityApps/doodle/server');
  return new Response(doodlePage(clientId), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}

export const activityAppRoutes = new Elysia({ prefix: '/activity-apps/doodle' })
  .get('/', () => page())
  .get('', () => page())
  .get('/app.js', async () => {
    const { doodleAppId, doodleBundle } = await import('@/lib/activityApps/doodle/server');
    if (!doodleAppId()) return new Response('Not found', { status: 404 });
    try {
      const js = await doodleBundle();
      return new Response(js, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
    } catch (err) {
      console.error('[doodle] bundle failed:', (err as Error)?.message ?? err);
      return new Response('console.error("Doodle Party failed to build")', { status: 500, headers: { 'Content-Type': 'text/javascript' } });
    }
  })
  .post('/token', async ({ body, request, set }) => {
    if (!(await checkRateLimit('oauthToken', getClientIP(request))).success) { set.status = 429; return { error: 'rate_limited' }; }
    const { exchangeDoodleCode } = await import('@/lib/activityApps/doodle/server');
    const r = await exchangeDoodleCode((body as { code?: unknown } | null)?.code);
    set.status = r.status;
    return r.body;
  });
