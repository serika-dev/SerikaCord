import { describe, expect, test } from "bun:test";
import {
  MUTE_FOREVER,
  applyOverridePatch,
  decideMessageAlert,
  isMuteActive,
  muteUntilFor,
  resolveNotification,
  sanitizeSettingsDoc,
  serverDefaultLevel,
  type NotificationSettingsDoc,
} from "@/lib/notifications/levels";
import { NotificationGroups, conversationTag, groupedNotificationBody } from "@/lib/notifications/grouping";
import { computeUnreadDivider, newestAckable } from "@/lib/chat/unreadMarker";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const empty = (): NotificationSettingsDoc => ({ servers: {}, channels: {} });

describe("notification level resolution", () => {
  test("falls back to the server default, then the global all-messages switch", () => {
    expect(resolveNotification({ doc: empty(), serverId: "s", channelId: "c", now: NOW }).level).toBe("mentions");
    expect(
      resolveNotification({ doc: empty(), serverId: "s", channelId: "c", serverDefault: "all", now: NOW }).level,
    ).toBe("all");
    expect(
      resolveNotification({ doc: empty(), serverId: "s", channelId: "c", globalAllMessages: true, now: NOW }).level,
    ).toBe("all");
    expect(resolveNotification({ doc: empty(), channelId: "dm", now: NOW }).level).toBe("all");
    // A server channel whose server isn't known yet is not a DM.
    expect(resolveNotification({ doc: empty(), channelId: "c", isDM: false, now: NOW }).level).toBe("mentions");
  });

  test("channel beats category beats server", () => {
    const doc: NotificationSettingsDoc = {
      servers: { s: { level: "nothing" } },
      channels: { cat: { level: "all" }, c: { level: "mentions" } },
    };
    expect(resolveNotification({ doc, serverId: "s", channelId: "c", ancestorIds: ["cat"], now: NOW }).level).toBe("mentions");
    expect(resolveNotification({ doc, serverId: "s", channelId: "other", ancestorIds: ["cat"], now: NOW }).level).toBe("all");
    expect(resolveNotification({ doc, serverId: "s", channelId: "loose", now: NOW }).level).toBe("nothing");
  });

  test("mutes expire", () => {
    expect(isMuteActive({ muteUntil: NOW + 1000 }, NOW)).toBe(true);
    expect(isMuteActive({ muteUntil: NOW - 1 }, NOW)).toBe(false);
    expect(isMuteActive({ muteUntil: MUTE_FOREVER }, NOW)).toBe(true);
    expect(muteUntilFor(15, NOW)).toBe(NOW + 15 * 60_000);
    expect(muteUntilFor(null, NOW)).toBe(MUTE_FOREVER);

    const doc: NotificationSettingsDoc = { servers: {}, channels: { c: { muteUntil: NOW + 60_000 } } };
    expect(resolveNotification({ doc, serverId: "s", channelId: "c", now: NOW }).muted).toBe(true);
    expect(resolveNotification({ doc, serverId: "s", channelId: "c", now: NOW + 120_000 }).muted).toBe(false);
  });

  test("a muted category mutes its channels; a muted server mutes everything", () => {
    const doc: NotificationSettingsDoc = {
      servers: { s2: { muteUntil: MUTE_FOREVER } },
      channels: { cat: { muteUntil: MUTE_FOREVER } },
    };
    const r = resolveNotification({ doc, serverId: "s", channelId: "c", ancestorIds: ["cat"], now: NOW });
    expect(r.channelMuted).toBe(true);
    expect(r.serverMuted).toBe(false);
    const r2 = resolveNotification({ doc, serverId: "s2", channelId: "x", now: NOW });
    expect(r2.serverMuted).toBe(true);
    expect(r2.muted).toBe(true);
  });
});

