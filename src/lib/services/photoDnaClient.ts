// PhotoDNA Cloud Service client: checks an image against the known-CSAM hash
// sets (NCMEC, IWF, ...). Response rules: src/lib/safety/photoDna.ts.
//
// Keys: PHOTODNA_KEY (primary) and PHOTODNA_KEY_SECONDARY (used when the
// primary is rejected or rate limited). Unset = scanning is off.
//
// Images are normalised with sharp first: PhotoDNA only takes jpeg/png/gif/
// bmp/tiff of at least 160x160 and at most 4 MB, so others are re-encoded to
// JPEG, small ones upscaled and big ones downscaled (PhotoDNA is resize-robust).
import sharp from 'sharp';
import { config } from '@/lib/config';
import {
  PHOTODNA_ENDPOINT,
  PHOTODNA_MAX_BYTES,
  PHOTODNA_MIN_SIDE,
  isPhotoDnaNativeType,
  parsePhotoDnaResponse,
  type PhotoDnaResult,
} from '@/lib/safety/photoDna';

const TIMEOUT_MS = 8_000;
const MAX_SIDE = 2048;
/** Images above this many pixels aren't decoded (memory); the scanner blocks them instead. */
export const MAX_SCAN_PIXELS = 40_000_000;

export function photoDnaConfigured(): boolean {
  return Boolean(config.PHOTODNA_KEY || config.PHOTODNA_KEY_SECONDARY);
}

/** Bytes PhotoDNA accepts, or null when the image can't be decoded. */
async function normalizeForPhotoDna(buffer: Buffer, contentType: string, page = 0): Promise<{ body: Buffer; type: string } | null> {
  try {
    const opts = { page, pages: 1, failOn: 'none' as const, limitInputPixels: MAX_SCAN_PIXELS, sequentialRead: true };
    const meta = await sharp(buffer, opts).metadata();
    const w = meta.width ?? 0;
    // For multi-frame images sharp reports the height of one page.
    const h = meta.pageHeight ?? meta.height ?? 0;
    if (!w || !h) return null;
    const fits = w >= PHOTODNA_MIN_SIDE && h >= PHOTODNA_MIN_SIDE && w <= MAX_SIDE && h <= MAX_SIDE;
    if (page === 0 && (meta.pages ?? 1) <= 1 && fits && isPhotoDnaNativeType(contentType) && buffer.byteLength <= PHOTODNA_MAX_BYTES) {
      return { body: buffer, type: contentType.split(';')[0].trim().toLowerCase() };
    }
    let pipeline = sharp(buffer, opts);
    const shortest = Math.min(w, h);
    if (shortest < PHOTODNA_MIN_SIDE) {
      const scale = PHOTODNA_MIN_SIDE / shortest;
      pipeline = pipeline.resize(Math.ceil(w * scale), Math.ceil(h * scale), { fit: 'fill' });
    } else if (Math.max(w, h) > MAX_SIDE) {
      pipeline = pipeline.resize(MAX_SIDE, MAX_SIDE, { fit: 'inside' });
    }
    const body = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    return body.byteLength <= PHOTODNA_MAX_BYTES ? { body, type: 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

async function callMatch(key: string, body: Buffer, type: string): Promise<PhotoDnaResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PHOTODNA_ENDPOINT}?enhance=false`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': type, 'Cache-Control': 'no-cache' },
      body: new Uint8Array(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return parsePhotoDnaResponse(res.status, json);
  } catch (err) {
    return { status: 'error', code: null, description: (err as Error)?.message || 'network error', retryWithOtherKey: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks an image. 'error' results (service down, bad image) are returned,
 * not thrown: callers decide whether to fail open.
 */
export async function photoDnaMatch(buffer: Buffer, contentType: string, page = 0): Promise<PhotoDnaResult> {
  const keys = [config.PHOTODNA_KEY, config.PHOTODNA_KEY_SECONDARY].filter(Boolean);
  if (keys.length === 0) return { status: 'error', code: null, description: 'PhotoDNA not configured', retryWithOtherKey: false };
  const prepared = await normalizeForPhotoDna(buffer, contentType, page);
  if (!prepared) return { status: 'error', code: 3206, description: 'Image could not be prepared for PhotoDNA', retryWithOtherKey: false };
  let last: PhotoDnaResult = { status: 'error', code: null, description: 'not attempted', retryWithOtherKey: false };
  for (const key of keys) {
    last = await callMatch(key, prepared.body, prepared.type);
    if (last.status !== 'error' || !last.retryWithOtherKey) return last;
  }
  return last;
}
