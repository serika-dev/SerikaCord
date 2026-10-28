/**
 * Image crop presets and the pure math behind the shared crop dialog
 * (src/components/media/ImageCropDialog.tsx, opened by useImageCropper).
 *
 * Every image upload field names a preset: the shape it is rendered in, the
 * aspect ratio of the box that shows it and the resolution worth storing.
 * `decideCrop` picks what happens to a picked file: upload it untouched,
 * scale it down without asking, or open the cropper. Geometry works in
 * "rotated image pixels" (the image after the chosen 90° rotation), so the
 * crop never depends on how big the dialog happens to be on screen.
 *
 * No DOM here; covered by tests/image-crop.test.ts.
 */

export type CropShape = "circle" | "rounded" | "rect";
export type CropRotation = 0 | 90 | 180 | 270;

/** One allowed output: aspect ratio (width / height) and the stored size. */
export interface CropFrame {
  ratio: number;
  width: number;
  height: number;
}

export type CropPresetId =
  | "avatar"
  | "profileBanner"
  | "serverIcon"
  | "serverBanner"
  | "groupIcon"
  | "appIcon"
  | "appCover"
  | "nameplate"
  | "background"
  | "eventCover"
  | "emoji"
  | "roleIcon"
  | "sticker";

export interface CropPreset {
  id: CropPresetId;
  /** First entry is the default; more than one lets the user switch (background). */
  frames: CropFrame[];
  /** How the image is masked where it is shown (preview only; output stays rectangular). */
  shape: CropShape;
  /** Allow zooming out past "fill" so the whole image fits, with transparent edges. */
  allowFit: boolean;
  /** Open zoomed out to fit (emoji, stickers: art usually must not lose its edges). */
  startFit: boolean;
  /** The field stores animated GIF / APNG / WebP as-is, so animation must survive. */
  keepsAnimation: boolean;
  /** Small art: try lossless PNG first, lossy WebP only if PNG is over `maxBytes`. */
  lossless: boolean;
  /** Upload limit the client enforces for this field. */
  maxBytes: number;
  /** Types the endpoint accepts as-is; anything else is converted when it can be decoded. */
  types: readonly string[];
}

const RASTER_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const MB = 1024 * 1024;

function frame(width: number, height: number): CropFrame {
  return { ratio: width / height, width, height };
}

/**
 * Sizes are about twice the largest box each image is drawn in, so they stay
 * sharp on high-DPI screens:
 * - avatars, icons: 1:1, at most ~120 px on screen (full profile)
 * - profile banner: 340×120 profile card / 360×140 full profile → 17:6 (680×240 ×2)
 * - server banner: 240×120 channel sidebar header → 2:1
 * - nameplate: member row ~224×44, sidebar user panel 240×52 → 5:1
 * - event cover: h-32 / h-40 strip across a ~480 px dialog → 3:1
 * - app directory cover: aspect-[3/1] in the portal and on /bots/[appId]
 * - app background: full window, landscape or portrait
 * - emoji 1:1 (jumbo 48 px ×3 DPR), role icon 1:1 (≤32 px), sticker 1:1 (160 px ×2)
 */
