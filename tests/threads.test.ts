import { describe, expect, test } from "bun:test";
import {
  canHostThreads,
  clampThreadPanelWidth,
  cleanThreadName,
  defaultThreadName,
  filterThreadsByName,
  formatThreadCount,
  isPastAutoArchive,
  isThreadType,
  normalizeAutoArchiveDuration,
  partitionThreads,
  threadMembersToAdd,
  type ThreadSummary,
} from "@/lib/chat/threads";
import { applyThreadUpdate, groupMessages, isStandaloneRow } from "@/lib/chat/messages";
import { canSendInChannel, hasChannelPermission } from "@/lib/roles/channelPermissions";
import { PERMISSION_BITS as P } from "@/lib/permissions/bits";
import type { ChatMessage } from "@/lib/chat/types";

const summary = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "t1",
  name: "Thread",
  type: "public_thread",
  parentId: "c1",
  ownerId: "u1",
  archived: false,
  locked: false,
  messageCount: 0,
  memberCount: 1,
  autoArchiveDuration: 1440,
  archiveTimestamp: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  starterMessageId: null,
  lastMessage: null,
  ...over,
});

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  content: "hi",
  authorId: "u1",
  author: { id: "u1", username: "a", displayName: "A" },
  channelId: "c1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("thread types", () => {
  test("thread and host channel types", () => {
    expect(isThreadType("public_thread")).toBeTrue();
    expect(isThreadType("private_thread")).toBeTrue();
    expect(isThreadType("text")).toBeFalse();
    expect(canHostThreads("text")).toBeTrue();
    expect(canHostThreads("announcement")).toBeTrue();
    expect(canHostThreads("forum")).toBeFalse();
    expect(canHostThreads("public_thread")).toBeFalse();
  });
});

describe("auto-archive durations", () => {
  test("only Discord's four windows are accepted", () => {
    expect(normalizeAutoArchiveDuration(60)).toBe(60);
    expect(normalizeAutoArchiveDuration("10080")).toBe(10080);
    expect(normalizeAutoArchiveDuration(15)).toBe(1440);
    expect(normalizeAutoArchiveDuration(null, 4320)).toBe(4320);
  });

  test("idle past the window archives; never without a window", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(isPastAutoArchive(now - 61 * 60_000, 60, now)).toBeTrue();
    expect(isPastAutoArchive(now - 59 * 60_000, 60, now)).toBeFalse();
    expect(isPastAutoArchive(now - 10 * 86_400_000, null, now)).toBeFalse();
  });
});

describe("thread names", () => {
  test("default name flattens markup and mentions and is length-limited", () => {
    expect(defaultThreadName("**hello** <@11111111-1111-1111-1111-111111111111> world")).toBe("hello world");
    expect(defaultThreadName("look :) <:wave:22222222-2222-2222-2222-222222222222>")).toBe("look :) :wave:");
    expect(defaultThreadName("   ")).toBe("New Thread");
    expect(defaultThreadName("", "")).toBe("");
    expect(defaultThreadName("x".repeat(150)).length).toBe(100);
  });

  test("typed names are trimmed and collapsed", () => {
    expect(cleanThreadName("  a   b  ")).toBe("a b");
    expect(cleanThreadName(null)).toBe("");
    expect(cleanThreadName("y".repeat(120)).length).toBe(100);
  });
});

