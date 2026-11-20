import { describe, expect, test } from "bun:test";
import { isAllowedCorsOrigin, CORS_SUBDOMAIN_BASES, hostOf } from "@/lib/security/csrf";
import { ipInCidr, isCloudflareIP, parseIP, pickClientIpFromRequestHeaders } from "@/lib/security";

const allowedOrigins = ["http://localhost:3000", "https://serika.dev", "https://serika.chat", "https://api.serika.chat", "https://serika.cc"];
const prod = { allowedOrigins, subdomainBases: CORS_SUBDOMAIN_BASES, blockedHosts: [hostOf("https://cdn.serika.chat")], allowLocalhost: false };
const dev = { ...prod, allowLocalhost: true };

describe("isAllowedCorsOrigin", () => {
  test("exact allowed origins", () => {
    expect(isAllowedCorsOrigin("https://serika.chat", prod)).toBe(true);
    expect(isAllowedCorsOrigin("https://serika.dev", prod)).toBe(true);
    expect(isAllowedCorsOrigin("https://api.serika.chat", prod)).toBe(true);
  });

  test("https subdomains of first-party app hosts", () => {
    expect(isAllowedCorsOrigin("https://canary.serika.chat", prod)).toBe(true);
    expect(isAllowedCorsOrigin("https://www.serika.chat", prod)).toBe(true);
  });

  test("never the CDN, plain http subdomains, or other subdomains", () => {
    expect(isAllowedCorsOrigin("https://cdn.serika.chat", prod)).toBe(false);
    expect(isAllowedCorsOrigin("http://canary.serika.chat", prod)).toBe(false);
    expect(isAllowedCorsOrigin("http://serika.chat", prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://gifs.serika.dev", prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://x.serika.cc", prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://evilserika.chat", prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://serika.chat.evil.com", prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://serika.chat:8443", prod)).toBe(false);
    expect(isAllowedCorsOrigin("null", prod)).toBe(false);
    expect(isAllowedCorsOrigin("capacitor://localhost", dev)).toBe(false);
  });

  test("localhost only outside production", () => {
    expect(isAllowedCorsOrigin("http://localhost:3000", dev)).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:3000", prod)).toBe(false);
    expect(isAllowedCorsOrigin("http://localhost:4000", dev)).toBe(false);
  });
});

describe("CIDR matching", () => {
  test("parses IPv4, IPv6 and mapped addresses", () => {
    expect(parseIP("1.2.3.4")?.v).toBe(4);
    expect(parseIP("::ffff:1.2.3.4")).toEqual(parseIP("1.2.3.4"));
    expect(parseIP("[2606:4700::1]")?.v).toBe(6);
    expect(parseIP("fe80::1%eth0")?.v).toBe(6);
    expect(parseIP("256.1.1.1")).toBeNull();
    expect(parseIP("1.2.3")).toBeNull();
    expect(parseIP("1::2::3")).toBeNull();
    expect(parseIP("unknown")).toBeNull();
    expect(parseIP("")).toBeNull();
  });

  test("ipInCidr", () => {
    expect(ipInCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("2606:4700:10::6816:1", "2606:4700::/32")).toBe(true);
    expect(ipInCidr("2606:4701::1", "2606:4700::/32")).toBe(false);
    expect(ipInCidr("10.0.0.1", "2606:4700::/32")).toBe(false);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  test("Cloudflare ranges", () => {
    expect(isCloudflareIP("162.158.1.1")).toBe(true);
    expect(isCloudflareIP("172.71.255.255")).toBe(true);
    expect(isCloudflareIP("172.72.0.0")).toBe(false);
    expect(isCloudflareIP("2a06:98c7::1")).toBe(true);
    expect(isCloudflareIP("2a06:98c8::1")).toBe(false);
    expect(isCloudflareIP("203.0.113.9")).toBe(false);
  });
});

describe("pickClientIpFromRequestHeaders", () => {
  test("trusts CF-Connecting-IP when the proxy peer is a Cloudflare edge", () => {
    expect(pickClientIpFromRequestHeaders("198.51.100.7", "162.158.10.20", null)).toBe("198.51.100.7");
    expect(pickClientIpFromRequestHeaders("198.51.100.7", "6.6.6.6, 2606:4700::5", null)).toBe("198.51.100.7");
    expect(pickClientIpFromRequestHeaders("2001:db8::1", null, "104.16.0.1")).toBe("2001:db8::1");
  });

  test("ignores CF-Connecting-IP from anyone else", () => {
    expect(pickClientIpFromRequestHeaders("1.1.1.1", "203.0.113.9", null)).toBe("203.0.113.9");
    // A spoofed Cloudflare IP left of the real hop doesn't help.
    expect(pickClientIpFromRequestHeaders("1.1.1.1", "162.158.10.20, 203.0.113.9", null)).toBe("203.0.113.9");
    expect(pickClientIpFromRequestHeaders("not-an-ip", "162.158.10.20", null)).toBe("162.158.10.20");
  });

  test("no proxy headers (direct dev)", () => {
    expect(pickClientIpFromRequestHeaders(null, null, null)).toBe("unknown");
    expect(pickClientIpFromRequestHeaders("1.1.1.1", null, null)).toBe("unknown");
    expect(pickClientIpFromRequestHeaders(null, null, "127.0.0.1")).toBe("127.0.0.1");
  });
});
