import { describe, expect, test } from "bun:test";
import {
  MAX_STRIKES,
  activeStrikeCount,
  computeStandingLevel,
  isRestrictionActive,
  isStrikeActive,
  normalizeAppealMessage,
  normalizeStrikeCategory,
  reachesSuspension,
  strikeExpiry,
} from "@/lib/safety/standing";
import {
  dHashFromGrayscale,
  findClosestHash,
  hammingDistance,
  isScannableImage,
  normalizeHash,
  sniffImageType,
} from "@/lib/safety/imageHash";
import { isPhotoDnaNativeType, parsePhotoDnaResponse } from "@/lib/safety/photoDna";

const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("account standing", () => {
  test("strikes expire or get revoked", () => {
    expect(isStrikeActive({ createdAt: new Date(NOW - 1000), expiresAt: new Date(NOW + 1000) }, NOW)).toBe(true);
    expect(isStrikeActive({ createdAt: new Date(NOW - 1000), expiresAt: new Date(NOW - 1) }, NOW)).toBe(false);
    expect(isStrikeActive({ createdAt: new Date(NOW - 1000), expiresAt: null }, NOW)).toBe(true);
    expect(isStrikeActive({ createdAt: new Date(NOW - 1000), revokedAt: new Date(NOW) }, NOW)).toBe(false);
    expect(strikeExpiry(new Date(NOW), 10).getTime()).toBe(NOW + 10 * 86400_000);
    expect(activeStrikeCount([{ createdAt: null }, { createdAt: null, revokedAt: "x" }], NOW)).toBe(1);
  });

  test("restrictions are active until lifted or over", () => {
    expect(isRestrictionActive({ until: new Date(NOW + 60_000) }, NOW)).toBe(true);
    expect(isRestrictionActive({ until: new Date(NOW + 60_000), liftedAt: new Date(NOW) }, NOW)).toBe(false);
    expect(isRestrictionActive({ until: new Date(NOW - 1) }, NOW)).toBe(false);
  });

  test("standing levels", () => {
    expect(computeStandingLevel({ banned: false, activeStrikes: 0, activeRestrictions: 0 })).toBe("all_good");
    expect(computeStandingLevel({ banned: false, activeStrikes: 0, activeRestrictions: 1 })).toBe("limited");
    expect(computeStandingLevel({ banned: false, activeStrikes: 1, activeRestrictions: 0 })).toBe("limited");
    expect(computeStandingLevel({ banned: false, activeStrikes: 2, activeRestrictions: 0 })).toBe("very_limited");
    expect(computeStandingLevel({ banned: false, activeStrikes: 4, activeRestrictions: 0 })).toBe("at_risk");
    expect(computeStandingLevel({ banned: true, activeStrikes: 0, activeRestrictions: 0 })).toBe("suspended");
    expect(MAX_STRIKES).toBe(5);
    expect(reachesSuspension(4)).toBe(false);
    expect(reachesSuspension(5)).toBe(true);
  });

  test("input normalisation", () => {
    expect(normalizeStrikeCategory("scam")).toBe("scam");
    expect(normalizeStrikeCategory("bogus")).toBe("other");
    expect(normalizeAppealMessage("too short")).toBeNull();
    expect(normalizeAppealMessage("  I did not post that image, my account was hacked.  ")).toBe("I did not post that image, my account was hacked.");
  });
});

describe("scam image hashing", () => {
  test("dHash bits from a gradient", () => {
    // Each row decreasing left→right: every pixel brighter than its right neighbour → all ones.
    const decreasing = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(dHashFromGrayscale(decreasing)).toBe("ffffffffffffffff");
    const increasing = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
    expect(dHashFromGrayscale(increasing)).toBe("0000000000000000");
  });

  test("hamming distance and closest match", () => {
    expect(hammingDistance("ffffffffffffffff", "fffffffffffffffe")).toBe(1);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("zz", "ffffffffffffffff")).toBe(64);
    const list = [{ hash: "ffffffffffffff00", id: "a" }, { hash: "fffffffffffffff0", id: "b" }];
    expect(findClosestHash("ffffffffffffffff", list, 6)?.entry.id).toBe("b");
    expect(findClosestHash("0000000000000000", list, 6)).toBeNull();
    expect(normalizeHash(" 0xABCDEF0123456789 ")).toBe("abcdef0123456789");
    expect(normalizeHash("abc")).toBeNull();
  });

  test("what gets scanned", () => {
    expect(isScannableImage("image/png")).toBe(true);
    expect(isScannableImage("image/svg+xml")).toBe(false);
    expect(isScannableImage("video/mp4")).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(png)).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("hello world, not an image"))).toBeNull();
  });
});

describe("PhotoDNA responses", () => {
  test("match with flags, test source detection", () => {
    const r = parsePhotoDnaResponse(200, {
      Status: { Code: 3000, Description: "OK" },
      IsMatch: true,
      TrackingId: "WUS_1",
      MatchDetails: { MatchFlags: [{ AdvancedInfo: [{ Key: "MatchId", Value: "7469692" }], Source: "Test", Violations: ["A1"], MatchDistance: 179 }] },
    });
    expect(r).toEqual({ status: "match", trackingId: "WUS_1", isTestSource: true, flags: [{ source: "Test", violations: ["A1"], matchDistance: 179, matchId: "7469692" }] });
  });

  test("clean, service errors and key failover", () => {
    expect(parsePhotoDnaResponse(200, { Status: { Code: 3000 }, IsMatch: false, TrackingId: "x" })).toEqual({ status: "clean", trackingId: "x" });
    expect(parsePhotoDnaResponse(200, { Status: { Code: 3208, Description: "too small" } })).toMatchObject({ status: "error", code: 3208, retryWithOtherKey: false });
    expect(parsePhotoDnaResponse(401, null)).toMatchObject({ status: "error", retryWithOtherKey: true });
    expect(parsePhotoDnaResponse(429, {})).toMatchObject({ status: "error", retryWithOtherKey: true });
    expect(parsePhotoDnaResponse(503, null)).toMatchObject({ status: "error", retryWithOtherKey: true });
    expect(isPhotoDnaNativeType("image/JPEG")).toBe(true);
    expect(isPhotoDnaNativeType("image/webp")).toBe(false);
  });
});
