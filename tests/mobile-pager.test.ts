import { describe, expect, test } from "bun:test";
import {
  PAGER_PEEK,
  conversationApiBase,
  conversationParams,
  dragOffset,
  pagerLayout,
  parseShellRoute,
  releaseVelocity,
  rubberBand,
  shellListHref,
  snapDuration,
  snapIndex,
} from "@/lib/mobile/pager";
import { gestureAxis } from "@/lib/mobile/gestures";

describe("shell routes", () => {
  test("server list and channel", () => {
    expect(parseShellRoute("/channels/s1")).toEqual({ family: "server", panel: "list", serverId: "s1" });
    expect(parseShellRoute("/channels/s1/c1")).toEqual({ family: "server", panel: "chat", serverId: "s1", conversation: "/channels/s1/c1" });
    expect(parseShellRoute("/channels/s1/c1/")).toMatchObject({ conversation: "/channels/s1/c1" });
  });

  test("DM list, DMs and group DMs", () => {
    expect(parseShellRoute("/channels/messages")).toEqual({ family: "dm", panel: "list" });
    expect(parseShellRoute("/dm/u1")).toEqual({ family: "dm", panel: "chat", conversation: "/dm/u1" });
    expect(parseShellRoute("/dm/group/g1")).toEqual({ family: "dm", panel: "chat", conversation: "/dm/group/g1" });
  });

  test("other screens stay router pages", () => {
    for (const p of ["/channels/me", "/channels/settings/profile", "/channels/explore", "/channels/notifications", "/channels/profile", "/channels/s1/members", "/channels/s1/onboarding", "/channels/s1/guide", "/channels/s1/customize", "/dm", "/", null]) {
      expect(parseShellRoute(p)).toBeNull();
    }
  });

  test("list hrefs, params and message cache keys", () => {
    expect(shellListHref({ family: "server", serverId: "s1" })).toBe("/channels/s1");
    expect(shellListHref({ family: "dm" })).toBe("/channels/messages");
    expect(conversationParams("/channels/s1/c1")).toEqual({ serverId: "s1", channelId: "c1" });
    expect(conversationParams("/dm/u1")).toEqual({ recipientId: "u1" });
    expect(conversationParams("/dm/group/g1")).toEqual({ channelId: "g1" });
    expect(conversationParams("/channels/s1")).toBeNull();
    expect(conversationApiBase("/channels/s1/c1")).toBe("/api/channels/c1");
    expect(conversationApiBase("/dm/u1")).toBe("/api/dms/u1");
    expect(conversationApiBase("/dm/group/g1")).toBe("/api/group-dms/g1");
  });
});

describe("pager layout", () => {
  test("no conversation: the list fills the screen", () => {
    expect(pagerLayout(390, { hasChat: false, hasMembers: true })).toEqual({ panels: ["list"], positions: [0], sideWidth: 390 });
  });

  test("side panels leave the chat peeking", () => {
    const l = pagerLayout(390, { hasChat: true, hasMembers: true });
    const side = 390 - PAGER_PEEK;
    expect(l.panels).toEqual(["list", "chat", "members"]);
    expect(l.positions).toEqual([0, -side, -2 * side]);
    // At "members" the chat's left edge shows `peek` px.
    expect(side + l.positions[2] + 390).toBe(PAGER_PEEK);
  });

  test("DMs have no member panel", () => {
    expect(pagerLayout(390, { hasChat: true, hasMembers: false }).panels).toEqual(["list", "chat"]);
  });
});

describe("drag + rubber band", () => {
  test("follows the finger 1:1 inside the range", () => {
    expect(dragOffset(-334, 100, -668, 0)).toBe(-234);
    expect(dragOffset(-334, -100, -668, 0)).toBe(-434);
  });

  test("resists past either end, monotonically and bounded", () => {
    const past = [10, 40, 120, 400, 2000].map((d) => dragOffset(0, d, -668, 0));
    expect(past).toEqual([...past].sort((a, b) => a - b));
    expect(past.every((x) => x > 0 && x < 80)).toBe(true);
    expect(dragOffset(-668, -50, -668, 0)).toBeGreaterThan(-718);
    expect(dragOffset(-668, -50, -668, 0)).toBeLessThan(-668);
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-5)).toBe(0);
  });
});

describe("snap target", () => {
  const P = [0, -334, -668];

  test("slow release snaps to the nearest panel", () => {
    expect(snapIndex(P, 1, -320, 0)).toBe(1);
    expect(snapIndex(P, 1, -150, 0)).toBe(0);
    expect(snapIndex(P, 1, -520, 0)).toBe(2);
  });

  test("a flick moves one panel even when short", () => {
    expect(snapIndex(P, 1, -300, 0.6)).toBe(0);
    expect(snapIndex(P, 1, -360, -0.6)).toBe(2);
  });

  test("a flick against the drag direction doesn't jump", () => {
    // Dragged right a little, then flicked back left: stay.
    expect(snapIndex(P, 1, -310, -0.5)).toBe(1);
  });

  test("never skips a panel, never leaves the range", () => {
    expect(snapIndex(P, 0, -600, -3)).toBe(1);
    expect(snapIndex(P, 2, 0, 3)).toBe(1);
    expect(snapIndex(P, 0, 40, 2)).toBe(0);
    expect(snapIndex(P, 2, -700, -2)).toBe(2);
    expect(snapIndex([0], 0, -50, -1)).toBe(0);
  });

  test("durations stay in the ~140-260 ms window", () => {
    expect(snapDuration(0)).toBe(0);
    for (const d of [10, 100, 334, 668, 2000]) {
      const ms = snapDuration(d);
      expect(ms).toBeGreaterThanOrEqual(140);
      expect(ms).toBeLessThanOrEqual(260);
    }
    expect(snapDuration(334, 2)).toBeLessThan(snapDuration(334, 0));
  });

  test("release velocity uses only recent samples", () => {
    expect(releaseVelocity([{ x: 0, t: 0 }, { x: 100, t: 100 }], 100, 150)).toBeCloseTo(1);
    expect(releaseVelocity([{ x: 0, t: 0 }, { x: 100, t: 10 }, { x: 100, t: 300 }], 300)).toBe(0);
    expect(releaseVelocity([{ x: 5, t: 0 }], 0)).toBe(0);
  });
});

describe("direction lock", () => {
  test("nothing is claimed inside the 8px slop", () => {
    expect(gestureAxis(7, 2)).toBeNull();
  });
  test("vertical scrolling wins ties; clear horizontal drags lock horizontal", () => {
    expect(gestureAxis(10, 9)).toBe("vertical");
    expect(gestureAxis(12, 3)).toBe("horizontal");
    expect(gestureAxis(-12, 3)).toBe("horizontal");
  });
});