describe("counts and browser", () => {
  test("message count caps at 50+", () => {
    expect(formatThreadCount(0)).toBe("0");
    expect(formatThreadCount(50)).toBe("50");
    expect(formatThreadCount(51)).toBe("50+");
    expect(formatThreadCount(undefined)).toBe("0");
  });

  test("partition: joined first, other active, archived newest first", () => {
    const a = summary({ id: "a", lastMessage: { id: "x", content: "", createdAt: "2026-01-03T00:00:00.000Z", author: null } });
    const b = summary({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" });
    const c = summary({ id: "c", archived: true, archiveTimestamp: "2026-01-05T00:00:00.000Z" });
    const d = summary({ id: "d", archived: true, archiveTimestamp: "2026-01-06T00:00:00.000Z" });
    const parts = partitionThreads([b, c, a, d], (t) => t.id === "b");
    expect(parts.joined.map((t) => t.id)).toEqual(["b"]);
    expect(parts.other.map((t) => t.id)).toEqual(["a"]);
    expect(parts.archived.map((t) => t.id)).toEqual(["d", "c"]);
  });

  test("name filter is case-insensitive", () => {
    const list = [summary({ name: "Bug Reports" }), summary({ id: "2", name: "Ideas" })];
    expect(filterThreadsByName(list, "bug").length).toBe(1);
    expect(filterThreadsByName(list, "  ").length).toBe(2);
  });

  test("panel width stays within bounds", () => {
    expect(clampThreadPanelWidth(100, 1600)).toBe(360);
    expect(clampThreadPanelWidth(5000, 1600)).toBe(960);
    expect(clampThreadPanelWidth(500, 1600)).toBe(500);
    expect(clampThreadPanelWidth(Number.NaN, 1600)).toBe(440);
  });
});

describe("thread membership", () => {
  test("author and mentioned users join once", () => {
    expect(threadMembersToAdd(["u1"], "u1", ["u2", "U2", "u1"])).toEqual(["u2"]);
    expect(threadMembersToAdd(null, "u3", [])).toEqual(["u3"]);
    expect(threadMembersToAdd(["u1"], "u1", null)).toEqual([]);
  });
});

describe("thread rows in the chat engine", () => {
  test("'started a thread' rows stand alone", () => {
    expect(isStandaloneRow({ type: "thread_created" })).toBeTrue();
    const groups = groupMessages([
      msg({ id: "1" }),
      msg({ id: "2", type: "thread_created", threadId: "t1" }),
      msg({ id: "3" }),
    ]);
    expect(groups.length).toBe(3);
  });

  test("thread_update reaches the starter and the notice row", () => {
    const list = [msg({ id: "s" }), msg({ id: "n", type: "thread_created", threadId: "t1" }), msg({ id: "o" })];
    const next = applyThreadUpdate(list, { threadId: "t1", messageId: "s", thread: summary({ messageCount: 3 }) });
    expect(next[0].thread?.messageCount).toBe(3);
    expect(next[0].threadId).toBe("t1");
    expect(next[1].thread?.messageCount).toBe(3);
    expect(next[2]).toBe(list[2]);
  });

  test("a deleted thread drops the chip; unrelated updates keep the array", () => {
    const list = [msg({ id: "s", threadId: "t1", thread: summary() })];
    const cleared = applyThreadUpdate(list, { threadId: "t1", messageId: "s", thread: null });
    expect(cleared[0].thread).toBeNull();
    expect(cleared[0].threadId).toBeUndefined();
    expect(applyThreadUpdate(list, { threadId: "other", thread: summary({ id: "other" }) })).toBe(list);
  });
});

describe("thread permissions (client mirror)", () => {
  const SERVER = "s1";
  const everyoneDeny = (bits: bigint) => ({
    permissionOverwrites: [{ id: SERVER, type: "role", allow: "0", deny: bits.toString() }],
    serverId: SERVER,
  });

  test("threads speak with SEND_MESSAGES_IN_THREADS, not SEND_MESSAGES", () => {
    const thread = { ...everyoneDeny(P.SEND_MESSAGES), type: "public_thread" };
    expect(canSendInChannel(thread, [], [], false, false, { everyonePermissions: P.SEND_MESSAGES_IN_THREADS | P.VIEW_CHANNEL })).toBeTrue();
    const blocked = { ...everyoneDeny(P.SEND_MESSAGES_IN_THREADS), type: "public_thread" };
    expect(canSendInChannel(blocked, [], [], false, false, { everyonePermissions: P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS })).toBeFalse();
  });

  test("create threads follows the channel's overwrites", () => {
    const channel = everyoneDeny(P.CREATE_PUBLIC_THREADS);
    expect(hasChannelPermission(channel, P.CREATE_PUBLIC_THREADS, [], [], false, false, { everyonePermissions: P.CREATE_PUBLIC_THREADS })).toBeFalse();
    expect(hasChannelPermission({ serverId: SERVER }, P.CREATE_PUBLIC_THREADS, [], [], false, false, { everyonePermissions: P.CREATE_PUBLIC_THREADS })).toBeTrue();
    expect(hasChannelPermission(channel, P.CREATE_PUBLIC_THREADS, [], [], true, false)).toBeTrue();
    expect(hasChannelPermission(null, P.MANAGE_THREADS, [], [], true, false)).toBeFalse();
  });
});
