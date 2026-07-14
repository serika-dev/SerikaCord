/**
 * OPTIONAL standalone bot Gateway (Bun.serve transport).
 *
 * Not needed for normal deploys — the gateway runs inside the main server
 * (server.ts) on the same port. Use this only if you later want to scale the
 * gateway horizontally as its own process. Run: bun run gateway
 *
 * Shares all protocol logic with the integrated server via src/lib/gateway/core.
 */
import type { ServerWebSocket } from 'bun';
import { config } from '../src/lib/config';
import { connectDB } from '../src/lib/db';
import {
  GatewayHub,
  subscribeHubToRedis,
  newSession,
  isHeartbeatExpired,
  KEEPALIVE_SWEEP_INTERVAL,
  GATEWAY_PATH,
  type Conn,
  type Session,
} from '../src/lib/gateway/core';

interface SocketData { conn: Conn }
type WS = ServerWebSocket<SocketData>;

async function main() {
  await connectDB();
  console.log('✅ Gateway: MongoDB connected');

  const hub = new GatewayHub();
  await subscribeHubToRedis(hub);

  // Reap zombie connections that stopped heartbeating. Bun sends protocol-level
  // pings automatically (sendPings: true) which keeps proxies happy; this sweep
  // additionally closes bots that went silent so they can reconnect cleanly.
  const liveSockets = new Set<WS>();
  const keepaliveSweep = setInterval(() => {
    for (const ws of liveSockets) {
      const conn = ws.data.conn;
      if (conn?.data.authenticated && isHeartbeatExpired(conn)) {
        try { ws.close(4009, 'Session timed out'); } catch { ws.terminate(); }
      }
    }
  }, KEEPALIVE_SWEEP_INTERVAL);
  keepaliveSweep.unref?.();

  Bun.serve<SocketData, Record<string, never>>({
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
      const ok = server.upgrade(req, { data: { conn: null as unknown as Conn } });
      return ok ? undefined : new Response('Upgrade failed', { status: 426 });
    },
    websocket: {
      sendPings: true,
      maxPayloadLength: 1 << 20,
      open(ws: WS) {
        const session: Session = newSession();
        const conn: Conn = {
          data: session,
          sendText: (text) => { ws.send(text); },
          close: (code, reason) => ws.close(code, reason),
        };
        ws.data.conn = conn;
        liveSockets.add(ws);
        hub.hello(conn);
      },
      async message(ws: WS, raw: string | Buffer) {
        await hub.onFrame(ws.data.conn, raw.toString());
      },
      pong(ws: WS) {
        if (ws.data.conn) ws.data.conn.data.lastHeartbeat = Date.now();
      },
      close(ws: WS) {
        liveSockets.delete(ws);
        if (ws.data.conn) hub.onClose(ws.data.conn);
      },
    },
  });

  console.log(`🚀 Standalone Gateway on :${config.GATEWAY_PORT}${GATEWAY_PATH}`);
}

main().catch((err) => {
  console.error('Gateway fatal error:', err);
  process.exit(1);
});
