import { describe, expect, test } from "bun:test";
import { canStartDm, dmPairKey, dmPrivacy, dmPrivacyAllows, isDmBlocked, isDmListedFor, pickDmChannel } from "@/lib/chat/dmAccess";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";

describe("dmPrivacy", () => {
  test("never-saved settings default to everyone", () => {
    expect(dmPrivacy({})).toBe("everyone");
    expect(dmPrivacy(null)).toBe("everyone");
    expect(dmPrivacy({ privacy: {} })).toBe("everyone");
    expect(dmPrivacy({ privacy: { directMessages: "bogus" } })).toBe("everyone");
  });
  test("explicit values are kept", () => {
    expect(dmPrivacy({ privacy: { directMessages: "friends" } })).toBe("friends");
    expect(dmPrivacy({ privacy: { directMessages: "servers" } })).toBe("servers");
  });
});

describe("DM access", () => {
  test("blocks apply in both directions", () => {
    expect(isDmBlocked({ id: A, blockedUsers: [B] }, { id: B })).toBe(true);
    expect(isDmBlocked({ id: A }, { id: B, blockedUsers: [A] })).toBe(true);
    expect(isDmBlocked({ id: A }, { id: B })).toBe(false);
  });
  test("friends-only recipients reject strangers but accept friends and system", () => {
    const recipient = { id: B, settings: { privacy: { directMessages: "friends" } } };
    expect(dmPrivacyAllows({ id: A }, recipient)).toBe(false);
    expect(dmPrivacyAllows({ id: A, friends: [B] }, recipient)).toBe(true);
    expect(dmPrivacyAllows({ id: A }, recipient, true)).toBe(true);
  });
  test("canStartDm: unsaved settings allow, blocks deny", () => {
    expect(canStartDm({ id: A }, { id: B, settings: {} })).toBe(true);
    expect(canStartDm({ id: A }, { id: B, settings: {}, blockedUsers: [A] })).toBe(false);
  });
});

describe("pickDmChannel", () => {
  test("requires exactly the pair and picks the oldest duplicate", () => {
    const rows = [
      { id: "3", type: "dm", recipientIds: [A, C], createdAt: "2024-01-01" },
      { id: "2", type: "dm", recipientIds: [B, A], createdAt: "2024-03-01" },
      { id: "1", type: "dm", recipientIds: [A, B], createdAt: "2024-02-01" },
      { id: "4", type: "group_dm", recipientIds: [A, B], createdAt: "2023-01-01" },
    ];
    expect(pickDmChannel(rows, A, B)?.id).toBe("1");
    expect(pickDmChannel(rows, B, C)).toBeNull();
  });
  test("a self-DM only matches [a, a]", () => {
    const rows = [{ id: "1", type: "dm", recipientIds: [A, B] }];
    expect(pickDmChannel(rows, A, A)).toBeNull();
  });
  test("pair key is order independent", () => {
    expect(dmPairKey(A, B)).toBe(dmPairKey(B, A));
  });
});

describe("isDmListedFor", () => {
  test("empty DMs are listed only for their creator", () => {
    const empty = { type: "dm", recipientIds: [A, B], lastMessageId: null };
    expect(isDmListedFor(empty, A)).toBe(true);
    expect(isDmListedFor(empty, B)).toBe(false);
    expect(isDmListedFor({ ...empty, lastMessageId: "m1" }, B)).toBe(true);
    expect(isDmListedFor({ type: "group_dm", recipientIds: [A, B] }, B)).toBe(true);
  });
});
