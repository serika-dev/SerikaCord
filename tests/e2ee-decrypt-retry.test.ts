// Encrypted messages that fail to decrypt for a moment are retried, never
// remembered as failures for good (lib/e2ee/decryptRetry.ts), and the client
// session reports transient causes as transient: a key fetch that failed once
// (network, 401 during a token refresh, 429), a sender device whose keys
// couldn't be fetched, an engine error.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DECRYPT_RETRY_DELAYS_MS,
  DecryptMemo,
  applyRetriedMessages,
  decryptRetryDelay,
  envelopeSigOf,
  failureState,
  isMemoizableDecryptFailure,
  isRetryableFailure,
  isTransientDecryptFailure,
  rawRowForRetry,
  stateAfterRetry,
} from "@/lib/e2ee/decryptRetry";
import {
  backupRecipientId,
  describeDevice,
  encryptMessage,
  exportPublicKey,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  signBackupKey,
  signDevice,
  type DeviceKeys,
  type PublicDevice,
} from "@/lib/e2ee";
import { decryptContextFor } from "@/lib/e2ee/client/chatGlue";
import { installFakeIndexedDb } from "./helpers/fakeIndexedDb";

const ENVELOPE = { v: 1, sig: "c2lnLWE=", sd: "dev", keys: [] };

describe("which failures are retried", () => {
  test("keys loading / unreachable, unknown sender device and engine errors are transient", () => {
    for (const r of ["not_ready", "keys_unavailable", "unknown_device", "temporary"]) expect(isTransientDecryptFailure(r)).toBe(true);
    for (const r of ["no_key", "unwrap", "decrypt", "commitment", "payload", "signature", "revoked_device", "edit_mismatch", "wrong_conversation", "foreign_url", "malformed", "restore"]) {
      expect(isTransientDecryptFailure(r)).toBe(false);
    }
    expect(isTransientDecryptFailure(undefined)).toBe(false);
  });

  test("transient failures and \"restore\" are never memoised", () => {
    expect(isMemoizableDecryptFailure("keys_unavailable")).toBe(false);
    expect(isMemoizableDecryptFailure("restore")).toBe(false);
    expect(isMemoizableDecryptFailure("signature")).toBe(true);
    expect(isMemoizableDecryptFailure("no_key")).toBe(true);
  });

  test("three automatic retries over about ten seconds", () => {
    expect(DECRYPT_RETRY_DELAYS_MS).toHaveLength(3);
    expect(DECRYPT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000);
    expect(decryptRetryDelay(0)).toBe(DECRYPT_RETRY_DELAYS_MS[0]);
    expect(decryptRetryDelay(2)).toBe(DECRYPT_RETRY_DELAYS_MS[2]);
    expect(decryptRetryDelay(3)).toBeNull();
    expect(decryptRetryDelay(-1)).toBe(DECRYPT_RETRY_DELAYS_MS[0]);
  });
});

