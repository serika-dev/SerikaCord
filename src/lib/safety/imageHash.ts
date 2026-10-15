// Perceptual image hashing for the staff-managed scam image list (not CSAM:
// that is PhotoDNA). A 64-bit difference hash (dHash) survives re-encoding,
// resizing and small edits; two images match when their hashes differ in at
// most a few bits. Pure: the caller decodes the image to 9x8 grayscale.

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
/** Default max differing bits (of 64) for a scam-image match. */
export const DEFAULT_MATCH_DISTANCE = 6;
export const MAX_MATCH_DISTANCE = 16;

/**
 * dHash from 9x8 grayscale pixels (row-major, 72 values): each bit says
 * whether a pixel is brighter than its right neighbour. Returns 16 hex chars.
 */
export function dHashFromGrayscale(pixels: ArrayLike<number>): string {
  if (pixels.length < DHASH_WIDTH * DHASH_HEIGHT) throw new Error('dHash needs 9x8 pixels');
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const left = pixels[y * DHASH_WIDTH + x];
      const right = pixels[y * DHASH_WIDTH + x + 1];
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bits++;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

const HEX_RE = /^[0-9a-f]{16}$/;

export function normalizeHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().toLowerCase().replace(/^0x/, '');
  return HEX_RE.test(h) ? h : null;
}

const POPCOUNT = Array.from({ length: 16 }, (_, i) => ((i >> 3) & 1) + ((i >> 2) & 1) + ((i >> 1) & 1) + (i & 1));

/** Number of differing bits between two 16-hex-char hashes (64 when invalid). */
export function hammingDistance(a: string, b: string): number {
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** The closest listed hash within `maxDistance`, or null. */
export function findClosestHash<T extends { hash: string }>(hash: string, list: readonly T[], maxDistance = DEFAULT_MATCH_DISTANCE): { entry: T; distance: number } | null {
  let best: { entry: T; distance: number } | null = null;
  for (const entry of list) {
    const distance = hammingDistance(hash, entry.hash);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { entry, distance };
  }
  return best;
}

/** Images the scanners look at (PhotoDNA + scam hashes). */
export function isScannableImage(contentType: string | null | undefined): boolean {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  return ct.startsWith('image/') && ct !== 'image/svg+xml';
}

/**
 * Image type from the file's magic bytes (so an image renamed to .bin or sent
 * as application/octet-stream is still scanned), or null.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'image/tiff';
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /^(avif|avis|heic|heix|mif1|msf1)$/.test(ascii(8, 12))) return ascii(8, 12).startsWith('avi') ? 'image/avif' : 'image/heic';
  return null;
}
