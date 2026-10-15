/**
 * Pure rules for website-connection favicons (GET /api/favicons/:domain).
 *
 * Viewers never load a third-party favicon directly (that would leak their IP
 * to every linked site): the server fetches it once, converts it to a small
 * PNG and serves it from our origin. Everything here is pure so it can be unit
 * tested; the network side lives in src/lib/services/favicons.ts.
 */
import { normalizeDomain } from './domain';

/** Largest response body read for an icon, and for the homepage HTML (truncated, not refused). */
export const MAX_FAVICON_BYTES = 256 * 1024;
export const MAX_FAVICON_HTML_BYTES = 256 * 1024;
/** Output edge length (PNG, transparent letterbox). Smaller icons are not upscaled. */
export const FAVICON_OUTPUT_SIZE = 64;
/** Icons smaller than this (e.g. 1x1 spacer "favicons") count as missing. */
export const FAVICON_MIN_SIZE = 8;
/** Candidate icon URLs tried per domain, after the homepage. */
export const MAX_FAVICON_CANDIDATES = 4;

/** Public path of a domain's favicon, or null when the domain isn't a valid public one. */
export function faviconPath(domain: unknown): string | null {
  const d = normalizeDomain(domain);
  return d ? `/api/favicons/${encodeURIComponent(d)}` : null;
}

/**
 * The route only answers for the canonical spelling (`example.com`, not
 * `WWW.Example.com`), so one domain has exactly one cache entry.
 */
export function canonicalFaviconDomain(param: unknown): string | null {
  if (typeof param !== 'string') return null;
  let raw = param;
  try {
    raw = decodeURIComponent(param);
  } catch {
    return null;
  }
  const d = normalizeDomain(raw);
  return d && d === raw ? d : null;
}

/**
 * May the fetcher request this URL? HTTPS on the default port only, no
 * credentials, and a DNS name (never an IP literal or an internal-only name).
 * The DNS answer is checked separately (assertPublicUrl) on every hop.
 */
export function checkFaviconFetchUrl(input: string | URL): URL | null {
  let u: URL;
  try {
    u = typeof input === 'string' ? new URL(input) : new URL(input.toString());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port !== '' && u.port !== '443') return null;
  // A public DNS name (rejects IPv4/IPv6 literals, localhost, *.local, ...).
  if (!normalizeDomain(`https://${u.hostname}`)) return null;
  u.hash = '';
  return u;
}

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'ico' | 'svg' | 'bmp';

/** Detect the image format from its first bytes (never trust Content-Type). */
export function sniffImageType(buf: Uint8Array): ImageKind | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  if (buf.length >= 6 && buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0 && (buf[4] | buf[5]) !== 0) return 'ico';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  // SVG: text whose first tag (after an optional BOM, XML prolog, comments, doctype) is <svg.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 1024)).replace(/^﻿/, '');
  const stripped = head
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/g, '')
    .replace(/^\s*<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/g, '');
  if (/^\s*<svg[\s>]/i.test(stripped)) return 'svg';
  return null;
}

// ─── Homepage <link rel="icon"> discovery ─────────────────────────────────────

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;

function decodeAttr(v: string): string {
  let s = v;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;|&#47;/gi, '/')
    .trim();
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = decodeAttr(m[2]);
  }
  return out;
}

/** Edge length a <link> advertises (sizes="32x32 64x64" → 64; "any"/SVG → 512). */
function advertisedSize(attrs: Record<string, string>, rel: string[], href: string): number {
  const sizes = (attrs.sizes || '').toLowerCase();
  if (sizes.includes('any')) return 512;
  const dims = [...sizes.matchAll(/(\d{1,4})x(\d{1,4})/g)].map((m) => Math.max(Number(m[1]), Number(m[2])));
  if (dims.length > 0) return Math.max(...dims);
  if ((attrs.type || '').includes('svg') || /\.svg(?:$|[?#])/i.test(href)) return 512;
  if (rel.some((r) => r.startsWith('apple-touch-icon'))) return 180;
  return 16; // a bare rel="icon" is almost always a 16/32px .ico
}

/** Lower is better: closest to 64px, preferring bigger icons over smaller ones. */
function sizeScore(size: number): number {
  return size >= FAVICON_OUTPUT_SIZE ? size - FAVICON_OUTPUT_SIZE : (FAVICON_OUTPUT_SIZE - size) * 4;
}

/**
 * Icon URLs a homepage advertises, best first (rel="icon", "shortcut icon",
 * "apple-touch-icon"; never "mask-icon", which is a monochrome stencil). Only
 * absolute https URLs survive; `/favicon.ico` on the page's origin is always
 * appended as the last resort.
 */
export function extractIconCandidates(html: string, pageUrl: string | URL): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl.toString());
  } catch {
    return [];
  }
  const found: { url: string; score: number; order: number }[] = [];
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  let order = 0;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0]);
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    const isIcon = rel.includes('icon') || rel.some((r) => r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed');
    if (!isIcon || rel.includes('mask-icon') || !attrs.href) continue;
    if (/^\s*(?:data|javascript|blob):/i.test(attrs.href)) continue;
    let url: URL | null;
    try {
      url = checkFaviconFetchUrl(new URL(attrs.href, base));
    } catch {
      url = null;
    }
    if (!url) continue;
    found.push({ url: url.toString(), score: sizeScore(advertisedSize(attrs, rel, attrs.href)), order: order++ });
  }
  found.sort((a, b) => a.score - b.score || a.order - b.order);
  const out: string[] = [];
  for (const f of found) {
    if (!out.includes(f.url)) out.push(f.url);
    if (out.length >= MAX_FAVICON_CANDIDATES) break;
  }
  const fallback = checkFaviconFetchUrl(new URL('/favicon.ico', base));
  if (fallback && !out.includes(fallback.toString())) out.push(fallback.toString());
  return out;
}

