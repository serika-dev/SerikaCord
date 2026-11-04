/**
 * The Activities proxy: `<client_id>.<ACTIVITIES_DOMAIN>` (CORD-92).
 *
 * server.ts sends every request whose Host is on the Activities domain here,
 * before any SerikaCord route, so nothing of SerikaCord's is reachable on it.
 * Each app's host serves:
 *   - `/.serika/frame`  our relay page (src/lib/activities/relay.ts)
 *   - everything else   the app's URL mappings (first match, root last;
 *                       `/.proxy/<rest>` and `/<rest>` resolve the same)
 *
 * Upstreams are always https/wss, checked by the SSRF guard
 * (src/lib/security/ssrf.ts: every resolved address must be public) on each
 * request, redirects are never followed server-side, cookies never cross,
 * bodies and time are capped, and app documents get a strict CSP.
 * Design: docs/architecture/activities.md, section 2.
 */
import * as crypto from 'crypto';
import type { ServerWebSocket } from 'bun';
import { config } from '@/lib/config';
import { Application } from '@/lib/models';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { checkRateLimit } from '@/lib/security';
import { assertPublicUrl, UnsafeUrlError } from '@/lib/security/ssrf';
import { activityHostLabel, activityOrigin, parseActivityHost, resolveUrlMapping, withRootOverride, type ActivitySettings, type UrlMapping } from './settings';
import {
  FRAME_ALLOW_BASE, appCsp, downstreamResponseHeaders, hostOrigins, relayCsp, relayHtml, rewriteLocation, sdkQuery,
  upstreamRequestHeaders,
} from './relay';

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const WS_MAX_MESSAGE = 1 << 20;
const APP_CACHE_MS = 30_000;

interface ActivityApp {
  id: string;
  clientId: string;
  name: string;
  settings: ActivitySettings;
}

const appCache = new BoundedMap<string, { at: number; app: ActivityApp | null }>(2000);

/** The enabled Activity app behind a client id (cached 30 s), or null. */
export async function activityAppByClientId(clientId: string): Promise<ActivityApp | null> {
  const hit = appCache.get(clientId);
  if (hit && Date.now() - hit.at < APP_CACHE_MS) return hit.app;
  let app: ActivityApp | null = null;
  try {
    const row = await Application.findOne({ clientId });
    if (row) {
      const { getActivitySettings } = await import('@/lib/services/activitySettings');
      const settings = await getActivitySettings(row.id);
      if (settings.enabled) app = { id: row.id, clientId: row.clientId, name: settings.displayName || row.name, settings };
    }
  } catch (err) {
    console.error('[activities] app lookup failed:', (err as Error)?.message ?? err);
    return null; // not cached: retry next request
  }
  appCache.set(clientId, { at: Date.now(), app });
  return app;
}

/** Drop a cached app after its settings change. */
export function invalidateActivityApp(clientId: string): void {
  appCache.delete(clientId);
}

/** SerikaCord origins that may host the relay (this deployment plus the known Serika app origins). */
export function activityHostOrigins(): string[] {
  const extra = (process.env.ACTIVITIES_HOST_ORIGINS || '').split(',');
  const dev = process.env.NODE_ENV !== 'production' ? [`http://localhost:${process.env.PORT || 3000}`] : [];
  return hostOrigins([config.FRONTEND_URL, 'https://serika.chat', 'https://canary.serika.chat', ...extra, ...dev]);
}

/** Origins an Activity may call directly (SerikaCord's API), like Discord's discord.com/api exception. */
function apiOrigins(): string[] {
  return hostOrigins([config.FRONTEND_URL, 'https://serika.chat', 'https://canary.serika.chat', 'https://capi.serika.chat']);
}

function cdnOrigin(): string | null {
  try { return new URL(config.CDN_URL).origin; } catch { return null; }
}

