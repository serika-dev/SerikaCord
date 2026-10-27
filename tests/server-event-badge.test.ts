import { describe, expect, test } from "bun:test";
import { STARTING_SOON_MS } from "../src/lib/chat/scheduledEvents";
import { eventBadgeState, pickServerActiveEvent, type RailEventCandidate } from "../src/lib/chat/serverEventBadge";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000);
const row = (id: string, status: string, startMin: number, name = id): RailEventCandidate => ({ id, name, status, startAt: at(startMin) });

describe("pickServerActiveEvent", () => {
  test("nothing to show", () => {
    expect(pickServerActiveEvent([], NOW)).toBeNull();
    expect(pickServerActiveEvent([row("later", "scheduled", 90)], NOW)).toBeNull();
    expect(pickServerActiveEvent([row("done", "completed", -10), row("gone", "canceled", 5)], NOW)).toBeNull();
  });

  test("a live event wins over one starting soon", () => {
    const pick = pickServerActiveEvent([row("soon", "scheduled", 5), row("live", "active", -30)], NOW);
    expect(pick).toEqual({ id: "live", name: "live", status: "active", startAt: at(-30).toISOString() });
  });

  test("the longest-running live event, else the next to start", () => {
    expect(pickServerActiveEvent([row("b", "active", -5), row("a", "active", -60)], NOW)?.id).toBe("a");
    expect(pickServerActiveEvent([row("b", "scheduled", 40), row("a", "scheduled", 10)], NOW)?.id).toBe("a");
  });

  test("the one-hour window is inclusive, and overdue scheduled events still count", () => {
    expect(pickServerActiveEvent([row("edge", "scheduled", STARTING_SOON_MS / 60_000)], NOW)?.id).toBe("edge");
    expect(pickServerActiveEvent([row("overdue", "scheduled", -1)], NOW)?.status).toBe("scheduled");
  });

  test("accepts ISO strings and skips bad dates", () => {
    expect(pickServerActiveEvent([{ id: "s", name: "S", status: "active", startAt: at(-1).toISOString() }], NOW)?.id).toBe("s");
    expect(pickServerActiveEvent([{ id: "x", name: "X", status: "active", startAt: "nope" }], NOW)).toBeNull();
  });
});

describe("eventBadgeState", () => {
  test("live", () => {
    expect(eventBadgeState({ id: "e", name: "Movie night", status: "active", startAt: at(-10).toISOString() }, NOW))
      .toEqual({ kind: "live", eventId: "e", name: "Movie night" });
  });

  test("starting soon rounds up to whole minutes, at least 1", () => {
    const soon = (min: number) => eventBadgeState({ id: "e", name: "Raid", status: "scheduled", startAt: at(min).toISOString() }, NOW);
    expect(soon(20)).toEqual({ kind: "soon", eventId: "e", name: "Raid", minutes: 20 });
    expect(soon(19.2)).toMatchObject({ minutes: 20 });
    expect(soon(0)).toMatchObject({ kind: "soon", minutes: 1 });
    expect(soon(-2)).toMatchObject({ kind: "soon", minutes: 1 });
  });

  test("no badge past the window, for missing or malformed events", () => {
    expect(eventBadgeState({ id: "e", name: "Later", status: "scheduled", startAt: at(61).toISOString() }, NOW)).toBeNull();
    expect(eventBadgeState(null, NOW)).toBeNull();
    expect(eventBadgeState(undefined, NOW)).toBeNull();
    expect(eventBadgeState({ id: "e", name: "Bad", status: "scheduled", startAt: "soon" }, NOW)).toBeNull();
  });
});
