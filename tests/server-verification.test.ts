import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_AGE_MS,
  MEMBER_AGE_MS,
  evaluateVerificationGate,
  flagSensitiveMedia,
  isFilterableMedia,
  normalizeContentFilter,
  normalizeVerificationLevel,
  shouldFilterMedia,
} from "@/lib/servers/verification";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const old = new Date(NOW - 24 * 3600_000);

describe("verification level", () => {
  test("normalizes stored values", () => {
    expect(normalizeVerificationLevel("medium")).toBe("medium");
    expect(normalizeVerificationLevel(3)).toBe("high");
    expect(normalizeVerificationLevel("bogus")).toBe("none");
    expect(normalizeContentFilter(2)).toBe("all_members");
    expect(normalizeContentFilter(undefined)).toBe("disabled");
  });

  test("none never blocks", () => {
    expect(evaluateVerificationGate({ level: "none", roleCount: 0, emailVerified: false, now: NOW }).blocked).toBe(false);
  });

  test("low needs a verified email", () => {
    const r = evaluateVerificationGate({ level: "low", roleCount: 0, emailVerified: false, accountCreatedAt: old, now: NOW });
    expect(r).toEqual({ blocked: true, reason: "email", until: null });
    expect(evaluateVerificationGate({ level: "low", roleCount: 0, emailVerified: true, now: NOW }).blocked).toBe(false);
  });

  test("medium needs a 5 minute old account", () => {
    const created = new Date(NOW - 60_000);
    const r = evaluateVerificationGate({ level: "medium", roleCount: 0, emailVerified: true, accountCreatedAt: created, now: NOW });
    expect(r.reason).toBe("account_age");
    expect(r.until).toBe(new Date(created.getTime() + ACCOUNT_AGE_MS).toISOString());
    expect(evaluateVerificationGate({ level: "medium", roleCount: 0, emailVerified: true, accountCreatedAt: old, now: NOW }).blocked).toBe(false);
  });

  test("high and very_high need 10 minutes of membership", () => {
    const joined = new Date(NOW - 2 * 60_000);
    for (const level of ["high", "very_high"] as const) {
      const r = evaluateVerificationGate({ level, roleCount: 0, emailVerified: true, accountCreatedAt: old, memberJoinedAt: joined, now: NOW });
      expect(r.reason).toBe("member_age");
      expect(r.until).toBe(new Date(joined.getTime() + MEMBER_AGE_MS).toISOString());
    }
    expect(
      evaluateVerificationGate({ level: "high", roleCount: 0, emailVerified: true, accountCreatedAt: old, memberJoinedAt: old, now: NOW }).blocked,
    ).toBe(false);
  });

  test("members with a role and exempt users are never gated", () => {
    expect(evaluateVerificationGate({ level: "very_high", roleCount: 1, emailVerified: false, now: NOW }).blocked).toBe(false);
    expect(evaluateVerificationGate({ level: "very_high", roleCount: 0, exempt: true, emailVerified: false, now: NOW }).blocked).toBe(false);
  });
});

describe("explicit media content filter", () => {
  test("who gets scanned", () => {
    expect(shouldFilterMedia({ filter: "disabled", roleCount: 0 })).toBe(false);
    expect(shouldFilterMedia({ filter: "members_without_roles", roleCount: 0 })).toBe(true);
    expect(shouldFilterMedia({ filter: "members_without_roles", roleCount: 2 })).toBe(false);
    expect(shouldFilterMedia({ filter: "members_without_roles", roleCount: 0, exempt: true })).toBe(false);
    expect(shouldFilterMedia({ filter: "all_members", roleCount: 5 })).toBe(true);
    expect(shouldFilterMedia({ filter: "all_members", roleCount: 5, channelNsfw: true })).toBe(false);
  });

  test("flags only images and videos", () => {
    expect(isFilterableMedia("image/png")).toBe(true);
    expect(isFilterableMedia("VIDEO/mp4")).toBe(true);
    expect(isFilterableMedia("application/pdf")).toBe(false);
    const out = flagSensitiveMedia([{ contentType: "image/png" }, { contentType: "text/plain" }]);
    expect(out[0].sensitive).toBe(true);
    expect(out[1].sensitive).toBeUndefined();
  });
});
