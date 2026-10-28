// E2EE trust on first use: the pure pin rules (lib/e2ee/trust.ts) and the
// "security code changed" → Accept / Verify flow through the real session
// module (in-memory IndexedDB, mocked server).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  describeDevice,
  exportPublicKey,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  signBackupKey,
  signDevice,
  type PublicDevice,
} from "@/lib/e2ee";
import { acceptIdentity, observeIdentity, samePin, setIdentityVerified, type TrustPin } from "@/lib/e2ee/trust";
import { installFakeIndexedDb } from "./helpers/fakeIndexedDb";

// Own ids: the session module and its IndexedDB connection may be shared with other test files.
const ME = "a7777777-7777-4777-8777-777777777777";
const BOB = "b8888888-8888-4888-8888-888888888888";
const CAROL = "c9999999-9999-4999-8999-999999999999";
const CH1 = "d1111111-1111-4111-8111-111111111111";
const CH2 = "d2222222-2222-4222-8222-222222222222";
const CH3 = "d3333333-3333-4333-8333-333333333333";

// ─── Pure rules ───────────────────────────────────────────────────────────────

describe("trust pins (trust.ts)", () => {
  const pin = (key: string, extra: Partial<TrustPin> = {}): TrustPin => ({ key, seen: [key], verified: false, pending: null, updatedAt: 1, ...extra });

  test("first key seen is pinned; the same key again is trusted (or verified)", () => {
    const first = observeIdentity(null, "k1", 10);
    expect(first).toMatchObject({ trust: "new", dirty: true, currentKey: "k1", pendingKey: null });
    expect(first.pin).toMatchObject({ key: "k1", seen: ["k1"], verified: false, pending: null });
    const again = observeIdentity(first.pin, "k1", 11);
    expect(again).toMatchObject({ trust: "trusted", dirty: false, currentKey: "k1" });
    expect(again.pin).toBe(first.pin);
    expect(observeIdentity(pin("k1", { verified: true }), "k1", 12).trust).toBe("verified");
  });

  test("a different key is a change waiting for review: nothing encrypts to it yet", () => {
    const seen = observeIdentity(pin("k1"), "k2", 20);
    expect(seen).toMatchObject({ trust: "changed", dirty: true, currentKey: null, pendingKey: "k2" });
    expect(seen.pin).toMatchObject({ key: "k1", pending: "k2" });
    // Seeing it again changes nothing.
    expect(observeIdentity(seen.pin, "k2", 21).dirty).toBe(false);
    // The trusted key coming back (the change was undone) clears it.
    const back = observeIdentity(seen.pin, "k1", 22);
    expect(back).toMatchObject({ trust: "trusted", dirty: true });
    expect(back.pin.pending).toBeNull();
  });

  test("stale (cached) copies never clear or set what is pending", () => {
    const pending = pin("k1", { pending: "k2" });
    // An old copy with the old key: still trusted for that copy, but the change stays pending.
    const old = observeIdentity(pending, "k1", 30, { stale: true });
    expect(old).toMatchObject({ trust: "trusted", dirty: false });
    expect(old.pin.pending).toBe("k2");
    // After accepting k2, an old copy with k1 shows as changed but never re-pends k1.
    const accepted = acceptIdentity(pending, "k2", 31);
    const replay = observeIdentity(accepted, "k1", 32, { stale: true });
    expect(replay).toMatchObject({ trust: "changed", dirty: false, pendingKey: "k1" });
    expect(replay.pin.pending).toBeNull();
  });

  test("accepting stores exactly the shown key, unverified, keeping old keys for history", () => {
    const accepted = acceptIdentity(pin("k1", { pending: "k2", verified: true }), "k2", 40);
    expect(accepted).toMatchObject({ key: "k2", pending: null, verified: false, updatedAt: 40 });
    expect(accepted.seen).toEqual(["k1", "k2"]);
    expect(observeIdentity(accepted, "k2", 41).trust).toBe("trusted");
    // A newer change that arrived meanwhile isn't accepted unseen: accepting k2 when k3 is pending.
    const newer = acceptIdentity(pin("k1", { pending: "k3" }), "k2", 42);
    expect(newer.key).toBe("k2");
    expect(observeIdentity(newer, "k3", 43).trust).toBe("changed");
    // Accepting again (another tab got there first) is a no-op.
    expect(acceptIdentity(accepted, "k2", 44)).toBe(accepted);
    // No pin yet: accepting pins it.
    expect(acceptIdentity(null, "k9", 45)).toMatchObject({ key: "k9", seen: ["k9"], pending: null });
  });

  test("verifying the shown key: the trusted one is marked, a pending one is accepted as verified", () => {
    const trusted = pin("k1");
    expect(setIdentityVerified(trusted, "k1", true, 50)).toMatchObject({ key: "k1", verified: true });
    expect(setIdentityVerified(trusted, "k1", false, 50)).toBe(trusted);
    const changed = pin("k1", { pending: "k2" });
    expect(setIdentityVerified(changed, "k2", true, 51)).toMatchObject({ key: "k2", verified: true, pending: null, seen: ["k1", "k2"] });
    // Clearing a key that isn't trusted does nothing.
    expect(setIdentityVerified(changed, "k2", false, 52)).toBe(changed);
    expect(setIdentityVerified(null, "k1", false, 53)).toBeNull();
  });

  test("samePin ignores timestamps", () => {
    expect(samePin(pin("k1"), pin("k1", { updatedAt: 99 }))).toBe(true);
    expect(samePin(pin("k1"), pin("k1", { pending: "k2" }))).toBe(false);
    expect(samePin(null, null)).toBe(true);
    expect(samePin(pin("k1"), null)).toBe(false);
  });
});

