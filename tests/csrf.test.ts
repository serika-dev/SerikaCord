import { describe, expect, test } from "bun:test";
import { isCrossSiteWrite } from "@/lib/security/csrf";

const ALLOWED = ["https://serika.chat", "http://localhost:3000"];
const req = (method: string, headers: Record<string, string>) => ({
  method,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});
const session = { cookie: "foo=1; auth_token=abc", host: "serika.chat" };

describe("isCrossSiteWrite", () => {
  test("same-origin app writes pass", () => {
    expect(isCrossSiteWrite(req("POST", { ...session, origin: "https://serika.chat", "sec-fetch-site": "same-origin" }), ALLOWED)).toBeFalse();
    expect(isCrossSiteWrite(req("POST", { ...session, host: "canary.serika.chat", origin: "https://canary.serika.chat" }), ALLOWED)).toBeFalse();
  });
  test("cross-site and sibling-subdomain cookie writes are refused", () => {
    expect(isCrossSiteWrite(req("POST", { ...session, origin: "https://evil.example", "sec-fetch-site": "cross-site" }), ALLOWED)).toBeTrue();
    expect(isCrossSiteWrite(req("DELETE", { ...session, origin: "https://user-content.serika.chat", "sec-fetch-site": "same-site" }), ALLOWED)).toBeTrue();
    expect(isCrossSiteWrite(req("PATCH", { ...session, origin: "null" }), ALLOWED)).toBeTrue();
  });
  test("reads, bearer clients, cookie-less and header-less native requests pass", () => {
    expect(isCrossSiteWrite(req("GET", { ...session, origin: "https://evil.example", "sec-fetch-site": "cross-site" }), ALLOWED)).toBeFalse();
    expect(isCrossSiteWrite(req("POST", { ...session, authorization: "Bot x", origin: "https://evil.example" }), ALLOWED)).toBeFalse();
    expect(isCrossSiteWrite(req("POST", { ...session, authorization: "Bearer abc", origin: "https://evil.example" }), ALLOWED)).toBeFalse();
    // A junk header doesn't switch auth away from the cookie, so it doesn't skip the guard.
    expect(isCrossSiteWrite(req("POST", { ...session, authorization: "x", origin: "https://user-content.serika.chat" }), ALLOWED)).toBeTrue();
    expect(isCrossSiteWrite(req("POST", { host: "serika.chat", origin: "https://evil.example", "sec-fetch-site": "cross-site" }), ALLOWED)).toBeFalse();
    expect(isCrossSiteWrite(req("POST", { ...session }), ALLOWED)).toBeFalse();
  });
});
