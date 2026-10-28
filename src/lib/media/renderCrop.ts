"use client";

/**
 * Renders a crop (src/lib/media/imageCrop.ts) to an upload-ready File in the
 * browser: draws straight from the decoded original, downscales in ≤2× steps
 * with high-quality smoothing, keeps transparency, and encodes WebP (or PNG
 * first for small art, and wherever the browser can't encode WebP).
 */

import {
  cropRect,
  croppedFileName,
  downscalePasses,
  outputSize,
  rotatedSize,
  type CropFrame,
  type CropGeometry,
  type CropPreset,
  type CropView,
} from "@/lib/media/imageCrop";

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/** Draw the crop of `image` into a canvas of exactly `width`×`height`. */
export function drawCrop(image: CanvasImageSource, geom: CropGeometry, view: CropView, frame: CropFrame): HTMLCanvasElement {
  const crop = cropRect(view, geom);
  const out = outputSize(crop, frame);
  const passes = downscalePasses(crop.width, out);
  let w = out.width * 2 ** passes;
  let h = out.height * 2 ** passes;

  let current = canvas(w, h);
  const ctx = ctx2d(current);
  const r = rotatedSize(geom.width, geom.height, view.rotation);
  ctx.scale(w / crop.width, h / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(r.width / 2, r.height / 2);
  ctx.rotate((view.rotation * Math.PI) / 180);
  ctx.drawImage(image, -geom.width / 2, -geom.height / 2, geom.width, geom.height);

  for (let i = 0; i < passes; i++) {
    w = Math.max(out.width, Math.round(w / 2));
    h = Math.max(out.height, Math.round(h / 2));
    const next = canvas(w, h);
    ctx2d(next).drawImage(current, 0, 0, w, h);
    current.width = 0; // free the larger buffer early (iOS keeps canvases around)
    current = next;
  }
  return current;
}

/**
 * Encode under `preset.maxBytes` when possible: PNG first for small art,
 * then WebP at falling quality. Falls back to PNG when the browser silently
 * returns PNG for a WebP request (older Safari).
 */
export async function encodeCanvas(c: HTMLCanvasElement, preset: CropPreset): Promise<Blob> {
  let smallest: Blob | null = null;
  const keep = (b: Blob | null) => {
    if (b && (!smallest || b.size < smallest.size)) smallest = b;
    return b;
  };
  if (preset.lossless) {
    const png = keep(await toBlob(c, "image/png"));
    if (png && png.size <= preset.maxBytes) return png;
  }
  for (const quality of [0.92, 0.85, 0.75, 0.6]) {
    const webp = keep(await toBlob(c, "image/webp", quality));
    if (!webp) break;
    if (webp.type !== "image/webp") return webp; // no WebP encoder: this is a PNG
    if (webp.size <= preset.maxBytes) return webp;
  }
  if (smallest) return smallest;
  const png = await toBlob(c, "image/png");
  if (!png) throw new Error("Could not encode the image");
  return png;
}

export async function renderCropToFile(
  image: CanvasImageSource,
  geom: CropGeometry,
  view: CropView,
  frame: CropFrame,
  preset: CropPreset,
  originalName: string,
): Promise<File> {
  const c = drawCrop(image, geom, view, frame);
  const blob = await encodeCanvas(c, preset);
  c.width = 0;
  return new File([blob], croppedFileName(originalName, blob.type), { type: blob.type, lastModified: Date.now() });
}
