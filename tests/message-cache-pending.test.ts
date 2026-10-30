import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// messageCache persists to localStorage; bun has none, so give it a tiny one.
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const g = globalThis as { localStorage?: unknown };
const hadStorage = "localStorage" in g;
const previous = g.localStorage;

beforeAll(() => { g.localStorage = fakeStorage; });
afterAll(() => { if (hadStorage) g.localStorage = previous; else delete g.localStorage; });

describe("message cache persistence", () => {
  test("a message still being sent is never written to localStorage", async () => {
    const { writeCache } = await import("../src/lib/chat/messageCache");
    const base = { channelId: "c", authorId: "me", createdAt: "2026-10-30T00:00:00.000Z", attachments: [], reactions: [] };
    writeCache("/api/dms/x", [
      { ...base, id: "m1", content: "sent" },
      // Shown before the device knew the conversation is encrypted: plaintext, pending.
      { ...base, id: "temp-1", content: "secret draft", pending: true },
    ] as never, true);
    const raw = store.get("sc:msgcache:/api/dms/x");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as Array<{ id: string; content: string }>;
    expect(saved.map((m) => m.id)).toEqual(["m1"]);
    expect(raw).not.toContain("secret draft");
  });
});
