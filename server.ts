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
// MUST be first: registers a Bun module shim so gt-next's runtime
// require("gt-next/internal/_load-translations") resolves to our disk-backed
// loader instead of the throwing placeholder stub. See gt-preload.ts.
import './gt-preload';
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

  const server = createServer((req, res) => {
    // ─── Domain redirect ────────────────────────────────────
    // Redirect serika.cc → FRONTEND_URL (preserves path + query).
    if (frontendUrl && redirectHosts.has(req.headers.host?.split(':')[0] || '')) {
      const target = new URL(req.url || '/', frontendUrl);
      res.writeHead(301, { Location: target.href });
      res.end();
      return;
    }

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
    } else if (!pathname.startsWith('/_next/')) {
      // Not a gateway upgrade — let it drop (Next has no other WS routes).
      socket.destroy();
    }
  });

  server.listen(port, () => {
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
  // `no-transform` tells Cloudflare (and any intermediary proxy) not to buffer,
  // compress, or otherwise mutate the stream — without it CF may hold SSE bytes
  // and turn the ~220ms speed-of-light delay for far users into multi-second lag.
  'Cache-Control': 'no-cache, no-store, must-revalidate, no-transform',
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
