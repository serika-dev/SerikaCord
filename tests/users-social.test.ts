import { describe, expect, test } from "bun:test";
import { addId, dedupeIds, hasId, removeId } from "@/lib/social/friendLists";
import { normalizeDisplayName } from "@/lib/utils/normalizeDisplayName";
import { isOwnedMediaKey } from "@/lib/utils/ownedMedia";
import { shouldPromoteToOnline, toClientStatus, toServerStatus } from "@/lib/presenceChoice";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("friendLists", () => {
  test("addId never duplicates", () => {
    expect(addId([A], A)).toEqual([A]);
    expect(addId([A, A], B)).toEqual([A, B]);
    expect(addId(null, A)).toEqual([A]);
  });

  test("removeId drops every copy and dedupes the rest", () => {
    expect(removeId([A, B, A, B], A)).toEqual([B]);
    expect(removeId(undefined, A)).toEqual([]);
  });

  test("dedupeIds keeps order and skips empties", () => {
    expect(dedupeIds([B, A, B, ""])).toEqual([B, A]);
    expect(hasId([A], B)).toBeFalse();
    expect(hasId([A], A)).toBeTrue();
  });
});

describe("normalizeDisplayName", () => {
  test("blank or invisible-only names become null", () => {
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("​‍﻿ ")).toBeNull();
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
  });

  test("trims and caps at 32 characters", () => {
    expect(normalizeDisplayName("  Serika  ")).toBe("Serika");
    expect(normalizeDisplayName("x".repeat(50))).toHaveLength(32);
    expect(normalizeDisplayName(42)).toBe("42");
  });
});

describe("isOwnedMediaKey", () => {
  test("accepts keys inside the owner prefix", () => {
    expect(isOwnedMediaKey(`avatars/${A}/pic.webp`, `avatars/${A}/`)).toBeTrue();
  });

  test("rejects other owners, traversal and empty keys", () => {
    expect(isOwnedMediaKey(`avatars/${B}/pic.webp`, `avatars/${A}/`)).toBeFalse();
    expect(isOwnedMediaKey(`avatars/${A}/../${B}/pic.webp`, `avatars/${A}/`)).toBeFalse();
    expect(isOwnedMediaKey(`avatars/${A}/`, `avatars/${A}/`)).toBeFalse();
    expect(isOwnedMediaKey("", `avatars/${A}/`)).toBeFalse();
    expect(isOwnedMediaKey(`avatars/${A}/x`, `avatars/${A}`)).toBeFalse();
  });
});

describe("presenceChoice", () => {
  test("Invisible round-trips through the server value", () => {
    expect(toServerStatus("offline")).toBe("invisible");
    expect(toServerStatus("dnd")).toBe("dnd");
    expect(toClientStatus("invisible")).toBe("offline");
    expect(toClientStatus("idle")).toBe("idle");
    expect(toClientStatus(undefined)).toBe("online");
  });

  test("explicit DND / Invisible are never promoted to online", () => {
    expect(shouldPromoteToOnline("dnd")).toBeFalse();
    expect(shouldPromoteToOnline("invisible")).toBeFalse();
    expect(shouldPromoteToOnline("idle")).toBeTrue();
    expect(shouldPromoteToOnline("offline")).toBeTrue();
  });
});
