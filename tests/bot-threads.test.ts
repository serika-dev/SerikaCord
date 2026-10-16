import { describe, expect, test } from "bun:test";
import {
  CHANNEL_FLAGS,
  filterAndSortThreads,
  pageArchivedThreads,
  pageThreadMemberIds,
  parseBeforeTimestamp,
  parseThreadCreate,
  planForumPatch,
  planThreadPatch,
  threadListLimit,
  threadSearchPlan,
} from "@/lib/botapi/threadRules";
import { toDiscordChannel, toDiscordThreadMember } from "@/lib/services/gatewayEvents";

const TAG = "11111111-1111-4111-8111-111111111111";

describe("parseThreadCreate", () => {
  test("text channels default to a private thread (Discord v10 default)", () => {
    const r = parseThreadCreate({ name: "help" }, { parentType: "text" });
    expect(r.ok && r.value.type).toBe("private_thread");
  });
  test("type 11 is public, invitable kept for private", () => {
    const pub = parseThreadCreate({ name: "x", type: 11 }, { parentType: "text" });
    expect(pub.ok && pub.value.type).toBe("public_thread");
    const priv = parseThreadCreate({ name: "x", type: 12, invitable: false }, { parentType: "text" });
    expect(priv.ok && priv.value.invitable).toBe(false);
  });
  test("announcement channels only take type 10", () => {
    expect(parseThreadCreate({ name: "x" }, { parentType: "announcement" }).ok).toBe(true);
    const bad = parseThreadCreate({ name: "x", type: 12 }, { parentType: "announcement" });
    expect(bad.ok).toBe(false);
  });
  test("from a message is always public and ignores type", () => {
    const r = parseThreadCreate({ name: "x", type: 12 }, { parentType: "text", fromMessage: true });
    expect(r.ok && r.value.type).toBe("public_thread");
  });
  test("name is required and limited to 100", () => {
    const r = parseThreadCreate({}, { parentType: "text" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error.errors as Record<string, unknown>).name).toBeDefined();
    expect(parseThreadCreate({ name: "x".repeat(101) }, { parentType: "text" }).ok).toBe(false);
  });
  test("auto_archive_duration must be one of Discord's values", () => {
    expect(parseThreadCreate({ name: "x", auto_archive_duration: 30 }, { parentType: "text" }).ok).toBe(false);
    const r = parseThreadCreate({ name: "x", auto_archive_duration: 4320 }, { parentType: "text" });
    expect(r.ok && r.value.autoArchiveDuration).toBe(4320);
  });
  test("forum posts need a message and known tags (max 5)", () => {
    const tags = new Set([TAG]);
    expect(parseThreadCreate({ name: "x" }, { parentType: "forum", availableTagIds: tags }).ok).toBe(false);
    const ok = parseThreadCreate({ name: "x", message: { content: "hi" }, applied_tags: [TAG.toUpperCase()] }, { parentType: "forum", availableTagIds: tags });
    expect(ok.ok && ok.value.appliedTags).toEqual([TAG]);
    expect(parseThreadCreate({ name: "x", message: {}, applied_tags: ["nope"] }, { parentType: "forum", availableTagIds: tags }).ok).toBe(false);
    expect(parseThreadCreate({ name: "x", message: {}, applied_tags: [TAG, TAG, TAG, TAG, TAG, TAG] }, { parentType: "forum", availableTagIds: tags }).ok).toBe(false);
  });
  test("rate_limit_per_user is 0..21600", () => {
    expect(parseThreadCreate({ name: "x", rate_limit_per_user: 21601 }, { parentType: "text" }).ok).toBe(false);
    expect(parseThreadCreate({ name: "x", rate_limit_per_user: -1 }, { parentType: "text" }).ok).toBe(false);
  });
});

const state = (over: Partial<Parameters<typeof planThreadPatch>[1]> = {}) => ({
  type: "public_thread",
  archived: false,
  locked: false,
  parentType: "text",
  availableTagIds: new Set<string>(),
  flags: 0,
  ...over,
});
const owner = { isOwner: true, manageThreads: false, canSend: true };
const mod = { isOwner: false, manageThreads: true, canSend: true };
const member = { isOwner: false, manageThreads: false, canSend: true };

