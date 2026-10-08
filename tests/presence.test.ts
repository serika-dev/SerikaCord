import { describe, expect, test } from "bun:test";
import { PRESENCE_TIMEOUT_MS, isPresenceStale, resolveEffectiveStatus } from "@/lib/services/presence";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const fresh = new Date(NOW - 10_000);
const stale = new Date(NOW - PRESENCE_TIMEOUT_MS - 1);

describe("isPresenceStale", () => {
  test("a heartbeat inside the timeout is fresh", () => {
    expect(isPresenceStale(fresh, NOW)).toBeFalse();
    expect(isPresenceStale(NOW - PRESENCE_TIMEOUT_MS, NOW)).toBeFalse();
  });

  test("an old, missing or unparseable heartbeat is stale", () => {
    expect(isPresenceStale(stale, NOW)).toBeTrue();
    expect(isPresenceStale(null, NOW)).toBeTrue();
    expect(isPresenceStale(undefined, NOW)).toBeTrue();
    expect(isPresenceStale("not a date", NOW)).toBeTrue();
    expect(isPresenceStale(Number.NaN, NOW)).toBeTrue();
  });

  test("accepts ISO strings and epoch numbers", () => {
    expect(isPresenceStale(fresh.toISOString(), NOW)).toBeFalse();
    expect(isPresenceStale(fresh.getTime(), NOW)).toBeFalse();
  });
});

describe("resolveEffectiveStatus", () => {
  test("keeps the chosen status while the heartbeat is fresh", () => {
    for (const status of ["online", "idle", "dnd"] as const) {
      expect(resolveEffectiveStatus({ status, presenceLastHeartbeatAt: fresh }, NOW)).toBe(status);
    }
    expect(resolveEffectiveStatus({ status: "DND", presenceLastHeartbeatAt: fresh }, NOW)).toBe("dnd");
  });

  test("shows offline once the heartbeat is stale, whatever the status", () => {
    expect(resolveEffectiveStatus({ status: "online", presenceLastHeartbeatAt: stale }, NOW)).toBe("offline");
    expect(resolveEffectiveStatus({ status: "dnd", presenceLastHeartbeatAt: null }, NOW)).toBe("offline");
  });

  test("invisible and offline never leak as online", () => {
    expect(resolveEffectiveStatus({ status: "invisible", presenceLastHeartbeatAt: fresh }, NOW)).toBe("offline");
    expect(resolveEffectiveStatus({ status: "offline", presenceLastHeartbeatAt: fresh }, NOW)).toBe("offline");
    expect(resolveEffectiveStatus({ status: null, presenceLastHeartbeatAt: fresh }, NOW)).toBe("offline");
    expect(resolveEffectiveStatus({ status: "weird", presenceLastHeartbeatAt: fresh }, NOW)).toBe("offline");
  });

  test("system users are always online", () => {
    expect(resolveEffectiveStatus({ isSystem: true, status: "offline", presenceLastHeartbeatAt: null }, NOW)).toBe("online");
  });
});
