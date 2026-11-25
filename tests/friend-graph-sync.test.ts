import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  accountsIdFromUserId,
  applyFriendPatch,
  backfillAction,
  eitherBlocked,
  graphOpFor,
  graphPeerStates,
  invertState,
  localPeerState,
  mirrorOp,
  pairPatches,
  planBackfill,
  reconcilePeer,
  userIdFromAccountsId,
  type FriendRow,
  type PeerState,
} from "../src/lib/social/friendGraphSync";

// Accounts ids (ObjectIds) and the SerikaCord ids derived from them.
const A = "65f1a2b3c4d5e6f7a8b9c0d1";
const B = "65f1a2b3c4d5e6f7a8b9c0d2";
const C = "65f1a2b3c4d5e6f7a8b9c0d3";
const uA = "65f1a2b3-c4d5-e6f7-a8b9-c0d100000000";
const uB = "65f1a2b3-c4d5-e6f7-a8b9-c0d200000000";
const uC = "65f1a2b3-c4d5-e6f7-a8b9-c0d300000000";
const LEGACY = "3f2b8c1e-9a4d-4c2b-8e1f-6a7b8c9d0e1f";

const row = (id: string, o: { friends?: string[]; incoming?: string[]; outgoing?: string[]; blocked?: string[] } = {}): FriendRow => ({
  id,
  friends: o.friends ?? [],
  blockedUsers: o.blocked ?? [],
  pendingFriendRequests: { incoming: o.incoming ?? [], outgoing: o.outgoing ?? [] },
});

describe("id mapping", () => {
  test("accounts ids round-trip through local ids; legacy ids have none", () => {
    expect(userIdFromAccountsId(A)).toBe(uA);
    expect(accountsIdFromUserId(uA)).toBe(A);
    expect(accountsIdFromUserId(LEGACY)).toBeNull();
    expect(userIdFromAccountsId("not-an-id")).toBeNull();
  });

  test("graphPeerStates maps the graph response to local ids and drops junk", () => {
    const m = graphPeerStates({ friends: [B], incoming: [C], outgoing: ["bad", 5 as unknown as string] });
    expect([...m]).toEqual([[uC, "incoming"], [uB, "friend"]]);
  });
});

describe("local state", () => {
  test("reads friend / outgoing / incoming / none from one row", () => {
    const me = row(uA, { friends: [uB], outgoing: [uC] });
    expect(localPeerState(me, uB)).toBe("friend");
    expect(localPeerState(me, uC)).toBe("outgoing");
    expect(localPeerState(row(uA, { incoming: [uB] }), uB)).toBe("incoming");
    expect(localPeerState(me, LEGACY)).toBe("none");
  });

  test("pairPatches sets both rows and keeps other entries", () => {
    const me = row(uA, { friends: [uC], incoming: [uB] });
    const peer = row(uB, { outgoing: [uA] });
    const p = pairPatches(me, peer, "friend");
    expect(p.me.friends).toEqual([uC, uB]);
    expect(p.me.pendingFriendRequests).toEqual({ incoming: [], outgoing: [] });
    expect(p.peer.friends).toEqual([uA]);
    const back = pairPatches(applyFriendPatch(me, p.me), applyFriendPatch(peer, p.peer), "outgoing");
    expect(back.me).toEqual({ friends: [uC], pendingFriendRequests: { incoming: [], outgoing: [uB] } });
    expect(back.peer).toEqual({ friends: [], pendingFriendRequests: { incoming: [uA], outgoing: [] } });
  });

  test("eitherBlocked checks both directions", () => {
    expect(eitherBlocked(row(uA, { blocked: [uB] }), row(uB))).toBe(true);
    expect(eitherBlocked(row(uA), row(uB, { blocked: [uA] }))).toBe(true);
    expect(eitherBlocked(row(uA), row(uB))).toBe(false);
  });
});

describe("mirror ops", () => {
  test("every SerikaCord transition maps to the right graph write", () => {
    // add
    expect(mirrorOp(uA, uB, "none", "outgoing")).toEqual({ kind: "upsert", a: A, b: B, requestedBy: A });
    // accept (I had their request)
    expect(mirrorOp(uA, uB, "incoming", "friend")).toEqual({ kind: "upsert", a: A, b: B, requestedBy: B, status: 1 });
    // decline / cancel / remove / block
    for (const before of ["incoming", "outgoing", "friend"] as PeerState[]) {
      expect(mirrorOp(uA, uB, before, "none")).toEqual({ kind: "delete", a: A, b: B });
    }
    // unchanged (unblock, failed checks)
    expect(mirrorOp(uA, uB, "none", "none")).toBeNull();
  });

  test("users without an accounts id are skipped", () => {
    expect(mirrorOp(uA, LEGACY, "none", "outgoing")).toBeNull();
    expect(graphOpFor(LEGACY, uB, "friend")).toBeNull();
    expect(graphOpFor(uA, uA, "friend")).toBeNull();
  });
});

