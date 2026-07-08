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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectDB } from '@/lib/db';
import { initializeAPI } from '@/lib/api';
import { authenticateRequest } from '@/lib/services/auth';
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

// ─── SSE lazy imports (set after initializeAPI) ──────────
// These are populated inside main() once the Elysia routes are wired up.
// handleSSE references them — they're null only before the server starts.
let registerChannelSSE: ((channelId: string, write: (data: string) => void) => () => void) | null = null;
let registerDmSSE: ((channelId: string, write: (data: string) => void) => () => void) | null = null;
let checkChannelAccess: ((userId: string, channelId: string) => Promise<{ hasAccess: boolean; error?: string }>) | null = null;
let getOrCreateDMChannel: ((userId: string, recipientId: string) => Promise<{ id: string }>) | null = null;
let registerActivitySSE: ((userId: string, write: (data: string) => void) => () => void) | null = null;

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
    // ─── SSE fast-path ───────────────────────────────────────
    // Intercept SSE stream endpoints BEFORE Next.js so events are written
    // directly to the raw socket. Next.js route handlers buffer ReadableStream
    // bodies, which delays/batches SSE events — making chat feel laggy or
    // breaking delivery entirely for background tabs.
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}

    const channelMatch = pathname.match(/^\/api\/channels\/([^/]+)\/stream$/);
    const dmMatch = pathname.match(/^\/api\/dms\/([^/]+)\/stream$/);

    if (channelMatch || dmMatch) {
      handleSSE(req, res, channelMatch?.[1], dmMatch?.[1]).catch((err) => {
        console.error('SSE handler error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'SSE handler error' }));
        }
      });
      return;
    }

    if (pathname === '/api/users/@me/activity') {
      handleActivitySSE(req, res).catch((err) => {
        console.error('Activity SSE handler error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'SSE handler error' }));
        }
      });
      return;
    }

    handle(req, res);
  });

  // ─── Bot Gateway (WebSocket) ─────────────────────────────
  const hub = new GatewayHub();
  await subscribeHubToRedis(hub);

  // ─── Realtime SSE fan-out bridge ─────────────────────────
  // Re-broadcast channel/DM events published to Redis onto THIS instance's SSE
  // connections, so users on every app instance receive messages simultaneously.
  try {
    const [channelMod, dmMod] = await Promise.all([
      import('@/lib/api/channels'),
      import('@/lib/api/dms'),
    ]);
    registerChannelSSE = channelMod.registerRawSSEConnection;
    registerDmSSE = dmMod.registerRawDmSSEConnection;
    checkChannelAccess = channelMod.checkChannelAccess;
    getOrCreateDMChannel = dmMod.getOrCreateDMChannel;
    await channelMod.startChannelSSEBridge();
    await dmMod.startDmSSEBridge();
    // App-wide unread/activity bus (glow, mention badges in the sidebar).
    import('@/lib/api/activity').then(async (activityMod) => {
      registerActivitySSE = activityMod.registerActivityConnection;
      await activityMod.startActivitySSEBridge();
    }).catch((err) => console.error('Activity SSE bridge init failed:', err));
    // Voice bridge is optional — don't block startup if it fails.
    import('@/lib/api/voice').then(({ startVoiceBridge }) => {
      startVoiceBridge().catch(() => {});
    }).catch(() => {});
  } catch (err) {
    console.error('SSE bridge init failed (realtime cross-instance disabled):', err);
  }

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
    console.log(`📡 SSE fast-path active for /api/channels/*/stream and /api/dms/*/stream`);
  });
}

main().catch((err: unknown) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});

// ─── SSE handler ──────────────────────────────────────────
// Writes events directly to the raw HTTP socket instead of going through
// Next.js route handlers (which buffer ReadableStream bodies and delay/batch
// SSE events). This is what makes chat messages arrive instantly on every
// client — including background tabs and the sender's own other devices.

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const SSE_PING_MS = 15_000;

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

async function handleSSE(
  req: IncomingMessage,
  res: ServerResponse,
  channelId: string | undefined,
  recipientId: string | undefined,
) {
  // Auth
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization ?? null;
  const { user, error: authError } = await authenticateRequest(
    typeof authHeader === 'string' ? authHeader : null,
    cookies,
  );
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: authError || 'Unauthorized' }));
    return;
  }

  // Determine the channel key for SSE registration
  let channelKey: string;
  if (channelId) {
    const { hasAccess, error } = await checkChannelAccess!(user.id, channelId);
    if (!hasAccess) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error || 'Access denied' }));
      return;
    }
    channelKey = channelId;
  } else if (recipientId) {
    const dmChannel = await getOrCreateDMChannel!(user.id, recipientId);
    channelKey = dmChannel.id;
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing channel or recipient ID' }));
    return;
  }

  // Write SSE headers — flush immediately so the client's EventSource fires onopen
  res.writeHead(200, SSE_HEADERS);
  res.write('data: {"type":"connected"}\n\n');

  // Register a raw write callback into the shared activeConnections set.
  // publishToChannel / publishToDm will call this whenever a new event arrives.
  const register = channelId ? registerChannelSSE! : registerDmSSE!;
  const unregister = register(channelKey, (data: string) => {
    try { res.write(data); } catch { /* socket closed */ }
  });

  // Keep-alive ping — prevents proxies/load balancers from closing idle connections
  const pingInterval = setInterval(() => {
    try { res.write('data: {"type":"ping"}\n\n'); } catch { /* closed */ }
  }, SSE_PING_MS);

  // Cleanup on client disconnect
  const cleanup = () => {
    clearInterval(pingInterval);
    unregister();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

// Raw SSE handler for the app-wide unread/activity stream. Writes directly to
// the socket (same rationale as handleSSE) so unread glow updates arrive
// instantly instead of being batched by Next.js response buffering.
async function handleActivitySSE(req: IncomingMessage, res: ServerResponse) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization ?? null;
  const { user, error: authError } = await authenticateRequest(
    typeof authHeader === 'string' ? authHeader : null,
    cookies,
  );
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: authError || 'Unauthorized' }));
    return;
  }
  if (!registerActivitySSE) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Activity stream not ready' }));
    return;
  }

  res.writeHead(200, SSE_HEADERS);
  res.write('data: {"type":"connected"}\n\n');

  const unregister = registerActivitySSE(user.id, (data: string) => {
    try { res.write(data); } catch { /* socket closed */ }
  });

  const pingInterval = setInterval(() => {
    try { res.write('data: {"type":"ping"}\n\n'); } catch { /* closed */ }
  }, SSE_PING_MS);

  const cleanup = () => {
    clearInterval(pingInterval);
    unregister();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}