// ─── ICO decoding ─────────────────────────────────────────────────────────────

export type IcoImage =
  | { kind: 'png'; data: Uint8Array; width: number; height: number }
  | { kind: 'rgba'; data: Uint8Array; width: number; height: number };

const MAX_ICO_ENTRIES = 64;

/**
 * Pick the best image in a .ico file (largest, then deepest colour) and
 * return it as embedded PNG bytes or decoded RGBA pixels (BMP-style entries,
 * 1/4/8/24/32 bpp with the AND transparency mask). Null on anything malformed.
 */
export function decodeIco(buf: Uint8Array): IcoImage | null {
  if (buf.length < 6) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint16(0, true) !== 0) return null;
  const type = view.getUint16(2, true);
  if (type !== 1 && type !== 2) return null;
  const count = view.getUint16(4, true);
  if (count === 0 || count > MAX_ICO_ENTRIES || 6 + count * 16 > buf.length) return null;

  type Entry = { width: number; height: number; bpp: number; size: number; offset: number };
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const width = buf[o] || 256;
    const height = buf[o + 1] || 256;
    const bpp = view.getUint16(o + 6, true);
    const size = view.getUint32(o + 8, true);
    const offset = view.getUint32(o + 12, true);
    if (size === 0 || offset + size > buf.length || offset < 6 + count * 16) continue;
    entries.push({ width, height, bpp, size, offset });
  }
  entries.sort((a, b) => b.width * b.height - a.width * a.height || b.bpp - a.bpp);

  for (const e of entries) {
    const data = buf.subarray(e.offset, e.offset + e.size);
    if (sniffImageType(data) === 'png') {
      return { kind: 'png', data, width: e.width, height: e.height };
    }
    const decoded = decodeIcoBitmap(data);
    if (decoded) return decoded;
  }
  return null;
}

/** A BITMAPINFOHEADER + XOR pixels + AND mask, as stored inside a .ico. */
export function decodeIcoBitmap(data: Uint8Array): IcoImage | null {
  if (data.length < 40) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint32(0, true);
  if (headerSize < 40 || headerSize > data.length) return null;
  const width = view.getInt32(4, true);
  const fullHeight = view.getInt32(8, true);
  const bpp = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colorsUsed = view.getUint32(32, true);
  // Icons store XOR + AND masks stacked, so the header height is doubled.
  const height = Math.abs(fullHeight) / 2;
  if (!Number.isInteger(height) || width <= 0 || width > 256 || height <= 0 || height > 256) return null;
  if (![1, 4, 8, 24, 32].includes(bpp)) return null;
  if (compression !== 0 && !(compression === 3 && bpp === 32)) return null;

  const paletteCount = bpp <= 8 ? (colorsUsed > 0 && colorsUsed <= 1 << bpp ? colorsUsed : 1 << bpp) : 0;
  // BI_BITFIELDS appends three DWORD masks after a 40-byte header.
  const masksSize = compression === 3 && headerSize === 40 ? 12 : 0;
  const paletteStart = headerSize + masksSize;
  const pixelStart = paletteStart + paletteCount * 4;
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4;
  const andStride = Math.floor((width + 31) / 32) * 4;
  const andStart = pixelStart + xorStride * height;
  if (andStart > data.length) return null;
  const hasAnd = andStart + andStride * height <= data.length;
  const bottomUp = fullHeight > 0;

  const out = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const rowOff = pixelStart + srcRow * xorStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 32) {
        const p = rowOff + x * 4;
        b = data[p]; g = data[p + 1]; r = data[p + 2]; a = data[p + 3];
        if (a !== 0) anyAlpha = true;
      } else if (bpp === 24) {
        const p = rowOff + x * 3;
        b = data[p]; g = data[p + 1]; r = data[p + 2];
      } else {
        const bitPos = x * bpp;
        const byte = data[rowOff + (bitPos >> 3)];
        const shift = 8 - bpp - (bitPos & 7);
        const idx = (byte >> shift) & ((1 << bpp) - 1);
        if (idx >= paletteCount) return null;
        const p = paletteStart + idx * 4;
        b = data[p]; g = data[p + 1]; r = data[p + 2];
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  // AND mask: 1 = transparent. 32 bpp icons carry real alpha unless it is all zero.
  if (hasAnd && (bpp !== 32 || !anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const srcRow = bottomUp ? height - 1 - y : y;
      const rowOff = andStart + srcRow * andStride;
      for (let x = 0; x < width; x++) {
        const bit = (data[rowOff + (x >> 3)] >> (7 - (x & 7))) & 1;
        out[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  } else if (bpp === 32 && !anyAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }
  return { kind: 'rgba', data: out, width, height };
}

// ─── SVG ──────────────────────────────────────────────────────────────────────

/**
 * Make an SVG safe to hand to the rasteriser: no DOCTYPE / entity
 * declarations (entity expansion), no external references (only `#fragment`
 * hrefs survive), no <style> @imports. The script/handler stripping is done by
 * sanitizeSvg in the service; this only removes what a rasteriser could fetch.
 */
export function stripSvgExternalRefs(svg: string): string {
  return svg
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/\b((?:xlink:)?href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (all, _name: string, value: string) => {
      const v = value.replace(/^["']|["']$/g, '').trim();
      return v.startsWith('#') ? all : '';
    })
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
}
