import { describe, expect, test } from "bun:test";
import { EMPTY_UNREAD_STATE, badgeCount, hasUnread, readMarkerOf, reduceUnread, type UnreadEvent, type UnreadState } from "@/lib/unread/engine";
import { decideLiveMessage } from "@/lib/unread/live";
import { computeUnreadDivider, planMarkUnread } from "@/lib/chat/unreadMarker";

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const ME = "aaaaaaaa-0000-4000-8000-00000000000a";
const THEM = "bbbbbbbb-0000-4000-8000-00000000000b";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CH = "ch-1";

function run(events: UnreadEvent[], from: UnreadState = EMPTY_UNREAD_STATE): UnreadState {
  return events.reduce(reduceUnread, from);
}

const messages = [
  { id: id(1), createdAt: iso(T0), authorId: THEM },
  { id: id(2), createdAt: iso(T0 + 1000), authorId: ME },
  { id: id(3), createdAt: iso(T0 + 2000), authorId: THEM, mentionedUserIds: [ME] },
  { id: id(4), createdAt: iso(T0 + 3000), authorId: THEM },
  { id: "temp-1", createdAt: iso(T0 + 4000), authorId: ME, pending: true },
];

describe("planMarkUnread", () => {
  test("marker = the message above; every message from others badges in a DM", () => {
    const plan = planMarkUnread(messages, id(3), { currentUserId: ME, counts: () => true })!;
    expect(plan.previous?.id).toBe(id(2));
    expect(plan.marker).toEqual({ lastReadMessageId: id(2), lastReadAt: iso(T0 + 1000) });
    expect(plan.badge.map((m) => m.id)).toEqual([id(3), id(4)]);
    expect(plan.newest?.id).toBe(id(4));
    // The divider then sits on the marked message.
    expect(computeUnreadDivider(messages, plan.marker, ME)?.firstUnreadId).toBe(id(3));
  });

  test("server channels badge only mentions; the first message has no previous", () => {
    const plan = planMarkUnread(messages, id(1), {
      currentUserId: ME,
      counts: (m) => Boolean((m as { mentionedUserIds?: string[] }).mentionedUserIds?.includes(ME)),
    })!;
    expect(plan.previous).toBeNull();
    expect(plan.marker.lastReadMessageId).toBeNull();
    expect(Date.parse(plan.marker.lastReadAt!)).toBe(T0 - 1);
    expect(plan.badge.map((m) => m.id)).toEqual([id(3)]);
  });

  test("unknown or optimistic messages can't be marked", () => {
    expect(planMarkUnread(messages, "temp-1", { counts: () => true })).toBeNull();
    expect(planMarkUnread(messages, id(99), { counts: () => true })).toBeNull();
  });
});

describe("engine: rewind (Mark Unread)", () => {
  const read = run([
    { type: "seed_conversations", conversations: [{ channelId: CH, lastMessageAt: T0 + 3000, lastMessageId: id(4) }] },
    { type: "read", channelId: CH, at: T0 + 3000, messageId: id(4), now: T0 + 4000 },
  ]);

  test("moves the marker backwards and restores the badge", () => {
    expect(hasUnread(read, CH)).toBeFalse();
    const s = reduceUnread(read, {
      type: "rewind",
      channelId: CH,
      at: T0 + 1000,
      messageId: id(2),
      badge: [{ id: id(3), at: T0 + 2000 }, { id: id(4), at: T0 + 3000 }],
      now: T0 + 5000,
    });
    expect(hasUnread(s, CH)).toBeTrue();
    expect(badgeCount(s, CH)).toBe(2);
    expect(readMarkerOf(s, CH)).toEqual({ lastReadAt: iso(T0 + 1000), lastReadMessageId: id(2) });
  });

  test("badge entries at or before the marker are ignored; the echo keeps the badge", () => {
    let s = reduceUnread(read, {
      type: "rewind",
      channelId: CH,
      at: T0 + 2000,
      messageId: id(3),
      badge: [{ id: id(3), at: T0 + 2000 }, { id: id(4), at: T0 + 3000 }],
    });
    expect(badgeCount(s, CH)).toBe(1);
    // The server's read_state echo (no badge list) must not wipe it.
    s = reduceUnread(s, { type: "rewind", channelId: CH, at: T0 + 2000, messageId: id(3) });
    expect(badgeCount(s, CH)).toBe(1);
  });

  test("after a rewind, reading again moves forward normally", () => {
    let s = reduceUnread(read, { type: "rewind", channelId: CH, at: T0 + 1000, messageId: id(2), badge: [{ id: id(4), at: T0 + 3000 }] });
    s = reduceUnread(s, { type: "read", channelId: CH, at: T0 + 3000, messageId: id(4) });
    expect(hasUnread(s, CH)).toBeFalse();
    expect(badgeCount(s, CH)).toBe(0);
  });

  test("a rewind makes the newest message known when it wasn't", () => {
    const s = reduceUnread(EMPTY_UNREAD_STATE, {
      type: "rewind",
      channelId: CH,
      at: T0,
      newest: { id: id(4), at: T0 + 3000 },
    });
    expect(hasUnread(s, CH)).toBeTrue();
  });
});

describe("@silent live messages", () => {
  test("silent messages still badge but never alert (notify=false)", () => {
    const base = {
      channelId: "dm",
      messageId: id(5),
      at: T0,
      authorId: THEM,
      selfId: ME,
      isDM: true,
      mention: true,
      active: false,
      readingLive: false,
    };
    const loud = decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, notify: true });
    const silent = decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, notify: false });
    expect(loud.alert).toBeTrue();
    expect(silent.alert).toBeFalse();
    expect(badgeCount(run([silent.event!]), "dm")).toBe(1);
  });
});