describe("planThreadPatch", () => {
  test("owner renames and archives", () => {
    const r = planThreadPatch({ name: "new", archived: true }, state(), owner);
    expect(r.ok && r.plan.updates.name).toBe("new");
    expect(r.ok && r.plan.archive).toEqual({ archived: true });
  });
  test("others cannot rename", () => {
    const r = planThreadPatch({ name: "new" }, state(), member);
    expect(!r.ok && r.status).toBe(403);
  });
  test("anyone who can send unarchives an unlocked thread", () => {
    const r = planThreadPatch({ archived: false }, state({ archived: true }), member);
    expect(r.ok && r.plan.archive).toEqual({ archived: false });
  });
  test("locked threads are moderator-only", () => {
    expect(planThreadPatch({ archived: false }, state({ archived: true, locked: true }), member).ok).toBe(false);
    expect(planThreadPatch({ locked: true }, state(), owner).ok).toBe(false);
    const r = planThreadPatch({ locked: true }, state(), mod);
    expect(r.ok && r.plan.updates.locked).toBe(true);
    // Discord: locking does not archive.
    expect(r.ok && r.plan.archive).toBeUndefined();
  });
  test("archived threads take field edits only with archived: false", () => {
    const r = planThreadPatch({ name: "x" }, state({ archived: true }), mod);
    expect(!r.ok && r.body.code).toBe(50083);
    expect(planThreadPatch({ name: "x", archived: false }, state({ archived: true }), owner).ok).toBe(true);
  });
  test("rate limit / invitable need MANAGE_THREADS; invitable only on private", () => {
    expect(planThreadPatch({ rate_limit_per_user: 5 }, state(), owner).ok).toBe(false);
    expect(planThreadPatch({ rate_limit_per_user: 5 }, state(), mod).ok).toBe(true);
    expect(planThreadPatch({ invitable: false }, state(), mod).ok).toBe(false);
    const r = planThreadPatch({ invitable: false }, state({ type: "private_thread" }), mod);
    expect(r.ok && r.plan.updates.threadInvitable).toBe(false);
  });
  test("applied_tags on forum posts only; PINNED flag only on forum posts", () => {
    const tags = new Set([TAG]);
    expect(planThreadPatch({ applied_tags: [TAG] }, state({ availableTagIds: tags }), owner).ok).toBe(false);
    const r = planThreadPatch({ applied_tags: [TAG] }, state({ parentType: "forum", availableTagIds: tags }), owner);
    expect(r.ok && r.plan.updates.appliedTags).toEqual([TAG]);
    expect(planThreadPatch({ flags: CHANNEL_FLAGS.PINNED }, state(), mod).ok).toBe(false);
    const p = planThreadPatch({ flags: CHANNEL_FLAGS.PINNED }, state({ parentType: "forum" }), mod);
    expect(p.ok && p.plan.updates.flags).toBe(CHANNEL_FLAGS.PINNED);
    expect(planThreadPatch({ flags: 1 << 4 }, state({ parentType: "forum" }), mod).ok).toBe(false);
  });
  test("bad types are 50035", () => {
    const r = planThreadPatch({ archived: "yes" }, state(), mod);
    expect(!r.ok && r.body.code).toBe(50035);
  });
});

describe("planForumPatch", () => {
  const existing = [{ id: TAG, name: "bug", moderated: false, emojiId: null, emojiName: null }];
  test("null without forum fields", () => {
    expect(planForumPatch({ name: "x" }, { type: "forum", flags: 0, availableTags: existing }, () => "new")).toBeNull();
  });
  test("keeps existing tag ids, mints new ones", () => {
    const r = planForumPatch({ available_tags: [{ id: TAG, name: "bugs" }, { name: "idea", emoji_name: "💡" }] }, { type: "forum", flags: 0, availableTags: existing }, () => "fresh");
    expect(r && r.ok && r.updates.availableTags).toEqual([
      { id: TAG, name: "bugs", moderated: false, emojiId: null, emojiName: null },
      { id: "fresh", name: "idea", moderated: false, emojiId: null, emojiName: "💡" },
    ]);
  });
  test("sort order, layout, reaction emoji, REQUIRE_TAG", () => {
    const r = planForumPatch({ default_sort_order: 1, default_forum_layout: 2, default_reaction_emoji: { emoji_name: "👍" }, flags: CHANNEL_FLAGS.REQUIRE_TAG }, { type: "forum", flags: 0, availableTags: [] }, () => "x");
    expect(r && r.ok && r.updates).toEqual({
      defaultSortOrder: "creation_date",
      defaultForumLayout: "gallery_view",
      defaultReactionEmoji: { emojiId: null, emojiName: "👍" },
      flags: CHANNEL_FLAGS.REQUIRE_TAG,
    });
    // The stored form round-trips through the channel serializer.
    const ch = toDiscordChannel({ id: "c", type: "forum", defaultSortOrder: "creation_date", defaultForumLayout: "gallery_view", flags: CHANNEL_FLAGS.REQUIRE_TAG, defaultReactionEmoji: { emojiId: null, emojiName: "👍" } });
    expect(ch.default_sort_order).toBe(1);
    expect(ch.default_forum_layout).toBe(2);
    expect(ch.flags).toBe(CHANNEL_FLAGS.REQUIRE_TAG);
  });
  test("tag name length and layout on media channels are rejected", () => {
    expect(planForumPatch({ available_tags: [{ name: "" }] }, { type: "forum", flags: 0, availableTags: [] }, () => "x")?.ok).toBe(false);
    expect(planForumPatch({ default_forum_layout: 1 }, { type: "media", flags: 0, availableTags: [] }, () => "x")?.ok).toBe(false);
  });
});

