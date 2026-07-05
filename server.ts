/**
 * SerikaCord production server.
 *
 * Runs the Next.js app AND the Discord-compatible bot Gateway in a SINGLE
 * process on a SINGLE port. Bots connect to wss://<host>/api/v10/gateway; every
 * other request is handled by Next. This is what makes a one-app deploy work on
 * Coolify/Nixpacks (and anywhere else) — no second container, no second repo.
 *
 * Start:  bun server.ts   (package.json "start")
 */
import { createServer } from 'node:http';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectDB } from '@/lib/db';
import { initializeAPI } from '@/lib/api';
import {
  GatewayHub,
  subscribeHubToRedis,
  newSession,
  GATEWAY_PATH,
  type Conn,
} from '@/lib/gateway/core';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  // Ensure DB/system users are ready before the gateway authenticates bots.
  try {
    await initializeAPI();
  } catch (err) {
    console.error('initializeAPI failed (continuing):', err);
    await connectDB().catch(() => {});
  }

  const server = createServer((req, res) => {
    handle(req, res);
  });

  // ─── Bot Gateway (WebSocket) ─────────────────────────────
  const hub = new GatewayHub();
  await subscribeHubToRedis(hub);

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = {
      data: newSession(),
      sendText: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };
    hub.hello(conn);
    ws.on('message', (raw) => { void hub.onFrame(conn, raw.toString()); });
    ws.on('close', () => hub.onClose(conn));
    ws.on('error', () => hub.onClose(conn));
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
    if (pathname === GATEWAY_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      // Not a gateway upgrade — let it drop (Next has no other WS routes).
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`🚀 SerikaCord ready on http://0.0.0.0:${port}`);
    console.log(`🔌 Gateway on ws://0.0.0.0:${port}${GATEWAY_PATH}`);
  });
}

main().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
