import { describe, expect, test } from "bun:test";
import {
  ACK_GRACE_MS,
  EMPTY_UNREAD_STATE,
  MAX_UNREAD_BADGE,
  badgeCount,
  hasUnread,
  hydrateUnread,
  isCaughtUp,
  isMessageRead,
  persistUnread,
  readMarkerOf,
  reduceUnread,
  summarize,
  titleBadgeCount,
  type UnreadEvent,
  type UnreadState,
} from "@/lib/unread/engine";
import { decideLiveMessage, type LiveMessageInput } from "@/lib/unread/live";
import { ATTENTION_WINDOW_MS, attentionExpiresAt, isAttending } from "@/lib/unread/attention";
import { mentionTokens, renderMentionText } from "@/lib/chat/mentionText";
import { computeUnreadDivider } from "@/lib/chat/unreadMarker";

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const ME = "me";
const CH = "ch-1";
const DM = "dm-1";

function run(events: UnreadEvent[], from: UnreadState = EMPTY_UNREAD_STATE): UnreadState {
  return events.reduce(reduceUnread, from);
}

function msg(channelId: string, id: string, at: number, extra: Partial<Extract<UnreadEvent, { type: "message" }>> = {}): UnreadEvent {
  return { type: "message", channelId, messageId: id, at, counts: true, now: at + 5, ...extra };
}

describe("unread engine: live messages", () => {
  test("a mention counts once even when it arrives twice (activity + DM list stream)", () => {
    const s = run([msg(DM, "m1", T0), msg(DM, "m1", T0), msg(DM, "m2", T0 + 1000)]);
    expect(badgeCount(s, DM)).toBe(2);
    expect(hasUnread(s, DM)).toBe(true);
  });

  test("plain messages glow without badging", () => {
    const s = run([msg(CH, "m1", T0, { counts: false })]);
    expect(hasUnread(s, CH)).toBe(true);
    expect(badgeCount(s, CH)).toBe(0);
  });

  test("a message read live (on screen, attending, at bottom) never badges", () => {
    const s = run([msg(DM, "m1", T0, { viewing: true })]);
    expect(badgeCount(s, DM)).toBe(0);
  });

  test("a mention in the open channel while scrolled up still badges", () => {
    const s = run([msg(CH, "m1", T0, { viewing: false })]);
    expect(badgeCount(s, CH)).toBe(1);
  });

  test("the ack beating the activity event: the message isn't counted", () => {
    const s = run([
      { type: "read", channelId: DM, at: T0, messageId: "m1", now: T0 },
      msg(DM, "m1", T0),
    ]);
    expect(badgeCount(s, DM)).toBe(0);
    expect(hasUnread(s, DM)).toBe(false);
  });

  test("your own message from another device reads the conversation", () => {
    const s = run([msg(DM, "m1", T0), msg(DM, "m2", T0 + 10), msg(DM, "mine", T0 + 20, { own: true, counts: false })]);
    expect(badgeCount(s, DM)).toBe(0);
    expect(hasUnread(s, DM)).toBe(false);
    expect(readMarkerOf(s, DM).lastReadMessageId).toBe("mine");
  });

  test("badges stop at the 99+ cap", () => {
    const events: UnreadEvent[] = [];
    for (let i = 0; i < MAX_UNREAD_BADGE + 20; i++) events.push(msg(DM, `m${i}`, T0 + i));
    expect(badgeCount(run(events), DM)).toBe(MAX_UNREAD_BADGE);
  });
});

