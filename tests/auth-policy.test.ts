import { describe, expect, test } from "bun:test";
import { safeRedirect } from "@/lib/safeRedirect";
import {
  canAdoptLocalUser,
  dedupeUsername,
  parseSavedAccounts,
  encodeSavedAccountsCookie,
  upsertSavedAccount,
  removeSavedAccount,
  toPublicSavedAccounts,
  parseOAuthStateCookie,
  checkSteamAssertion,
  buildSteamCheckAuthBody,
  isSteamCheckAuthValid,
  STEAM_OPENID_ENDPOINT,
} from "@/lib/services/authPolicy";

const ORIGIN = "https://serika.chat";

describe("safeRedirect", () => {
  test("keeps same-site paths", () => {
    expect(safeRedirect("/channels/123/456", undefined, ORIGIN)).toBe("/channels/123/456");
    expect(safeRedirect("/qr/abc?x=1#y", undefined, ORIGIN)).toBe("/qr/abc?x=1#y");
    expect(safeRedirect("/oauth2/authorize?client_id=1&redirect_uri=https%3A%2F%2Fa.b", undefined, ORIGIN))
      .toBe("/oauth2/authorize?client_id=1&redirect_uri=https%3A%2F%2Fa.b");
  });

  test("rejects scripts, other origins and protocol-relative tricks", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:fetch('//evil')",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "data:text/html,hi",
      "evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(safeRedirect(bad, "/channels/me", ORIGIN)).toBe("/channels/me");
    }
  });
});

describe("canAdoptLocalUser", () => {
  const accounts = { id: "acc-1", email: "Me@Example.com", isVerified: true };

  test("adopts a legacy row with the same verified email", () => {
    expect(canAdoptLocalUser({ id: "legacy", email: "me@example.com" }, accounts)).toBe(true);
  });

  test("never adopts bots, system users, email-less or mismatched rows", () => {
    expect(canAdoptLocalUser({ id: "b", email: "me@example.com", isBot: true }, accounts)).toBe(false);
    expect(canAdoptLocalUser({ id: "s", email: "me@example.com", isSystem: true }, accounts)).toBe(false);
    expect(canAdoptLocalUser({ id: "d", email: null }, accounts)).toBe(false);
    expect(canAdoptLocalUser({ id: "o", email: "other@example.com" }, accounts)).toBe(false);
  });

  test("requires the accounts email to be verified", () => {
    expect(canAdoptLocalUser({ id: "legacy", email: "me@example.com" }, { ...accounts, isVerified: false })).toBe(false);
    expect(canAdoptLocalUser({ id: "legacy", email: "me@example.com" }, { ...accounts, isVerified: undefined })).toBe(false);
  });
});

describe("dedupeUsername", () => {
  test("appends an id-derived suffix within limits", () => {
    const name = dedupeUsername("popularbot", "1a2b3c4d-5e6f-7a8b-9c0d-112233445566");
    expect(name).toBe("popularbot_1a2b3c");
    expect(name).toMatch(/^[a-zA-Z0-9_]+$/);
    const long = dedupeUsername("a".repeat(40), "1a2b3c4d5e6f", 1);
    expect(long.length <= 32).toBe(true);
    expect(long.endsWith("_1a2b3c4d5e")).toBe(true);
  });
});

describe("saved accounts cookie", () => {
  const a = { email: "a@x.com", username: "a", token: "tokA", refreshToken: "rA", savedAt: 1 };
  const b = { email: "b@x.com", username: "b", savedAt: 2 };

  test("is HttpOnly and Secure and round-trips", () => {
    const cookie = encodeSavedAccountsCookie([a, b]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const value = cookie.slice("saved_accounts=".length, cookie.indexOf(";"));
    expect(parseSavedAccounts(value)).toEqual([a, b]);
    expect(parseSavedAccounts([a])).toEqual([a]);
    expect(parseSavedAccounts("not json")).toEqual([]);
  });

  test("public view never exposes tokens", () => {
    const pub = toPublicSavedAccounts([a, b]);
    expect(JSON.stringify(pub)).not.toContain("tokA");
    expect(JSON.stringify(pub)).not.toContain("rA");
    expect(pub.find((p) => p.email === "a@x.com")?.switchable).toBe(true);
    expect(pub.find((p) => p.email === "b@x.com")?.switchable).toBe(false);
  });

  test("upsert replaces and remove drops by email or username", () => {
    const up = upsertSavedAccount([a, b], { ...a, token: "new", savedAt: 3 });
    expect(up.filter((x) => x.email === "a@x.com")).toHaveLength(1);
    expect(removeSavedAccount([a, b], { email: "A@X.com" })).toEqual([b]);
    expect(removeSavedAccount([a, b], { username: "B" })).toEqual([a]);
  });
});

describe("parseOAuthStateCookie", () => {
  const nonce = "ab".repeat(24);
  test("accepts provider:nonce (raw or URI-encoded)", () => {
    expect(parseOAuthStateCookie(`github:${nonce}`, "github")).toBe(nonce);
    expect(parseOAuthStateCookie(`steam%3A${nonce}`, "steam")).toBe(nonce);
  });
  test("rejects other providers and user-id style states", () => {
    expect(parseOAuthStateCookie(`github:${nonce}`, "steam")).toBeNull();
    expect(parseOAuthStateCookie("discord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "discord")).toBeNull();
    expect(parseOAuthStateCookie(undefined, "discord")).toBeNull();
  });
});

describe("Steam OpenID assertion", () => {
  const returnTo = "https://serika.chat/api/auth/steam/callback";
  const id = "https://steamcommunity.com/openid/id/76561197960287930";
  const good = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": id,
    "openid.identity": id,
    "openid.return_to": returnTo,
    "openid.response_nonce": "2026-01-01T00:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
  };

  test("extracts the SteamID only from a well-formed assertion", () => {
    expect(checkSteamAssertion(good, returnTo)).toEqual({ steamId: "76561197960287930" });
  });

  test("rejects forged or mismatched fields", () => {
    expect("error" in checkSteamAssertion({ ...good, "openid.identity": "https://evil.com/openid/id/76561197960287930" }, returnTo)).toBe(true);
    expect("error" in checkSteamAssertion({ ...good, "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960287931" }, returnTo)).toBe(true);
    expect("error" in checkSteamAssertion({ ...good, "openid.return_to": "https://evil.com/cb" }, returnTo)).toBe(true);
    expect("error" in checkSteamAssertion({ ...good, "openid.op_endpoint": "https://evil.com/openid/login" }, returnTo)).toBe(true);
    expect("error" in checkSteamAssertion({ ...good, "openid.mode": "cancel" }, returnTo)).toBe(true);
    expect("error" in checkSteamAssertion({ ...good, "openid.sig": undefined }, returnTo)).toBe(true);
  });

  test("check_authentication body and response parsing", () => {
    const body = buildSteamCheckAuthBody({ ...good, code: "x" });
    expect(body.get("openid.mode")).toBe("check_authentication");
    expect(body.get("openid.sig")).toBe("c2lnbmF0dXJl");
    expect(body.has("code")).toBe(false);
    expect(isSteamCheckAuthValid("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")).toBe(true);
    expect(isSteamCheckAuthValid("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n")).toBe(false);
    expect(isSteamCheckAuthValid("")).toBe(false);
  });
});
