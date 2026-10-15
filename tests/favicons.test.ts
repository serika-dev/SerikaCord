import { describe, expect, test } from "bun:test";
import {
  canonicalFaviconDomain,
  checkFaviconFetchUrl,
  decodeIco,
  extractIconCandidates,
  faviconPath,
  sniffImageType,
  stripSvgExternalRefs,
} from "../src/lib/connections/favicon";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("favicon URLs", () => {
  test("faviconPath only for valid public domains", () => {
    expect(faviconPath("Example.com")).toBe("/api/favicons/example.com");
    expect(faviconPath("https://www.example.com/x")).toBe("/api/favicons/example.com");
    expect(faviconPath("localhost")).toBeNull();
    expect(faviconPath("127.0.0.1")).toBeNull();
    expect(faviconPath(null)).toBeNull();
  });

  test("the route answers only for the canonical spelling", () => {
    expect(canonicalFaviconDomain("example.com")).toBe("example.com");
    expect(canonicalFaviconDomain("xn--bcher-kva.example")).toBeNull(); // reserved TLD
    expect(canonicalFaviconDomain("EXAMPLE.com")).toBeNull();
    expect(canonicalFaviconDomain("www.example.com")).toBeNull();
    expect(canonicalFaviconDomain("example.com%2F..")).toBeNull();
    expect(canonicalFaviconDomain("169.254.169.254")).toBeNull();
    expect(canonicalFaviconDomain("%E0%A4%A")).toBeNull();
  });

  test("fetch URLs: https, default port, DNS names only", () => {
    expect(checkFaviconFetchUrl("https://cdn.example.com/icon.png")?.toString()).toBe("https://cdn.example.com/icon.png");
    expect(checkFaviconFetchUrl("https://example.com:443/favicon.ico")).not.toBeNull();
    expect(checkFaviconFetchUrl("http://example.com/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://example.com:8443/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://user:pw@example.com/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://127.0.0.1/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://[::1]/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://localhost/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://printer.local/favicon.ico")).toBeNull();
    expect(checkFaviconFetchUrl("https://metadata.internal/")).toBeNull();
    expect(checkFaviconFetchUrl("file:///etc/passwd")).toBeNull();
    expect(checkFaviconFetchUrl("not a url")).toBeNull();
  });
});

describe("extractIconCandidates", () => {
  const page = "https://example.com/blog/";

  test("ranks advertised icons, resolves relative URLs, ends with /favicon.ico", () => {
    const html = `<html><head>
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="icon" href="/favicon-64.png" sizes="64x64">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
      <link rel="stylesheet" href="/x.css">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="http://insecure.example.com/i.png">
      <link rel="icon" href="https://10.0.0.1/i.png">
    </head><body><link rel="icon" href="/body-icon.png" sizes="64x64"></body></html>`;
    expect(extractIconCandidates(html, page)).toEqual([
      "https://example.com/favicon-64.png",
      "https://cdn.example.com/touch.png",
      "https://example.com/favicon-16.png",
      "https://example.com/favicon.ico",
    ]);
  });

  test("handles 'shortcut icon', single quotes and entities", () => {
    const html = `<head><LINK REL='shortcut icon' HREF='/static/fav.ico?v=1&amp;x=2'></head>`;
    expect(extractIconCandidates(html, page)[0]).toBe("https://example.com/static/fav.ico?v=1&x=2");
  });

  test("no links: just the origin's /favicon.ico", () => {
    expect(extractIconCandidates("", "https://example.com/a/b")).toEqual(["https://example.com/favicon.ico"]);
  });
});