describe("failure state of a message", () => {
  test("a transient failure keeps retrying (shown as decrypting) until the attempts run out", () => {
    const s0 = failureState("keys_unavailable", ENVELOPE, ["https://cdn/a.bin"]);
    expect(s0).toMatchObject({ status: "error", reason: "keys_unavailable", attempts: 0, retrying: true, stored: ["https://cdn/a.bin"] });
    expect(s0.envelope).toBe(ENVELOPE);
    let s = s0 as ReturnType<typeof failureState>;
    for (let i = 1; i <= 3; i++) {
      s = stateAfterRetry({ status: "error", reason: "keys_unavailable", envelope: ENVELOPE }, s) as ReturnType<typeof failureState>;
      expect(s.attempts).toBe(i);
      expect(s.retrying).toBe(i < 3);
      // The stored blobs survive every retry.
      expect(s.stored).toEqual(["https://cdn/a.bin"]);
    }
  });

  test("a permanent failure shows at once; one without an envelope can't retry", () => {
    expect(failureState("signature", ENVELOPE).retrying).toBe(false);
    expect(failureState("keys_unavailable", undefined).retrying).toBe(false);
  });

  test("a reset (keys changed, tab back, Try again) starts the attempts over", () => {
    const exhausted = { status: "error", reason: "keys_unavailable", envelope: ENVELOPE, attempts: 3, retrying: false };
    const again = stateAfterRetry({ status: "error", reason: "keys_unavailable", envelope: ENVELOPE }, exhausted, true);
    expect(again).toMatchObject({ attempts: 0, retrying: true });
  });

  test("a success replaces the failure as is", () => {
    const ok = { status: "ok", verified: true, envelope: ENVELOPE };
    expect(stateAfterRetry(ok, failureState("keys_unavailable", ENVELOPE))).toBe(ok);
  });

  test("retryable messages: failed, with their envelope, not being sent", () => {
    const failed = { id: "a", e2ee: failureState("signature", ENVELOPE) };
    expect(isRetryableFailure(failed)).toBe(true);
    expect(isRetryableFailure(failed, { transientOnly: true })).toBe(false);
    expect(isRetryableFailure({ id: "b", e2ee: { status: "error", reason: "keys_unavailable" } })).toBe(false);
    expect(isRetryableFailure({ id: "c", e2ee: { status: "ok", envelope: ENVELOPE } })).toBe(false);
    expect(isRetryableFailure(failed, { ids: new Set(["x"]) })).toBe(false);
  });

  test("the raw row for a retry puts the envelope and the stored blobs back", () => {
    const m = { id: "a", authorId: "u", content: "", attachments: [], e2ee: failureState("keys_unavailable", ENVELOPE, ["https://cdn/a.bin"]) };
    const raw = rawRowForRetry(m)!;
    expect(raw.e2ee).toBe(ENVELOPE);
    expect(raw.attachments).toEqual([{ url: "https://cdn/a.bin" }]);
    expect(raw.authorId).toBe("u");
    expect(rawRowForRetry({ id: "b", e2ee: { status: "ok", envelope: ENVELOPE } })).toBeNull();
  });
});

describe("putting retried messages back", () => {
  type Row = { id: string; content: string; reactions?: string[]; e2ee?: { status?: unknown; envelope?: unknown; reason?: unknown; attempts?: unknown; retrying?: unknown; stored?: unknown; verified?: unknown }; referencedMessage?: Record<string, unknown> | null };

  test("a success replaces the failure's decrypted fields only (reactions that changed meanwhile stay)", () => {
    const prev: Row[] = [{ id: "a", content: "", reactions: ["👍"], e2ee: failureState("keys_unavailable", ENVELOPE) }];
    const result: Row = { id: "a", content: "hello", reactions: [], e2ee: { status: "ok", verified: true, envelope: ENVELOPE } };
    const next = applyRetriedMessages(prev, [result]);
    expect(next[0].content).toBe("hello");
    expect(next[0].e2ee?.status).toBe("ok");
    expect(next[0].reactions).toEqual(["👍"]);
  });

  test("never overwrites an edit (another envelope) or a message that decrypted meanwhile", () => {
    const edited = { ...ENVELOPE, sig: "c2lnLWI=" };
    const prev: Row[] = [
      { id: "a", content: "", e2ee: failureState("keys_unavailable", edited) },
      { id: "b", content: "fine", e2ee: { status: "ok", envelope: ENVELOPE } },
    ];
    const results: Row[] = [
      { id: "a", content: "old", e2ee: { status: "ok", envelope: ENVELOPE } },
      { id: "b", content: "", e2ee: failureState("keys_unavailable", ENVELOPE) },
    ];
    expect(applyRetriedMessages(prev, results)).toBe(prev);
  });

  test("an unchanged failure keeps the same array (no re-render)", () => {
    const state = failureState("signature", ENVELOPE);
    const prev: Row[] = [{ id: "a", content: "", e2ee: state }];
    expect(applyRetriedMessages(prev, [{ id: "a", content: "", e2ee: { ...state } }])).toBe(prev);
  });

  test("replies quoting a message that now decrypted show our own text", () => {
    const prev: Row[] = [
      { id: "A", content: "", e2ee: failureState("keys_unavailable", ENVELOPE) },
      { id: "r", content: "reply", e2ee: { status: "ok", envelope: { sig: "x" } }, referencedMessage: { id: "a", content: "their snippet", encrypted: true, quotedBySender: true } },
    ];
    const next = applyRetriedMessages(prev, [{ id: "A", content: "original", e2ee: { status: "ok", envelope: ENVELOPE } }]);
    expect(next[1].referencedMessage).toMatchObject({ content: "original", quotedBySender: false });
    expect(next[1]).not.toBe(prev[1]);
  });

  test("envelope signature helper", () => {
    expect(envelopeSigOf({ envelope: ENVELOPE })).toBe(ENVELOPE.sig);
    expect(envelopeSigOf(null)).toBeNull();
  });
});

