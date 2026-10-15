// Server-side favicons for website connections (GET /api/favicons/:domain).
//
// Only domains someone has DNS-verified (a user's website connection or a
// server's own domain) are ever fetched, so the endpoint can't be used as a
// general fetch proxy. Each fetch is HTTPS-only, re-validates every redirect
// hop against private / loopback / link-local addresses (assertPublicUrl),
// caps bodies at 256 KB and gives up after a few seconds. The result is
// re-encoded to a small PNG (ICO and SVG included, SVG never served raw) and
// cached in Redis, misses too.
import { and, eq, sql } from 'drizzle-orm';
import { cache } from '@/lib/db';
import { db, schema } from '@/lib/db/postgres';
import { assertPublicUrl } from '@/lib/security/ssrf';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { DOMAIN_VERIFICATION_KEY } from '@/lib/connections/domain';
import {
  MAX_FAVICON_BYTES,
  MAX_FAVICON_HTML_BYTES,
  checkFaviconFetchUrl,
  extractIconCandidates,
} from '@/lib/connections/favicon';
import { toFaviconPng } from '@/lib/services/faviconImage';

const HIT_TTL = 7 * 24 * 60 * 60;
const MISS_TTL = 6 * 60 * 60;
const KNOWN_TTL = 10 * 60;
const UNKNOWN_TTL = 2 * 60;
const TOTAL_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; SerikaFavicon/1.0; +https://serika.chat)';

type CachedFavicon = { png: string } | { miss: true };

const faviconKey = (domain: string) => `favicon:v1:${domain}`;
const knownKey = (domain: string) => `favicon:known:${domain}`;

/** Concurrent requests for the same uncached domain share one fetch. */
const inflight = new BoundedMap<string, Promise<Buffer | null>>(500);

/** Cached PNG (Buffer), cached miss (null) or not cached yet (undefined). */
export async function getCachedFavicon(domain: string): Promise<Buffer | null | undefined> {
  const hit = await cache.get<CachedFavicon>(faviconKey(domain)).catch(() => null);
  if (!hit) return undefined;
  if ('png' in hit && typeof hit.png === 'string') return Buffer.from(hit.png, 'base64');
  return null;
}

/** Whether some user or server has proven ownership of this domain. */
export async function isVerifiedDomainAnywhere(domain: string): Promise<boolean> {
  const cached = await cache.get<{ known: boolean }>(knownKey(domain)).catch(() => null);
  if (cached) return cached.known;
  // `metadata.domainVerification.verified` (DOMAIN_VERIFICATION_KEY; that key is never encrypted).
  const verified = sql`(${schema.userConnections.metadata} -> ${sql.raw(`'${DOMAIN_VERIFICATION_KEY}'`)} ->> 'verified') = 'true'`;
  let known = false;
  try {
    const [row] = await db
      .select({ id: schema.userConnections.id })
      .from(schema.userConnections)
      .where(and(eq(schema.userConnections.provider, 'website'), eq(schema.userConnections.accountId, domain), verified))
      .limit(1);
    known = Boolean(row);
  } catch {
    known = false;
  }
  if (!known) {
    try {
      const [row] = await db
        .select({ id: schema.serverOwnedConnections.id })
        .from(schema.serverOwnedConnections)
        .where(and(
          eq(schema.serverOwnedConnections.provider, 'website'),
          eq(schema.serverOwnedConnections.accountId, domain),
          eq(schema.serverOwnedConnections.verified, true),
        ))
        .limit(1);
      known = Boolean(row);
    } catch {
      // Table not created yet.
    }
  }
  await cache.set(knownKey(domain), { known }, known ? KNOWN_TTL : UNKNOWN_TTL).catch(() => {});
  return known;
}

/** Forget a domain's "not verified" answer (call right after a domain is verified). */
export async function forgetFaviconDomainStatus(domain: string): Promise<void> {
  await cache.del(knownKey(domain)).catch(() => {});
}

/** Fetch (or reuse the cached) favicon PNG for a verified domain; null when it has none. */
export async function getFavicon(domain: string): Promise<Buffer | null> {
  const cached = await getCachedFavicon(domain);
  if (cached !== undefined) return cached;
  const running = inflight.get(domain);
  if (running) return running;
  const job = (async () => {
    let png: Buffer | null = null;
    try {
      png = await fetchFaviconPng(domain);
    } catch {
      png = null;
    }
    const value: CachedFavicon = png ? { png: png.toString('base64') } : { miss: true };
    await cache.set(faviconKey(domain), value, png ? HIT_TTL : MISS_TTL).catch(() => {});
    return png;
  })().finally(() => inflight.delete(domain));
  inflight.set(domain, job);
  return job;
}

// ─── Network ──────────────────────────────────────────────────────────────────

/** GET over HTTPS to public addresses only, following (and re-checking) redirects by hand. */
async function safeHttpsGet(url: string, accept: string, signal: AbortSignal): Promise<{ res: Response; url: URL } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = checkFaviconFetchUrl(current);
    if (!u) return null;
    await assertPublicUrl(u); // throws on private / loopback / link-local answers
    const res = await fetch(u.toString(), {
      redirect: 'manual',
      signal,
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return null;
      current = new URL(loc, u).toString();
      continue;
    }
    return { res, url: u };
  }
  return null;
}

/**
 * Read at most `cap` bytes. `truncate` keeps the first `cap` bytes of a longer
 * body (HTML: the <head> is at the top); otherwise an oversized body is refused.
 */
async function readCapped(res: Response, cap: number, truncate: boolean): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (!truncate && declared > cap) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > cap) {
        if (!truncate) return null;
        chunks.push(value.subarray(0, cap - total));
        total = cap;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks, total);
}

async function fetchImage(url: string, signal: AbortSignal): Promise<Buffer | null> {
  const got = await safeHttpsGet(url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5', signal).catch(() => null);
  if (!got || !got.res.ok) {
    try { await got?.res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  const body = await readCapped(got.res, MAX_FAVICON_BYTES, false).catch(() => null);
  if (!body || body.length === 0) return null;
  return toFaviconPng(body).catch(() => null);
}

/** Fetches and converts without touching the cache (exported for scripts). */
export async function fetchFaviconPng(domain: string): Promise<Buffer | null> {
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  // The apex first, then www. (normalizeDomain strips "www.", and some sites only answer there).
  for (const home of [`https://${domain}/`, `https://www.${domain}/`]) {
    const page = await safeHttpsGet(home, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', signal).catch(() => null);
    if (!page) continue;
    let candidates: string[];
    const type = page.res.headers.get('content-type') || '';
    if (page.res.ok && /html|xml/i.test(type)) {
      const html = await readCapped(page.res, MAX_FAVICON_HTML_BYTES, true).catch(() => null);
      candidates = extractIconCandidates(html ? html.toString('utf8') : '', page.url);
    } else {
      try { await page.res.body?.cancel(); } catch { /* ignore */ }
      candidates = extractIconCandidates('', page.url);
    }
    for (const url of candidates) {
      if (signal.aborted) return null;
      const png = await fetchImage(url, signal);
      if (png) return png;
    }
    return null; // the site answered; don't try www. as well
  }
  return null;
}
