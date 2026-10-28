import { describe, expect, test } from "bun:test";
import {
  CROP_PRESETS,
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  aspectMatches,
  clampView,
  closestFrame,
  coverCropSize,
  cropRect,
  croppedFileName,
  decideCrop,
  downscalePasses,
  initialView,
  isAnimatedImage,
  minZoomFor,
  outputSize,
  panBy,
  rotateView,
  zoomAt,
  type CropGeometry,
  type ImageFacts,
} from "@/lib/media/imageCrop";

const facts = (width: number, height: number, extra: Partial<ImageFacts> = {}): ImageFacts => ({
  width, height, type: "image/png", size: 200 * 1024, animated: false, ...extra,
});

describe("aspect detection", () => {
  test("matches within the tolerance only", () => {
    expect(aspectMatches(1000, 1000, 1)).toBe(true);
    expect(aspectMatches(1010, 1000, 1)).toBe(true);
    expect(aspectMatches(1100, 1000, 1)).toBe(false);
    expect(aspectMatches(1360, 480, 1360 / 480)).toBe(true);
    expect(aspectMatches(0, 10, 1)).toBe(false);
  });

  test("closest frame picks landscape or portrait backgrounds", () => {
    const frames = CROP_PRESETS.background.frames;
    expect(closestFrame(1920, 1080, frames).ratio).toBeGreaterThan(1);
    expect(closestFrame(1080, 2400, frames).ratio).toBeLessThan(1);
  });
});

describe("decideCrop", () => {
  test("right-shaped images upload untouched", () => {
    expect(decideCrop(facts(512, 512), CROP_PRESETS.avatar)).toEqual({ kind: "upload" });
    expect(decideCrop(facts(1000, 200), CROP_PRESETS.nameplate)).toEqual({ kind: "upload" });
  });

  test("wrong shape opens the cropper on the closest frame", () => {
    const d = decideCrop(facts(1600, 900), CROP_PRESETS.avatar);
    expect(d.kind).toBe("crop");
    const bg = decideCrop(facts(1000, 1000), CROP_PRESETS.background);
    expect(bg.kind).toBe("crop");
  });

  test("animated images keep their animation when already right-shaped", () => {
    expect(decideCrop(facts(480, 480, { type: "image/gif", animated: true, size: 20 * 1024 * 1024 }), CROP_PRESETS.avatar)).toEqual({ kind: "upload" });
    const d = decideCrop(facts(800, 450, { type: "image/gif", animated: true }), CROP_PRESETS.avatar);
    expect(d).toMatchObject({ kind: "crop", animated: true });
  });

  test("static images that are too big, far too large or in an unsupported type are scaled down", () => {
    expect(decideCrop(facts(512, 512, { size: 6 * 1024 * 1024 }), CROP_PRESETS.avatar).kind).toBe("resize");
    expect(decideCrop(facts(6000, 6000), CROP_PRESETS.avatar).kind).toBe("resize");
    expect(decideCrop(facts(512, 512, { type: "image/avif" }), CROP_PRESETS.avatar).kind).toBe("resize");
    expect(decideCrop(facts(320, 320, { type: "image/jpeg" }), CROP_PRESETS.sticker).kind).toBe("resize");
  });

  test("undecodable files are left to the server", () => {
    expect(decideCrop(facts(0, 0), CROP_PRESETS.avatar)).toEqual({ kind: "upload" });
  });
});

