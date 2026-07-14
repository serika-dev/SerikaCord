/**
 * SerikaCord production server.
 *
 * Runs the Next.js app AND the Discord-compatible bot Gateway in a SINGLE
 * process on a SINGLE port. Bots connect to wss://<host>/api/v10/gateway; every
 * other request is handled by Next.
 *
 * Architecture: Bun.serve handles WebSocket upgrades natively and proxies all
 * HTTP traffic to an internal node:http server running Next.js on 127.0.0.1.
 * This avoids the Bun + node:http + ws upgrade incompatibility that caused
 * WebSocket connections to drop with code 1006 immediately after HELLO.
 *
 * Start:  bun server.ts   (package.json "start")
 */
// MUST be first: registers a Bun module shim so gt-next's runtime
// require("gt-next/internal/_load-translations") resolves to our disk-backed
// loader instead of the throwing placeholder stub. See gt-preload.ts.
import './gt-preload';
import { createServer } from 'node:http';
import next from 'next';
import type { ServerWebSocket } from 'bun';
import { connectDB } from '@/lib/db';
import { initializeAPI } from '@/lib/api';
import { authenticateRequest } from '@/lib/services/auth';
import {
  GatewayHub,
  subscribeHubToRedis,
  newSession,
  isHeartbeatExpired,
  KEEPALIVE_SWEEP_INTERVAL,
  GATEWAY_PATH,
  type Conn,
  type Session,
} from '@/lib/gateway/core';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

