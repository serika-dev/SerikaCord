import { describe, expect, test } from "bun:test";
import {
  COMMAND_HISTORY_LIMIT,
  canRecallCommand,
  lastOwnMessageAt,
  notePlainSend,
  pushCommandHistory,
  readCommandHistory,
  readLastPlainSendAt,
  recallableHistory,
  recordCommand,
  stepCommandHistory,
  type CommandHistoryEntry,
} from "@/lib/chat/commandHistory";

const entry = (key: string, values: Record<string, string> = {}, at = 0): CommandHistoryEntry => ({
  key,
  name: key,
  values,
  labels: {},
  shown: Object.keys(values),
  at,
});

describe("history list", () => {
  test("newest last, re-runs move to the end, capped at 20", () => {
    let list: CommandHistoryEntry[] = [];
    list = pushCommandHistory(list, entry("a", { x: "1" }, 1));
    list = pushCommandHistory(list, entry("b", {}, 2));
    list = pushCommandHistory(list, entry("a", { x: "1" }, 3));
    expect(list.map((e) => [e.key, e.at])).toEqual([["b", 2], ["a", 3]]);
    list = pushCommandHistory(list, entry("a", { x: "2" }, 4));
    expect(list.length).toBe(3);
    for (let i = 0; i < 30; i++) list = pushCommandHistory(list, entry(`c${i}`, {}, 10 + i));
    expect(list.length).toBe(COMMAND_HISTORY_LIMIT);
    expect(list[list.length - 1].key).toBe("c29");
  });
  test("entries for commands that are gone are skipped", () => {
    const list = [entry("builtin:roll"), entry("app:x:gone"), entry("builtin:me")];
    expect(recallableHistory(list, new Set(["builtin:roll", "builtin:me"])).map((e) => e.key)).toEqual(["builtin:roll", "builtin:me"]);
  });
});

describe("cycling", () => {
  test("↑ starts at the newest and stops at the oldest", () => {
    expect(stepCommandHistory(3, null, "up")).toBe(2);
    expect(stepCommandHistory(3, 2, "up")).toBe(1);
    expect(stepCommandHistory(3, 0, "up")).toBe(0);
  });
  test("↓ goes forward and then back to an empty composer", () => {
    expect(stepCommandHistory(3, 1, "down")).toBe(2);
    expect(stepCommandHistory(3, 2, "down")).toBeNull();
    expect(stepCommandHistory(3, null, "down")).toBeNull();
  });
  test("empty history never starts browsing", () => {
    expect(stepCommandHistory(0, null, "up")).toBeNull();
  });
});

describe("↑ recall rule", () => {
  test("a command newer than your last message is recalled", () => {
    expect(canRecallCommand({ lastCommandAt: 2000, lastPlainSendAt: 1000, lastOwnMessageAt: 1000 })).toBe(true);
    expect(canRecallCommand({ lastCommandAt: 2000, lastPlainSendAt: null, lastOwnMessageAt: null })).toBe(true);
  });
  test("a normal message after the command means ↑ edits it instead", () => {
    expect(canRecallCommand({ lastCommandAt: 2000, lastPlainSendAt: 2500, lastOwnMessageAt: null })).toBe(false);
    // Sent from another device (server time), well after the command.
    expect(canRecallCommand({ lastCommandAt: 2000, lastPlainSendAt: null, lastOwnMessageAt: 9000 })).toBe(false);
  });
  test("the message a command itself posts (/me, /shrug) doesn't count", () => {
    expect(canRecallCommand({ lastCommandAt: 2000, lastPlainSendAt: null, lastOwnMessageAt: 3500 })).toBe(true);
  });
  test("no command, no recall", () => {
    expect(canRecallCommand({ lastCommandAt: null, lastPlainSendAt: null, lastOwnMessageAt: null })).toBe(false);
  });
  test("last own message skips pending, ephemeral and others' messages", () => {
    const msgs = [
      { id: "1", authorId: "me", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: "2", author: { id: "them" }, createdAt: "2026-01-01T00:00:05.000Z" },
      { id: "temp-3", authorId: "me", createdAt: "2026-01-01T00:00:06.000Z", pending: true },
      { id: "eph-local-4", authorId: "me", createdAt: "2026-01-01T00:00:07.000Z", ephemeral: true },
    ];
    expect(lastOwnMessageAt(msgs, "me")).toBe(Date.parse("2026-01-01T00:00:01.000Z"));
    expect(lastOwnMessageAt(msgs, "nobody")).toBeNull();
    expect(lastOwnMessageAt(msgs, null)).toBeNull();
  });
});

describe("store", () => {
  test("per conversation, works without sessionStorage", () => {
    recordCommand("ctx-a", entry("builtin:roll", { sides: "20" }, 5));
    recordCommand("ctx-b", entry("builtin:me", { action: "waves" }, 6));
    expect(readCommandHistory("ctx-a").map((e) => e.values)).toEqual([{ sides: "20" }]);
    expect(readCommandHistory("ctx-b").map((e) => e.key)).toEqual(["builtin:me"]);
    expect(readLastPlainSendAt("ctx-a")).toBeNull();
    notePlainSend("ctx-a", 42);
    expect(readLastPlainSendAt("ctx-a")).toBe(42);
    expect(readLastPlainSendAt("ctx-b")).toBeNull();
  });
});
