/**
 * The Activities proxy's own responses and header rules (pure, no I/O):
 *
 * - the relay page served at `<client_id>.<ACTIVITIES_DOMAIN>/.serika/frame`,
 *   which loads the app in a nested same-origin iframe so the stock Embedded
 *   App SDK's origin check passes, and shuttles SDK tuples between the app and
 *   the SerikaCord window (docs/architecture/activities.md, section 1);
 * - the Content-Security-Policy of proxied app responses;
 * - which request / response headers cross the proxy.
 *
 * The relay is not a security boundary (the app shares its origin). SerikaCord
 * checks every message's source window and origin and treats it as untrusted.
 */

/** postMessage envelope between the relay and the SerikaCord window. */
export const RELAY_ENVELOPE = 'serikaActivity' as const;

/** `allow` features the frames get (microphone/camera are added only after the user agrees). */
export const FRAME_ALLOW_BASE = ['autoplay', 'fullscreen', 'clipboard-write', 'gamepad', 'screen-wake-lock', 'encrypted-media', 'picture-in-picture'];

/** `sandbox` tokens of the relay iframe SerikaCord creates. Safe with allow-same-origin only because the frame is cross-site. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads';

/** Query params the SDK reads; the relay forwards exactly these to the app. */
export const SDK_QUERY_PARAMS = ['frame_id', 'instance_id', 'platform', 'guild_id', 'channel_id', 'location_id', 'custom_id', 'referrer_id', 'mobile_app_version', 'launch_id'] as const;

/** Keep only the SDK's query params (string values, bounded). */
export function sdkQuery(search: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of SDK_QUERY_PARAMS) {
    const v = search.get(key);
    if (v !== null && v.length <= 200 && /^[\w.:-]*$/.test(v)) out.set(key, v);
  }
  return out;
}

/** Origins allowed to host the relay: the app's own origin(s), normalized, deduplicated. */
export function hostOrigins(candidates: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(c.trim());
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) continue;
      if (!out.includes(u.origin)) out.push(u.origin);
    } catch { /* skip junk */ }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * The relay page. `appSrc` is the app's root path plus the SDK query string;
 * `allowedOrigins` the SerikaCord origins that may host it. The script only
 * forwards: app -> host wrapped in the envelope, host -> app unwrapped.
 */
export function relayHtml(opts: { nonce: string; appSrc: string; allowedOrigins: string[]; title: string; allow: string[] }): string {
  const allowed = JSON.stringify(opts.allowedOrigins);
  const src = JSON.stringify(opts.appSrc);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(opts.title)}</title>
<style nonce="${opts.nonce}">html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body>
<iframe id="app" title="${escapeHtml(opts.title)}" allow="${escapeHtml(opts.allow.join('; '))}" allowfullscreen></iframe>
<script nonce="${opts.nonce}">
(function () {
  var ALLOWED = ${allowed};
  var KEY = ${JSON.stringify(RELAY_ENVELOPE)};
  var app = document.getElementById('app');
  var host = window.parent !== window ? window.parent : window.opener;
  var hostOrigin = null;
  try { var r = new URL(document.referrer).origin; if (ALLOWED.indexOf(r) !== -1) hostOrigin = r; } catch (e) {}
  var queue = [];
  function toHost(data) {
    if (!host) return;
    if (!hostOrigin) { if (queue.length < 100) queue.push(data); return; }
    var m = {}; m[KEY] = 1; m.data = data;
    host.postMessage(m, hostOrigin);
  }
  window.addEventListener('message', function (e) {
    if (e.source === app.contentWindow && e.origin === location.origin) { toHost(e.data); return; }
    if (e.source === host && ALLOWED.indexOf(e.origin) !== -1 && e.data && e.data[KEY] === 1) {
      if (!hostOrigin) { hostOrigin = e.origin; var q = queue; queue = []; q.forEach(toHost); }
      if (e.origin !== hostOrigin) return;
      if (e.data.data !== undefined && app.contentWindow) app.contentWindow.postMessage(e.data.data, location.origin);
    }
  });
  if (host && hostOrigin) { var hello = {}; hello[KEY] = 1; hello.hello = 1; host.postMessage(hello, hostOrigin); }
  app.src = ${src};
})();
</script>
</body></html>`;
}

/** CSP of the relay page: only its inline script/style, frames from itself, framed only by SerikaCord. */
export function relayCsp(nonce: string, ancestors: string[]): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "frame-src 'self'",
    `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * CSP for proxied app documents: everything external goes through the proxy
 * (`/.proxy/...`), like Discord's. SerikaCord's API and CDN are the exceptions
 * (Discord allows discord.com/api and its CDN the same way), so an Activity can
 * call the API with its own OAuth2 token.
 *
 * frame-ancestors is checked against EVERY ancestor, not just the parent: the
 * app sits in the relay ('self'), which sits in a SerikaCord page, so the
 * SerikaCord origins must be listed too or browsers refuse to show it.
 */