// Force webpack (NOT Turbopack) for this custom server.
//
// Next 16 defaults programmatic dev to Turbopack, which sets process.env.TURBOPACK
// ('auto') — and gt-next disables its compile-time babel compiler whenever that env
// is truthy. Without the compiler, every <T>/gt() falls back to sha256-hashing its
// source string on EVERY render for non-default locales, saturating the main thread
// and making the app laggy + unusable on any non-English language (and translations
// still won't apply cleanly). @generaltranslation/compiler only has a webpack
// transform (no Turbopack one), so we must run on webpack.
//
// Passing `webpack: true` makes Next skip setting process.env.TURBOPACK, so gt-next
// keeps the babel compiler enabled and hashes are injected at build time (runtime is
// then just a cheap dictionary lookup). See next.config.ts and package.json (--webpack).
const app = next({ dev, webpack: true } as Parameters<typeof next>[0]);
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

  const frontendUrl = process.env.FRONTEND_URL;
  const redirectHosts = new Set(['serika.cc', 'www.serika.cc']);

  // ─── Internal Next.js server (node:http) ────────────────
  // Next.js needs node:http req/res. We run it on an internal port and proxy
  // from Bun.serve (which handles WebSocket natively). This is what fixes the
  // 1006 drops: ws.handleUpgrade doesn't work under Bun's node:http polyfill,
  // but Bun.serve's native WebSocket is rock-solid.
  const internalPort = port + 1;
  createServer((req, res) => {
    handle(req, res);
  }).listen(internalPort, '127.0.0.1');

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

  // ─── Bun.serve: native WebSocket + SSE + proxy to Next.js ──
  // Bun.serve handles WebSocket upgrades natively — no ws package, no
  // node:http upgrade event. This is what fixes the 1006 drops.
  interface SocketData { conn: Conn }
  type WS = ServerWebSocket<SocketData>;

  const liveSockets = new Set<WS>();
  const keepaliveSweep = setInterval(() => {
    for (const ws of liveSockets) {
      const conn = ws.data.conn;
      if (!conn) continue;
      if (ws.readyState !== ws.OPEN) continue;
      if (conn.data.authenticated && isHeartbeatExpired(conn)) {
        try { ws.close(4009, 'Session timed out'); } catch { ws.terminate(); }
        continue;
      }
      // Bun sends protocol-level pings automatically (sendPings: true).
    }
  }, KEEPALIVE_SWEEP_INTERVAL);
  keepaliveSweep.unref?.();

  Bun.serve<SocketData>({
    port,
    idleTimeout: 120,
    fetch(req, server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // ─── Domain redirect ────────────────────────────────────
      if (frontendUrl && redirectHosts.has(req.headers.get('host')?.split(':')[0] || '')) {
        const target = new URL(req.url, frontendUrl);
        return Response.redirect(target.href, 301);
      }

      // ─── WebSocket upgrade for gateway ──────────────────────
      if (pathname === GATEWAY_PATH) {
        const ok = server.upgrade(req, { data: { conn: null as unknown as Conn } });
        return ok ? undefined : new Response('Upgrade failed', { status: 426 });
      }

      // ─── SSE fast-path ───────────────────────────────────────
      const channelMatch = pathname.match(/^\/api\/channels\/([^/]+)\/stream$/);
      const dmMatch = pathname.match(/^\/api\/dms\/([^/]+)\/stream$/);
      if (channelMatch || dmMatch) {
        return handleSSE(req, channelMatch?.[1], dmMatch?.[1]);
      }
      if (pathname === '/api/users/@me/activity') {
        return handleActivitySSE(req);
      }

      // ─── Proxy everything else to internal Next.js server ───
      // req.url is absolute in Bun.serve; use only the path+query to route to
      // the internal loopback server. Original headers (including Host) are
      // preserved so Next.js sees the real public hostname.
      const reqUrl = new URL(req.url);
      const proxyUrl = new URL(`${reqUrl.pathname}${reqUrl.search}`, `http://127.0.0.1:${internalPort}`);
      const proxyReq = new Request(proxyUrl, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return fetch(proxyReq, { redirect: 'manual' });
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
        if (ws.data.conn) await hub.onFrame(ws.data.conn, raw.toString());
      },
      pong(ws: WS) {
        if (ws.data.conn) ws.data.conn.data.lastHeartbeat = Date.now();
      },
      close(ws: WS) {
        liveSockets.delete(ws);
        if (ws.data.conn) {
          if (process.env.GATEWAY_DEBUG === '1' || process.env.GATEWAY_DEBUG === 'true') {
            console.log(`[gateway] closed session=${ws.data.conn.data.sessionId.slice(0, 8)} bot=${ws.data.conn.data.botId ?? '(unauth)'} code=unknown`);
          }
          hub.onClose(ws.data.conn);
        }
      },
    },
  });

  console.log(`🚀 SerikaCord ready on http://0.0.0.0:${port}`);
  console.log(`🔌 Gateway on ws://0.0.0.0:${port}${GATEWAY_PATH}`);
  console.log(`📡 SSE fast-path active for /api/channels/*/stream and /api/dms/*/stream`);

  // Start Discord Bot real-time listener — only one instance should run
  // the bot to avoid duplicate gateway connections. Use a Redis lock with
  // a TTL so if the active instance crashes, another picks it up.
  // Set DISABLE_DISCORD_BOT=1 on canary/dev to skip entirely.
  if (process.env.DISABLE_DISCORD_BOT === '1' || process.env.DISABLE_DISCORD_BOT === 'true') {
    console.log('[Discord Bot] DISABLE_DISCORD_BOT is set — skipping bot startup.');
  } else {
  (async () => {
  const redis = (await import('@/lib/db/redis')).getRedis();
  const instanceId = `${process.pid}-${Date.now()}`;
  const LOCK_KEY = 'serikacord:discord-bot-lock';
  const LOCK_TTL = 60; // seconds

  async function tryAcquireBotLock(): Promise<boolean> {
    if (!redis) return true; // No Redis — assume single instance
    try {
      const result = await redis.set(LOCK_KEY, instanceId, 'EX', LOCK_TTL, 'NX');
      return result === 'OK';
    } catch {
      return true; // Redis error — assume single instance
    }
  }

  async function renewBotLock(): Promise<boolean> {
    if (!redis) return true;
    try {
      const current = await redis.get(LOCK_KEY);
      if (current !== instanceId) return false;
      await redis.expire(LOCK_KEY, LOCK_TTL);
      return true;
    } catch {
      return true;
    }
  }

  let botLockHeld = false;
  let botLockTimer: ReturnType<typeof setInterval> | null = null;

  async function startBotIfLeader() {
    botLockHeld = await tryAcquireBotLock();
    if (!botLockHeld) {
      console.log('[Discord Bot] Another instance is running the bot — skipping startup.');
      // Retry every 15s in case the leader crashes
      botLockTimer = setInterval(async () => {
        if (await tryAcquireBotLock()) {
          if (botLockTimer) clearInterval(botLockTimer);
          botLockTimer = null;
          botLockHeld = true;
          console.log('[Discord Bot] Acquired leadership — starting bot now.');
          import('@/lib/discord/bot').then(({ startDiscordBot }) => {
            startDiscordBot().catch((err) => console.error('[Discord Bot] Startup failed:', err));
          }).catch((err) => console.error('[Discord Bot] Import failed:', err));
          // Start renewal timer
          setInterval(async () => {
            if (!(await renewBotLock())) {
              console.warn('[Discord Bot] Lost leadership — bot may duplicate. Stopping renewal.');
            }
          }, LOCK_TTL * 500); // Renew at half TTL
        }
      }, 15000);
      return;
    }

    console.log('[Discord Bot] Acquired leadership — starting bot.');
    import('@/lib/discord/bot').then(({ startDiscordBot }) => {
      startDiscordBot().catch((err) => console.error('[Discord Bot] Startup failed:', err));
    }).catch((err) => console.error('[Discord Bot] Import failed:', err));

    // Renew lock periodically
    setInterval(async () => {
      if (!(await renewBotLock())) {
        console.warn('[Discord Bot] Lost leadership — bot may duplicate. Stopping renewal.');
      }
    }, LOCK_TTL * 500); // Renew at half TTL
  }

  void startBotIfLeader();
  })(); // end async IIFE
  } // end else (DISABLE_DISCORD_BOT check)
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

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, must-revalidate, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const SSE_PING_MS = 15_000;

