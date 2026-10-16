/**
 * Bot-compat harness: the Elysia API + the bot gateway in one Bun process,
 * without Next.js. Serves /api/* (api.handle) and /api/v10/gateway
 * (GatewayHub over the shared Bun transport), against the local docker stack
 * only (guard.ts aborts otherwise).
 *
 *   bun --no-env-file --env-file=scripts/bot-compat/.env.test scripts/bot-compat/serve.ts
 */
import { assertLocalStack } from './guard';

assertLocalStack();

const { api, initializeAPI } = await import('../../src/lib/api');
const { GatewayHub, subscribeHubToRedis, GATEWAY_PATH } = await import('../../src/lib/gateway/core');
const { createBunGatewayTransport } = await import('../../src/lib/gateway/bunTransport');
type SocketData = import('../../src/lib/gateway/bunTransport').GatewaySocketData;

await initializeAPI();
const hub = new GatewayHub();
await subscribeHubToRedis(hub);
const gateway = createBunGatewayTransport(hub);
gateway.installShutdown();

const port = Number(process.env.PORT || 58080);
Bun.serve<SocketData>({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 120,
  async fetch(req, server) {
    const { pathname } = new URL(req.url);
    if (pathname === GATEWAY_PATH) return gateway.upgrade(req, server);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await api.handle(req);
      } catch (err) {
        console.error('[harness] unhandled', err);
        return new Response('{"message":"500: Internal Server Error","code":0}', { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('bot-compat harness', { status: 404 });
  },
  websocket: gateway.websocket,
});

console.log(`bot-compat harness on http://127.0.0.1:${port} (gateway ws://127.0.0.1:${port}${GATEWAY_PATH})`);