describe("unread engine: read markers", () => {
  test("a read from another device clears the badge and the glow", () => {
    const s = run([
      msg(CH, "m1", T0),
      msg(CH, "m2", T0 + 100),
      { type: "read", channelId: CH, at: T0 + 100, messageId: "m2" },
    ]);
    expect(isCaughtUp(s, CH)).toBe(true);
  });

  test("the marker never moves backwards (late, older acks)", () => {
    const s = run([
      { type: "read", channelId: CH, at: T0 + 500, messageId: "m5" },
      { type: "read", channelId: CH, at: T0 + 100, messageId: "m1" },
    ]);
    expect(readMarkerOf(s, CH)).toEqual({ lastReadAt: iso(T0 + 500), lastReadMessageId: "m5" });
  });

  test("an older marker only clears the messages it covers", () => {
    const s = run([
      msg(CH, "m1", T0),
      msg(CH, "m2", T0 + 100),
      { type: "read", channelId: CH, at: T0, messageId: "m1" },
    ]);
    expect(badgeCount(s, CH)).toBe(1);
    expect(hasUnread(s, CH)).toBe(true);
  });

  test("acking the newest known message reads it even if its stamp lags", () => {
    const s = run([
      { type: "seed_conversations", conversations: [{ channelId: CH, lastMessageAt: T0 + 3, lastMessageId: "m9" }] },
      { type: "read", channelId: CH, at: T0, messageId: "m9" },
    ]);
    expect(hasUnread(s, CH)).toBe(false);
  });

  test("mark as read uses the newest message time, not the device clock", () => {
    const s = run([msg(CH, "m1", T0), { type: "read_all", channelId: CH, now: T0 + 10 * 3600_000 }]);
    expect(isCaughtUp(s, CH)).toBe(true);
    // A message after it is unread again (a clock running ahead can't hide it).
    const later = run([msg(CH, "m2", T0 + 1000)], s);
    expect(hasUnread(later, CH)).toBe(true);
    expect(badgeCount(later, CH)).toBe(1);
  });

  test("a marker without a message id drops the stale id (NEW line placement)", () => {
    const s = run([
      { type: "read", channelId: CH, at: T0, messageId: "a" },
      { type: "read", channelId: CH, at: T0 + 200 },
    ]);
    const marker = readMarkerOf(s, CH);
    expect(marker.lastReadMessageId).toBeNull();
    const messages = [
      { id: "a", createdAt: iso(T0), authorId: "x" },
      { id: "b", createdAt: iso(T0 + 100), authorId: "x" },
      { id: "c", createdAt: iso(T0 + 300), authorId: "x" },
    ];
    expect(computeUnreadDivider(messages, marker, ME)?.firstUnreadId).toBe("c");
  });

  test("isMessageRead by id or by time", () => {
    const s = run([{ type: "read", channelId: CH, at: T0, messageId: "m1" }]);
    expect(isMessageRead(s, CH, "m1", T0 + 999)).toBe(true);
    expect(isMessageRead(s, CH, "m0", T0 - 1)).toBe(true);
    expect(isMessageRead(s, CH, "m2", T0 + 1)).toBe(false);
  });
});

describe("unread engine: seeds and reconnects", () => {
  test("DM seed: the server count shows when nothing local is newer", () => {
    const s = run([
      { type: "seed_conversations", issuedAt: T0, conversations: [{ channelId: DM, lastMessageAt: T0 - 50, lastMessageId: "m3", unread: 3 }] },
    ]);
    expect(badgeCount(s, DM)).toBe(3);
  });

  test("DM seed right after a local read doesn't bring the badge back", () => {
    const read = run([
      msg(DM, "m1", T0),
      { type: "read", channelId: DM, at: T0, messageId: "m1", now: T0 + 100 },
    ]);
    // Issued just after the ack; the server hadn't seen it yet.
    const s = run([{ type: "seed_conversations", issuedAt: T0 + 200, conversations: [{ channelId: DM, lastMessageAt: T0, lastMessageId: "m1", unread: 1 }] }], read);
    expect(badgeCount(s, DM)).toBe(0);
  });

  test("DM seed long after an old read: server count wins", () => {
    const read = run([{ type: "read", channelId: DM, at: T0, messageId: "m1", now: T0 }]);
    const issuedAt = T0 + ACK_GRACE_MS + 60_000;
    const s = run(
      [{ type: "seed_conversations", issuedAt, conversations: [{ channelId: DM, lastMessageAt: T0 + 50_000, lastMessageId: "m4", unread: 3 }] }],
      read,
    );
    expect(badgeCount(s, DM)).toBe(3);
    expect(hasUnread(s, DM)).toBe(true);
  });

  test("DM seed doesn't double count messages that arrived while it was in flight", () => {
    const issuedAt = T0;
    const s = run([
      msg(DM, "m1", T0 + 10, { now: T0 + 20 }),
      { type: "seed_conversations", issuedAt, conversations: [{ channelId: DM, lastMessageAt: T0 + 10, lastMessageId: "m1", unread: 1 }] },
    ]);
    expect(badgeCount(s, DM)).toBe(1);
  });

  test("a zero count from the server clears a badge the live stream missed the read for", () => {
    const s = run([
      msg(DM, "m1", T0, { now: T0 }),
      { type: "seed_conversations", issuedAt: T0 + 60_000, conversations: [{ channelId: DM, lastMessageAt: T0, lastMessageId: "m1", unread: 0 }] },
    ]);
    expect(badgeCount(s, DM)).toBe(0);
  });

  test("reconnect gap: a re-seed with a newer message makes the channel unread", () => {
    const s = run([
      { type: "read", channelId: CH, at: T0, messageId: "m1" },
      { type: "seed_conversations", conversations: [{ channelId: CH, lastMessageAt: T0 + 5000, lastMessageId: "m2" }] },
    ]);
    expect(hasUnread(s, CH)).toBe(true);
  });

  test("a seed whose newest message is your own reads it", () => {
    const s = run([
      msg(DM, "m1", T0),
      { type: "seed_conversations", conversations: [{ channelId: DM, lastMessageAt: T0 + 10, lastMessageId: "mine", lastMessageIsOwn: true }] },
    ]);
    expect(isCaughtUp(s, DM)).toBe(true);
  });

  test("mention seeds union with live mentions and skip read ones", () => {
    const s = run([
      { type: "read", channelId: CH, at: T0, messageId: "old" },
      msg(CH, "m2", T0 + 20),
      {
        type: "seed_mentions",
        mentions: [
          { id: "old", channelId: CH, createdAt: iso(T0) },
          { id: "m1", channelId: CH, createdAt: iso(T0 + 10) },
          { id: "m2", channelId: CH, createdAt: iso(T0 + 20) },
        ],
      },
    ]);
    expect(badgeCount(s, CH)).toBe(2);
  });

  test("a count seeded before the conversation's activity is known survives", () => {
    const s = run([{ type: "seed_conversations", issuedAt: T0, conversations: [{ channelId: DM, unread: 2 }] }]);
    expect(badgeCount(s, DM)).toBe(2);
  });
});