function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function sseResponse(
  setup: (write: (data: string) => void) => () => void,
): Response {
  const encoder = new TextEncoder();
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const write = (data: string) => {
        try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
      };
      cleanup = setup(write);
      pingInterval = setInterval(() => {
        write('data: {"type":"ping"}\n\n');
      }, SSE_PING_MS);
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
      if (cleanup) cleanup();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

async function handleSSE(
  req: Request,
  channelId: string | undefined,
  recipientId: string | undefined,
): Promise<Response> {
  const cookies = parseCookies(req.headers.get('cookie'));
  const authHeader = req.headers.get('authorization');
  const { user, error: authError } = await authenticateRequest(
    authHeader,
    cookies,
  );
  if (!user) {
    return new Response(JSON.stringify({ error: authError || 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let channelKey: string;
  if (channelId) {
    const { hasAccess, error } = await checkChannelAccess!(user.id, channelId);
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: error || 'Access denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    channelKey = channelId;
  } else if (recipientId) {
    const dmChannel = await getOrCreateDMChannel!(user.id, recipientId);
    channelKey = dmChannel.id;
  } else {
    return new Response(JSON.stringify({ error: 'Missing channel or recipient ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return sseResponse((write) => {
    write('data: {"type":"connected"}\n\n');
    const register = channelId ? registerChannelSSE! : registerDmSSE!;
    const unregister = register(channelKey, (data: string) => write(data));
    return () => { unregister(); };
  });
}

async function handleActivitySSE(req: Request): Promise<Response> {
  const cookies = parseCookies(req.headers.get('cookie'));
  const authHeader = req.headers.get('authorization');
  const { user, error: authError } = await authenticateRequest(
    authHeader,
    cookies,
  );
  if (!user) {
    return new Response(JSON.stringify({ error: authError || 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!registerActivitySSE) {
    return new Response(JSON.stringify({ error: 'Activity stream not ready' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const register = registerActivitySSE;
  return sseResponse((write) => {
    write('data: {"type":"connected"}\n\n');
    const unregister = register(user.id, (data: string) => write(data));
    return () => { unregister(); };
  });
}