describe("decryption memo: successes only, failures never for good", () => {
  type R = { ok: boolean; reason?: string };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test("in flight: shared by concurrent callers", () => {
    const memo = new DecryptMemo<R>();
    const p = new Promise<R>(() => {});
    memo.set("k", p);
    expect(memo.get("k")).toBe(p);
  });

  test("a success is kept", async () => {
    const memo = new DecryptMemo<R>();
    memo.set("k", Promise.resolve({ ok: true }));
    await flush();
    expect(memo.get("k")).toBeDefined();
  });

  test("a transient failure is dropped as soon as it settles", async () => {
    const memo = new DecryptMemo<R>();
    for (const reason of ["keys_unavailable", "not_ready", "unknown_device", "temporary", "restore"]) {
      memo.set(reason, Promise.resolve({ ok: false, reason }));
    }
    await flush();
    expect(memo.size).toBe(0);
  });

  test("a rejected promise is never kept", async () => {
    const memo = new DecryptMemo<R>();
    const p = Promise.reject(new Error("boom"));
    p.catch(() => {});
    memo.set("k", p);
    await flush();
    expect(memo.get("k")).toBeUndefined();
  });

  test("a permanent failure is kept for its TTL only", async () => {
    let now = 1_000;
    const memo = new DecryptMemo<R>({ failureTtlMs: 60_000, now: () => now });
    memo.set("k", Promise.resolve({ ok: false, reason: "signature" }));
    await flush();
    expect(memo.get("k")).toBeDefined();
    now += 60_001;
    expect(memo.get("k")).toBeUndefined();
  });

  test("bounded: oldest out first; deleteWhere and clear", async () => {
    const memo = new DecryptMemo<R>({ max: 2 });
    memo.set("c|1", Promise.resolve({ ok: true }));
    memo.set("c|2", Promise.resolve({ ok: true }));
    memo.set("d|3", Promise.resolve({ ok: true }));
    expect(memo.get("c|1")).toBeUndefined();
    memo.deleteWhere((k) => k.startsWith("c|"));
    expect(memo.size).toBe(1);
    memo.clear();
    expect(memo.size).toBe(0);
  });

  test("a stale settle never touches a newer entry", async () => {
    const memo = new DecryptMemo<R>();
    let resolveOld: (r: R) => void = () => {};
    memo.set("k", new Promise<R>((r) => { resolveOld = r; }));
    const fresh = Promise.resolve<R>({ ok: true });
    memo.set("k", fresh);
    resolveOld({ ok: false, reason: "keys_unavailable" });
    await flush();
    expect(memo.get("k")).toBe(fresh);
  });
});

describe("decrypt context of a live message", () => {
  const BOB = "22222222-2222-4222-8222-222222222222";
  test("a 1:1 DM whose facts haven't loaded uses the row's channel (checked against the URL's person later)", () => {
    expect(decryptContextFor({ kind: "dm", recipientId: BOB }, null, [{ channelId: "AAAA" }])).toEqual({ channelId: "aaaa", dmPeer: BOB });
    expect(decryptContextFor({ kind: "dm", recipientId: BOB }, null, [{ channelId: "a" }, { channelId: "b" }])).toEqual({ channelId: null, dmPeer: BOB });
    expect(decryptContextFor({ kind: "dm", recipientId: BOB }, { channelId: "m", e2ee: true, e2eeAuto: false }, [{ channelId: "x" }]).channelId).toBe("m");
    // A group always uses the URL's channel.
    expect(decryptContextFor({ kind: "group", channelId: "g" }, null, [{ channelId: "x" }])).toEqual({ channelId: "g", group: true });
  });
});