describe("sniffImageType", () => {
  test("detects formats from bytes, not headers", () => {
    expect(sniffImageType(new Uint8Array([...PNG_SIG, 0, 0]))).toBe("png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a...."))).toBe("gif");
    expect(sniffImageType(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe("ico");
    expect(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?>\n<!-- c --><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(sniffImageType(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

/** Builds a .ico with one 32bpp BMP entry (bottom-up rows, BGRA). */
function bmpIco(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const xorStride = width * 4;
  const andStride = Math.floor((width + 31) / 32) * 4;
  const dib = new Uint8Array(40 + xorStride * height + andStride * height);
  const dv = new DataView(dib.buffer);
  dv.setUint32(0, 40, true);
  dv.setInt32(4, width, true);
  dv.setInt32(8, height * 2, true);
  dv.setUint16(12, 1, true);
  dv.setUint16(14, 32, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = 40 + (height - 1 - y) * xorStride + x * 4;
      dib[o] = b; dib[o + 1] = g; dib[o + 2] = r; dib[o + 3] = a;
    }
  }
  const out = new Uint8Array(6 + 16 + dib.length);
  const ov = new DataView(out.buffer);
  ov.setUint16(2, 1, true);
  ov.setUint16(4, 1, true);
  out[6] = width; out[7] = height;
  ov.setUint16(6 + 6, 32, true);
  ov.setUint32(6 + 8, dib.length, true);
  ov.setUint32(6 + 12, 22, true);
  out.set(dib, 22);
  return out;
}

describe("decodeIco", () => {
  test("decodes a 32bpp BMP entry top-down with alpha", () => {
    const ico = bmpIco(2, 2, (x, y) => (y === 0 ? [255, 0, 0, 255] : x === 0 ? [0, 255, 0, 128] : [0, 0, 255, 0]));
    const img = decodeIco(ico);
    expect(img?.kind).toBe("rgba");
    if (img?.kind !== "rgba") return;
    expect([img.width, img.height]).toEqual([2, 2]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255]); // top-left
    expect(Array.from(img.data.slice(8, 12))).toEqual([0, 255, 0, 128]); // bottom-left
    expect(img.data[15]).toBe(0); // bottom-right transparent
  });

  test("returns embedded PNG entries as-is", () => {
    const png = new Uint8Array([...PNG_SIG, 1, 2, 3, 4]);
    const out = new Uint8Array(22 + png.length);
    const dv = new DataView(out.buffer);
    dv.setUint16(2, 1, true);
    dv.setUint16(4, 1, true);
    out[6] = 0; out[7] = 0; // 256x256
    dv.setUint32(6 + 8, png.length, true);
    dv.setUint32(6 + 12, 22, true);
    out.set(png, 22);
    const img = decodeIco(out);
    expect(img?.kind).toBe("png");
    expect(img?.width).toBe(256);
  });

  test("rejects malformed files", () => {
    expect(decodeIco(new Uint8Array([0, 0, 1, 0]))).toBeNull();
    expect(decodeIco(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBeNull(); // entry table missing
    const bad = bmpIco(2, 2, () => [0, 0, 0, 255]);
    new DataView(bad.buffer).setUint32(6 + 12, 999_999, true); // offset out of range
    expect(decodeIco(bad)).toBeNull();
  });
});

describe("stripSvgExternalRefs", () => {
  test("drops external references and entity declarations, keeps fragments", () => {
    const svg = `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">
      <style>@import url(https://evil.example/a.css); .a{fill:url(#g)}</style>
      <image href="https://evil.example/p.png"/><use xlink:href="#shape"/><rect style="fill:url(https://evil.example/x)"/></svg>`;
    const out = stripSvgExternalRefs(svg);
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("ENTITY");
    expect(out).not.toContain("DOCTYPE");
    expect(out).toContain('xlink:href="#shape"');
    expect(out).toContain("url(#g)");
  });
});

describe("toFaviconPng", () => {
  // sharp only: no network, no database.
  const load = () => import("../src/lib/services/faviconImage");

  test("converts a BMP-style .ico to a PNG", async () => {
    const { toFaviconPng } = await load();
    const ico = bmpIco(16, 16, (x) => (x < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const out = await toFaviconPng(Buffer.from(ico));
    expect(out).not.toBeNull();
    expect(sniffImageType(out!)).toBe("png");
  });

  test("rasterises SVG (never passes it through) and caps the size at 64px", async () => {
    const { toFaviconPng } = await load();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" onload="alert(1)"><script>alert(1)</script><rect width="512" height="512" fill="#f80"/></svg>`;
    const out = await toFaviconPng(Buffer.from(svg));
    expect(out).not.toBeNull();
    expect(sniffImageType(out!)).toBe("png");
    const { default: sharp } = await import("sharp");
    const meta = await sharp(out!).metadata();
    expect([meta.width, meta.height]).toEqual([64, 64]);
  });

  test("rejects non-images and tiny spacer icons", async () => {
    const { toFaviconPng } = await load();
    expect(await toFaviconPng(Buffer.from("<!doctype html><title>404</title>"))).toBeNull();
    expect(await toFaviconPng(Buffer.from(bmpIco(1, 1, () => [0, 0, 0, 0])))).toBeNull();
  });
});
