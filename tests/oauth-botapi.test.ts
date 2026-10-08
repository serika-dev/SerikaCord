import { describe, expect, test } from "bun:test";
import {
  appendQuery,
  clampBotPermissions,
  isSafeRedirectUrl,
  parsePermissionsParam,
  resolveRedirectUri,
} from "@/lib/oauth/authorize";
import {
  canGrantBits,
  computeGuildStanding,
  memberTopPosition,
  outranks,
  parseBitfield,
  standingHas,
} from "@/lib/permissions/botGuild";
import { ALL_PERMISSIONS, PERMISSION_BITS as P } from "@/lib/permissions/bits";

describe("isSafeRedirectUrl", () => {
  test("allows https anywhere and http only on loopback", () => {
    expect(isSafeRedirectUrl("https://example.com/cb")).toBe(true);
    expect(isSafeRedirectUrl("http://localhost:3000/cb")).toBe(true);
    expect(isSafeRedirectUrl("http://127.0.0.1/cb")).toBe(true);
    expect(isSafeRedirectUrl("http://example.com/cb")).toBe(false);
  });

  test("rejects script and garbage URLs", () => {
    expect(isSafeRedirectUrl("javascript:alert(1)//")).toBe(false);
    expect(isSafeRedirectUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeRedirectUrl("data:text/html,hi")).toBe(false);
    expect(isSafeRedirectUrl("/relative")).toBe(false);
    expect(isSafeRedirectUrl("")).toBe(false);
    expect(isSafeRedirectUrl(null)).toBe(false);
  });
});

describe("resolveRedirectUri", () => {
  const registered = ["https://app.example/cb", "javascript:alert(1)"];

  test("requires an exact registered match", () => {
    expect(resolveRedirectUri("https://app.example/cb", registered)).toEqual({ ok: true, uri: "https://app.example/cb" });
    expect(resolveRedirectUri("https://evil.example/cb", registered).ok).toBe(false);
    expect(resolveRedirectUri("https://app.example/cb/extra", registered).ok).toBe(false);
  });

  test("rejects unsafe schemes even when registered", () => {
    expect(resolveRedirectUri("javascript:alert(1)", registered).ok).toBe(false);
  });

  test("defaults to the only registered URI, otherwise none", () => {
    expect(resolveRedirectUri(undefined, ["https://one.example/cb"])).toEqual({ ok: true, uri: "https://one.example/cb" });
    expect(resolveRedirectUri("", registered)).toEqual({ ok: true, uri: null });
    expect(resolveRedirectUri(undefined, [])).toEqual({ ok: true, uri: null });
    expect(resolveRedirectUri(undefined, null)).toEqual({ ok: true, uri: null });
  });

  test("an unregistered redirect is rejected when the app has none", () => {
    expect(resolveRedirectUri("https://evil.example", []).ok).toBe(false);
  });
});

describe("appendQuery", () => {
  test("keeps existing params and encodes values", () => {
    const url = appendQuery("https://a.example/cb?x=1", { code: "abc", state: "a b&c" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("x")).toBe("1");
    expect(parsed.searchParams.get("code")).toBe("abc");
    expect(parsed.searchParams.get("state")).toBe("a b&c");
  });
});

describe("bot install permissions", () => {
  test("parsePermissionsParam accepts non-negative integers only", () => {
    expect(parsePermissionsParam(undefined)).toBe(0n);
    expect(parsePermissionsParam("8")).toBe(8n);
    expect(parsePermissionsParam("-8")).toBeNull();
    expect(parsePermissionsParam("abc")).toBeNull();
    expect(parsePermissionsParam("1".repeat(60))).toBeNull();
  });

  test("clampBotPermissions masks to the caller's bits unless owner/admin", () => {
    const manageServer = P.MANAGE_SERVER | P.SEND_MESSAGES;
    expect(clampBotPermissions(P.ADMINISTRATOR | P.SEND_MESSAGES, manageServer, false)).toBe(P.SEND_MESSAGES);
    expect(clampBotPermissions(P.ADMINISTRATOR, 0n, true)).toBe(P.ADMINISTRATOR);
    expect(clampBotPermissions(P.BAN_MEMBERS, P.ADMINISTRATOR, false)).toBe(P.BAN_MEMBERS);
  });
});

describe("bot guild standing", () => {
  const roles = [
    { id: "everyone", position: 0, permissions: String(P.VIEW_CHANNEL), isDefault: true },
    { id: "mod", position: 5, permissions: String(P.KICK_MEMBERS | P.MANAGE_ROLES) },
    { id: "bot", position: 3, permissions: String(P.MANAGE_ROLES | P.SEND_MESSAGES), managed: true },
    { id: "member", position: 1, permissions: "0" },
  ];

  test("computes perms and top position from held roles plus @everyone", () => {
    const s = computeGuildStanding(roles, ["bot"], false);
    expect(s.topPosition).toBe(3);
    expect(standingHas(s, P.MANAGE_ROLES)).toBe(true);
    expect(standingHas(s, P.VIEW_CHANNEL)).toBe(true);
    expect(standingHas(s, P.KICK_MEMBERS)).toBe(false);
    expect(standingHas(s, P.ADMINISTRATOR)).toBe(false);
  });

  test("owner holds everything and outranks all", () => {
    const s = computeGuildStanding(roles, [], true);
    expect(s.perms).toBe(ALL_PERMISSIONS);
    expect(outranks(s, 100)).toBe(true);
  });

  test("hierarchy: only strictly lower roles are manageable", () => {
    const s = computeGuildStanding(roles, ["bot"], false);
    expect(outranks(s, 1)).toBe(true);
    expect(outranks(s, 3)).toBe(false);
    expect(outranks(s, memberTopPosition(roles, ["mod"]))).toBe(false);
    expect(outranks(s, memberTopPosition(roles, ["member"]))).toBe(true);
  });

  test("bots may only grant bits they hold", () => {
    const s = computeGuildStanding(roles, ["bot"], false);
    expect(canGrantBits(s, P.SEND_MESSAGES)).toBe(true);
    expect(canGrantBits(s, P.ADMINISTRATOR)).toBe(false);
    const admin = computeGuildStanding([{ id: "a", position: 2, permissions: String(P.ADMINISTRATOR) }], ["a"], false);
    expect(canGrantBits(admin, P.ADMINISTRATOR | P.BAN_MEMBERS)).toBe(true);
  });

  test("parseBitfield rejects malformed values", () => {
    expect(parseBitfield("8")).toBe(8n);
    expect(parseBitfield(undefined)).toBe(0n);
    expect(parseBitfield("8n")).toBeNull();
    expect(parseBitfield(-1)).toBeNull();
  });
});
