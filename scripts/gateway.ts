/**
 * OPTIONAL standalone bot Gateway (Bun.serve transport).
 *
 * Not needed for normal deploys — the gateway runs inside the main server
 * (server.ts) on the same port. Use this only if you later want to scale the
 * gateway horizontally as its own process. Run: bun run gateway
 *
 * Shares all protocol logic with the integrated server via src/lib/gateway/core.
 */
import { config } from '../src/lib/config';
import { connectDB } from '../src/lib/db';
import { GatewayHub, subscribeHubToRedis, GATEWAY_PATH } from '../src/lib/gateway/core';
import { createBunGatewayTransport, type GatewaySocketData } from '../src/lib/gateway/bunTransport';

async function main() {
  await connectDB();
  console.log('✅ Gateway: PostgreSQL connected');

  const hub = new GatewayHub();
  await subscribeHubToRedis(hub);

  // Same transport as server.ts: ?v= / encoding / compress=zlib-stream, the
  // zombie sweep (4009) and op 7 RECONNECT to every bot on SIGTERM.
  const gateway = createBunGatewayTransport(hub);
  gateway.installShutdown();

  Bun.serve<GatewaySocketData>({
    port: config.GATEWAY_PORT,
    // Bun closes sockets idle longer than this (seconds). Keep it comfortably
    // above the heartbeat interval so a healthy bot is never dropped.
    idleTimeout: 120,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', connections: hub.connections.size }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname !== GATEWAY_PATH && url.pathname !== '/') {
        return new Response('SerikaCord Gateway', { status: 426 });
      }
      return gateway.upgrade(req, server);
    },
    websocket: gateway.websocket,
  });

  console.log(`🚀 Standalone Gateway on :${config.GATEWAY_PORT}${GATEWAY_PATH}`);
}

main().catch((err) => {
  console.error('Gateway fatal error:', err);
  process.exit(1);
});