describe("message alert decision", () => {
  const base = { isDM: false, mentionedDirectly: false, mentionedEveryone: false, mentionedRole: false };
  const resolved = (doc: NotificationSettingsDoc, extra: Partial<Parameters<typeof resolveNotification>[0]> = {}) =>
    resolveNotification({ doc, serverId: "s", channelId: "c", now: NOW, ...extra });

  test("mentions-only notifies for pings, not chatter", () => {
    const r = resolved(empty());
    expect(decideMessageAlert({ ...base, resolved: r })).toEqual({ mention: false, notify: false, glow: true });
    expect(decideMessageAlert({ ...base, resolved: r, mentionedDirectly: true })).toEqual({ mention: true, notify: true, glow: true });
  });

  test("all messages notifies for everything", () => {
    const r = resolved({ servers: { s: { level: "all" } }, channels: {} });
    expect(decideMessageAlert({ ...base, resolved: r }).notify).toBe(true);
  });

  test("suppress @everyone and role mentions per server", () => {
    const r = resolved({ servers: { s: { suppressEveryone: true, suppressRoles: true } }, channels: {} });
    expect(decideMessageAlert({ ...base, resolved: r, mentionedEveryone: true })).toEqual({ mention: false, notify: false, glow: true });
    expect(decideMessageAlert({ ...base, resolved: r, mentionedRole: true }).mention).toBe(false);
    // A direct ping still gets through.
    expect(decideMessageAlert({ ...base, resolved: r, mentionedEveryone: true, mentionedDirectly: true }).notify).toBe(true);
    const open = resolved(empty());
    expect(decideMessageAlert({ ...base, resolved: open, mentionedEveryone: true }).notify).toBe(true);
  });

  test("nothing drops alerts and badges", () => {
    const r = resolved({ servers: {}, channels: { c: { level: "nothing" } } });
    expect(decideMessageAlert({ ...base, resolved: r, mentionedDirectly: true })).toEqual({ mention: false, notify: false, glow: true });
  });

  test("muted keeps the mention badge but silences and dims", () => {
    const r = resolved({ servers: {}, channels: { c: { muteUntil: NOW + 60_000 } } });
    expect(decideMessageAlert({ ...base, resolved: r, mentionedDirectly: true })).toEqual({ mention: true, notify: false, glow: false });
    // Once the mute runs out, it notifies again.
    const later = resolved({ servers: {}, channels: { c: { muteUntil: NOW + 60_000 } } }, { now: NOW + 61_000 });
    expect(decideMessageAlert({ ...base, resolved: later, mentionedDirectly: true }).notify).toBe(true);
  });

  test("DMs always badge, muted DMs don't notify", () => {
    const r = resolveNotification({ doc: empty(), channelId: "dm", now: NOW });
    expect(decideMessageAlert({ ...base, isDM: true, resolved: r })).toEqual({ mention: true, notify: true, glow: true });
    const muted = resolveNotification({ doc: { servers: {}, channels: { dm: { muteUntil: MUTE_FOREVER } } }, channelId: "dm", now: NOW });
    expect(decideMessageAlert({ ...base, isDM: true, resolved: muted })).toEqual({ mention: true, notify: false, glow: false });
  });
});

describe("notification settings storage", () => {
  test("sanitize drops junk, bad ids and expired mutes", () => {
    const doc = sanitizeSettingsDoc(
      {
        servers: { s: { level: "all", suppressEveryone: true, junk: 1 }, "bad id!": { level: "all" } },
        channels: { c: { level: "loud" }, d: { muteUntil: NOW - 5 }, e: { muteUntil: MUTE_FOREVER } },
        extra: {},
      },
      NOW,
    );
    expect(doc).toEqual({
      servers: { s: { level: "all", suppressEveryone: true } },
      channels: { e: { muteUntil: MUTE_FOREVER } },
    });
  });

  test("patches merge, null fields reset, null patch clears", () => {
    let doc = applyOverridePatch(empty(), "server", "s", { level: "all", suppressRoles: true }, NOW);
    doc = applyOverridePatch(doc, "server", "s", { muteUntil: NOW + 1000 }, NOW);
    expect(doc.servers.s).toEqual({ level: "all", suppressRoles: true, muteUntil: NOW + 1000 });
    doc = applyOverridePatch(doc, "server", "s", { level: null }, NOW);
    expect(doc.servers.s.level).toBeUndefined();
    doc = applyOverridePatch(doc, "server", "s", null, NOW);
    expect(doc.servers.s).toBeUndefined();
    // Channels can't carry server-only switches.
    doc = applyOverridePatch(doc, "channel", "c", { suppressEveryone: true }, NOW);
    expect(doc.channels.c).toBeUndefined();
  });

  test("server default column maps to a level", () => {
    expect(serverDefaultLevel("all_messages")).toBe("all");
    expect(serverDefaultLevel("only_mentions")).toBe("mentions");
    expect(serverDefaultLevel(null)).toBe("mentions");
  });
});