describe("crop geometry", () => {
  const wide: CropGeometry = { width: 2000, height: 1000, ratio: 1, allowFit: false };

  test("zoom 1 fills the frame with the largest centred crop", () => {
    const v = initialView(wide, false);
    expect(cropRect(v, wide)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(coverCropSize(2000, 1000, 17 / 6).height).toBeCloseTo(2000 / (17 / 6));
  });

  test("the crop never leaves the image", () => {
    const v = clampView({ zoom: 1, cx: -50, cy: 9999, rotation: 0 }, wide);
    const r = cropRect(v, wide);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    const panned = panBy(initialView(wide, false), -10_000, 0, wide, 300);
    expect(cropRect(panned, wide).x + cropRect(panned, wide).width).toBeCloseTo(2000);
  });

  test("zoom is clamped; fitting is only allowed where the field supports it", () => {
    expect(clampView({ zoom: 0.2, cx: 1000, cy: 500, rotation: 0 }, wide).zoom).toBe(1);
    expect(clampView({ zoom: 99, cx: 1000, cy: 500, rotation: 0 }, wide).zoom).toBe(MAX_ZOOM);
    const fitGeom = { ...wide, allowFit: true };
    expect(minZoomFor(fitGeom, 0)).toBeCloseTo(0.5);
    const fitted = initialView(fitGeom, true);
    expect(cropRect(fitted, fitGeom)).toEqual({ x: 0, y: -500, width: 2000, height: 2000 });
  });

  test("zoomAt keeps the point under the cursor still", () => {
    const v = initialView(wide, false);
    const frameWidth = 400;
    const s0 = frameWidth / cropRect(v, wide).width;
    const imagePoint = { x: v.cx + 100 / s0, y: v.cy + 50 / s0 };
    const z = zoomAt(v, 2, 100, 50, wide, frameWidth);
    const s1 = frameWidth / cropRect(z, wide).width;
    expect(z.cx + 100 / s1).toBeCloseTo(imagePoint.x);
    expect(z.cy + 50 / s1).toBeCloseTo(imagePoint.y);
  });

  test("rotation swaps the axes and four quarter turns return home", () => {
    const g: CropGeometry = { width: 2000, height: 1000, ratio: 2, allowFit: false };
    const start = clampView({ zoom: 2, cx: 700, cy: 400, rotation: 0 }, g);
    const once = rotateView(start, 1, g);
    expect(once.rotation).toBe(90);
    expect(cropRect(once, g).width).toBeLessThanOrEqual(1000);
    const back = rotateView(rotateView(rotateView(once, 1, g), 1, g), 1, g);
    expect(back.rotation).toBe(0);
    const ccw = rotateView(once, -1, g);
    expect(ccw.rotation).toBe(0);
    expect(ccw.cx).toBeCloseTo(start.cx);
    expect(ccw.cy).toBeCloseTo(start.cy);
  });
});

describe("output size", () => {
  test("uses the preset size, never upscales", () => {
    const frame = CROP_PRESETS.avatar.frames[0];
    expect(outputSize({ width: 3000, height: 3000 }, frame)).toEqual({ width: 1024, height: 1024 });
    expect(outputSize({ width: 300, height: 300 }, frame)).toEqual({ width: 300, height: 300 });
    const banner = CROP_PRESETS.profileBanner.frames[0];
    expect(outputSize({ width: 680, height: 240 }, banner)).toEqual({ width: 680, height: 240 });
  });

  test("downscale passes halve at most 2× per step and respect the canvas limit", () => {
    expect(downscalePasses(1024, { width: 1024, height: 1024 })).toBe(0);
    expect(downscalePasses(2048, { width: 512, height: 512 })).toBe(2);
    expect(downscalePasses(4096, { width: 1024, height: 1024 })).toBe(1); // 4096² first pass is over the canvas limit
    expect(downscalePasses(1500, { width: 1024, height: 1024 })).toBe(0);
    const p = downscalePasses(20000, { width: 2560, height: 1440 });
    expect(2560 * 1440 * 4 ** p).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  test("cropped file names follow the encoded type", () => {
    expect(croppedFileName("My Photo.JPG", "image/webp")).toBe("My Photo.webp");
    expect(croppedFileName("emoji.gif", "image/png")).toBe("emoji.png");
    expect(croppedFileName("", "image/webp")).toBe("image.webp");
  });
});

describe("animation sniffing", () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0];

  test("GIF: one frame is still (even with a NETSCAPE loop block), two frames animate", () => {
    const header = bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0]);
    const netscape = bytes([0x21, 0xff, 0x0b], "NETSCAPE2.0", [3, 1, 0, 0, 0]);
    const still = new Uint8Array([...header, ...netscape, ...gifFrame, 0x3b]);
    const anim = new Uint8Array([...header, ...netscape, ...gifFrame, ...gifFrame, 0x3b]);
    expect(isAnimatedImage(still)).toBe(false);
    expect(isAnimatedImage(anim)).toBe(true);
  });

  test("PNG: acTL with several frames before IDAT means APNG", () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = [...be32(13), ...bytes("IHDR"), ...new Array(13).fill(0), 0, 0, 0, 0];
    const actl = (frames: number) => [...be32(8), ...bytes("acTL"), ...be32(frames), ...be32(0), 0, 0, 0, 0];
    const idat = [...be32(0), ...bytes("IDAT"), 0, 0, 0, 0];
    expect(isAnimatedImage(new Uint8Array([...sig, ...ihdr, ...idat]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array([...sig, ...ihdr, ...actl(4), ...idat]))).toBe(true);
    expect(isAnimatedImage(new Uint8Array([...sig, ...ihdr, ...actl(1), ...idat]))).toBe(false);
  });

  test("WebP: the VP8X animation flag", () => {
    const vp8x = (flags: number) => bytes("RIFF", le32(30), "WEBP", "VP8X", le32(10), [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isAnimatedImage(vp8x(0x02))).toBe(true);
    expect(isAnimatedImage(vp8x(0x10))).toBe(false);
    expect(isAnimatedImage(bytes("RIFF", le32(4), "WEBP", "VP8 ", le32(0)))).toBe(false);
  });

  test("other formats are still", () => {
    expect(isAnimatedImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array())).toBe(false);
  });
});
