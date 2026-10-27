import { describe, expect, test } from "bun:test";
import {
  browseChannelCount,
  canViewMembersPage,
  channelIdFromSegment,
  groupBrowseChannels,
  memberNameColor,
  memberSignals,
  relativeAge,
  samePicks,
  toggleOnboardingPick,
  unansweredRequired,
  visibleMemberRoles,
} from "../src/lib/servers/serverPages";
import { filterAndSortMembers } from "../src/lib/servers/memberView";

const single = { id: "q1", multiple: false, required: false, options: [{ id: "a" }, { id: "b" }] };
const singleRequired = { ...single, id: "q2", required: true, options: [{ id: "c" }, { id: "d" }] };
const multi = { id: "q3", multiple: true, required: false, options: [{ id: "e" }, { id: "f" }] };
const multiRequired = { ...multi, id: "q4", required: true, options: [{ id: "g" }, { id: "h" }] };

describe("Members page visibility", () => {
  test("needs a moderation permission or ownership", () => {
    const none = () => false;
    expect(canViewMembersPage(none)).toBe(false);
    expect(canViewMembersPage(none, true)).toBe(true);
    for (const key of ["MANAGE_SERVER", "KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS"] as const) {
      expect(canViewMembersPage((k) => k === key)).toBe(true);
    }
  });
});

describe("toggleOnboardingPick", () => {
  test("single choice switches and can be cleared when optional", () => {
    expect(toggleOnboardingPick(single, ["x"], "a").next).toEqual(["x", "a"]);
    expect(toggleOnboardingPick(single, ["a", "x"], "b").next).toEqual(["x", "b"]);
    expect(toggleOnboardingPick(single, ["a"], "a")).toEqual({ next: [], blocked: null });
  });

  test("a required single choice keeps its pick", () => {
    expect(toggleOnboardingPick(singleRequired, ["c"], "c")).toEqual({ next: ["c"], blocked: "required" });
    expect(toggleOnboardingPick(singleRequired, ["c"], "d").next).toEqual(["d"]);
  });

  test("multiple choice toggles; a required one keeps its last pick", () => {
    expect(toggleOnboardingPick(multi, ["e"], "f").next).toEqual(["e", "f"]);
    expect(toggleOnboardingPick(multi, ["e", "f"], "e").next).toEqual(["f"]);
    expect(toggleOnboardingPick(multi, ["e"], "e").next).toEqual([]);
    expect(toggleOnboardingPick(multiRequired, ["g", "h"], "g").next).toEqual(["h"]);
    expect(toggleOnboardingPick(multiRequired, ["g"], "g").blocked).toBe("required");
  });

  test("ignores options of other questions", () => {
    expect(toggleOnboardingPick(single, ["e"], "e")).toEqual({ next: ["e"], blocked: null });
  });

  test("unansweredRequired lists only required questions without a pick", () => {
    const qs = [single, singleRequired, multi, multiRequired];
    expect(unansweredRequired(qs, [])).toEqual(["q2", "q4"]);
    expect(unansweredRequired(qs, ["d", "h"])).toEqual([]);
  });

  test("samePicks ignores order", () => {
    expect(samePicks(["a", "b"], ["b", "a"])).toBe(true);
    expect(samePicks(["a"], ["a", "b"])).toBe(false);
    expect(samePicks(["a", "c"], ["a", "b"])).toBe(false);
  });
});

describe("groupBrowseChannels", () => {
  const channels = [
    { id: "cat2", name: "Voice", type: "category", position: 2 },
    { id: "cat1", name: "Info", type: "category", position: 1 },
    { id: "empty", name: "Empty", type: "category", position: 3 },
    { id: "v1", name: "lounge", type: "voice", position: 0, parentId: "cat1" },
    { id: "t2", name: "rules", type: "text", position: 2, parentId: "cat1" },
    { id: "t1", name: "welcome", type: "announcement", position: 1, parentId: "cat1" },
    { id: "v2", name: "music", type: "voice", position: 0, parentId: "cat2" },
    { id: "loose", name: "general", type: "text", position: 0 },
    { id: "orphan", name: "old", type: "text", position: 5, parentId: "gone" },
    { id: "th", name: "a thread", type: "public_thread", position: 0, parentId: "t2" },
  ];

  test("uncategorized first, then categories in order; text before voice; threads and empty categories dropped", () => {
    const sections = groupBrowseChannels(channels);
    expect(sections.map((s) => s.category?.id ?? null)).toEqual([null, "cat1", "cat2"]);
    expect(sections[0].channels.map((c) => c.id)).toEqual(["loose", "orphan"]);
    expect(sections[1].channels.map((c) => c.id)).toEqual(["t1", "t2", "v1"]);
    expect(browseChannelCount(sections)).toBe(6);
  });
});

