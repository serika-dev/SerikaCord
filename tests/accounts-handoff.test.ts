import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import {
  ACCOUNTS_SECURITY_URL,
  DEFAULT_NEXT_PATH,
  handoffReasonForLoginCode,
  loginReturnPath,
  parseHandoffError,
  passkeyStartHref,
  sanitizeNextPath,
} from "@/lib/accountsHandoff";
import {
  CLEAR_HANDOFF_COOKIE,
  buildHandoffStartUrl,
  createPkcePair,
  handoffCookie,
  isValidFlowId,
  isValidHandoffCode,
  isValidHandoffState,
  isValidPkceVerifier,
  mapExchangeResult,
  newFlowId,
  parseHandoffFlow,
  passThroughLoginCode,
  pkceChallenge,
  randomUrlSafe,
  readCookie,
  resolveHandoffCallbackUrl,
  secureEquals,
} from "@/lib/services/accountsHandoff";

describe("PKCE", () => {
  test("RFC 7636 appendix B test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("pairs are valid, distinct and S256-consistent", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(isValidPkceVerifier(a.verifier)).toBeTrue();
    expect(a.verifier).toHaveLength(43);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("verifier charset and length (same rule as Serika Accounts)", () => {
    expect(isValidPkceVerifier("a".repeat(42))).toBeFalse();
    expect(isValidPkceVerifier("a".repeat(129))).toBeFalse();
    expect(isValidPkceVerifier("a".repeat(43))).toBeTrue();
    expect(isValidPkceVerifier(`${"a".repeat(42)}~`)).toBeTrue();
    expect(isValidPkceVerifier(`${"a".repeat(42)}/`)).toBeFalse();
    expect(isValidPkceVerifier(null)).toBeFalse();
  });
});

describe("state, code and flow id validation", () => {
  test("states", () => {
    const state = randomUrlSafe(32);
    expect(isValidHandoffState(state)).toBeTrue();
    expect(isValidHandoffState("short")).toBeFalse();
    expect(isValidHandoffState("a".repeat(129))).toBeFalse();
    expect(isValidHandoffState(`${"a".repeat(40)}<script>`)).toBeFalse();
    expect(isValidHandoffState(`${"a".repeat(40)}\n`)).toBeFalse();
    expect(isValidHandoffState(["a".repeat(43)])).toBeFalse();
  });

  test("codes", () => {
    expect(isValidHandoffCode("ab12".repeat(16))).toBeTrue(); // 64 hex, what accounts issues
    expect(isValidHandoffCode("a".repeat(15))).toBeFalse();
    expect(isValidHandoffCode("a".repeat(129))).toBeFalse();
    expect(isValidHandoffCode(`${"a".repeat(20)}%00`)).toBeFalse();
    expect(isValidHandoffCode(`${"a".repeat(20)} x`)).toBeFalse();
    expect(isValidHandoffCode(undefined)).toBeFalse();
  });

  test("flow ids", () => {
    const id = newFlowId();
    expect(isValidFlowId(id)).toBeTrue();
    expect(isValidFlowId(id.toUpperCase())).toBeFalse();
    expect(isValidFlowId(id.slice(1))).toBeFalse();
    expect(isValidFlowId("../" + id.slice(3))).toBeFalse();
    expect(isValidFlowId(null)).toBeFalse();
  });

  test("secureEquals", () => {
    expect(secureEquals("abc", "abc")).toBeTrue();
    expect(secureEquals("abc", "abd")).toBeFalse();
    expect(secureEquals("abc", "abcd")).toBeFalse();
    expect(secureEquals("", "")).toBeFalse();
    expect(secureEquals("abc", undefined)).toBeFalse();
  });
});

describe("stored flow and cookies", () => {
  const flow = {
    state: randomUrlSafe(32),
    verifier: createPkcePair().verifier,
    next: "/channels/1/2",
    redirectUri: "https://serika.chat/api/auth/accounts/callback",
    createdAt: 1,
  };

  test("round-trips through JSON", () => {
    expect(parseHandoffFlow(JSON.stringify(flow))).toEqual(flow);
    expect(parseHandoffFlow(flow)).toEqual(flow);
  });

  test("rejects malformed flows", () => {
    expect(parseHandoffFlow(null)).toBeNull();
    expect(parseHandoffFlow("not json")).toBeNull();
    expect(parseHandoffFlow(JSON.stringify({ ...flow, state: "x" }))).toBeNull();
    expect(parseHandoffFlow(JSON.stringify({ ...flow, verifier: "short" }))).toBeNull();
    expect(parseHandoffFlow(JSON.stringify({ ...flow, next: 5 }))).toBeNull();
    expect(parseHandoffFlow(JSON.stringify({ ...flow, redirectUri: undefined }))).toBeNull();
  });

  test("cookie is HttpOnly, Secure, Lax, scoped and short-lived; clearing expires it", () => {
    const id = newFlowId();
    const set = handoffCookie(id);
    expect(set.startsWith(`serika_handoff=${id};`)).toBeTrue();
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/auth/accounts", "Max-Age=600"]) {
      expect(set).toContain(part);
    }
    expect(CLEAR_HANDOFF_COOKIE).toContain("Max-Age=0");
    expect(CLEAR_HANDOFF_COOKIE).toContain("Path=/api/auth/accounts");
  });

  test("readCookie", () => {
    expect(readCookie("a=1; serika_handoff=abc; b=2", "serika_handoff")).toBe("abc");
    expect(readCookie("xserika_handoff=abc", "serika_handoff")).toBeNull();
    expect(readCookie("", "serika_handoff")).toBeNull();
    expect(readCookie(null, "serika_handoff")).toBeNull();
  });
});

