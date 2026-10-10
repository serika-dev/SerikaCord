import { describe, expect, test } from "bun:test";
import {
  activeCustomStatus,
  clearAfterToExpiry,
  guessClearAfter,
  hasCustomStatus,
  isCustomStatusExpired,
  sanitizeExpiry,
  sanitizeStatusEmoji,
} from "@/lib/social/customStatus";
import { decideAutoIdle, parseHeartbeatIdle } from "@/lib/presence/autoIdle";
import { collapseBlockedGroups, isBlockedAuthor } from "@/lib/chat/blocked";
import { decideOnSend, isHiddenRequest, isPendingRequest } from "@/lib/chat/messageRequests";
import { friendRequestAllowedFrom, friendRequestSources, messageRequestsEnabled } from "@/lib/settings/privacy";
import { normalizeUserNote, USER_NOTE_MAX } from "@/lib/social/userNotes";
import type { ChatMessage, MessageGroupData } from "@/lib/chat/types";

const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);

describe("custom status", () => {
  test("clear-after choices", () => {
    expect(clearAfterToExpiry("30m", NOW)).toBe(new Date(NOW + 30 * 60_000).toISOString());
    expect(clearAfterToExpiry("1h", NOW)).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(clearAfterToExpiry("4h", NOW)).toBe(new Date(NOW + 4 * 3_600_000).toISOString());
    expect(clearAfterToExpiry("never", NOW)).toBeNull();
    // UTC viewer: next midnight UTC.
    expect(clearAfterToExpiry("today", NOW, 0)).toBe(new Date(Date.UTC(2026, 9, 11)).toISOString());
    // UTC-5 viewer (offset +300): local 10:00, midnight local = 05:00 UTC next day.
    expect(clearAfterToExpiry("today", NOW, 300)).toBe(new Date(Date.UTC(2026, 9, 11, 5)).toISOString());
    // UTC+9 viewer (offset -540): local 00:00 on the 11th already passed; next is the 12th 00:00 local = 11th 15:00 UTC.
    expect(clearAfterToExpiry("today", NOW, -540)).toBe(new Date(Date.UTC(2026, 9, 11, 15)).toISOString());
  });

  test("expiry validation", () => {
    expect(sanitizeExpiry(null, NOW)).toEqual({ ok: true, value: null });
    expect(sanitizeExpiry(new Date(NOW - 1).toISOString(), NOW)).toEqual({ ok: false });
    expect(sanitizeExpiry(new Date(NOW + 48 * 3_600_000).toISOString(), NOW)).toEqual({ ok: false });
    expect(sanitizeExpiry(new Date(NOW + 60_000).toISOString(), NOW)).toEqual({ ok: true, value: new Date(NOW + 60_000).toISOString() });
    expect(sanitizeExpiry({}, NOW)).toEqual({ ok: false });
  });

  test("emoji validation", () => {
    expect(sanitizeStatusEmoji({ name: "🎮" })).toEqual({ name: "🎮" });
    expect(sanitizeStatusEmoji({ name: "<script>" })).toBeNull();
    expect(sanitizeStatusEmoji({ name: "" })).toBeNull();
    expect(sanitizeStatusEmoji(null)).toBeNull();
    const cdn = "https://cdn.serika.chat";
    expect(sanitizeStatusEmoji({ name: "pog", id: "abc-123", url: `${cdn}/emojis/x.png` }, cdn)).toEqual({
      name: "pog", id: "abc-123", url: `${cdn}/emojis/x.png`, animated: false,
    });
    // Foreign image hosts are refused.
    expect(sanitizeStatusEmoji({ name: "pog", id: "abc-123", url: "https://evil.example/x.png" }, cdn)).toBeNull();
  });

  test("active status hides expired ones", () => {
    const live = { customStatusEmoji: { name: "🔥" }, customStatusExpiresAt: new Date(NOW + 1000).toISOString() };
    const dead = { customStatusEmoji: { name: "🔥" }, customStatusExpiresAt: new Date(NOW - 1000).toISOString() };
    expect(activeCustomStatus("hi", live, NOW)).toEqual({ text: "hi", emoji: { name: "🔥" }, expiresAt: live.customStatusExpiresAt });
    expect(activeCustomStatus("hi", dead, NOW)).toEqual({ text: null, emoji: null, expiresAt: null });
    expect(isCustomStatusExpired(dead, NOW)).toBe(true);
    expect(hasCustomStatus(null, { customStatusEmoji: { name: "🔥" } }, NOW)).toBe(true);
    expect(hasCustomStatus("", {}, NOW)).toBe(false);
    expect(activeCustomStatus("plain", null, NOW).text).toBe("plain");
  });

  test("guessClearAfter maps back to a choice", () => {
    expect(guessClearAfter(null, NOW)).toBe("never");
    expect(guessClearAfter(new Date(NOW + 20 * 60_000).toISOString(), NOW)).toBe("30m");
    expect(guessClearAfter(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe("4h");
    expect(guessClearAfter(new Date(NOW + 9 * 3_600_000).toISOString(), NOW)).toBe("today");
  });
});

describe("auto idle", () => {
  test("goes idle only from online and only when no other device is active", () => {
    expect(decideAutoIdle({ status: "online", idle: true, otherDeviceActive: false, autoIdleFlag: false })).toBe("set-idle");
    expect(decideAutoIdle({ status: "online", idle: true, otherDeviceActive: true, autoIdleFlag: false })).toBe("none");
    expect(decideAutoIdle({ status: "dnd", idle: true, otherDeviceActive: false, autoIdleFlag: false })).toBe("none");
    expect(decideAutoIdle({ status: "invisible", idle: true, otherDeviceActive: false, autoIdleFlag: false })).toBe("none");
  });

  test("restores online only when the idle was automatic", () => {
    expect(decideAutoIdle({ status: "idle", idle: false, otherDeviceActive: false, autoIdleFlag: true })).toBe("restore-online");
    expect(decideAutoIdle({ status: "idle", idle: false, otherDeviceActive: false, autoIdleFlag: false })).toBe("none");
    expect(decideAutoIdle({ status: "dnd", idle: false, otherDeviceActive: false, autoIdleFlag: true })).toBe("none");
  });

  test("heartbeat body parsing", () => {
    expect(parseHeartbeatIdle({ idle: true })).toBe(true);
    expect(parseHeartbeatIdle('{"idle":false}')).toBe(false);
    expect(parseHeartbeatIdle(undefined)).toBeUndefined();
    expect(parseHeartbeatIdle("nope")).toBeUndefined();
    expect(parseHeartbeatIdle({ idle: "yes" })).toBeUndefined();
  });
});

function group(authorId: string, ids: string[], extra: Partial<ChatMessage> = {}): MessageGroupData<ChatMessage> {
  return {
    author: { id: authorId, username: authorId, displayName: authorId },
    timestamp: "2026-10-10T00:00:00.000Z",
    messages: ids.map((id) => ({ id, authorId, content: "", createdAt: "2026-10-10T00:00:00.000Z", ...extra }) as unknown as ChatMessage),
  };
}

describe("blocked messages", () => {
  test("collapses consecutive blocked groups and counts their messages", () => {
    const groups = [group("a", ["1"]), group("x", ["2", "3"]), group("y", ["4"]), group("a", ["5"]), group("x", ["6"])];
    const items = collapseBlockedGroups(groups, new Set(["x", "y"]));
    expect(items.map((i) => i.kind)).toEqual(["group", "blocked", "group", "blocked"]);
    const first = items[1];
    expect(first.kind === "blocked" && first.count).toBe(3);
    expect(first.kind === "blocked" && first.key).toBe("blocked-2");
    expect(items[2].kind === "group" && items[2].index).toBe(3);
  });

  test("no blocks = passthrough, webhook posts never collapse", () => {
    const groups = [group("x", ["1"], { webhookId: "w" } as Partial<ChatMessage>)];
    expect(collapseBlockedGroups(groups, new Set()).map((i) => i.kind)).toEqual(["group"]);
    expect(collapseBlockedGroups(groups, new Set(["x"])).map((i) => i.kind)).toEqual(["group"]);
    expect(isBlockedAuthor("x", new Set(["x"]))).toBe(true);
    expect(isBlockedAuthor(null, new Set(["x"]))).toBe(false);
  });
});

describe("message requests", () => {
  const base = { areFriends: false, recipientRequestsEnabled: true, involvesBotOrSystem: false, existing: null, recipientHasPosted: false } as const;
  test("first DM from a non-friend becomes a request", () => {
    expect(decideOnSend(base)).toBe("request");
    expect(decideOnSend({ ...base, existing: "pending" })).toBe("request");
    expect(decideOnSend({ ...base, existing: "ignored" })).toBe("request");
  });
  test("friends, bots, disabled setting and established DMs skip requests", () => {
    expect(decideOnSend({ ...base, areFriends: true })).toBe("none");
    expect(decideOnSend({ ...base, involvesBotOrSystem: true })).toBe("none");
    expect(decideOnSend({ ...base, recipientRequestsEnabled: false })).toBe("none");
    expect(decideOnSend({ ...base, recipientHasPosted: true })).toBe("accept");
    expect(decideOnSend({ ...base, existing: "accepted" })).toBe("none");
    expect(decideOnSend({ ...base, existing: "pending", areFriends: true })).toBe("accept");
  });
  test("visibility", () => {
    expect(isHiddenRequest("pending", false)).toBe(true);
    expect(isHiddenRequest("ignored", false)).toBe(true);
    expect(isHiddenRequest("pending", true)).toBe(false);
    expect(isHiddenRequest("accepted", false)).toBe(false);
    expect(isPendingRequest("pending", false)).toBe(true);
    expect(isPendingRequest("ignored", false)).toBe(false);
  });
});

describe("friend request sources", () => {
  test("defaults to everyone", () => {
    expect(friendRequestSources(undefined)).toEqual({ everyone: true, friendsOfFriends: true, serverMembers: true });
    expect(friendRequestAllowedFrom({}, { mutualFriend: false, mutualServer: false })).toBe(true);
  });
  test("narrowed sources", () => {
    const s = { privacy: { friendRequestSources: { everyone: false, friendsOfFriends: true, serverMembers: false } } };
    expect(friendRequestAllowedFrom(s, { mutualFriend: false, mutualServer: true })).toBe(false);
    expect(friendRequestAllowedFrom(s, { mutualFriend: true, mutualServer: false })).toBe(true);
    const none = { privacy: { friendRequests: "none", friendRequestSources: { everyone: true } } };
    expect(friendRequestAllowedFrom(none, { mutualFriend: true, mutualServer: true })).toBe(false);
    const legacy = { friendRequests: { allowEveryone: false } };
    expect(friendRequestAllowedFrom(legacy, { mutualFriend: true, mutualServer: true })).toBe(false);
  });
  test("message requests default on", () => {
    expect(messageRequestsEnabled(undefined)).toBe(true);
    expect(messageRequestsEnabled({ privacy: { messageRequests: false } })).toBe(false);
  });
});

describe("user notes", () => {
  test("normalizes", () => {
    expect(normalizeUserNote("  hi\u0000 ")).toBe("hi");
    expect(normalizeUserNote(5)).toBe("");
    expect(normalizeUserNote("line1\nline2")).toBe("line1\nline2");
    expect(Array.from(normalizeUserNote("x".repeat(500))).length).toBe(USER_NOTE_MAX);
  });
});
