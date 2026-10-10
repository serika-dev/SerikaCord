import { describe, expect, test } from "bun:test";
import {
  dedupeIds,
  dmChannelApiBase,
  dmChannelHref,
  GROUP_DM_MAX_MEMBERS,
  groupEventPreview,
  isDmChannelOpen,
  isGroupDmEventType,
  isGroupOwner,
  membersWithout,
  nextGroupOwner,
  normalizeGroupName,
  planGroupAdd,
  planGroupCreate,
} from "@/lib/chat/groupDm";
import { groupTitle, isGroupMember } from "@/lib/chat/groupDmClient";
import { groupMessages, isStandaloneRow } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ME = id(1);
const FRIENDS = [id(2), id(3), id(4), id(5), id(6), id(7), id(8), id(9), id(10), id(11)];

describe("planGroupCreate", () => {
  test("creator first (owner), then friends in order, deduped", () => {
    const plan = planGroupCreate(ME, [id(3), id(2), id(3).toUpperCase()], FRIENDS);
    expect(plan).toEqual({ ok: true, memberIds: [ME, id(3), id(2)] });
  });

  test("needs at least two other people (one friend is a 1:1 DM)", () => {
    expect(planGroupCreate(ME, [id(2)], FRIENDS).ok).toBe(false);
    expect(planGroupCreate(ME, [id(2), ME], FRIENDS).ok).toBe(false);
  });

  test("only friends", () => {
    const plan = planGroupCreate(ME, [id(2), id(99)], FRIENDS);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toContain("friends");
  });

  test("at most 10 members including the creator", () => {
    expect(planGroupCreate(ME, FRIENDS.slice(0, 9), FRIENDS).ok).toBe(true);
    expect(planGroupCreate(ME, FRIENDS.slice(0, 10), FRIENDS).ok).toBe(false);
    expect(GROUP_DM_MAX_MEMBERS).toBe(10);
  });
});

describe("planGroupAdd", () => {
  const current = [ME, id(2), id(3)];

  test("adds new friends, skipping people already in", () => {
    expect(planGroupAdd(current, ME, [id(3), id(4)], FRIENDS)).toEqual({
      ok: true,
      added: [id(4)],
      memberIds: [ME, id(2), id(3), id(4)],
    });
  });

  test("nothing new is an error", () => {
    expect(planGroupAdd(current, ME, [id(2), ME], FRIENDS).ok).toBe(false);
  });

  test("only the adder's friends", () => {
    expect(planGroupAdd(current, ME, [id(99)], FRIENDS).ok).toBe(false);
  });

  test("can't grow past the limit", () => {
    const nine = [ME, ...FRIENDS.slice(0, 8)];
    expect(planGroupAdd(nine, ME, [FRIENDS[8]], FRIENDS).ok).toBe(true);
    expect(planGroupAdd(nine, ME, [FRIENDS[8], FRIENDS[9]], FRIENDS).ok).toBe(false);
  });
});

describe("leaving and ownership", () => {
  const members = [ME, id(2), id(3)];

  test("membersWithout drops the user case-insensitively", () => {
    expect(membersWithout(members, id(2).toUpperCase())).toEqual([ME, id(3)]);
  });

  test("owner leaving passes ownership to the next member", () => {
    expect(nextGroupOwner(members, ME, ME)).toBe(id(2));
  });

  test("someone else leaving keeps the owner", () => {
    expect(nextGroupOwner(members, id(3), ME)).toBe(ME);
  });

  test("last one out leaves no owner", () => {
    expect(nextGroupOwner([ME], ME, ME)).toBeNull();
  });

  test("a group without an owner is owned by its first member", () => {
    expect(isGroupOwner({ ownerId: null, recipientIds: members }, ME)).toBe(true);
    expect(isGroupOwner({ ownerId: id(2), recipientIds: members }, ME)).toBe(false);
    expect(isGroupOwner({ ownerId: id(2), recipientIds: members }, id(2).toUpperCase())).toBe(true);
  });
});

describe("names", () => {
  test("normalizeGroupName collapses whitespace and caps length", () => {
    expect(normalizeGroupName("  game   night  ")).toBe("game night");
    expect(normalizeGroupName(null)).toBe("");
    expect(normalizeGroupName("x".repeat(150)).length).toBe(100);
  });

  test("groupTitle uses the name, else the other members", () => {
    const members = [
      { id: ME, username: "me" },
      { id: id(2), username: "bob", displayName: "Bob" },
      { id: id(3), username: "carol" },
    ];
    expect(groupTitle({ name: "Squad", members }, ME)).toBe("Squad");
    expect(groupTitle({ name: null, members }, ME)).toBe("Bob, carol");
    expect(isGroupMember({ members }, id(3))).toBe(true);
    expect(isGroupMember({ members }, id(4))).toBe(false);
  });

  test("dedupeIds keeps the first spelling and drops blanks", () => {
    expect(dedupeIds(["a", "A", "", null, "b"])).toEqual(["a", "b"]);
  });
});

describe("links", () => {
  test("group rows open the group page, DMs the other person", () => {
    const group = { id: id(50), type: "group_dm", recipients: [{ id: id(2) }] };
    const dm = { id: id(51), type: "dm", recipients: [{ id: id(2) }] };
    expect(dmChannelHref(group)).toBe(`/dm/group/${id(50)}`);
    expect(dmChannelApiBase(group)).toBe(`/api/group-dms/${id(50)}`);
    expect(dmChannelHref(dm)).toBe(`/dm/${id(2)}`);
    expect(dmChannelApiBase(dm)).toBe(`/api/dms/${id(2)}`);
    expect(dmChannelHref({ id: id(52), type: "dm", recipients: [] })).toBeNull();
    expect(isDmChannelOpen(group, `/dm/group/${id(50)}`)).toBe(true);
    expect(isDmChannelOpen(group, `/dm/${id(2)}`)).toBe(false);
  });
});

describe("system rows", () => {
  test("event types", () => {
    expect(isGroupDmEventType("recipient_add")).toBe(true);
    expect(isGroupDmEventType("default")).toBe(false);
    expect(isGroupDmEventType(undefined)).toBe(false);
  });

  test("previews", () => {
    expect(groupEventPreview("recipient_add", "Ann", "Bob")).toBe("Ann added Bob to the group.");
    expect(groupEventPreview("recipient_remove", "Ann", "Ann")).toBe("Ann left the group.");
    expect(groupEventPreview("recipient_remove", "Ann", "Bob")).toBe("Ann removed Bob from the group.");
    expect(groupEventPreview("channel_name_change", "Ann", null, "Squad")).toBe("Ann changed the group name to Squad.");
    expect(groupEventPreview("channel_icon_change", "Ann")).toBe("Ann changed the group icon.");
  });

  test("system rows never merge into a message group", () => {
    const author = { id: ME, username: "me", displayName: "me" };
    const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
    const msgs: ChatMessage[] = [
      { id: "1", content: "hi", authorId: ME, author, channelId: "c", createdAt: at(0) },
      { id: "2", content: "", type: "recipient_add", authorId: ME, author, channelId: "c", createdAt: at(1) },
      { id: "3", content: "yo", authorId: ME, author, channelId: "c", createdAt: at(2) },
    ];
    expect(isStandaloneRow(msgs[1])).toBe(true);
    expect(groupMessages(msgs).map((g) => g.messages.map((m) => m.id))).toEqual([["1"], ["2"], ["3"]]);
  });
});