describe("reconcilePeer (three-way merge)", () => {
  const cases: Array<[PeerState, PeerState, PeerState, ReturnType<typeof reconcilePeer>, string]> = [
    ["friend", "friend", "none", { agreed: "friend" }, "in sync"],
    ["none", "friend", "none", { local: "friend", agreed: "friend" }, "friendship made elsewhere is imported"],
    ["none", "incoming", "none", { local: "incoming", agreed: "incoming" }, "request made elsewhere is imported"],
    ["friend", "none", "friend", { local: "none", agreed: "none" }, "unfriended elsewhere is removed here"],
    ["outgoing", "none", "outgoing", { local: "none", agreed: "none" }, "declined elsewhere is removed here"],
    ["none", "friend", "friend", { graph: "none", agreed: "none" }, "removal here whose mirror failed is pushed again"],
    ["friend", "none", "none", { graph: "friend", agreed: "friend" }, "pre-mirroring friendship is pushed"],
    ["outgoing", "friend", "outgoing", { local: "friend", agreed: "friend" }, "accepted elsewhere"],
    ["outgoing", "incoming", "none", { local: "friend", graph: "friend", agreed: "friend" }, "both asked: friends"],
    ["friend", "outgoing", "incoming", { local: "friend", graph: "friend", agreed: "friend" }, "both moved: friend wins"],
  ];
  for (const [l, g, b, expected, name] of cases) {
    test(name, () => expect(reconcilePeer(l, g, b)).toEqual(expected));
  }

  test("invertState flips direction only", () => {
    expect(invertState("incoming")).toBe("outgoing");
    expect(invertState("friend")).toBe("friend");
  });
});

describe("backfill planning", () => {
  test("one entry per pair; skips legacy, blocked, bots and one-sided rows", () => {
    const D = "65f1a2b3c4d5e6f7a8b9c0d4";
    const E = "65f1a2b3c4d5e6f7a8b9c0d5";
    const uD = userIdFromAccountsId(D)!;
    const uE = userIdFromAccountsId(E)!;
    const plan = planBackfill([
      { ...row(uA, { friends: [uB, LEGACY], outgoing: [uC], blocked: [] }) },
      { ...row(uB, { friends: [uA] }) },
      { ...row(uC, { incoming: [uA] }) },
      { ...row(LEGACY, { friends: [uA] }) },
      { ...row(uD, { friends: [uE], blocked: [uE] }) },
      { ...row(uE, { friends: [uD] }) },
      { ...row("65f1a2b3-c4d5-e6f7-a8b9-c0d600000000", { friends: [uA] }) }, // A's row doesn't list them
      { ...row("65f1a2b3-c4d5-e6f7-a8b9-c0d700000000", { friends: [uB] }), isBot: true },
    ]);
    expect(plan.pairs).toEqual([
      { me: uA, peer: uC, state: "outgoing" },
      { me: uA, peer: uB, state: "friend" },
    ]);
    expect(plan.skipped).toEqual({ noAccountsId: 1, missingPeer: 0, botOrSystem: 1, blocked: 1, inconsistent: 1 });
  });

  test("never downgrades a graph friendship and skips pairs already there", () => {
    expect(backfillAction("outgoing", "friend")).toBe("graph_ahead");
    expect(backfillAction("friend", "friend")).toBe("in_sync");
    expect(backfillAction("friend", "outgoing")).toBe("push");
    expect(backfillAction("outgoing", "none")).toBe("push");
  });
});

// ── Service: mirroring and reconcile against fakes (no network, DB or Redis) ──

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let graphState: Record<string, { friends: string[]; incoming: string[]; outgoing: string[] }> = {};
let failWrites = false;
const realFetch = globalThis.fetch;

const store = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();
const fakeRedis = {
  multi() {
    const ops: Array<() => void> = [];
    const tx = {
      hset: (k: string, f: string, v: string) => { ops.push(() => { if (!store.has(k)) store.set(k, new Map()); store.get(k)!.set(f, v); }); return tx; },
      hdel: (k: string, f: string) => { ops.push(() => store.get(k)?.delete(f)); return tx; },
      expire: () => tx,
      exec: async () => { ops.forEach((op) => op()); return []; },
    };
    return tx;
  },
  hgetall: async (k: string) => Object.fromEntries(store.get(k) ?? []),
  set: async (k: string, v: string) => { if (strings.has(k)) return null; strings.set(k, v); return "OK"; },
};
let redisOn = false;
mock.module("../src/lib/db/redis", () => ({ getRedis: () => (redisOn ? fakeRedis : null), getPublisher: () => null, getSubscriber: () => null, isRedisAvailable: () => false, cache: { get: async () => null, set: async () => {}, del: async () => {} } }));

