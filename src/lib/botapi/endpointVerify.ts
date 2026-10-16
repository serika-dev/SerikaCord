/**
 * SSRF-safe verification of an application's interactions endpoint URL (the
 * signed PING Discord sends before accepting a URL). Used by PATCH
 * /applications/@me and the Developer Portal. Every request goes through
 * safeFetch (public addresses only, re-checked on each call), redirects are
 * not followed and the response body is capped.
 */
import { randomUUID } from 'crypto';

export const PING_RESPONSE_MAX_BYTES = 64 * 1024;
const INTERACTION_PING = 1;
const CB_PONG = 1;

/** https only, a public host shape (DNS is re-checked by safeFetch). */
export function isAcceptableEndpointUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && url.length <= 2048;
  } catch {
    return false;
  }
}

/** Read at most `max` bytes of a response body as text; null when it is bigger. */
export async function readCapped(res: Response, max = PING_RESPONSE_MAX_BYTES): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

// In-flight signed POSTs (per application and in total, per process). A slot
// is held until the request really settles, not just until we stop waiting.
const g = globalThis as unknown as { __endpointInflight?: { perKey: Map<string, number>; total: number } };
const inflight = (g.__endpointInflight ??= { perKey: new Map(), total: 0 });
export const ENDPOINT_CONCURRENCY_PER_APP = 25;
export const ENDPOINT_CONCURRENCY_TOTAL = 500;
export const ENDPOINT_TIMEOUT_MS = 3000;

/**
 * The one way SerikaCord POSTs to an app's interactions endpoint (deliveries
 * and the verification PING): https only, safeFetch (public addresses only,
 * DNS re-checked on every call, no redirects), signed like Discord
 * (X-Signature-Ed25519 / X-Signature-Timestamp over timestamp + body), a 3 s
 * bound on DNS + request together, a capped JSON reply, and per-app / global
 * concurrency caps. Returns null when it couldn't be sent or answered.
 */
export async function postSignedToEndpoint(opts: {
  url: string;
  privateKeyPem: string;
  payload: unknown;
  /** Concurrency bucket (the application id). */
  key: string;
  maxBytes?: number;
}): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  if (!isAcceptableEndpointUrl(opts.url)) return null;
  const current = inflight.perKey.get(opts.key) ?? 0;
  if (current >= ENDPOINT_CONCURRENCY_PER_APP || inflight.total >= ENDPOINT_CONCURRENCY_TOTAL) return null;
  inflight.perKey.set(opts.key, current + 1);
  inflight.total++;
  const release = () => {
    const n = (inflight.perKey.get(opts.key) ?? 1) - 1;
    if (n <= 0) inflight.perKey.delete(opts.key);
    else inflight.perKey.set(opts.key, n);
    inflight.total = Math.max(0, inflight.total - 1);
  };
  const work = (async () => {
    const { signInteraction } = await import('@/lib/services/appIdentity');
    const { safeFetch } = await import('@/lib/security/ssrf');
    const body = JSON.stringify(opts.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await safeFetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SerikaCord-Interactions/1.0 (+https://serika.chat/developers)',
        'X-Signature-Ed25519': signInteraction(opts.privateKeyPem, timestamp + body),
        'X-Signature-Timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    }, { maxRedirects: 0 });
    if (res.status >= 300 && res.status < 400) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { ok: false, status: res.status, body: null };
    }
    const text = await readCapped(res, opts.maxBytes ?? PING_RESPONSE_MAX_BYTES);
    let json: unknown = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    return { ok: res.ok, status: res.status, body: json };
  })();
  // The slot is freed when the work settles (even after we stopped waiting).
  void work.catch(() => null).finally(release);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ENDPOINT_TIMEOUT_MS + 250); });
  try {
    return await Promise.race([work.catch(() => null), timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Send a signed PING to `url`; true only when it answers 2xx with `{ type: 1 }`.
 * Never throws.
 */
export async function verifyInteractionsEndpointSafely(opts: {
  url: string;
  privateKeyPem?: string | null;
  clientId?: string | null;
  applicationId?: string | null;
}): Promise<boolean> {
  if (!opts.privateKeyPem || !isAcceptableEndpointUrl(opts.url)) return false;
  const res = await postSignedToEndpoint({
    url: opts.url,
    privateKeyPem: opts.privateKeyPem,
    key: opts.applicationId ?? opts.clientId ?? opts.url,
    payload: { id: randomUUID(), application_id: opts.applicationId ?? opts.clientId ?? '', type: INTERACTION_PING, token: 'ping', version: 1 },
  });
  return !!res && res.ok && (res.body as { type?: unknown } | null)?.type === CB_PONG;
}
