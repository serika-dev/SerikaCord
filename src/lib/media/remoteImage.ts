/**
 * Server-side fetch of a remote image for the image picker (a GIF from the
 * GIF service, the user's own Discord avatar / banner). SSRF-guarded
 * (safeFetch: public addresses only, every redirect re-checked, optional host
 * allowlist), short timeout, body capped at `maxBytes`, and the bytes must be
 * a PNG / JPEG / GIF / WebP. The result is handed back to the client, which
 * sends it through the normal crop + upload path (type check, size limits,
 * Trust & Safety scan) before anything is stored.
 */
import { safeFetch, UnsafeUrlError } from '@/lib/security/ssrf';
import { sniffImageType } from '@/lib/safety/imageHash';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type RemoteImageResult =
  | { ok: true; data: Uint8Array<ArrayBuffer>; contentType: string }
  | { ok: false; status: 400 | 404 | 413 | 502; error: string };

export async function fetchRemoteImage(
  url: string,
  opts: { maxBytes: number; allowHost?: (hostname: string) => boolean; timeoutMs?: number },
): Promise<RemoteImageResult> {
  let res: Response;
  try {
    res = await safeFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), headers: { Accept: 'image/*' } }, { allowHost: opts.allowHost });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { ok: false, status: 400, error: 'This image can\'t be used' };
    return { ok: false, status: 502, error: 'Could not fetch the image' };
  }
  if (res.status === 404) return { ok: false, status: 404, error: 'Image not found' };
  if (!res.ok || !res.body) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { ok: false, status: 502, error: 'Could not fetch the image' };
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > opts.maxBytes) {
    try { await res.body.cancel(); } catch { /* ignore */ }
    return { ok: false, status: 413, error: 'Image is too large' };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > opts.maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'Image is too large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 502, error: 'Could not fetch the image' };
  }
  const data = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  const contentType = sniffImageType(data);
  if (!contentType || !IMAGE_TYPES.has(contentType)) return { ok: false, status: 400, error: 'Not a supported image' };
  return { ok: true, data, contentType };
}

/** The bytes as a private, non-sniffable image response. */
export function remoteImageResponse(image: { data: Uint8Array<ArrayBuffer>; contentType: string }): Response {
  return new Response(image.data, {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.data.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