function plain(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

/** Data Bun keeps on a proxied Activity WebSocket (see withActivitySockets). */
export interface ActivitySocketState {
  upstreamUrl: string;
  headers: Record<string, string>;
  protocols: string[];
  upstream: WebSocket | null;
  queue: Array<string | Uint8Array>;
}

type SocketData = { conn: null; compress: null; encoding: string; version: null; activity: ActivitySocketState };
type UpgradeServer = { upgrade: (req: Request, options?: { data?: SocketData; headers?: Record<string, string> }) => boolean };

/**
 * Handle one request on the Activities domain. Returns undefined only when the
 * request was upgraded to a WebSocket (Bun then owns the socket).
 */
export async function handleActivityRequest(req: Request, server: UpgradeServer, clientIp: string): Promise<Response | undefined> {
  const domain = config.ACTIVITIES_DOMAIN;
  const hostHeader = req.headers.get('host') || '';
  const parsed = parseActivityHost(hostHeader, domain);
  if (!parsed) return plain(404, 'Not found');
  const { clientId } = parsed;
  const app = await activityAppByClientId(clientId);
  if (!app) return plain(404, 'This Activity is not available.');
  // <client_id>-<token>: a developer's URL-override instance (developer shelf).
  let mappings: UrlMapping[] = app.settings.urlMappings;
  if (parsed.overrideToken) {
    const { getUrlOverride } = await import('@/lib/services/activityInstances');
    const ovr = await getUrlOverride(parsed.overrideToken);
    if (!ovr || ovr.clientId !== clientId) return plain(404, 'This Activity is not available.');
    mappings = withRootOverride(mappings, ovr.target);
  }
  const label = activityHostLabel(clientId, parsed.overrideToken) ?? clientId;

  const rl = await checkRateLimit('activityProxy', `${clientIp}:${clientId}`);
  if (!rl.success) return plain(429, 'Too many requests', { 'Retry-After': String(Math.ceil((rl.retryAfter ?? 1000) / 1000)) });

  const url = new URL(req.url);
  const publicHost = `${label}.${domain}`;
  const publicOrigin = activityOrigin(label, domain, config.FRONTEND_URL);

  if (url.pathname === '/.serika/frame') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Method not allowed');
    const nonce = crypto.randomBytes(16).toString('base64');
    const ancestors = activityHostOrigins();
    const appSrc = `/?${sdkQuery(url.searchParams).toString()}`;
    const html = relayHtml({ nonce, appSrc, allowedOrigins: ancestors, title: app.name, allow: FRAME_ALLOW_BASE });
    return new Response(req.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': relayCsp(nonce, ancestors),
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()',
      },
    });
  }
  if (url.pathname.startsWith('/.serika/') || url.pathname === '/.serika') return plain(404, 'Not found');

  const resolved = resolveUrlMapping(mappings, url.pathname);
  if (!resolved) return plain(404, 'Not found');
  const upstream = new URL(`https://${resolved.host}${resolved.path}${url.search}`);
  try {
    await assertPublicUrl(upstream);
  } catch (err) {
    if (err instanceof UnsafeUrlError) return plain(502, 'This URL mapping points at an address the proxy may not reach.');
    return plain(502, 'Upstream unavailable');
  }

  const isWs = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
  const headers = upstreamRequestHeaders(req.headers, { clientIp, publicHost, clientId, websocket: isWs });

  if (isWs) {
    const wsUrl = new URL(upstream);
    wsUrl.protocol = 'wss:';
    const protocols = (req.headers.get('sec-websocket-protocol') || '').split(',').map((p) => p.trim()).filter(Boolean).slice(0, 8);
    const plainHeaders: Record<string, string> = {};
    headers.forEach((v, k) => { plainHeaders[k] = v; });
    const state: ActivitySocketState = { upstreamUrl: wsUrl.toString(), headers: plainHeaders, protocols, upstream: null, queue: [] };
    const ok = server.upgrade(req, {
      data: { conn: null, compress: null, encoding: 'json', version: null, activity: state },
      ...(protocols[0] ? { headers: { 'Sec-WebSocket-Protocol': protocols[0] } } : {}),
    });
    return ok ? undefined : plain(426, 'Upgrade failed');
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return plain(413, 'Request body too large');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await req.arrayBuffer().catch(() => undefined);
    if (body && body.byteLength > MAX_BODY_BYTES) return plain(413, 'Request body too large');
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return plain(502, 'Upstream unavailable');
  }

  const out = downstreamResponseHeaders(res.headers);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    out.delete('location');
    if (loc) {
      const rewritten = rewriteLocation(loc, upstream, publicOrigin, mappings);
      if (!rewritten) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        return plain(502, 'The Activity tried to redirect off its mapped hosts.');
      }
      out.set('Location', rewritten);
    }
  }
  out.set('Content-Security-Policy', appCsp({ host: publicHost, apiOrigins: apiOrigins(), cdnOrigin: cdnOrigin(), ancestors: activityHostOrigins() }));
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()');
  return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
}

