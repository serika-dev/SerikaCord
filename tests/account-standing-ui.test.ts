import { describe, expect, test } from "bun:test";
import { appealFor, formatRemaining, STANDING_LEVELS, type StandingData } from "../src/components/safety/standingShared";
import { isAccountRestricted } from "../src/components/safety/openAccountStanding";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("account standing countdown", () => {
  test("formats remaining time compactly", () => {
    expect(formatRemaining(30_000)).toBe("<1m");
    expect(formatRemaining(12 * MIN + 5_000)).toBe("12m");
    expect(formatRemaining(23 * HOUR + 12 * MIN)).toBe("23h 12m");
    expect(formatRemaining(5 * HOUR)).toBe("5h");
    expect(formatRemaining(3 * 24 * HOUR + 4 * HOUR + 30 * MIN)).toBe("3d 4h");
    expect(formatRemaining(7 * 24 * HOUR)).toBe("7d");
  });

  test("meter steps follow the server's standing levels", () => {
    expect(STANDING_LEVELS).toEqual(["all_good", "limited", "very_limited", "at_risk", "suspended"]);
  });
});

describe("restricted send detection", () => {
  test("recognises the account_restricted 403 body only", () => {
    expect(isAccountRestricted({ code: "account_restricted", restrictedUntil: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isAccountRestricted({ error: "You are timed out from this server" })).toBe(false);
    expect(isAccountRestricted(null)).toBe(false);
    expect(isAccountRestricted("account_restricted")).toBe(false);
  });
});

describe("restriction appeals", () => {
  test("finds the user's appeal for a restriction by id", () => {
    const standing = {
      appeals: [
        { id: "a1", targetType: "restriction", targetId: "r1", status: "open", staffNote: null, createdAt: "", message: "" },
        { id: "a2", targetType: "strike", targetId: "r2", status: "denied", staffNote: "no", createdAt: "", message: "" },
      ],
    } as unknown as StandingData;
    expect(appealFor(standing, "restriction", "r1")).toEqual({ id: "a1", status: "open", staffNote: null });
    expect(appealFor(standing, "restriction", "r2")).toBeNull();
  });
});
