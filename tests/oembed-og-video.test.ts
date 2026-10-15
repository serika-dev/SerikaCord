import { describe, expect, test } from "bun:test";
import { extractMetaTags, isSamePage } from "@/lib/api/oembed";

const page = "https://www.bilibili.tv/en/video/4801248978409984";
const bilibiliHead = `
<meta property="og:title" content="Nues Exorcist| 2027 | bilibili">
<meta property="og:url" content="${page}?bstar_from=share">
<meta property="og:video" content="${page}?bstar_from=share">
<meta property="og:video:type" content="video/mp4">
<meta property="og:image" content="https://p.bstarstatic.com/ugc/b67a.jpg">
<link rel="canonical" href="${page}">`;

describe("og:video detection", () => {
  test("ignores an og:video that is the page itself (bilibili.tv)", () => {
    const data = extractMetaTags(bilibiliHead, page);
    expect(data.video).toBeUndefined();
    expect(data.thumbnail).toBe("https://p.bstarstatic.com/ugc/b67a.jpg");
    expect(data.title).toContain("Nues Exorcist");
  });

  test("keeps a real media file", () => {
    const html = `<meta property="og:url" content="https://example.com/v/1"><meta property="og:video" content="https://cdn.example.com/v/1.mp4">`;
    expect(extractMetaTags(html, "https://example.com/v/1").video).toBe("https://cdn.example.com/v/1.mp4");
  });

  test("keeps a typed video on a different URL", () => {
    const html = `<meta property="og:url" content="https://example.com/v/1"><meta property="og:video" content="https://cdn.example.com/stream/1"><meta property="og:video:type" content="video/mp4">`;
    expect(extractMetaTags(html, "https://example.com/v/1").video).toBe("https://cdn.example.com/stream/1");
  });

  test("isSamePage ignores query, trailing slash and www", () => {
    expect(isSamePage("https://bilibili.tv/en/video/1/?a=1", ["https://www.bilibili.tv/en/video/1"])).toBe(true);
    expect(isSamePage("https://cdn.bilibili.tv/en/video/1", ["https://www.bilibili.tv/en/video/1"])).toBe(false);
  });
});