type AnyWS = ServerWebSocket<{ activity?: ActivitySocketState }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = Record<string, any>;

/**
 * Wrap the gateway's WebSocket handler so sockets upgraded by the Activities
 * proxy (data.activity set) tunnel to their upstream instead of the bot gateway.
 */
export function withActivitySockets<H extends Handler>(base: H): H {
  const closeBoth = (ws: AnyWS, code = 1000, reason = '') => {
    const st = ws.data.activity;
    try { st?.upstream?.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason.slice(0, 120)); } catch { /* ignore */ }
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason.slice(0, 120)); } catch { /* ignore */ }
  };
  return {
    ...base,
    open(ws: AnyWS) {
      const st = ws.data.activity;
      if (!st) return base.open?.(ws);
      // Bun's WebSocket client accepts headers (no cookies are in them, see upstreamRequestHeaders).
      const Ctor = WebSocket as unknown as new (url: string, opts: { headers: Record<string, string>; protocols?: string[] }) => WebSocket;
      let up: WebSocket;
      try {
        up = new Ctor(st.upstreamUrl, { headers: st.headers, protocols: st.protocols.length ? st.protocols : undefined });
      } catch {
        closeBoth(ws, 1011, 'Upstream unavailable');
        return;
      }
      up.binaryType = 'arraybuffer';
      st.upstream = up;
      up.onopen = () => {
        for (const m of st.queue) up.send(m);
        st.queue = [];
      };
      up.onmessage = (ev) => {
        const data = ev.data as string | ArrayBuffer;
        const size = typeof data === 'string' ? data.length : data.byteLength;
        if (size > WS_MAX_MESSAGE) { closeBoth(ws, 1009, 'Message too big'); return; }
        try { ws.send(typeof data === 'string' ? data : new Uint8Array(data)); } catch { /* client gone */ }
      };
      up.onclose = (ev) => { try { ws.close(ev.code && ev.code !== 1005 && ev.code !== 1006 ? ev.code : 1000, (ev.reason || '').slice(0, 120)); } catch { /* ignore */ } };
      up.onerror = () => closeBoth(ws, 1011, 'Upstream error');
    },
    message(ws: AnyWS, raw: string | Buffer) {
      const st = ws.data.activity;
      if (!st) return base.message?.(ws, raw);
      const msg = typeof raw === 'string' ? raw : new Uint8Array(raw);
      if (st.upstream && st.upstream.readyState === 1) st.upstream.send(msg);
      else if (st.queue.length < 100) st.queue.push(msg);
      else closeBoth(ws, 1013, 'Upstream not ready');
    },
    pong(ws: AnyWS, data?: Buffer) {
      if (ws.data.activity) return;
      return base.pong?.(ws, data);
    },
    close(ws: AnyWS, code: number, reason: string) {
      const st = ws.data.activity;
      if (!st) return base.close?.(ws, code, reason);
      try { st.upstream?.close(1000); } catch { /* ignore */ }
    },
  } as unknown as H;
}
