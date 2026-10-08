import { describe, expect, test } from "bun:test";
import { checkUrlShape, isBlockedAddress, UnsafeUrlError } from "@/lib/security/ssrf";
import { sanitizePlayerUrl } from "@/lib/security/embedPlayer";
import { sanitizeSvg } from "@/lib/security/svgSanitizer";

describe("ssrf address checks", () => {
  test("blocks private, loopback, link-local and mapped forms", () => {
    for (const a of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    ]) {
      expect(isBlockedAddress(a)).toBe(true);
    }
  });

  test("allows public addresses", () => {
    for (const a of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(a)).toBe(false);
    }
  });

  test("rejects bad schemes, credentials, ports and internal hosts", () => {
    for (const u of [
      "file:///etc/passwd", "data:text/html,hi", "ftp://example.com/",
      "http://user:pw@example.com/", "http://example.com:6379/",
      "http://localhost/", "http://foo.internal/", "http://127.0.0.1/",
      "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "http://169.254.169.254/latest/",
    ]) {
      expect(() => checkUrlShape(u)).toThrow(UnsafeUrlError);
    }
  });

  test("accepts normal public URLs", () => {
    expect(checkUrlShape("https://example.com/page").hostname).toBe("example.com");
    expect(checkUrlShape("http://example.com:8080/").port).toBe("8080");
  });
});

describe("player URL allowlist", () => {
  test("keeps https players on known embed hosts", () => {
    expect(sanitizePlayerUrl("https://open.spotify.com/embed/track/x")).toBeDefined();
    expect(sanitizePlayerUrl("https://www.youtube.com/embed/abc")).toBeDefined();
  });

  test("drops user-content hosts, other schemes and lookalikes", () => {
    expect(sanitizePlayerUrl("https://evil.netlify.app/player")).toBeUndefined();
    expect(sanitizePlayerUrl("https://phish.example/serika-login")).toBeUndefined();
    expect(sanitizePlayerUrl("http://open.spotify.com/embed")).toBeUndefined();
    expect(sanitizePlayerUrl("data:text/html,<script>1</script>")).toBeUndefined();
    expect(sanitizePlayerUrl("https://notyoutube.com/embed")).toBeUndefined();
    expect(sanitizePlayerUrl(undefined)).toBeUndefined();
  });
});

describe("svg sanitizer", () => {
  test("nested tags cannot rebuild a script element", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><scr<script>ipt>alert(1)</scr<script>ipt></svg>',
    );
    expect(out.toLowerCase()).not.toContain("<script");
  });

  test("strips entity-encoded javascript: hrefs and event handlers", () => {
    const out = sanitizeSvg(
      '<svg><a href="&#106;avascript:alert(1)"><rect onclick="x()"/></a><a xlink:href="java&#x09;script:1">t</a></svg>',
    );
    expect(out).not.toContain("avascript");
    expect(out).not.toContain("script:1");
    expect(out).not.toContain("onclick");
  });

  test("leaves harmless SVG untouched", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://serika.chat"><circle r="4"/></a></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });
});
