import { describe, expect, test } from "bun:test";
import {
  normalizeMetadataValue,
  parseStoredMetadata,
  serializeUserRoleConnection,
  validateRoleConnectionMetadata,
  validateUserRoleConnection,
  type RoleConnectionMetadataRecord,
} from "@/lib/botapi/roleConnections";

const RECORDS: RoleConnectionMetadataRecord[] = [
  { type: 2, key: "level", name: "Level", description: "Minimum level" },
  { type: 6, key: "joined", name: "Joined", description: "Joined before" },
  { type: 7, key: "pro", name: "Pro", description: "Has pro" },
];

describe("role connection metadata", () => {
  test("accepts Discord-shaped records and normalizes them", () => {
    const r = validateRoleConnectionMetadata([
      { type: 2, key: "level", name: " Level ", description: "Minimum level", name_localizations: { fr: "Niveau" } },
    ]);
    expect(r).toEqual({ ok: true, records: [{ type: 2, key: "level", name: "Level", description: "Minimum level", name_localizations: { fr: "Niveau" } }] });
    expect(validateRoleConnectionMetadata([])).toEqual({ ok: true, records: [] });
  });

  test("rejects bad bodies with 50035 trees", () => {
    const notArray = validateRoleConnectionMetadata({});
    expect(notArray.ok).toBe(false);
    const tooMany = validateRoleConnectionMetadata(Array.from({ length: 6 }, (_, i) => ({ type: 1, key: `k${i}`, name: "n", description: "d" })));
    expect(tooMany.ok).toBe(false);
    const bad = validateRoleConnectionMetadata([
      { type: 9, key: "Bad Key", name: "", description: "x".repeat(201) },
      { type: 1, key: "dup", name: "a", description: "b" },
      { type: 1, key: "dup", name: "a", description: "b" },
      { type: 1, key: "loc", name: "a", description: "b", name_localizations: { xx: "nope" } },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe(50035);
      expect(Object.keys(bad.error.errors)).toEqual(["0", "2", "3"]);
      expect(Object.keys(bad.error.errors["0"] as object).sort()).toEqual(["description", "key", "name", "type"]);
    }
  });

  test("stored metadata keeps only valid records", () => {
    expect(parseStoredMetadata(null)).toEqual([]);
    expect(parseStoredMetadata([{ type: 1, key: "ok", name: "a", description: "b" }, { type: 0, key: "bad" }])).toEqual([
      { type: 1, key: "ok", name: "a", description: "b" },
    ]);
  });
});

describe("metadata values", () => {
  test("integers, datetimes and booleans", () => {
    expect(normalizeMetadataValue(1, 5)).toBe("5");
    expect(normalizeMetadataValue(3, "-12")).toBe("-12");
    expect(normalizeMetadataValue(2, "1.5")).toBeNull();
    expect(normalizeMetadataValue(2, "99999999999999999999")).toBeNull();
    expect(normalizeMetadataValue(5, "2024-01-02T03:04:05Z")).toBe("2024-01-02T03:04:05.000Z");
    expect(normalizeMetadataValue(6, "yesterday")).toBeNull();
    expect(normalizeMetadataValue(7, true)).toBe("1");
    expect(normalizeMetadataValue(8, "0")).toBe("0");
    expect(normalizeMetadataValue(8, "maybe")).toBeNull();
  });
});

describe("user role connection", () => {
  test("validates against the app's records", () => {
    const r = validateUserRoleConnection({ platform_name: "Game", platform_username: "neo", metadata: { level: 30, joined: "2023-05-01", pro: true } }, RECORDS, null);
    expect(r).toEqual({
      ok: true,
      connection: { platform_name: "Game", platform_username: "neo", metadata: { level: "30", joined: "2023-05-01T00:00:00.000Z", pro: "1" } },
    });
  });

  test("absent fields keep their stored value; null clears", () => {
    const current = { platform_name: "Game", platform_username: "neo", metadata: { level: "3" } };
    expect(validateUserRoleConnection({ platform_username: null }, RECORDS, current)).toEqual({
      ok: true,
      connection: { platform_name: "Game", platform_username: null, metadata: { level: "3" } },
    });
  });

  test("rejects unknown keys, wrong types and long names", () => {
    const r = validateUserRoleConnection({ platform_name: "x".repeat(51), metadata: { nope: "1", level: "abc" } }, RECORDS, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.error.errors).sort()).toEqual(["metadata", "platform_name"]);
      expect(Object.keys(r.error.errors.metadata as object).sort()).toEqual(["level", "nope"]);
    }
    expect(validateUserRoleConnection([], RECORDS, null).ok).toBe(false);
  });

  test("serialization drops keys the app no longer defines", () => {
    expect(serializeUserRoleConnection({ platformName: "G", platformUsername: null, metadata: { level: "1", gone: "2" } }, RECORDS)).toEqual({
      platform_name: "G",
      platform_username: null,
      metadata: { level: "1" },
    });
    expect(serializeUserRoleConnection(null, RECORDS)).toEqual({ platform_name: null, platform_username: null, metadata: {} });
  });
});