describe("callback URL and accounts start URL", () => {
  test("explicit callback wins (https only in production)", () => {
    expect(resolveHandoffCallbackUrl({
      explicit: "https://canary.serika.chat/api/auth/accounts/callback",
      frontendUrl: "https://serika.chat",
      production: true,
    })).toBe("https://canary.serika.chat/api/auth/accounts/callback");
    expect(resolveHandoffCallbackUrl({
      explicit: "http://evil.example/cb",
      production: true,
    })).toBe("https://serika.chat/api/auth/accounts/callback");
  });

  test("loopback request origin in development", () => {
    expect(resolveHandoffCallbackUrl({ requestOrigin: "http://localhost:3000", frontendUrl: "https://serika.chat", production: false }))
      .toBe("http://localhost:3000/api/auth/accounts/callback");
    // Never in production, and never for non-loopback hosts.
    expect(resolveHandoffCallbackUrl({ requestOrigin: "http://localhost:3000", production: true }))
      .toBe("https://serika.chat/api/auth/accounts/callback");
    expect(resolveHandoffCallbackUrl({ requestOrigin: "https://evil.example", production: false }))
      .toBe("https://serika.chat/api/auth/accounts/callback");
  });

  test("FRONTEND_URL, then the default", () => {
    expect(resolveHandoffCallbackUrl({ frontendUrl: "https://canary.serika.chat/", production: true }))
      .toBe("https://canary.serika.chat/api/auth/accounts/callback");
    expect(resolveHandoffCallbackUrl({ production: true })).toBe("https://serika.chat/api/auth/accounts/callback");
  });

  test("start URL carries exactly the accounts parameters", () => {
    const url = new URL(buildHandoffStartUrl({
      accountsBase: "https://accounts.serika.dev",
      redirectUri: "https://serika.chat/api/auth/accounts/callback",
      state: "s".repeat(43),
      challenge: "c".repeat(43),
      passkey: true,
    }));
    expect(url.origin).toBe("https://accounts.serika.dev");
    expect(url.pathname).toBe("/api/auth/handoff/start");
    expect(url.searchParams.get("product")).toBe("serikacord");
    expect(url.searchParams.get("return")).toBe("https://serika.chat/api/auth/accounts/callback");
    expect(url.searchParams.get("state")).toBe("s".repeat(43));
    expect(url.searchParams.get("code_challenge")).toBe("c".repeat(43));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("passkey")).toBe("1");
    expect(url.searchParams.has("code_verifier")).toBeFalse();

    const noPasskey = new URL(buildHandoffStartUrl({
      accountsBase: "https://accounts.serika.dev",
      redirectUri: "https://serika.chat/api/auth/accounts/callback",
      state: "s".repeat(43),
      challenge: "c".repeat(43),
      passkey: false,
    }));
    expect(noPasskey.searchParams.has("passkey")).toBeFalse();
  });
});

