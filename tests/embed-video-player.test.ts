import { describe, expect, test } from "bun:test";
import { embedPlayerSrc, isDirectVideoUrl, isPlayerPageUrl, parseYouTubeVideoId } from "@/lib/security/embedPlayer";
import { extractMetaTags, isProxyableMediaType } from "@/lib/api/oembed";
import { pinnedRequest } from "@/lib/security/ssrf";

const ID = "ZjcyRr-f5Pc";

describe("YouTube video ids", () => {
  test("parses every common link form", () => {
    for (const u of [
      `https://youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?si=abc&v=${ID}&t=10`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&list=RDAMVM`,
      `https://youtu.be/${ID}?si=x`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(parseYouTubeVideoId(u)).toBe(ID);
    }
  });

  test("rejects non-video and foreign links", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/embed/videoseries?list=PL123")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/@channel")).toBeNull();
    expect(parseYouTubeVideoId(`https://evil-youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeVideoId(`javascript:alert(1)//youtube.com/watch?v=${ID}`)).toBeNull();
  });
});

describe("embed video classification", () => {
  test("only media files are direct video", () => {
    expect(isDirectVideoUrl("https://cdn.example.com/a/b.mp4")).toBe(true);
    expect(isDirectVideoUrl("https://video.twimg.com/x/vid.mp4?tag=12")).toBe(true);
    expect(isDirectVideoUrl("/api/oembed/media?url=https%3A%2F%2Fvideo.twimg.com%2Fa.mp4")).toBe(true);
    expect(isDirectVideoUrl(`https://www.youtube.com/embed/${ID}`)).toBe(false);
    expect(isDirectVideoUrl("https://player.vimeo.com/video/123")).toBe(false);
    expect(isDirectVideoUrl("https://example.com/page")).toBe(false);
    expect(isDirectVideoUrl("javascript:x.mp4")).toBe(false);
  });

  test("player pages are recognised", () => {
    expect(isPlayerPageUrl(`https://www.youtube.com/embed/${ID}`)).toBe(true);
    expect(isPlayerPageUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isPlayerPageUrl("https://player.vimeo.com/video/123")).toBe(true);
    expect(isPlayerPageUrl("https://cdn.example.com/a.mp4")).toBe(false);
  });

  test("Discord's YouTube unfurl becomes the YouTube iframe player", () => {
    expect(embedPlayerSrc(`https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/watch?v=${ID}`))
      .toBe(`https://www.youtube.com/embed/${ID}?autoplay=1`);
    expect(embedPlayerSrc(undefined, `https://youtu.be/${ID}`)).toBe(`https://www.youtube.com/embed/${ID}?autoplay=1`);
    expect(embedPlayerSrc("https://player.vimeo.com/video/123")).toBe("https://player.vimeo.com/video/123");
    expect(embedPlayerSrc("https://evil.example.com/player")).toBeUndefined();
    expect(embedPlayerSrc("http://player.vimeo.com/video/123")).toBeUndefined();
  });
});

describe("og:video from YouTube pages", () => {
  test("an iframe player og:video is not reported as a video file", () => {
    const html = `
      <meta property="og:url" content="https://www.youtube.com/watch?v=${ID}">
      <meta property="og:video:url" content="https://www.youtube.com/embed/${ID}">
      <meta property="og:video:secure_url" content="https://www.youtube.com/embed/${ID}">
      <meta property="og:video:type" content="text/html">
      <meta property="og:image" content="https://i.ytimg.com/vi/${ID}/maxresdefault.jpg">`;
    const data = extractMetaTags(html, `https://www.youtube.com/watch?v=${ID}`);
    expect(data.video).toBeUndefined();
    expect(data.thumbnail).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  });

  test("even a claimed video/mp4 type on a player host is ignored", () => {
    const html = `<meta property="og:video" content="https://www.youtube.com/embed/${ID}"><meta property="og:video:type" content="video/mp4">`;
    expect(extractMetaTags(html, "https://example.com/").video).toBeUndefined();
  });
});

describe("media proxy content types", () => {
  test("allows raster images and video only", () => {
    expect(isProxyableMediaType("video/mp4")).toBe(true);
    expect(isProxyableMediaType("image/jpeg; charset=binary")).toBe(true);
    expect(isProxyableMediaType("image/svg+xml")).toBe(false);
    expect(isProxyableMediaType("text/html")).toBe(false);
    expect(isProxyableMediaType("application/x-mpegURL")).toBe(false);
    expect(isProxyableMediaType("")).toBe(false);
  });
});

describe("pinned outbound request", () => {
  test("connects to the vetted IP but keeps Host and TLS server name", () => {
    const pin = pinnedRequest(new URL("https://example.com/a?b=1"), "93.184.216.34", { Accept: "text/html" });
    expect(pin.target).toBe("https://93.184.216.34/a?b=1");
    expect(pin.headers.get("host")).toBe("example.com");
    expect(pin.headers.get("accept")).toBe("text/html");
    expect(pin.tls).toEqual({ serverName: "example.com" });
  });

  test("IPv6, explicit ports and plain http", () => {
    const pin = pinnedRequest(new URL("http://example.com:8080/x"), "2606:2800:220:1::1");
    expect(pin.target).toBe("http://[2606:2800:220:1::1]:8080/x");
    expect(pin.headers.get("host")).toBe("example.com:8080");
    expect(pin.tls).toBeUndefined();
  });
});