const rows = new Map<string, FriendRow & { isBot?: boolean; isSystem?: boolean }>();
mock.module("../src/lib/models", () => ({
  User: {
    findById: async (id: string) => rows.get(id) ?? null,
    find: async (q: { id: { in: string[] } }) => q.id.in.map((id) => rows.get(id)).filter(Boolean),
  },
}));
mock.module("../src/lib/services/friendPairLock", () => ({
  mutateFriendPair: async (
    meId: string,
    peerId: string,
    fn: (me: FriendRow, peer: FriendRow, save: (id: string, patch: Partial<FriendRow>) => Promise<void>) => Promise<{ changed?: boolean }>,
  ) => {
    const me = rows.get(meId);
    const peer = rows.get(peerId);
    if (!me || !peer) return null;
    return fn(me, peer, async (id, patch) => { rows.set(id, applyFriendPatch(rows.get(id)!, patch)); });
  },
}));

const svc = await import("../src/lib/services/friendGraph");

function installFetch() {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.pathname.startsWith("/internal/graph/friends/")) {
      const id = url.pathname.split("/").pop()!;
      return json(graphState[id] ?? { friends: [], incoming: [], outgoing: [] });
    }
    if (failWrites) return json({ error: "down" }, 503);
    return json({ status: init?.method === "DELETE" ? "removed" : "pending" });
  }) as typeof fetch;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("friendGraph service", () => {
  beforeEach(() => {
    calls.length = 0;
    graphState = {};
    failWrites = false;
    store.clear();
    strings.clear();
    rows.clear();
    redisOn = true;
    installFetch();
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    redisOn = false;
  });

  test("mirrorFriendChange posts with the service key and records the base on success", async () => {
    svc.mirrorFriendChange(uA, uB, "none", "outgoing");
    await flush();
    expect(calls).toEqual([{ method: "POST", path: "/internal/graph/friends", body: { a: A, b: B, requestedBy: A } }]);
    expect(store.get(`friendgraph:base:${uA}`)?.get(uB)).toBe("outgoing");
    expect(store.get(`friendgraph:base:${uB}`)?.get(uA)).toBe("incoming");

    svc.mirrorFriendChange(uA, uB, "friend", "none");
    await flush();
    expect(calls[1]).toEqual({ method: "DELETE", path: "/internal/graph/friends", body: { a: A, b: B } });
    expect(store.get(`friendgraph:base:${uA}`)?.has(uB)).toBe(false);
  });

  test("a failed mirror never throws and leaves the base alone", async () => {
    failWrites = true;
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(() => svc.mirrorFriendChange(uA, uB, "none", "outgoing")).not.toThrow();
      await flush();
    } finally {
      console.warn = warn;
    }
    expect(store.get(`friendgraph:base:${uA}`)).toBeUndefined();
    expect(() => svc.mirrorFriendChange(uA, LEGACY, "none", "outgoing")).not.toThrow();
  });

  test("reconcile imports a friendship made elsewhere, unless blocked", async () => {
    rows.set(uA, row(uA));
    rows.set(uB, row(uB));
    rows.set(uC, row(uC, { blocked: [uA] }));
    graphState[A] = { friends: [B, C], incoming: [], outgoing: [] };
    const changed: string[][] = [];
    const log = console.log;
    console.log = () => {};
    try {
      await svc.reconcileFriendGraph(uA, { onLocalChange: (ids) => changed.push(ids) });
    } finally {
      console.log = log;
    }
    expect(localPeerState(rows.get(uA)!, uB)).toBe("friend");
    expect(localPeerState(rows.get(uB)!, uA)).toBe("friend");
    expect(localPeerState(rows.get(uA)!, uC)).toBe("none"); // C blocked A
    expect(changed).toEqual([[uA, uB]]);
    expect(store.get(`friendgraph:base:${uA}`)?.get(uB)).toBe("friend");
    expect(store.get(`friendgraph:base:${uA}`)?.has(uC)).toBe(false);
    // Only the GET: nothing pushed back.
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  test("reconcile pushes local-only pairs, removes ones unfriended elsewhere, and is throttled", async () => {
    rows.set(uA, row(uA, { friends: [uB, uC] }));
    rows.set(uB, row(uB, { friends: [uA] }));
    rows.set(uC, row(uC, { friends: [uA] }));
    store.set(`friendgraph:base:${uA}`, new Map([[uC, "friend"]])); // C was in sync, then removed elsewhere
    graphState[A] = { friends: [], incoming: [], outgoing: [] };
    const log = console.log;
    console.log = () => {};
    try {
      await svc.reconcileFriendGraph(uA);
    } finally {
      console.log = log;
    }
    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      { method: "POST", path: "/internal/graph/friends", body: { a: A, b: B, requestedBy: A, status: 1 } },
    ]);
    expect(localPeerState(rows.get(uA)!, uC)).toBe("none");
    expect(localPeerState(rows.get(uC)!, uA)).toBe("none");

    calls.length = 0;
    await svc.reconcileFriendGraph(uA);
    expect(calls).toEqual([]);
  });

  test("reconcile is a no-op for users without an accounts id", async () => {
    rows.set(LEGACY, row(LEGACY, { friends: [uA] }));
    await svc.reconcileFriendGraph(LEGACY);
    expect(calls).toEqual([]);
  });
});
