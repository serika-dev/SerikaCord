// Website-connection favicons, mounted at /api.
//
//   GET /favicons/:domain   the domain's favicon as a ≤64px PNG (404 when it has none)
//
// Served from our origin so viewers' browsers never contact the linked site.
// Only DNS-verified domains (a user's or a server's) are fetched; the fetch
// itself is SSRF-guarded and cached in Redis (see services/favicons.ts).
import { Elysia, t } from 'elysia';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { canonicalFaviconDomain } from '@/lib/connections/favicon';
import { getCachedFavicon, getFavicon, isVerifiedDomainAnywhere } from '@/lib/services/favicons';

const IMAGE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-site',
};

function png(body: Buffer): Response {
  return new Response(new Uint8Array(body), { status: 200, headers: IMAGE_HEADERS });
}

function notFound(maxAge: number): Response {
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' },
  });
}

export const faviconRoutes = new Elysia()
  .get('/favicons/:domain', async ({ params, request }) => {
    const domain = canonicalFaviconDomain(params.domain);
    if (!domain) return new Response(null, { status: 400, headers: { 'Cache-Control': 'public, max-age=86400' } });

    const cached = await getCachedFavicon(domain);
    if (cached) return png(cached);
    if (cached === null) return notFound(3600);

    if (!(await isVerifiedDomainAnywhere(domain))) return notFound(300);

    // Only cache misses reach the network; bound them per client.
    const limit = await checkRateLimit('faviconFetch', getClientIP(request));
    if (!limit.success) {
      return new Response(null, { status: 429, headers: { 'Retry-After': String(limit.retryAfter ?? 60), 'Cache-Control': 'no-store' } });
    }
    const icon = await getFavicon(domain).catch(() => null);
    return icon ? png(icon) : notFound(3600);
  }, { params: t.Object({ domain: t.String({ maxLength: 300 }) }) });
