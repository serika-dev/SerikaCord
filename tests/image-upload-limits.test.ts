import { describe, expect, test } from "bun:test";
import {
  ANIMATED_BANNER_MAX_BYTES,
  EXPRESSION_IMAGE_MAX_BYTES,
  bannerMaxBytes,
  checkImageUploadFor,
  imageTooLargeMessageFor,
  imageUploadCeiling,
  imageUploadMaxBytes,
  readImageUploadFor,
} from "@/lib/media/imageUploadLimits";

const MB = 1024 * 1024;
const cfg = { avatarMax: 5 * MB, bannerMax: 10 * MB };

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const GIF_HEAD = [...Buffer.from("GIF89a", "latin1")];
const WEBP_HEAD = [...Buffer.from("RIFF\x24\x00\x00\x00WEBP", "latin1")];

/** A buffer of `size` bytes starting with `head` (only the magic bytes matter). */
function file(head: number[], size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
}

describe("imageUploadMaxBytes", () => {
  test("banners: GIFs get the animated cap, other types the configured banner size", () => {
    expect(imageUploadMaxBytes("banner", "image/gif", cfg)).toBe(ANIMATED_BANNER_MAX_BYTES);
    expect(ANIMATED_BANNER_MAX_BYTES).toBe(50 * MB);
    for (const t of ["image/png", "image/jpeg", "image/webp"]) expect(imageUploadMaxBytes("banner", t, cfg)).toBe(10 * MB);
  });

  test("a configured banner size above 50MB is never lowered for GIFs", () => {
    expect(bannerMaxBytes("image/gif", 80 * MB)).toBe(80 * MB);
    expect(bannerMaxBytes("image/png", 80 * MB)).toBe(80 * MB);
  });

  test("avatars / icons, appearance images and expressions", () => {
    expect(imageUploadMaxBytes("avatar", "image/gif", cfg)).toBe(5 * MB);
    expect(imageUploadMaxBytes("appearance", "image/gif", cfg)).toBe(10 * MB);
    expect(imageUploadMaxBytes("emoji", "image/png", cfg)).toBe(EXPRESSION_IMAGE_MAX_BYTES);
    expect(imageUploadMaxBytes("sticker", "image/gif", cfg)).toBe(20 * MB);
  });

  test("the ceiling is the largest per-type limit", () => {
    expect(imageUploadCeiling("banner", cfg)).toBe(50 * MB);
    expect(imageUploadCeiling("avatar", cfg)).toBe(5 * MB);
    expect(imageUploadCeiling("sticker", cfg)).toBe(20 * MB);
  });
});

describe("checkImageUploadFor", () => {
  test("type comes from the bytes and picks a matching extension", () => {
    expect(checkImageUploadFor(file(PNG_HEAD, 64), "avatar", cfg)).toEqual({ ok: true, contentType: "image/png", ext: "png" });
    expect(checkImageUploadFor(file(JPEG_HEAD, 64), "banner", cfg)).toEqual({ ok: true, contentType: "image/jpeg", ext: "jpg" });
    expect(checkImageUploadFor(file(GIF_HEAD, 64), "banner", cfg)).toEqual({ ok: true, contentType: "image/gif", ext: "gif" });
    expect(checkImageUploadFor(file(WEBP_HEAD, 64), "emoji", cfg)).toEqual({ ok: true, contentType: "image/webp", ext: "webp" });
  });

  test("a GIF banner between 10MB and 50MB is accepted", () => {
    const r = checkImageUploadFor(file(GIF_HEAD, 30 * MB), "banner", cfg);
    expect(r.ok && r.contentType).toBe("image/gif");
  });

  test("a still banner over 10MB is a 413 that mentions the GIF limit", () => {
    const r = checkImageUploadFor(file(PNG_HEAD, 11 * MB), "banner", cfg);
    expect(r).toEqual({ ok: false, status: 413, message: "File too large. Maximum size is 10MB (50MB for animated GIFs)." });
  });

  test("a GIF banner over 50MB is a 413", () => {
    const r = checkImageUploadFor(file(GIF_HEAD, 50 * MB + 1), "banner", cfg);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(413);
  });

  test("a GIF avatar gets no animated-banner allowance", () => {
    const r = checkImageUploadFor(file(GIF_HEAD, 6 * MB), "avatar", cfg);
    expect(r).toEqual({ ok: false, status: 413, message: "File too large. Maximum size is 5MB." });
  });

  test("spoofed non-images (HTML / SVG sent as image/png) are a 400", () => {
    for (const body of ["<!doctype html><script>alert(1)</script>", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']) {
      const r = checkImageUploadFor(Buffer.from(body), "banner", cfg);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.status).toBe(400);
      expect(!r.ok && r.message).toContain("Invalid file type");
    }
  });

  test("an empty file is a 400", () => {
    expect(checkImageUploadFor(new Uint8Array(0), "avatar", cfg)).toEqual({ ok: false, status: 400, message: "No file provided" });
  });

  test("stickers refuse JPEG but take PNG (incl. APNG), GIF and WebP", () => {
    const jpeg = checkImageUploadFor(file(JPEG_HEAD, 64), "sticker", cfg);
    expect(jpeg.ok).toBe(false);
    expect(!jpeg.ok && jpeg.status).toBe(400);
    for (const head of [PNG_HEAD, GIF_HEAD, WEBP_HEAD]) expect(checkImageUploadFor(file(head, 64), "sticker", cfg).ok).toBe(true);
  });
});

