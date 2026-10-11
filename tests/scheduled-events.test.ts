import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ACTIVE_MS,
  canTransition,
  cleanEventImage,
  defaultEventStart,
  eventAutoEndAt,
  fromLocalInputValue,
  isStartingSoon,
  nextAutoStatus,
  normalizeEventInput,
  sortEvents,
  startNotifyRecipients,
  toLocalInputValue,
  type StoredEventFields,
} from "../src/lib/chat/scheduledEvents";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const CH = "11111111-2222-3333-4444-555555555555";
const iso = (ms: number) => new Date(ms).toISOString();

describe("normalizeEventInput (create)", () => {
  test("voice event needs a channel and a future start", () => {
    const ok = normalizeEventInput({ name: " Movie night ", entityType: "voice", channelId: CH, startAt: iso(NOW + HOUR) }, { now: NOW });
    expect("value" in ok && ok.value.name).toBe("Movie night");
    expect(normalizeEventInput({ name: "x", entityType: "voice", startAt: iso(NOW + HOUR) }, { now: NOW })).toEqual({ error: "Choose a channel for the event" });
    expect(normalizeEventInput({ name: "x", entityType: "voice", channelId: CH, startAt: iso(NOW - HOUR) }, { now: NOW })).toEqual({ error: "The start time must be in the future" });
  });

  test("external event needs a location and an end time after the start", () => {
    const base = { name: "Meetup", entityType: "external", location: "Park", startAt: iso(NOW + HOUR) };
    expect(normalizeEventInput(base, { now: NOW })).toEqual({ error: "Events somewhere else need an end time" });
    expect(normalizeEventInput({ ...base, endAt: iso(NOW + HOUR) }, { now: NOW })).toEqual({ error: "The end time must be after the start time" });
    const ok = normalizeEventInput({ ...base, endAt: iso(NOW + 2 * HOUR), channelId: CH }, { now: NOW });
    expect("value" in ok && ok.value.channelId).toBeNull();
    expect(normalizeEventInput({ ...base, location: "  ", endAt: iso(NOW + 2 * HOUR) }, { now: NOW })).toEqual({ error: "Enter where the event takes place" });
  });

  test("rejects missing topic, bad type and foreign cover images", () => {
    expect(normalizeEventInput({ entityType: "voice", channelId: CH, startAt: iso(NOW + HOUR) }, { now: NOW })).toEqual({ error: "Event topic is required" });
    expect(normalizeEventInput({ name: "x", entityType: "text", channelId: CH, startAt: iso(NOW + HOUR) }, { now: NOW })).toEqual({ error: "Invalid event location type" });
    const r = normalizeEventInput(
      { name: "x", entityType: "voice", channelId: CH, startAt: iso(NOW + HOUR), image: "https://evil.example/a.png" },
      { now: NOW, imagePrefixes: ["https://cdn.serika.chat"] },
    );
    expect(r).toEqual({ error: "Invalid cover image" });
  });
});

describe("normalizeEventInput (edit)", () => {
  const existing: StoredEventFields = {
    name: "Old", description: null, entityType: "voice", channelId: CH, location: null, image: null,
    startAt: new Date(NOW - HOUR), endAt: null, status: "active",
  };
  test("an active event keeps its past start when only the name changes", () => {
    const r = normalizeEventInput({ name: "New" }, { now: NOW, existing });
    expect("value" in r && r.value.name).toBe("New");
    expect("value" in r && r.value.startAt.getTime()).toBe(NOW - HOUR);
  });
  test("switching to external requires a location", () => {
    expect(normalizeEventInput({ entityType: "external" }, { now: NOW, existing: { ...existing, status: "scheduled", startAt: new Date(NOW + HOUR) } }))
      .toEqual({ error: "Enter where the event takes place" });
  });
});

describe("cleanEventImage", () => {
  test("accepts only our CDN", () => {
    expect(cleanEventImage("https://cdn.serika.chat/event-covers/a.png", ["https://cdn.serika.chat"])).toBe("https://cdn.serika.chat/event-covers/a.png");
    expect(cleanEventImage("https://cdn.serika.chat.evil.com/a.png", ["https://cdn.serika.chat"])).toBe("invalid");
    expect(cleanEventImage("javascript:alert(1)", ["https://cdn.serika.chat"])).toBe("invalid");
    expect(cleanEventImage("", ["https://cdn.serika.chat"])).toBeNull();
  });
});

describe("status rules", () => {
  test("manual transitions", () => {
    expect(canTransition("scheduled", "active")).toBe(true);
    expect(canTransition("scheduled", "canceled")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
    expect(canTransition("active", "canceled")).toBe(false);
    expect(canTransition("completed", "active")).toBe(false);
  });

  test("auto start and end", () => {
    expect(nextAutoStatus({ status: "scheduled", startAt: iso(NOW + 1000) }, NOW)).toBeNull();
    expect(nextAutoStatus({ status: "scheduled", startAt: iso(NOW - 1000) }, NOW)).toBe("active");
    expect(nextAutoStatus({ status: "scheduled", startAt: iso(NOW - 2 * HOUR), endAt: iso(NOW - HOUR) }, NOW)).toBe("completed");
    expect(nextAutoStatus({ status: "active", startAt: iso(NOW - HOUR), endAt: iso(NOW + HOUR) }, NOW)).toBeNull();
    expect(nextAutoStatus({ status: "active", startAt: iso(NOW - DEFAULT_ACTIVE_MS - 1) }, NOW)).toBe("completed");
    expect(nextAutoStatus({ status: "canceled", startAt: iso(NOW - HOUR) }, NOW)).toBeNull();
  });

  test("auto end counts from a late manual start", () => {
    expect(eventAutoEndAt({ startAt: iso(NOW - 5 * HOUR), startedAt: iso(NOW) })).toBe(NOW + DEFAULT_ACTIVE_MS);
  });
});

describe("helpers", () => {
  test("live events sort first, then by start", () => {
    const out = sortEvents([
      { id: "b", status: "scheduled", startAt: iso(NOW + 2 * HOUR) },
      { id: "a", status: "scheduled", startAt: iso(NOW + HOUR) },
      { id: "c", status: "active", startAt: iso(NOW + 3 * HOUR) },
    ]);
    expect(out.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  test("starting soon", () => {
    expect(isStartingSoon({ status: "scheduled", startAt: iso(NOW + 30 * 60 * 1000) }, NOW)).toBe(true);
    expect(isStartingSoon({ status: "scheduled", startAt: iso(NOW + 3 * HOUR) }, NOW)).toBe(false);
    expect(isStartingSoon({ status: "active", startAt: iso(NOW) }, NOW)).toBe(false);
  });

  test("start notification skips the starter and duplicates", () => {
    expect(startNotifyRecipients(["A", "b", "a", "c"], "C")).toEqual(["A", "b"]);
  });

  test("datetime-local round trip and default start", () => {
    const d = new Date(2026, 9, 11, 14, 30);
    expect(toLocalInputValue(d)).toBe("2026-10-11T14:30");
    expect(fromLocalInputValue("2026-10-11T14:30")).toBe(d.toISOString());
    expect(fromLocalInputValue("")).toBeNull();
    const start = defaultEventStart(new Date(2026, 9, 11, 14, 30).getTime());
    expect(start.getHours()).toBe(15);
    expect(start.getMinutes()).toBe(0);
  });
});