export const CROP_PRESETS: Record<CropPresetId, CropPreset> = {
  avatar: {
    id: "avatar", frames: [frame(1024, 1024)], shape: "circle", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 5 * MB, types: RASTER_TYPES,
  },
  profileBanner: {
    id: "profileBanner", frames: [frame(1360, 480)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  serverIcon: {
    id: "serverIcon", frames: [frame(1024, 1024)], shape: "circle", allowFit: true, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 5 * MB, types: RASTER_TYPES,
  },
  serverBanner: {
    id: "serverBanner", frames: [frame(1920, 960)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  groupIcon: {
    id: "groupIcon", frames: [frame(512, 512)], shape: "circle", allowFit: true, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 5 * MB, types: RASTER_TYPES,
  },
  appIcon: {
    id: "appIcon", frames: [frame(1024, 1024)], shape: "rounded", allowFit: true, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 5 * MB, types: RASTER_TYPES,
  },
  appCover: {
    id: "appCover", frames: [frame(1500, 500)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  nameplate: {
    id: "nameplate", frames: [frame(1000, 200)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  background: {
    id: "background", frames: [frame(2560, 1440), frame(1440, 2560)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  eventCover: {
    id: "eventCover", frames: [frame(1200, 400)], shape: "rect", allowFit: false, startFit: false,
    keepsAnimation: true, lossless: false, maxBytes: 10 * MB, types: RASTER_TYPES,
  },
  emoji: {
    id: "emoji", frames: [frame(256, 256)], shape: "rect", allowFit: true, startFit: true,
    keepsAnimation: true, lossless: true, maxBytes: 256 * 1024, types: RASTER_TYPES,
  },
  roleIcon: {
    id: "roleIcon", frames: [frame(128, 128)], shape: "rect", allowFit: true, startFit: true,
    keepsAnimation: true, lossless: true, maxBytes: 256 * 1024, types: RASTER_TYPES,
  },
  sticker: {
    id: "sticker", frames: [frame(320, 320)], shape: "rect", allowFit: true, startFit: true,
    keepsAnimation: true, lossless: true, maxBytes: 512 * 1024, types: ["image/png", "image/apng", "image/gif", "image/webp"],
  },
};

/** Aspect ratios within ~2% count as "already the right shape". */
export const ASPECT_TOLERANCE = 0.02;
/** A right-shaped static image more than this many times the stored size is scaled down. */
export const OVERSIZE_FACTOR = 4;
export const MAX_ZOOM = 10;

export function aspectMatches(width: number, height: number, ratio: number, tolerance = ASPECT_TOLERANCE): boolean {
  if (!(width > 0 && height > 0 && ratio > 0)) return false;
  return Math.abs(Math.log(width / height / ratio)) <= tolerance;
}

/** The preset frame whose ratio is closest to the image's. */
export function closestFrame(width: number, height: number, frames: CropFrame[]): CropFrame {
  const r = width > 0 && height > 0 ? width / height : 1;
  let best = frames[0];
  for (const f of frames) {
    if (Math.abs(Math.log(r / f.ratio)) < Math.abs(Math.log(r / best.ratio))) best = f;
  }
  return best;
}

export interface ImageFacts {
  width: number;
  height: number;
  type: string;
  size: number;
  animated: boolean;
}

export type CropDecision =
  | { kind: "upload" }
  | { kind: "resize"; frame: CropFrame }
  | { kind: "crop"; frame: CropFrame; animated: boolean };

/**
 * What to do with a picked image:
 * - right shape and fine as-is → upload the original file untouched
 * - right shape but a static image that is too big, far larger than needed
 *   or in a type the endpoint rejects → scale it down silently
 * - wrong shape → open the cropper (animated images get "upload without
 *   cropping" there, so animation is never flattened without asking)
 * - not decodable → upload as-is and let the server validate
 */
export function decideCrop(img: ImageFacts, preset: CropPreset): CropDecision {
  if (!(img.width > 0 && img.height > 0)) return { kind: "upload" };
  const animated = img.animated && preset.keepsAnimation;
  const match = preset.frames.find((f) => aspectMatches(img.width, img.height, f.ratio));
  if (!match) return { kind: "crop", frame: closestFrame(img.width, img.height, preset.frames), animated };
  if (animated) return { kind: "upload" };
  const unsupported = !preset.types.includes(img.type);
  const tooBig = img.size > preset.maxBytes;
  const oversized = Math.max(img.width / match.width, img.height / match.height) > OVERSIZE_FACTOR;
  return unsupported || tooBig || oversized ? { kind: "resize", frame: match } : { kind: "upload" };
}

// ── Geometry ────────────────────────────────────────────────────────────────

export interface CropView {
  /** 1 = the frame is exactly filled ("cover"); below 1 only when fitting is allowed. */
  zoom: number;
  /** Crop centre in rotated image pixels. */
  cx: number;
  cy: number;
  rotation: CropRotation;
}

export interface CropGeometry {
  /** Natural (unrotated) image size. */
  width: number;
  height: number;
  ratio: number;
  allowFit: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rotatedSize(width: number, height: number, rotation: CropRotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/** Crop size at zoom 1: the largest box of `ratio` that fits inside the image. */
export function coverCropSize(rw: number, rh: number, ratio: number): { width: number; height: number } {
  const width = Math.min(rw, ratio * rh);
  return { width, height: width / ratio };
}

export function minZoomFor(geom: CropGeometry, rotation: CropRotation): number {
  if (!geom.allowFit) return 1;
  const r = rotatedSize(geom.width, geom.height, rotation);
  const cover = coverCropSize(r.width, r.height, geom.ratio);
  // Zoomed out until the crop contains the whole image.
  return Math.min(1, cover.width / r.width, cover.height / r.height);
}

export function clampZoom(zoom: number, geom: CropGeometry, rotation: CropRotation): number {
  const min = minZoomFor(geom, rotation);
  if (!Number.isFinite(zoom)) return min;
  return Math.min(MAX_ZOOM, Math.max(min, zoom));
}

/** Clamp zoom, then keep the crop inside the image (centred on an axis where it is larger). */
export function clampView(view: CropView, geom: CropGeometry): CropView {
  const zoom = clampZoom(view.zoom, geom, view.rotation);
  const r = rotatedSize(geom.width, geom.height, view.rotation);
  const cover = coverCropSize(r.width, r.height, geom.ratio);
  const w = cover.width / zoom;
  const h = cover.height / zoom;
  const axis = (c: number, size: number, extent: number) =>
    size >= extent ? extent / 2 : Math.min(extent - size / 2, Math.max(size / 2, Number.isFinite(c) ? c : extent / 2));
  return { zoom, rotation: view.rotation, cx: axis(view.cx, w, r.width), cy: axis(view.cy, h, r.height) };
}

export function initialView(geom: CropGeometry, startFit: boolean, rotation: CropRotation = 0): CropView {
  const r = rotatedSize(geom.width, geom.height, rotation);
  return clampView({ zoom: startFit ? minZoomFor(geom, rotation) : 1, cx: r.width / 2, cy: r.height / 2, rotation }, geom);
}

/** The crop in rotated image pixels. May reach past the image when zoomed out to fit. */
export function cropRect(view: CropView, geom: CropGeometry): Rect {
  const r = rotatedSize(geom.width, geom.height, view.rotation);
  const cover = coverCropSize(r.width, r.height, geom.ratio);
  const width = cover.width / view.zoom;
  const height = cover.height / view.zoom;
  return { x: view.cx - width / 2, y: view.cy - height / 2, width, height };
}

/** Screen pixels per rotated image pixel for a frame `frameWidth` px wide. */
export function screenScale(view: CropView, geom: CropGeometry, frameWidth: number): number {
  return frameWidth / cropRect(view, geom).width;
}

/** Drag by (dx, dy) screen pixels: the image follows the pointer. */
export function panBy(view: CropView, dx: number, dy: number, geom: CropGeometry, frameWidth: number): CropView {
  const s = screenScale(view, geom, frameWidth);
  if (!(s > 0)) return view;
  return clampView({ ...view, cx: view.cx - dx / s, cy: view.cy - dy / s }, geom);
}

/**
 * Zoom so the image point under (px, py) — screen pixels from the frame
 * centre — stays under it (wheel at cursor, pinch midpoint).
 */
export function zoomAt(view: CropView, zoom: number, px: number, py: number, geom: CropGeometry, frameWidth: number): CropView {
  const s0 = screenScale(view, geom, frameWidth);
  const next = clampZoom(zoom, geom, view.rotation);
  if (!(s0 > 0)) return clampView({ ...view, zoom: next }, geom);
  const s1 = s0 * (next / view.zoom);
  const ix = view.cx + px / s0;
  const iy = view.cy + py / s0;
  return clampView({ ...view, zoom: next, cx: ix - px / s1, cy: iy - py / s1 }, geom);
}

/** Rotate a quarter turn (dir 1 = clockwise), keeping the same image point centred. */
export function rotateView(view: CropView, dir: 1 | -1, geom: CropGeometry): CropView {
  const before = rotatedSize(geom.width, geom.height, view.rotation);
  const rotation = (((view.rotation + dir * 90) % 360) + 360) % 360 as CropRotation;
  // Clockwise maps (x, y) → (H - y, x); counter-clockwise maps (x, y) → (y, W - x).
  const cx = dir === 1 ? before.height - view.cy : view.cy;
  const cy = dir === 1 ? view.cx : before.width - view.cx;
  return clampView({ zoom: Math.max(view.zoom, minZoomFor(geom, rotation)), cx, cy, rotation }, geom);
}

/**
 * Stored size: the preset size, or the crop's own pixel size when the source
 * is smaller (never upscale; the CDN scales on the way out).
 */
export function outputSize(crop: { width: number; height: number }, target: CropFrame): { width: number; height: number } {
  if (crop.width >= target.width) return { width: target.width, height: target.height };
  const k = crop.width / target.width;
  return {
    width: Math.max(1, Math.round(target.width * k)),
    height: Math.max(1, Math.round(target.height * k)),
  };
}

/** Largest canvas the first render pass may use (iOS Safari's limit is ~16.7M px). */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Halving passes for a high-quality downscale: the first pass renders at
 * `out × 2^passes` (never above the crop's own size or the canvas limit),
 * each later pass halves, so no single step shrinks more than 2×.
 */
export function downscalePasses(cropWidth: number, out: { width: number; height: number }): number {
  if (!(cropWidth > out.width) || out.width <= 0) return 0;
  let passes = Math.max(0, Math.floor(Math.log2(cropWidth / out.width)));
  while (passes > 0 && out.width * out.height * 4 ** passes > MAX_CANVAS_PIXELS) passes--;
  return passes;
}

// ── Animation sniffing ──────────────────────────────────────────────────────

function ascii(bytes: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i]);
  return s;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

/** GIF with more than one image block. */
function gifIsAnimated(b: Uint8Array): boolean {
  if (b.length < 13) return false;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1));
  let frames = 0;
  const skipSubBlocks = () => {
    while (i < b.length) {
      const len = b[i++];
      if (len === 0) return;
      i += len;
    }
  };
  while (i < b.length) {
    const block = b[i++];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      i++; // extension label
      skipSubBlocks();
    } else if (block === 0x2c) {
      if (++frames > 1) return true;
      if (i + 9 > b.length) break;
      const packed = b[i + 8];
      i += 9;
      if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));
      i++; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return false;
}

/** APNG: an acTL chunk with more than one frame before the first IDAT. */
function pngIsAnimated(b: Uint8Array): boolean {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (type === "acTL") return i + 12 <= b.length && u32be(b, i + 8) > 1;
    if (type === "IDAT" || type === "IEND") return false;
    i += 12 + len;
  }
  return false;
}

/** Extended WebP (VP8X) with the animation flag, or an ANIM chunk. */
function webpIsAnimated(b: Uint8Array): boolean {
  if (ascii(b, 12, 4) === "VP8X" && b.length > 20) return (b[20] & 0x02) !== 0;
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    if (type === "ANIM" || type === "ANMF") return true;
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    i += 8 + len + (len & 1);
  }
  return false;
}

/** Sniff the file's bytes (not its declared type) for animation. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 3) === "GIF") return gifIsAnimated(bytes);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return pngIsAnimated(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webpIsAnimated(bytes);
  return false;
}

/** `photo.JPG` + "image/webp" → `photo.webp`. */
export function croppedFileName(original: string, type: string): string {
  const ext = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  const base = original.replace(/\.[^./\\]+$/, "").trim() || "image";
  return `${base}.${ext}`;
}