describe("unread engine: deletions and edits", () => {
  test("deleting the mention removes its badge and rolls the glow back", () => {
    const s = run([
      { type: "read", channelId: CH, at: T0, messageId: "m0" },
      msg(CH, "m1", T0 + 10),
      { type: "reset", channelId: CH, lastMessageAt: T0, deleted: [{ id: "m1", at: T0 + 10 }] },
    ]);
    expect(isCaughtUp(s, CH)).toBe(true);
  });

  test("deleting one of several keeps the others", () => {
    const s = run([
      msg(CH, "m1", T0 + 10),
      msg(CH, "m2", T0 + 20),
      { type: "reset", channelId: CH, lastMessageAt: T0 + 20, deleted: [{ id: "m1", at: T0 + 10 }] },
    ]);
    expect(badgeCount(s, CH)).toBe(1);
  });

  test("a deleted message known only as part of the server count decrements it", () => {
    const s = run([
      { type: "seed_conversations", issuedAt: T0, conversations: [{ channelId: DM, lastMessageAt: T0 + 30, lastMessageId: "m3", unread: 3 }] },
      { type: "reset", channelId: DM, lastMessageAt: T0 + 30, deleted: [{ id: "m2", at: T0 + 20 }] },
    ]);
    expect(badgeCount(s, DM)).toBe(2);
  });

  test("a reset for a conversation this device never saw changes nothing", () => {
    const s = run([{ type: "reset", channelId: "hidden", lastMessageAt: T0 }]);
    expect(s).toBe(EMPTY_UNREAD_STATE);
  });

  test("an edit removing the mention retracts the badge", () => {
    const s = run([msg(CH, "m1", T0), { type: "retract", channelId: CH, messageId: "m1" }]);
    expect(badgeCount(s, CH)).toBe(0);
    expect(hasUnread(s, CH)).toBe(true); // still a new message
  });

  test("forget drops a channel the user can't see any more", () => {
    const s = run([msg(CH, "m1", T0), { type: "forget", channelId: CH }]);
    expect(hasUnread(s, CH)).toBe(false);
    expect(badgeCount(s, CH)).toBe(0);
  });
});

describe("unread engine: aggregates", () => {
  const meta = { [CH]: { serverId: "srv" }, "ch-2": { serverId: "srv" }, [DM]: {}, "dm-muted": {} };

  test("muted channels don't glow their server but keep mention badges", () => {
    const s = run([msg(CH, "m1", T0), msg("ch-2", "x", T0, { counts: false })]);
    const muted = new Set([CH, "ch-2"]);
    const sum = summarize(s, meta, muted);
    expect(sum.unreadServers.has("srv")).toBe(false);
    expect(sum.serverMentions.get("srv")).toBe(1);
  });

  test("title count = server mentions + unmuted DM messages", () => {
    const s = run([msg(CH, "m1", T0), msg(DM, "d1", T0), msg(DM, "d2", T0 + 1), msg("dm-muted", "q", T0)]);
    const sum = summarize(s, meta, new Set(["dm-muted"]));
    expect(sum.dmBadgeTotal).toBe(3);
    expect(titleBadgeCount(sum)).toBe(3);
  });

  test("title count drops to zero once everything is read on another device", () => {
    const s = run([
      msg(CH, "m1", T0),
      msg(DM, "d1", T0),
      { type: "read", channelId: CH, at: T0, messageId: "m1" },
      { type: "read", channelId: DM, at: T0, messageId: "d1" },
    ]);
    expect(titleBadgeCount(summarize(s, meta, new Set()))).toBe(0);
  });
});