describe("imageTooLargeMessageFor", () => {
  test("banner message names both limits unless they are equal", () => {
    expect(imageTooLargeMessageFor("banner", cfg)).toBe("File too large. Maximum size is 10MB (50MB for animated GIFs).");
    expect(imageTooLargeMessageFor("banner", cfg, "image/gif")).toBe("File too large. Maximum size is 50MB.");
    expect(imageTooLargeMessageFor("banner", { avatarMax: 5 * MB, bannerMax: 60 * MB })).toBe("File too large. Maximum size is 60MB.");
    expect(imageTooLargeMessageFor("avatar", cfg)).toBe("File too large. Maximum size is 5MB.");
  });
});

describe("cover kind (scheduled event covers)", () => {
  test("the banner size for every type, GIFs included (storage's event-covers limit)", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) expect(imageUploadMaxBytes("cover", t, cfg)).toBe(10 * MB);
    expect(imageUploadCeiling("cover", cfg)).toBe(10 * MB);
    const r = checkImageUploadFor(file(GIF_HEAD, 11 * MB), "cover", cfg);
    expect(r).toEqual({ ok: false, status: 413, message: "File too large. Maximum size is 10MB." });
  });
});

describe("readImageUploadFor", () => {
  /** A multipart file whose declared type / name are lies; only the bytes count. */
  function upload(bytes: Uint8Array, declared = "image/png", name = "evil.png") {
    let read = false;
    const f = new File([new Uint8Array(bytes)], name, { type: declared });
    return {
      size: f.size,
      arrayBuffer: () => { read = true; return f.arrayBuffer(); },
      get wasRead() { return read; },
    };
  }

  test("returns the bytes with the sniffed type, ignoring the declared type and name", async () => {
    const r = await readImageUploadFor(upload(file(GIF_HEAD, 64), "image/png", "icon.png"), "avatar", cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("image/gif");
      expect(r.ext).toBe("gif");
      expect(r.data.length).toBe(64);
    }
  });

  test("an SVG or HTML file declared as image/png is a 400", async () => {
    const svg = await readImageUploadFor(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), "avatar", cfg);
    expect(svg.ok).toBe(false);
    expect(!svg.ok && svg.status).toBe(400);
  });

  test("a file over the ceiling is a 413 without reading its bytes", async () => {
    const f = upload(file(PNG_HEAD, 5 * MB + 1));
    const r = await readImageUploadFor(f, "avatar", cfg);
    expect(r).toEqual({ ok: false, status: 413, message: "File too large. Maximum size is 5MB." });
    expect(f.wasRead).toBe(false);
  });
});