describe("member table cells", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");

  test("relativeAge picks the largest sensible unit", () => {
    expect(relativeAge(null, now)).toBeNull();
    expect(relativeAge("nope", now)).toBeNull();
    expect(relativeAge("2026-10-27T11:59:50Z", now)).toEqual({ value: 1, unit: "minute" });
    expect(relativeAge("2026-10-26T15:00:00Z", now)).toEqual({ value: 21, unit: "hour" });
    expect(relativeAge("2026-10-15T12:00:00Z", now)).toEqual({ value: 12, unit: "day" });
    expect(relativeAge("2026-08-20T12:00:00Z", now)).toEqual({ value: 2, unit: "month" });
    expect(relativeAge("2024-06-01T12:00:00Z", now)).toEqual({ value: 2, unit: "year" });
    // Clock skew: a date slightly in the future reads as just now.
    expect(relativeAge("2026-10-27T12:05:00Z", now)).toEqual({ value: 1, unit: "minute" });
  });

  test("memberSignals flags new accounts and active timeouts", () => {
    expect(memberSignals({ accountCreatedAt: "2026-10-25T00:00:00Z" }, now)).toEqual(["new_account"]);
    expect(memberSignals({ accountCreatedAt: "2026-10-25T00:00:00Z", isBot: true }, now)).toEqual([]);
    expect(memberSignals({ accountCreatedAt: "2025-01-01T00:00:00Z", communicationDisabledUntil: "2026-10-28T00:00:00Z" }, now)).toEqual(["timed_out"]);
    expect(memberSignals({ communicationDisabledUntil: "2026-10-01T00:00:00Z" }, now)).toEqual([]);
  });

  test("memberNameColor uses the highest coloured role", () => {
    const roles = [
      { color: "#99AAB5", isDefault: true, position: 0 },
      { color: "#ff0000", position: 2 },
      { color: "#99aab5", position: 5 },
      { color: "#00ff00", position: 3 },
    ];
    expect(memberNameColor(roles)).toBe("#00ff00");
    expect(memberNameColor([{ color: "#99AAB5", position: 1 }])).toBeNull();
  });

  test("visibleMemberRoles drops @everyone and sorts highest first", () => {
    const roles = [{ id: "e", isDefault: true, position: 0 }, { id: "a", position: 1 }, { id: "b", position: 4 }];
    expect(visibleMemberRoles(roles).map((r) => r.id)).toEqual(["b", "a"]);
  });

  test("account-created sort reads the members API field", () => {
    const members = [
      { id: "1", username: "a", accountCreatedAt: "2020-01-01T00:00:00Z", roles: [] },
      { id: "2", username: "b", accountCreatedAt: "2024-01-01T00:00:00Z", roles: [] },
    ];
    expect(filterAndSortMembers(members, { sort: "created_desc" }).map((m) => m.id)).toEqual(["2", "1"]);
    expect(filterAndSortMembers(members, { sort: "created_asc" }).map((m) => m.id)).toEqual(["1", "2"]);
  });
});

describe("channelIdFromSegment", () => {
  test("server pages are not channels", () => {
    for (const slug of ["guide", "customize", "members", "onboarding"]) expect(channelIdFromSegment(slug)).toBeNull();
    expect(channelIdFromSegment(null)).toBeNull();
    expect(channelIdFromSegment("0b1c2d3e-0000-4000-8000-000000000001")).toBe("0b1c2d3e-0000-4000-8000-000000000001");
  });
});