describe("unread engine: persistence", () => {
  test("read markers and activity survive a reload; badges are re-seeded", () => {
    const s = run([msg(CH, "m1", T0 + 10), { type: "read", channelId: CH, at: T0, messageId: "m0" }]);
    const back = hydrateUnread(JSON.parse(JSON.stringify(persistUnread(s))));
    expect(readMarkerOf(back, CH)).toEqual(readMarkerOf(s, CH));
    expect(hasUnread(back, CH)).toBe(true);
    expect(badgeCount(back, CH)).toBe(0);
  });
});

describe("live message decisions", () => {
  const base: LiveMessageInput = {
    channelId: CH,
    messageId: "m1",
    at: T0,
    authorId: "other",
    selfId: ME,
    isDM: false,
    mention: true,
    notify: true,
    active: false,
    readingLive: false,
  };

  test("your own messages never alert or badge", () => {
    const out = decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, authorId: ME });
    expect(out.alert).toBe(false);
    const s = run(out.event ? [out.event] : []);
    expect(badgeCount(s, CH)).toBe(0);
  });

  test("an already-read message neither alerts nor badges", () => {
    const read = run([{ type: "read", channelId: CH, at: T0, messageId: "m1" }]);
    const out = decideLiveMessage(read, base);
    expect(out.alert).toBe(false);
    expect(badgeCount(run(out.event ? [out.event] : [], read), CH)).toBe(0);
  });

  test("the open server channel alerts through its chat view, not the stream", () => {
    expect(decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, active: true }).alert).toBe(false);
    expect(decideLiveMessage(EMPTY_UNREAD_STATE, base).alert).toBe(true);
  });

  test("an open DM being read live: alert path runs with viewing=true (silenced there)", () => {
    const out = decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, channelId: DM, isDM: true, active: true, readingLive: true });
    expect(out.alert).toBe(true);
    expect(out.viewing).toBe(true);
    expect(badgeCount(run(out.event ? [out.event] : []), DM)).toBe(0);
  });

  test("muted / Nothing: no alert", () => {
    expect(decideLiveMessage(EMPTY_UNREAD_STATE, { ...base, notify: false }).alert).toBe(false);
  });
});

describe("attention (when reading counts)", () => {
  const now = T0;
  test("focused + visible", () => {
    expect(isAttending({ visible: true, focused: true, lastInteractionAt: 0, now })).toBe(true);
  });
  test("unfocused window (second monitor, embed iframe, devtools) touched recently", () => {
    expect(isAttending({ visible: true, focused: false, lastInteractionAt: now - 5_000, now })).toBe(true);
    expect(attentionExpiresAt({ visible: true, focused: false, lastInteractionAt: now - 5_000, now })).toBe(now - 5_000 + ATTENTION_WINDOW_MS);
  });
  test("unfocused and untouched for a minute", () => {
    expect(isAttending({ visible: true, focused: false, lastInteractionAt: now - ATTENTION_WINDOW_MS, now })).toBe(false);
    expect(isAttending({ visible: true, focused: false, lastInteractionAt: 0, now })).toBe(false);
  });
  test("hidden tab never counts", () => {
    expect(isAttending({ visible: false, focused: true, lastInteractionAt: now, now })).toBe(false);
  });
  test("touch devices: visible is enough", () => {
    expect(isAttending({ visible: true, focused: false, lastInteractionAt: 0, now, touchDevice: true })).toBe(true);
  });
});

describe("mention previews", () => {
  test("resolves users, roles and channels; unknown ids fall back", () => {
    const text = "hi <@u1> and <@!u2>, <@&r1> see <#c1> <:wave:123> <@zz>";
    expect(renderMentionText(text, { users: { u1: "Alice", u2: "Bob" }, roles: { r1: "Mods" }, channels: { c1: "general" } })).toBe(
      "hi @Alice and @Bob, @Mods see #general :wave: @user",
    );
  });
  test("collects mention ids", () => {
    expect(mentionTokens("<@a> <@&b> <#c> <@a>")).toEqual({ userIds: ["a"], roleIds: ["b"], channelIds: ["c"] });
  });
});
