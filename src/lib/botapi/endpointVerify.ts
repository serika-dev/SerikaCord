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

/**
 * Send a signed PING to `url`; true only when it answers 2xx with `{ type: 1 }`.
 * Never throws.
 */
export async function verifyInteractionsEndpointSafely(opts: {
  url: string;
  privateKeyPem?: string | null;
  clientId?: string | null;
}): Promise<boolean> {
  if (!opts.privateKeyPem || !isAcceptableEndpointUrl(opts.url)) return false;
  try {
    const { signInteraction } = await import('@/lib/services/appIdentity');
    const { safeFetch } = await import('@/lib/security/ssrf');
    const body = JSON.stringify({ id: randomUUID(), application_id: opts.clientId ?? '', type: INTERACTION_PING, token: 'ping', version: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await safeFetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SerikaCord-Interactions/1.0',
        'X-Signature-Ed25519': signInteraction(opts.privateKeyPem, timestamp + body),
        'X-Signature-Timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(3000),
    }, { maxRedirects: 0 });
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return false; }
    const text = await readCapped(res);
    if (text === null) return false;
    const json = JSON.parse(text) as { type?: unknown };
    return json?.type === CB_PONG;
  } catch {
    return false;
  }
}