describe("listing helpers", () => {
  test("threadListLimit clamps", () => {
    expect(threadListLimit(undefined)).toBe(50);
    expect(threadListLimit("500")).toBe(100);
    expect(threadListLimit("0")).toBe(1);
  });
  test("parseBeforeTimestamp", () => {
    expect(parseBeforeTimestamp(undefined)).toBeNull();
    expect(parseBeforeTimestamp("2026-01-01T00:00:00.000Z")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(Number.isNaN(parseBeforeTimestamp("nope"))).toBe(true);
  });
  test("pageArchivedThreads: newest archive first, before is exclusive, has_more", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `t${n}`, archived: true, archiveTimestamp: new Date(n * 1000) }));
    const page = pageArchivedThreads([...rows, { id: "live", archived: false }], { limit: 2, beforeMs: null });
    expect(page.threads.map((t) => t.id)).toEqual(["t3", "t2"]);
    expect(page.hasMore).toBe(true);
    expect(pageArchivedThreads(rows, { limit: 5, beforeMs: 3000 }).threads.map((t) => t.id)).toEqual(["t2", "t1"]);
  });
  test("pageThreadMemberIds: sorted, after exclusive", () => {
    expect(pageThreadMemberIds(["c", "A", "b"], { limit: 2 })).toEqual(["a", "b"]);
    expect(pageThreadMemberIds(["c", "a", "b"], { after: "a", limit: 5 })).toEqual(["b", "c"]);
    expect(pageThreadMemberIds(["a"], { after: "z", limit: 5 })).toEqual([]);
  });
  test("thread search: words, tags, archived, sort", () => {
    const rows = [
      { id: "1", name: "Bug in login", appliedTags: [TAG], archived: false, createdAt: new Date(1000), updatedAt: new Date(5000) },
      { id: "2", name: "Login idea", appliedTags: [], archived: true, createdAt: new Date(2000), updatedAt: new Date(3000) },
      { id: "3", name: "Other", appliedTags: [TAG], archived: false, createdAt: new Date(3000), updatedAt: new Date(4000) },
    ];
    expect(filterAndSortThreads(rows, threadSearchPlan({ name: "login" })).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterAndSortThreads(rows, threadSearchPlan({ tag: TAG })).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterAndSortThreads(rows, threadSearchPlan({ archived: "true" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterAndSortThreads(rows, threadSearchPlan({ sort_by: "creation_time", sort_order: "asc" })).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("thread serializers", () => {
  test("thread member object", () => {
    const m = toDiscordThreadMember({ id: "t", createdAt: new Date(0) }, "u");
    expect(m).toEqual({ id: "t", user_id: "u", join_timestamp: new Date(0).toISOString(), flags: 0 });
  });
  test("private threads expose invitable from the stored column", () => {
    const t = toDiscordChannel({ id: "t", type: "private_thread", threadInvitable: false }) as { thread_metadata: { invitable: boolean } };
    expect(t.thread_metadata.invitable).toBe(false);
    const d = toDiscordChannel({ id: "t", type: "private_thread" }) as { thread_metadata: { invitable: boolean } };
    expect(d.thread_metadata.invitable).toBe(true);
  });
});
