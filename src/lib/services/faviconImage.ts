// Favicon bytes → a small PNG (sharp). Kept apart from services/favicons.ts
// (Redis / Postgres) so it can be unit tested. SVG is sanitised and stripped
// of external references before rasterising and is never served as SVG.
import { sanitizeSvg } from '@/lib/security/svgSanitizer';
import {
  FAVICON_MIN_SIZE,
  FAVICON_OUTPUT_SIZE,
  decodeIco,
  sniffImageType,
  stripSvgExternalRefs,
} from '@/lib/connections/favicon';

/** Any supported icon format → a ≤64px PNG with metadata stripped. Null when it isn't a usable image. */
export async function toFaviconPng(input: Buffer): Promise<Buffer | null> {
  const { default: sharp } = await import('sharp');
  const kind = sniffImageType(input);
  if (!kind) return null;
  const opts = { failOn: 'none' as const, limitInputPixels: 2048 * 2048, pages: 1 };
  let img: ReturnType<typeof sharp>;
  if (kind === 'ico') {
    const decoded = decodeIco(input);
    if (!decoded) return null;
    img = decoded.kind === 'png'
      ? sharp(Buffer.from(decoded.data), opts)
      : sharp(Buffer.from(decoded.data), { ...opts, raw: { width: decoded.width, height: decoded.height, channels: 4 } });
  } else if (kind === 'svg') {
    const cleaned = stripSvgExternalRefs(sanitizeSvg(input.toString('utf8')));
    img = sharp(Buffer.from(cleaned, 'utf8'), { ...opts, density: 192 });
  } else if (kind === 'bmp') {
    return null; // libvips can't read BMP without ImageMagick
  } else {
    img = sharp(input, opts);
  }
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.width < FAVICON_MIN_SIZE || meta.height < FAVICON_MIN_SIZE) return null;
  return img
    .resize(FAVICON_OUTPUT_SIZE, FAVICON_OUTPUT_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
