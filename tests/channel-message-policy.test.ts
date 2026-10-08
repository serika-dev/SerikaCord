import { describe, expect, test } from "bun:test";
import { clampInt } from "@/lib/utils/clampInt";
import { validateMessageAttachments } from "@/lib/chat/attachmentPolicy";
import { dmSendDenyReason } from "@/lib/chat/dmPolicy";
import {
  addReaction,
  matchReactionEmoji,
  removeReaction,
  type StoredReaction,
} from "@/lib/chat/reactionMutations";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHANNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CDN = "https://cdn.serika.chat";

describe("clampInt", () => {
  test("uses the value when it is a positive integer", () => {
    expect(clampInt("25", 50, 100)).toBe(25);
    expect(clampInt(7, 50, 100)).toBe(7);
  });
  test("caps at max", () => {
    expect(clampInt("5000", 50, 100)).toBe(100);
  });
  test("falls back for zero, negative, NaN and missing values", () => {
    expect(clampInt("0", 50, 100)).toBe(50);
    expect(clampInt("-5", 50, 100)).toBe(50);
    expect(clampInt("abc", 50, 100)).toBe(50);
    expect(clampInt(undefined, 50, 100)).toBe(50);
    expect(clampInt("", 20, 50)).toBe(20);
    expect(clampInt(Number.NaN, 20, 50)).toBe(20);
  });
});

describe("validateMessageAttachments", () => {
  const ok = (url: string, extra: Record<string, unknown> = {}) => ({
    id: "a",
    filename: "cat.png",
    contentType: "image/png",
    size: 1234,
    url,
    ...extra,
  });

  test("accepts the sender's own uploads, with or without a channel segment", () => {
    expect(validateMessageAttachments([ok(`${CDN}/attachments/${CHANNEL}/${ALICE}/x.png`)], { cdnUrl: CDN, userId: ALICE })).toBeNull();
    expect(validateMessageAttachments([ok(`${CDN}/attachments/${ALICE}/x.png`)], { cdnUrl: CDN, userId: ALICE })).toBeNull();
    expect(validateMessageAttachments(undefined, { cdnUrl: CDN, userId: ALICE })).toBeNull();
    expect(validateMessageAttachments([], { cdnUrl: CDN, userId: ALICE })).toBeNull();
  });

  test("accepts an empty content type (browsers send it for unknown files)", () => {
    expect(validateMessageAttachments([ok(`${CDN}/attachments/${ALICE}/x.bin`, { contentType: "" })], { cdnUrl: CDN, userId: ALICE })).toBeNull();
  });

  test("rejects foreign hosts and lookalike hosts", () => {
    for (const url of [
      "https://evil.example/invoice.exe",
      `https://cdn.serika.chat.evil.com/attachments/${ALICE}/x.png`,
      `https://user@cdn.serika.chat/attachments/${ALICE}/x.png`,
      `http://cdn.serika.chat/attachments/${ALICE}/x.png`,
      `${CDN}/avatars/${ALICE}/x.png`,
      "not a url",
    ]) {
      expect(validateMessageAttachments([ok(url)], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
    }
  });

  test("rejects another user's upload path", () => {
    expect(validateMessageAttachments([ok(`${CDN}/attachments/${CHANNEL}/${BOB}/x.png`)], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
    // The user id in the file name position doesn't count.
    expect(validateMessageAttachments([ok(`${CDN}/attachments/${ALICE}`)], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
  });

  test("rejects bad metadata", () => {
    const url = `${CDN}/attachments/${ALICE}/x.png`;
    expect(validateMessageAttachments([ok(url, { filename: "" })], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
    expect(validateMessageAttachments([ok(url, { filename: "a".repeat(300) })], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
    expect(validateMessageAttachments([ok(url, { contentType: "<script>" })], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
    expect(validateMessageAttachments([ok(url, { size: -1 })], { cdnUrl: CDN, userId: ALICE })).not.toBeNull();
  });
});

describe("dmSendDenyReason", () => {
  const alice = { id: ALICE, friends: [BOB], blockedUsers: [] as string[] };
  const bob = { id: BOB, friends: [ALICE], blockedUsers: [] as string[], settings: {} };

  test("friends may DM each other", () => {
    expect(dmSendDenyReason(alice, bob)).toBeNull();
  });

  test("a block on either side denies", () => {
    expect(dmSendDenyReason({ ...alice, blockedUsers: [BOB] }, bob)).not.toBeNull();
    expect(dmSendDenyReason(alice, { ...bob, blockedUsers: [ALICE] })).not.toBeNull();
  });

  test("non-friends need the recipient's privacy set to everyone", () => {
    const stranger = { ...alice, friends: [] };
    expect(dmSendDenyReason(stranger, bob)).not.toBeNull();
    expect(dmSendDenyReason(stranger, { ...bob, settings: { privacy: { directMessages: "friends" } } })).not.toBeNull();
    expect(dmSendDenyReason(stranger, { ...bob, settings: { privacy: { directMessages: "everyone" } } })).toBeNull();
  });

  test("system recipients skip the privacy check but not blocks", () => {
    const stranger = { ...alice, friends: [] };
    expect(dmSendDenyReason(stranger, bob, { recipientIsSystem: true })).toBeNull();
    expect(dmSendDenyReason({ ...stranger, blockedUsers: [BOB] }, bob, { recipientIsSystem: true })).not.toBeNull();
  });
});

describe("reaction mutations", () => {
  const thumbs = { name: "👍" };
  const match = matchReactionEmoji(thumbs);

  test("adding creates, increments and ignores repeats", () => {
    let r: StoredReaction[] = [];
    let res = addReaction(r, match, thumbs, ALICE);
    expect(res.count).toBe(1);
    r = res.reactions;
    res = addReaction(r, match, thumbs, BOB);
    expect(res.count).toBe(2);
    r = res.reactions;
    res = addReaction(r, match, thumbs, BOB);
    expect(res.count).toBe(2);
    expect(res.reactions[0].userIds).toEqual([ALICE, BOB]);
  });

  test("adding does not mutate the input array", () => {
    const input: StoredReaction[] = [{ emoji: { name: "👍" }, count: 1, userIds: [ALICE] }];
    addReaction(input, match, thumbs, BOB);
    expect(input[0].userIds).toEqual([ALICE]);
    expect(input[0].count).toBe(1);
  });

  test("custom emoji match by id, unicode by name", () => {
    const custom = matchReactionEmoji({ name: "blob", id: "e1" });
    const r: StoredReaction[] = [
      { emoji: { name: "blob", id: "e2" }, count: 1, userIds: [ALICE] },
      { emoji: { name: "other", id: "e1" }, count: 1, userIds: [ALICE] },
    ];
    expect(r.findIndex(custom)).toBe(1);
  });

  test("removing drops the user and the empty entry", () => {
    const r: StoredReaction[] = [{ emoji: { name: "👍" }, count: 2, userIds: [ALICE, BOB] }];
    const one = removeReaction(r, match, ALICE);
    expect(one.changed).toBe(true);
    expect(one.reactions[0].userIds).toEqual([BOB]);
    expect(one.reactions[0].count).toBe(1);
    const none = removeReaction(one.reactions, match, BOB);
    expect(none.reactions).toEqual([]);
    expect(removeReaction(none.reactions, match, BOB).changed).toBe(false);
    // Input untouched.
    expect(r[0].userIds).toEqual([ALICE, BOB]);
  });
});