// ─── Through the session ──────────────────────────────────────────────────────

interface Party {
  identityPub: string;
  backupPub: string;
  backupSig: string;
  device: PublicDevice;
}

async function makeParty(uid: string): Promise<Party> {
  const identity = await generateIdentityKeyPair();
  const backup = await generateBackupKeyPair();
  const backupPub = await exportPublicKey(backup.publicKey);
  const keys = await generateDeviceKeys();
  const desc = await describeDevice(keys);
  return {
    identityPub: await exportPublicKey(identity.publicKey),
    backupPub,
    backupSig: await signBackupKey(identity.privateKey, uid, backupPub),
    device: { ...desc, sig: await signDevice(identity.privateKey, uid, desc) },
  };
}

describe("security code changed: accept and verify", () => {
  const idb = installFakeIndexedDb();
  const realFetch = globalThis.fetch;
  let session: typeof import("@/lib/e2ee/client/session");
  let state: typeof import("@/lib/e2ee/client/state");
  let keyStore: typeof import("@/lib/e2ee/client/keyStore");
  const server = {
    identity: null as null | { identityPub: string; backupPub: string; backupSig: string },
    devices: [] as Array<PublicDevice & { revokedAt: string | null }>,
    bob: null as unknown as Party,
    carol: null as unknown as Party,
    gen: 1,
    hang: false,
    gate: null as Promise<void> | null,
  };
  const dm = { kind: "dm", recipientId: BOB } as const;
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const bundleOf = (uid: string, p: Party) => ({
    userId: uid,
    identityPub: p.identityPub,
    backupPub: p.backupPub,
    backupSig: p.backupSig,
    devices: [{ ...p.device, revokedAt: null }],
    revokedDevices: [],
  });
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    server.bob = await makeParty(BOB);
    server.carol = await makeParty(CAROL);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://serika.test");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (server.hang) return new Promise<Response>(() => {});
      if (url.pathname === "/api/e2ee/status") {
        const deviceId = url.searchParams.get("device");
        return json({
          enabled: true,
          identity: server.identity ? { ...server.identity, hasBackup: false } : null,
          device: deviceId ? { id: deviceId, active: server.devices.some((d) => d.id === deviceId) } : null,
        });
      }
      if (url.pathname === "/api/e2ee/identity" && method === "PUT") {
        server.identity = { identityPub: body.identityPub, backupPub: body.backupPub, backupSig: body.backupSig };
        return json({ identity: server.identity });
      }
      if (url.pathname === "/api/e2ee/devices" && method === "POST") {
        server.devices.push({ id: body.id, ecdhPub: body.ecdhPub, signPub: body.signPub, sig: body.sig, revokedAt: null });
        return json({ device: body });
      }
      const match = /^\/api\/e2ee\/channels\/([0-9a-f-]+)\/keys$/.exec(url.pathname);
      if (match && [CH1, CH2, CH3].includes(match[1])) {
        if (server.gate) await server.gate;
        const channelId = match[1];
        const version = `${channelId.slice(0, 8)}${String(server.gen).padStart(8, "0")}`;
        if (url.searchParams.get("v") === version) return json({ channelId, e2ee: true, version, unchanged: true });
        const other = channelId === CH3 ? bundleOf(CAROL, server.carol) : bundleOf(BOB, server.bob);
        return json({
          channelId,
          e2ee: true,
          version,
          members: [{ userId: ME, ...server.identity, devices: server.devices, revokedDevices: [] }, other],
        });
      }
      return json({ error: `unexpected ${method} ${url.pathname}` }, 404);
    }) as unknown as typeof fetch;
    session = await import("@/lib/e2ee/client/session");
    state = await import("@/lib/e2ee/client/state");
    keyStore = await import("@/lib/e2ee/client/keyStore");
    session.shutdownE2ee();
    await session.initE2ee({ id: ME });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    session?.shutdownE2ee();
    idb.uninstall();
  });

  /** Simulate a reload: module memory gone, IndexedDB (keys, pins, cached bundles) kept. */
  async function reload() {
    await wait(); // pin writes are write-behind
    session.shutdownE2ee();
    void session.initE2ee({ id: ME });
    await session.whenLocalReady();
  }

  const bobIn = (keys: Awaited<ReturnType<typeof session.getChannelKeys>>) => keys.members.find((m) => m.userId === BOB)!;
  const send = () => session.encryptForChannel(CH1, { v: 1, content: "hi", ts: Date.now() }, dm, null, { selfId: ME });

  test("first contact is pinned (trust on first use)", async () => {
    expect(bobIn(await session.getChannelKeys(CH1, true)).trust).toBe("new");
    expect(bobIn(await session.getChannelKeys(CH2, true)).trust).toBe("trusted");
    expect(session.getPin(BOB)?.key).toBe(server.bob.identityPub);
    await send();
  });

  test("a changed security code blocks sending and is shown with the new key", async () => {
    const before = server.bob.identityPub;
    server.bob = await makeParty(BOB);
    server.gen++;
    const bob = bobIn(await session.getChannelKeys(CH1, true));
    expect(bob.trust).toBe("changed");
    expect(bob.pendingKey).toBe(server.bob.identityPub);
    expect(bob.recipients).toHaveLength(0);
    expect(session.getPin(BOB)).toMatchObject({ key: before, pending: server.bob.identityPub });
    await expect(send()).rejects.toMatchObject({ name: "E2eeSendBlockedError", reason: "identity_changed" });
  });

  test("an old cached copy (another conversation) doesn't clear the pending change", async () => {
    // CH2's copy on this device still has Bob's old key; the server is unreachable.
    await reload();
    server.hang = true;
    try {
      const keys = await session.getChannelKeys(CH2);
      expect(bobIn(keys).trust).toBe("trusted");
      await wait();
      // Before the fix this cleared `pending`, so "Accept new code" found nothing to accept.
      expect(session.getPin(BOB)?.pending).toBe(server.bob.identityPub);
    } finally {
      server.hang = false;
    }
  });

  test("Accept stores the shown key, unblocks sending at once, and survives a reload", async () => {
    await reload();
    const shown = bobIn(await session.getChannelKeys(CH1, true));
    expect(shown.trust).toBe("changed");
    const pinsVersion = state.getE2eeSnapshot().pinsVersion;
    expect(await session.acknowledgeIdentityChange(BOB, shown.pendingKey)).toBe(true);
    expect(state.getE2eeSnapshot().pinsVersion).toBeGreaterThan(pinsVersion);
    expect(session.getPin(BOB)).toMatchObject({ key: server.bob.identityPub, pending: null, verified: false });
    // No network needed: the re-check uses the cached copy, now trusted.
    expect(bobIn(await session.getChannelKeys(CH1)).trust).toBe("trusted");
    await send();

    await reload();
    expect(session.getPin(BOB)).toMatchObject({ key: server.bob.identityPub, pending: null });
    expect(bobIn(await session.getChannelKeys(CH1)).trust).toBe("trusted");
    // Stored in IndexedDB (the trust store Verify writes to).
    const stored = await new keyStore.KeyStore(ME).get("pins");
    expect(stored?.[BOB]).toMatchObject({ key: server.bob.identityPub, pending: null });
  });

  test("an old cached copy with the replaced key doesn't bring the old code back", async () => {
    // CH2's copy still has the key from before; the server has the accepted one.
    const keys = await session.getChannelKeys(CH2);
    expect(bobIn(keys).trust).toBe("trusted");
    await wait();
    expect(session.getPin(BOB)).toMatchObject({ key: server.bob.identityPub, pending: null });
  });

  test("a key check in flight while accepting is checked again, never cached with the old verdict", async () => {
    server.bob = await makeParty(BOB);
    server.gen++;
    const shown = bobIn(await session.getChannelKeys(CH1, true));
    expect(shown.trust).toBe("changed");
    let release: () => void = () => {};
    server.gate = new Promise<void>((r) => { release = r; });
    // A revalidation (unchanged key set) starts before the accept and answers after it.
    const inflight = session.getChannelKeys(CH1, true);
    await wait(5);
    await session.acknowledgeIdentityChange(BOB, shown.pendingKey);
    server.gate = null;
    release();
    expect(bobIn(await inflight).trust).toBe("trusted");
    expect(bobIn(await session.getChannelKeys(CH1)).trust).toBe("trusted");
    await send();
  });

  test("Verify on a changed code shows the new number and accepts that exact code as verified", async () => {
    server.bob = await makeParty(BOB);
    server.gen++;
    expect(bobIn(await session.getChannelKeys(CH1, true)).trust).toBe("changed");
    const code = await session.safetyCodeFor(BOB);
    expect(code).toMatchObject({ identityPub: server.bob.identityPub, changed: true, verified: false });
    expect(code.groups).toHaveLength(12);
    await session.markVerified(BOB, true, code.identityPub);
    expect(session.getPin(BOB)).toMatchObject({ key: server.bob.identityPub, verified: true, pending: null });
    expect(bobIn(await session.getChannelKeys(CH1)).trust).toBe("verified");
    expect(await session.acknowledgeIdentityChange(BOB)).toBe(false);
  });

  test("pin writes never overwrite another tab's decision", async () => {
    // Bob's code changes; another tab accepts it (writes IndexedDB directly).
    server.bob = await makeParty(BOB);
    server.gen++;
    expect(bobIn(await session.getChannelKeys(CH1, true)).trust).toBe("changed");
    await wait();
    const accepted = server.bob.identityPub;
    await new keyStore.KeyStore(ME).update("pins", (cur) => ({ ...(cur ?? {}), [BOB]: acceptIdentity(cur?.[BOB], accepted, Date.now()) }));
    // This tab then pins someone new (a write of its own).
    await session.getChannelKeys(CH3, true);
    await wait();
    const stored = await new keyStore.KeyStore(ME).get("pins");
    expect(stored?.[BOB]).toMatchObject({ key: accepted, pending: null });
    expect(stored?.[CAROL]?.key).toBe(server.carol.identityPub);
  });
});