describe("next path sanitizing", () => {
  test("keeps same-origin relative paths", () => {
    expect(sanitizeNextPath("/channels/1/2")).toBe("/channels/1/2");
    expect(sanitizeNextPath("/invite/abc?x=1#y")).toBe("/invite/abc?x=1#y");
  });

  test("rejects open redirects, API routes and junk", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/\t/evil.example",
      "channels/me",
      "/api/auth/logout",
      "/api",
      "/api?x=1",
      "/" + "a".repeat(3000),
      null,
      undefined,
      42,
    ]) {
      expect(sanitizeNextPath(bad)).toBe(DEFAULT_NEXT_PATH);
    }
  });

  test("start href and login return path only carry a safe next", () => {
    expect(passkeyStartHref("/channels/me")).toBe("/api/auth/accounts/start");
    expect(passkeyStartHref("/channels/1")).toBe("/api/auth/accounts/start?next=%2Fchannels%2F1");
    expect(passkeyStartHref("https://evil.example")).toBe("/api/auth/accounts/start");
    expect(passkeyStartHref("/channels/1", { passkey: false })).toBe("/api/auth/accounts/start?next=%2Fchannels%2F1&passkey=0");
    expect(loginReturnPath("/channels/1", { error: "passkey_expired" })).toBe("/login?error=passkey_expired&redirect=%2Fchannels%2F1");
    expect(loginReturnPath("//evil.example", { signed_in: "1" })).toBe("/login?signed_in=1");
  });
});

describe("error codes", () => {
  test("exchange results", () => {
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: true, token: "t" } })).toBeNull();
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: true } })).toBe("passkey_failed");
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: false, error: "Invalid or expired code" } })).toBe("passkey_expired");
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: false, code: "AGE_RESTRICTION" } })).toBe("passkey_age");
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: false, error: "User not found" } })).toBe("passkey_failed");
    expect(mapExchangeResult({ ok: true, status: 200, data: { success: false, error: "Invalid service key" } })).toBe("passkey_failed");
    expect(mapExchangeResult({ ok: false, status: 503, data: { error: "down" } })).toBe("passkey_unavailable");
    expect(mapExchangeResult({ ok: false, status: 429, data: {} })).toBe("passkey_unavailable");
    expect(mapExchangeResult({ ok: false, status: 500, data: null })).toBe("passkey_unavailable");
  });

  test("login page only accepts known error codes", () => {
    expect(parseHandoffError("passkey_expired")).toBe("passkey_expired");
    expect(parseHandoffError("passkey_cancelled")).toBe("passkey_cancelled");
    expect(parseHandoffError("<img src=x>")).toBeNull();
    expect(parseHandoffError("")).toBeNull();
    expect(parseHandoffError(null)).toBeNull();
  });

  test("password login codes", () => {
    expect(handoffReasonForLoginCode("PASSKEY_REQUIRED")).toBe("passkey");
    expect(handoffReasonForLoginCode("TWO_FACTOR_REQUIRED")).toBe("two_factor");
    expect(handoffReasonForLoginCode("EMAIL_NOT_VERIFIED")).toBeNull();
    expect(handoffReasonForLoginCode(undefined)).toBeNull();
    expect(passThroughLoginCode("PASSKEY_REQUIRED")).toBe("PASSKEY_REQUIRED");
    expect(passThroughLoginCode("<b>")).toBeUndefined();
    expect(passThroughLoginCode("lowercase")).toBeUndefined();
    expect(passThroughLoginCode(5)).toBeUndefined();
  });

  test("passkeys are managed on the accounts security page", () => {
    expect(new URL(ACCOUNTS_SECURITY_URL).origin).toBe("https://accounts.serika.dev");
  });
});