// ─── The client session (mock server + in-memory IndexedDB) ──────────────────

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "66666666-6666-4666-8666-666666666666";

interface Party {
  identity: CryptoKeyPair;
  identityPub: string;
  backupPub: string;
  backupSig: string;
  device: { keys: DeviceKeys; pub: PublicDevice };
}

async function newDevice(identity: CryptoKeyPair) {
  const keys = await generateDeviceKeys();
  const desc = await describeDevice(keys);
  return { keys, pub: { ...desc, sig: await signDevice(identity.privateKey, BOB, desc) } };
}

async function makeBob(): Promise<Party> {
  const identity = await generateIdentityKeyPair();
  const backup = await generateBackupKeyPair();
  const identityPub = await exportPublicKey(identity.publicKey);
  const backupPub = await exportPublicKey(backup.publicKey);
  return {
    identity,
    identityPub,
    backupPub,
    backupSig: await signBackupKey(identity.privateKey, BOB, backupPub),
    device: await newDevice(identity),
  };
}

describe("client session: transient failures are reported as such and never cached", () => {
  const idb = installFakeIndexedDb();
  const realFetch = globalThis.fetch;
  let session: typeof import("@/lib/e2ee/client/session");
  let bob: Party;
  const server = {
    identity: null as null | { identityPub: string; backupPub: string; backupSig: string },
    devices: [] as Array<PublicDevice & { revokedAt: string | null }>,
    bobDevices: [] as PublicDevice[],
    version: 1,
    /** Fail the next N key requests (channel set and user keys). */
    failKeys: 0,
    failUserKeys: 0,
  };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const bobBundle = () => ({ userId: BOB, identityPub: bob.identityPub, backupPub: bob.backupPub, backupSig: bob.backupSig, devices: server.bobDevices, revokedDevices: [] });

  beforeAll(async () => {
    bob = await makeBob();
    server.bobDevices = [bob.device.pub];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://serika.test");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
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
      if (url.pathname === `/api/e2ee/channels/${CHANNEL}/keys`) {
        if (server.failKeys > 0) {
          server.failKeys--;
          return json({ error: "Too many requests" }, 429);
        }
        const version = `${server.version}`.padStart(16, "0");
        if (url.searchParams.get("v") === version) return json({ channelId: CHANNEL, e2ee: true, version, unchanged: true });
        return json({
          channelId: CHANNEL,
          e2ee: true,
          version,
          members: [{ userId: ME, ...server.identity, devices: server.devices, revokedDevices: [] }, bobBundle()],
        });
      }
      if (url.pathname === `/api/e2ee/users/${BOB}/keys`) {
        if (server.failUserKeys > 0) {
          server.failUserKeys--;
          return json({ error: "Service unavailable" }, 503);
        }
        return json({ keys: bobBundle() });
      }
      return json({ error: `unexpected ${method} ${url.pathname}` }, 404);
    }) as unknown as typeof fetch;
    session = await import("@/lib/e2ee/client/session");
    session.shutdownE2ee();
    await session.initE2ee({ id: ME });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    session?.shutdownE2ee();
    idb.uninstall();
  });

  async function bobSends(id: string, content: string, device = bob.device) {
    const recipients = [
      ...server.devices.map((d) => ({ id: d.id, pub: d.ecdhPub })),
      { id: backupRecipientId(ME), pub: server.identity!.backupPub },
      { id: backupRecipientId(BOB), pub: bob.backupPub },
    ];
    const { envelope } = await encryptMessage({
      payload: { v: 1, content, ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: BOB, senderDeviceId: device.pub.id },
      recipients,
      signKey: device.keys.sign.privateKey,
    });
    return { id, authorId: BOB, channelId: CHANNEL, createdAt: new Date(Date.now() - 1000).toISOString(), e2ee: envelope } as Record<string, unknown>;
  }

  const ctx = { channelId: CHANNEL, dmPeer: BOB, selfId: ME };
  type E2ee = { status: string; reason?: string; retrying?: boolean; envelope?: unknown };

  test("a key-set fetch that fails once (429) shows as retrying, and the next try decrypts", async () => {
    expect(server.devices).toHaveLength(1);
    server.failKeys = 1;
    const row = await bobSends("bbbbbbbb-0000-4000-8000-000000000001", "first message");
    const [failed] = await session.decryptRawMessages([row], ctx);
    const e = failed.e2ee as E2ee;
    expect(e.status).toBe("error");
    expect(e.reason).toBe("keys_unavailable");
    expect(e.retrying).toBe(true);
    // The envelope is kept, so the row can be decrypted again.
    expect(e.envelope).toBe(row.e2ee);
    const [ok] = await session.decryptRawMessages([row], ctx);
    expect(ok.content).toBe("first message");
    expect((ok.e2ee as E2ee).status).toBe("ok");
  });

  test("a sender device whose keys couldn't be fetched is \"keys unavailable\" (transient), then decrypts", async () => {
    const second = await newDevice(bob.identity);
    const row = await bobSends("bbbbbbbb-0000-4000-8000-000000000002", "from bob's new phone", second);
    server.bobDevices = [bob.device.pub, second.pub];
    server.failUserKeys = 1;
    const [failed] = await session.decryptRawMessages([row], ctx);
    expect((failed.e2ee as E2ee).reason).toBe("keys_unavailable");
    expect((failed.e2ee as E2ee).retrying).toBe(true);
    // Not remembered: the next attempt fetches the sender's keys again.
    const [ok] = await session.decryptRawMessages([row], ctx);
    expect(ok.content).toBe("from bob's new phone");
  });

  test("an engine error is \"temporary\" and not remembered", async () => {
    const row = await bobSends("bbbbbbbb-0000-4000-8000-000000000003", "after a hiccup");
    const subtle = globalThis.crypto.subtle;
    const realDigest = subtle.digest.bind(subtle);
    let failNext = true;
    (subtle as { digest: typeof subtle.digest }).digest = ((...args: Parameters<typeof subtle.digest>) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new DOMException("transient", "UnknownError"));
      }
      return realDigest(...args);
    }) as typeof subtle.digest;
    try {
      const [failed] = await session.decryptRawMessages([row], ctx);
      expect((failed.e2ee as E2ee).reason).toBe("temporary");
      expect((failed.e2ee as E2ee).retrying).toBe(true);
    } finally {
      (subtle as { digest: typeof subtle.digest }).digest = realDigest;
    }
    const [ok] = await session.decryptRawMessages([row], ctx);
    expect(ok.content).toBe("after a hiccup");
  });

  test("a permanent failure is shown at once; \"Try again\" really decrypts again", async () => {
    const row = await bobSends("bbbbbbbb-0000-4000-8000-000000000004", "tampered");
    const env = row.e2ee as { sig: string };
    const bad: Record<string, unknown> = { ...row, e2ee: { ...env, sig: env.sig.startsWith("A") ? `B${env.sig.slice(1)}` : `A${env.sig.slice(1)}` } };
    const [failed] = await session.decryptRawMessages([bad], ctx);
    expect((failed.e2ee as E2ee).reason).toBe("signature");
    expect((failed.e2ee as E2ee).retrying).toBe(false);
    let keyFetches = 0;
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(`/channels/${CHANNEL}/keys`)) keyFetches++;
      return fetchBefore(input, init);
    }) as typeof fetch;
    try {
      await session.prepareDecryptRetry(CHANNEL, [{ id: String(bad.id), authorId: BOB }]);
      expect(keyFetches).toBe(1);
    } finally {
      globalThis.fetch = fetchBefore;
    }
    const [still] = await session.decryptRawMessages([bad], ctx);
    expect((still.e2ee as E2ee).reason).toBe("signature");
  });
});