export function appCsp(opts: { host: string; apiOrigins: string[]; cdnOrigin: string | null; ancestors: string[] }): string {
  const extra = [...opts.apiOrigins, ...(opts.cdnOrigin ? [opts.cdnOrigin] : [])].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${extra}`.trim(),
    `media-src 'self' data: blob: ${extra}`.trim(),
    `connect-src 'self' wss://${opts.host} ${extra}`.trim(),
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    `frame-ancestors 'self' ${opts.ancestors.join(' ')}`.trim(),
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

/** Request headers forwarded upstream: no cookies, no hop-by-hop, no client-supplied forwarding headers. */
export function upstreamRequestHeaders(incoming: Headers, ctx: { clientIp: string; publicHost: string; clientId: string; websocket?: boolean }): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k === 'cookie' || k.startsWith('x-forwarded-') || k === 'forwarded' || k === 'x-real-ip'
      || k.startsWith('cf-') || k === 'true-client-ip' || k.startsWith('sec-websocket-')) return;
    out.set(key, value);
  });
  out.set('X-Forwarded-For', ctx.clientIp);
  out.set('X-Forwarded-Host', ctx.publicHost);
  out.set('X-Forwarded-Proto', 'https');
  out.set('X-Serika-Activity-Client-Id', ctx.clientId);
  return out;
}

/** Response headers passed back: no cookies, HSTS, hop-by-hop or upstream framing/CSP rules (we set our own). */
export function downstreamResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k === 'set-cookie' || k === 'strict-transport-security' || k === 'content-security-policy'
      || k === 'content-security-policy-report-only' || k === 'x-frame-options' || k === 'alt-svc' || k === 'clear-site-data') return;
    out.append(key, value);
  });
  return out;
}

/** Rewrite an upstream redirect `Location` that points at a mapped host back onto the proxy. */
export function rewriteLocation(location: string, upstreamUrl: URL, publicOrigin: string, mappings: Array<{ prefix: string; target: string }>): string | null {
  let u: URL;
  try { u = new URL(location, upstreamUrl); } catch { return null; }
  if (u.origin === publicOrigin) return u.toString();
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const hostPath = `${u.host}${u.pathname}`.toLowerCase();
  // Root mapping last, like routing.
  const ordered = [...mappings.filter((m) => m.prefix !== '/'), ...mappings.filter((m) => m.prefix === '/')];
  for (const m of ordered) {
    if (m.target.includes('{')) continue;
    const t = m.target.toLowerCase();
    if (hostPath === t || hostPath.startsWith(`${t}/`) || (t.indexOf('/') === -1 && u.host.toLowerCase() === t)) {
      const rest = `${u.host}${u.pathname}`.slice(m.target.length);
      const prefix = m.prefix === '/' ? '' : `/.proxy${m.prefix}`;
      return `${publicOrigin}${prefix}${rest.startsWith('/') || rest === '' ? rest : `/${rest}`}${u.search}${u.hash}` || `${publicOrigin}/`;
    }
  }
  return null; // off-site redirect: don't follow it inside the frame
}
