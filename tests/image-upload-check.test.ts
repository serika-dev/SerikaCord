import { describe, expect, test } from "bun:test";
import { checkImageUpload, imageTooLargeMessage } from "@/lib/botapi/imageData";
import { parseTeamIconPatch } from "@/lib/appDirectory/assets";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1");
const WEBP = Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1");
const MB = 1024 * 1024;

describe("checkImageUpload", () => {
  test("accepts each allowed type and reports the sniffed type and extension", () => {
    expect(checkImageUpload(PNG, MB)).toEqual({ ok: true, contentType: "image/png", ext: "png" });
    expect(checkImageUpload(JPEG, MB)).toEqual({ ok: true, contentType: "image/jpeg", ext: "jpg" });
    expect(checkImageUpload(GIF, MB)).toEqual({ ok: true, contentType: "image/gif", ext: "gif" });
    expect(checkImageUpload(WEBP, MB)).toEqual({ ok: true, contentType: "image/webp", ext: "webp" });
  });

  test("the type comes from the bytes (a GIF sent as image/png is a GIF)", () => {
    // The declared MIME / file name never reach the check: only bytes do.
    const r = checkImageUpload(new Uint8Array(GIF), MB);
    expect(r.ok && r.contentType).toBe("image/gif");
  });

  test("rejects spoofed non-images (HTML, SVG, text, scripts)", () => {
    for (const body of [
      "<!doctype html><html><script>alert(1)</script></html>",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<?xml version="1.0"?><svg/>',
      "just some text that claims to be image/png",
      "%PDF-1.7 not an image",
    ]) {
      const r = checkImageUpload(Buffer.from(body), MB);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toContain("Invalid file type");
    }
  });

  test("rejects other image formats we don't store (BMP, TIFF)", () => {
    expect(checkImageUpload(Buffer.from("BM\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", "latin1"), MB).ok).toBe(false);
    expect(checkImageUpload(Buffer.from([0x49, 0x49, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0, 0]), MB).ok).toBe(false);
  });

  test("rejects truncated magic numbers", () => {
    expect(checkImageUpload(PNG.subarray(0, 4), MB).ok).toBe(false);
    expect(checkImageUpload(WEBP.subarray(0, 8), MB).ok).toBe(false);
  });

  test("rejects an empty file", () => {
    expect(checkImageUpload(new Uint8Array(0), MB)).toEqual({ ok: false, message: "No file provided" });
  });

  test("rejects oversize files before sniffing, accepts exactly the limit", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MB)]);
    const r = checkImageUpload(big, MB);
    expect(r).toEqual({ ok: false, message: "File too large. Maximum size is 1MB." });
    const exact = Buffer.concat([PNG, Buffer.alloc(MB - PNG.length)]);
    expect(checkImageUpload(exact, MB).ok).toBe(true);
  });
});

describe("imageTooLargeMessage", () => {
  test("whole megabytes and fractions", () => {
    expect(imageTooLargeMessage(5 * MB)).toBe("File too large. Maximum size is 5MB.");
    expect(imageTooLargeMessage(256 * 1024)).toBe("File too large. Maximum size is 0.3MB.");
  });
});

describe("parseTeamIconPatch", () => {
  const CDN = "https://cdn.serika.chat";
  test("null and empty string clear the icon", () => {
    expect(parseTeamIconPatch(null, CDN)).toEqual({ ok: true, value: null });
    expect(parseTeamIconPatch("", CDN)).toEqual({ ok: true, value: null });
  });
  test("accepts a file on our CDN", () => {
    expect(parseTeamIconPatch("https://cdn.serika.chat/app-icons/abc/x.png", CDN)).toEqual({ ok: true, value: "https://cdn.serika.chat/app-icons/abc/x.png" });
  });
  test("refuses data URIs, other hosts, lookalikes and junk", () => {
    for (const v of [
      "data:image/png;base64,iVBORw0KGgo=",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://evil.example/x.png",
      "https://cdn.serika.chat.evil.example/x.png",
      "http://cdn.serika.chat/x.png",
      "https://user:pass@cdn.serika.chat/x.png",
      "https://cdn.serika.chat/",
      "javascript:alert(1)",
      "not a url",
      42,
      {},
      `https://cdn.serika.chat/${"a".repeat(2000)}`,
    ]) {
      expect(parseTeamIconPatch(v, CDN).ok).toBe(false);
    }
  });
});