describe("grouped notifications", () => {
  test("one message shows its preview, several show a count", () => {
    const many = (n: number) => `${n} new messages`;
    expect(groupedNotificationBody({ count: 1, latestBody: "hi", showPreview: true }, many)).toBe("hi");
    expect(groupedNotificationBody({ count: 3, latestBody: "hi", showPreview: true }, many)).toBe("3 new messages\nhi");
    expect(groupedNotificationBody({ count: 3, latestBody: "New message", showPreview: false }, many)).toBe("3 new messages");
  });

  test("groups count per conversation and reset when read", () => {
    const groups = new NotificationGroups(5);
    const tag = conversationTag("c1");
    expect(groups.bump(tag)).toBe(1);
    expect(groups.bump(tag)).toBe(2);
    expect(groups.bump(conversationTag("c2"))).toBe(1);
    for (let i = 0; i < 10; i++) groups.bump(tag);
    expect(groups.count(tag)).toBe(5);
    expect(groups.clear(tag)).toBe(true);
    expect(groups.bump(tag)).toBe(1);
  });
});

describe("unread divider", () => {
  const msg = (id: string, minute: number, authorId = "other") => ({
    id,
    authorId,
    createdAt: new Date(NOW + minute * 60_000).toISOString(),
  });
  const list = [msg("a", 0), msg("b", 1), msg("c", 2), msg("d", 3)];

  test("exact message marker", () => {
    expect(computeUnreadDivider(list, { lastReadMessageId: "b", lastReadAt: null }, "me")).toEqual({
      firstUnreadId: "c",
      count: 2,
      countIsLowerBound: false,
      since: list[2].createdAt,
    });
  });

  test("timestamp marker when the message isn't loaded", () => {
    const d = computeUnreadDivider(list, { lastReadMessageId: "zzz", lastReadAt: list[0].createdAt }, "me");
    expect(d?.firstUnreadId).toBe("b");
    expect(d?.count).toBe(3);
  });

  test("everything loaded is unread and older pages exist: count is a lower bound", () => {
    const d = computeUnreadDivider(list, { lastReadMessageId: null, lastReadAt: new Date(NOW - 60_000).toISOString() }, "me", true);
    expect(d?.firstUnreadId).toBe("a");
    expect(d?.countIsLowerBound).toBe(true);
  });

  test("nothing unread, never read, or you replied last", () => {
    expect(computeUnreadDivider(list, { lastReadMessageId: "d", lastReadAt: null }, "me")).toBeNull();
    expect(computeUnreadDivider(list, null, "me")).toBeNull();
    expect(computeUnreadDivider(list, { lastReadMessageId: null, lastReadAt: null }, "me")).toBeNull();
    const replied = [...list, msg("e", 4, "me")];
    expect(computeUnreadDivider(replied, { lastReadMessageId: "a", lastReadAt: null }, "me")).toBeNull();
  });

  test("own messages before others' restart the run", () => {
    const mixed = [msg("a", 0), msg("b", 1, "me"), msg("c", 2), msg("d", 3)];
    const d = computeUnreadDivider(mixed, { lastReadMessageId: "a", lastReadAt: null }, "me");
    expect(d?.firstUnreadId).toBe("c");
    expect(d?.count).toBe(2);
  });

  test("newest ackable skips optimistic and ephemeral rows", () => {
    const uuid = "0b8f9a2e-1111-4222-8333-444455556666";
    const rows = [
      { id: uuid, createdAt: list[0].createdAt },
      { id: "temp-1-1", createdAt: list[1].createdAt, pending: true },
      { id: "eph", createdAt: list[2].createdAt, ephemeral: true },
    ];
    expect(newestAckable(rows)?.id).toBe(uuid);
    expect(newestAckable([])).toBeNull();
  });
});
