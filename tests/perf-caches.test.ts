import { describe, expect, test } from "bun:test";
import { PermissionsStore } from "../src/lib/roles/permissionsStore";
import { getJsonCached, invalidateJson, peekJson } from "../src/lib/swrJson";

describe("PermissionsStore", () => {
  test("claims a first load once, then reuses a fresh snapshot", () => {
    const store = new PermissionsStore<null>(5000);
    const done = store.claimRefresh("s1", 0);
    expect(done).not.toBeNull();
    expect(store.claimRefresh("s1", 1)).toBeNull(); // in flight
    store.set("s1", { isOwner: false, bitfield: 8n, verification: null }, 10);
    done!();
    expect(store.claimRefresh("s1", 100)).toBeNull(); // fresh
    expect(store.claimRefresh("s1", 6000)).not.toBeNull(); // stale
  });

  test("keeps the same snapshot object and skips listeners when unchanged", () => {
    const store = new PermissionsStore<null>();
    let calls = 0;
    store.subscribe(() => calls++);
    store.set("s1", { isOwner: true, bitfield: 0n, verification: null });
    const first = store.get("s1");
    store.set("s1", { isOwner: true, bitfield: 0n, verification: null });
    expect(store.get("s1")).toBe(first);
    expect(calls).toBe(1);
    store.set("s1", { isOwner: false, bitfield: 0n, verification: null });
    expect(store.get("s1")).not.toBe(first);
    expect(calls).toBe(2);
  });

  test("evicts the oldest server past the cap", () => {
    const store = new PermissionsStore<null>(5000, 2);
    for (const id of ["a", "b", "c"]) store.set(id, { isOwner: false, bitfield: 0n, verification: null });
    expect(store.get("a")).toBeUndefined();
    expect(store.get("c")).toBeDefined();
  });
});

describe("getJsonCached", () => {
  test("dedupes, caches fresh responses and skips failures", async () => {
    const realFetch = globalThis.fetch;
    let hits = 0;
    let fail = false;
    globalThis.fetch = (async () => {
      hits++;
      return fail ? new Response("no", { status: 500 }) : Response.json({ n: hits });
    }) as unknown as typeof fetch;
    try {
      const url = "/test/swr-json";
      const [a, b] = await Promise.all([
        getJsonCached<{ n: number }>(url, 60_000),
        getJsonCached<{ n: number }>(url, 60_000),
      ]);
      expect(a).toEqual({ n: 1 });
      expect(b).toEqual({ n: 1 });
      expect(await getJsonCached(url, 60_000)).toEqual({ n: 1 });
      expect(hits).toBe(1);
      expect(peekJson(url)).toEqual({ n: 1 });

      invalidateJson("/test/");
      expect(peekJson(url)).toBeUndefined();
      fail = true;
      expect(await getJsonCached(url, 60_000)).toBeNull();
      expect(peekJson(url)).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
