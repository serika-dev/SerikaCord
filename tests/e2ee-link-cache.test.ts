// E2EE stage 1: device linking (lib/e2ee/link), key-set versions
// (lib/e2ee/keysVersion), and the client caches (decrypted-message cache,
// cached key bundles) exercised through the real session module against an
// in-memory IndexedDB and a mocked server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  E2eeFormatError,
  backupRecipientId,
  canonicalKeySet,
  deriveLinkSecrets,
  describeDevice,
  encryptMessage,
  exportPrivateJwk,
  exportPublicKey,
  formatLinkCode,
  formatSas,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  isKeysVersion,
  isLinkCommitment,
  linkCommitment,
  linkQrPayload,
  newLinkCode,
  normalizeLinkCode,
  openLinkPayload,
  parseLinkInput,
  publicKeyFromJwk,
  sasDigits,
  sealLinkPayload,
  signBackupKey,
  signDevice,
  validateLinkPayload,
  type DeviceKeys,
  type PublicDevice,
} from "@/lib/e2ee";
import { plainCacheKey, plainMessagePrefix } from "@/lib/e2ee/client/plainCache";
import { installFakeIndexedDb } from "./helpers/fakeIndexedDb";

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "44444444-4444-4444-8444-444444444444";

// ─── Linking (pure) ───────────────────────────────────────────────────────────

describe("device linking: codes and QR payloads", () => {
  test("codes are 10 Crockford base32 chars and survive typing mistakes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newLinkCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      seen.add(code);
      expect(normalizeLinkCode(formatLinkCode(code).toLowerCase())).toBe(code);
    }
    expect(seen.size).toBe(200);
    expect(normalizeLinkCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    // Look-alikes: O → 0, I / L → 1.
    expect(normalizeLinkCode("OOOOO IIIII")).toBe("0000011111");
    expect(normalizeLinkCode("lllll-00000")).toBe("1111100000");
    expect(normalizeLinkCode("ABCDE")).toBeNull();
    expect(normalizeLinkCode("ABCDEFGHJKU")).toBeNull();
    expect(normalizeLinkCode(42)).toBeNull();
  });

  test("QR payload round trip: the key in the fragment, the code typed alone", async () => {
    const eph = await generateEphemeralKeyPair();
    const pub = await exportPublicKey(eph.publicKey);
    const code = newLinkCode();
    const qr = linkQrPayload("https://serika.chat/", code, pub);
    expect(qr.startsWith(`https://serika.chat/e2ee/link#${code}.`)).toBe(true);
    expect(parseLinkInput(qr)).toEqual({ code, newPub: pub });
    expect(parseLinkInput(formatLinkCode(code))).toEqual({ code, newPub: null });
    // A broken key is refused rather than ignored.
    expect(parseLinkInput(`https://serika.chat/e2ee/link#${code}.AAAA`)).toBeNull();
    expect(parseLinkInput("https://serika.chat/e2ee/link#nope")).toBeNull();
  });

  test("SAS digits: 6 digits, formatted in two groups", () => {
    expect(sasDigits(new Uint8Array([0, 0, 0, 0, 0]))).toBe("000000");
    expect(sasDigits(new Uint8Array([255, 255, 255, 255, 255]))).toMatch(/^\d{6}$/);
    expect(formatSas("123456")).toBe("123 456");
    expect(() => sasDigits(new Uint8Array(4))).toThrow();
  });
});

async function linkParties() {
  const newEph = await generateEphemeralKeyPair();
  const oldEph = await generateEphemeralKeyPair();
  const newPub = await exportPublicKey(newEph.publicKey);
  const oldPub = await exportPublicKey(oldEph.publicKey);
  const code = newLinkCode();
  const commit = await linkCommitment(newPub);
  return { newEph, oldEph, newPub, oldPub, code, commit };
}

describe("device linking: commitment, SAS and the sealed keys", () => {
  test("both devices derive the same SAS and key; the keys arrive intact", async () => {
    const p = await linkParties();
    expect(isLinkCommitment(p.commit)).toBe(true);
    const transcript = { userId: ME, code: p.code, commit: p.commit, newPub: p.newPub, oldPub: p.oldPub };
    const onNew = await deriveLinkSecrets(p.newEph.privateKey, p.oldPub, transcript);
    const onOld = await deriveLinkSecrets(p.oldEph.privateKey, p.newPub, transcript);
    expect(onNew.sas).toBe(onOld.sas);
    expect(onNew.sas).toMatch(/^\d{6}$/);

    const identity = await generateIdentityKeyPair();
    const backup = await generateBackupKeyPair();
    const secrets = { identity: await exportPrivateJwk(identity.privateKey), backup: await exportPrivateJwk(backup.privateKey) };
    const sealed = await sealLinkPayload(onOld.key, ME, p.code, secrets);
    expect(validateLinkPayload(sealed)).toEqual(sealed);
    const opened = await openLinkPayload(onNew.key, ME, p.code, sealed);
    expect(publicKeyFromJwk(opened.identity)).toBe(await exportPublicKey(identity.publicKey));
    expect(publicKeyFromJwk(opened.backup)).toBe(await exportPublicKey(backup.publicKey));

    // Bound to the account and the session code.
    await expect(openLinkPayload(onNew.key, BOB, p.code, sealed)).rejects.toThrow();
    await expect(openLinkPayload(onNew.key, ME, newLinkCode(), sealed)).rejects.toThrow();
  });

  test("a server in the middle gets different codes on the two devices and can't open the keys", async () => {
    const p = await linkParties();
    // The relay substitutes its own key towards each side (it had to commit before seeing either real key).
    const mitmNew = await generateEphemeralKeyPair();
    const mitmOld = await generateEphemeralKeyPair();
    const mitmNewPub = await exportPublicKey(mitmNew.publicKey);
    const mitmOldPub = await exportPublicKey(mitmOld.publicKey);
    const mitmCommit = await linkCommitment(mitmNewPub);
    // Existing device saw the server's commitment + key; the new device saw the server's "existing" key.
    const onOld = await deriveLinkSecrets(p.oldEph.privateKey, mitmNewPub, { userId: ME, code: p.code, commit: mitmCommit, newPub: mitmNewPub, oldPub: p.oldPub });
    const onNew = await deriveLinkSecrets(p.newEph.privateKey, mitmOldPub, { userId: ME, code: p.code, commit: p.commit, newPub: p.newPub, oldPub: mitmOldPub });
    expect(onOld.sas).not.toBe(onNew.sas);
    // And a key that doesn't open its commitment is caught by the existing device.
    expect(await linkCommitment(p.newPub)).not.toBe(mitmCommit);
  });

  test("malformed payloads are refused", () => {
    expect(() => validateLinkPayload({ iv: "AAAA", ct: "AAAA" })).toThrow(E2eeFormatError);
    expect(() => validateLinkPayload({ iv: "AAAAAAAAAAAAAAAA", ct: "A".repeat(5000) })).toThrow(E2eeFormatError);
    expect(() => validateLinkPayload(null)).toThrow(E2eeFormatError);
  });
});

// ─── Key-set versions ─────────────────────────────────────────────────────────

describe("key-set versions (keysVersion.ts)", () => {
  const device = (id: string, revokedAt: string | null = null) => ({ id, ecdhPub: `e${id}`, signPub: `s${id}`, sig: `g${id}`, revokedAt });
  const bundle = (userId: string, devices = [device("a")], extra: Record<string, unknown> = {}) => ({
    userId,
    identityPub: `id-${userId}`,
    backupPub: `bk-${userId}`,
    backupSig: `bs-${userId}`,
    devices,
    revokedDevices: [],
    ...extra,
  });

  test("order and non-key fields don't matter", () => {
    const a = canonicalKeySet([bundle(ME, [device("a"), device("b")]), bundle(BOB)]);
    const b = canonicalKeySet([bundle(BOB), bundle(ME.toUpperCase(), [device("b"), device("a")])]);
    expect(a).toBe(b);
    const named = canonicalKeySet([
      bundle(ME, [{ ...device("a"), name: "Phone", lastSeenAt: new Date() } as ReturnType<typeof device>, device("b")]),
      bundle(BOB),
    ]);
    expect(named).toBe(a);
  });

  test("a new device, a revocation or a new identity changes it", () => {
    const base = canonicalKeySet([bundle(ME), bundle(BOB)]);
    expect(canonicalKeySet([bundle(ME, [device("a"), device("c")]), bundle(BOB)])).not.toBe(base);
    expect(canonicalKeySet([bundle(ME, [device("a", "2026-10-01T00:00:00Z")]), bundle(BOB)])).not.toBe(base);
    expect(canonicalKeySet([bundle(ME), bundle(BOB, [device("a")], { identityPub: "other" })])).not.toBe(base);
  });

  test("version strings", () => {
    expect(isKeysVersion("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isKeysVersion("xyz")).toBe(false);
    expect(isKeysVersion(undefined)).toBe(false);
  });
});

describe("decrypted-message cache keys (plainCache.ts)", () => {
  test("keyed by conversation, message, envelope and sender", () => {
    const k = plainCacheKey(CHANNEL.toUpperCase(), "M1", "sig==", BOB.toUpperCase());
    expect(k).toBe(`${CHANNEL}|m1|sig==|${BOB}`);
    // An edit (new signature) or another claimed sender is another entry.
    expect(plainCacheKey(CHANNEL, "m1", "sig2==", BOB)).not.toBe(k);
    expect(plainCacheKey(CHANNEL, "m1", "sig==", ME)).not.toBe(k);
    // Deleting a message drops every version of it.
    expect(k.startsWith(plainMessagePrefix(CHANNEL, "M1"))).toBe(true);
    expect(plainCacheKey(CHANNEL, "m10", "sig==", BOB).startsWith(plainMessagePrefix(CHANNEL, "m1"))).toBe(false);
  });
});

// ─── The client session with caches (mock server + in-memory IndexedDB) ──────

interface Party {
  identity: CryptoKeyPair;
  identityPub: string;
  backupPub: string;
  backupSig: string;
  device: { keys: DeviceKeys; pub: PublicDevice };
}

async function makeBob(): Promise<Party> {
  const identity = await generateIdentityKeyPair();
  const backup = await generateBackupKeyPair();
  const identityPub = await exportPublicKey(identity.publicKey);
  const backupPub = await exportPublicKey(backup.publicKey);
  const keys = await generateDeviceKeys();
  const desc = await describeDevice(keys);
  return {
    identity,
    identityPub,
    backupPub,
    backupSig: await signBackupKey(identity.privateKey, BOB, backupPub),
    device: { keys, pub: { ...desc, sig: await signDevice(identity.privateKey, BOB, desc) } },
  };
}

describe("client session: instant decryption from caches", () => {
  const idb = installFakeIndexedDb();
  const realFetch = globalThis.fetch;
  let session: typeof import("@/lib/e2ee/client/session");
  let plain: typeof import("@/lib/e2ee/client/plainCache");
  let bob: Party;
  const server = {
    identity: null as null | { identityPub: string; backupPub: string; backupSig: string },
    devices: [] as Array<PublicDevice & { revokedAt: string | null }>,
    bobRevokedAt: null as string | null,
    version: 1,
    hang: false,
    calls: [] as string[],
    link: null as null | { code: string; commit: string | null; oldPub: string | null; newPub: string | null; revealGate: Promise<void> | null },
  };
  const sentAt = new Date(Date.now() - 60_000).toISOString();

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  beforeAll(async () => {
    bob = await makeBob();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://serika.test");
      const method = init?.method ?? "GET";
      server.calls.push(`${method} ${url.pathname}`);
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
      if (server.link && url.pathname === "/api/e2ee/link" && method === "POST") {
        server.link.commit = body.commit;
        return json({ code: server.link.code, expiresAt: Date.now() + 300_000 }, 201);
      }
      if (server.link && url.pathname === `/api/e2ee/link/${server.link.code}` && method === "GET") {
        const l = server.link;
        return json({ code: l.code, status: l.newPub ? "revealed" : l.oldPub ? "joined" : "waiting", commit: l.commit, oldPub: l.oldPub, newPub: l.newPub, payload: null, expiresAt: Date.now() + 200_000 });
      }
      if (server.link && url.pathname === `/api/e2ee/link/${server.link.code}/reveal`) {
        const l = server.link;
        if (l.revealGate) await l.revealGate;
        l.newPub = body.pub;
        return json({ success: true });
      }
      if (server.link && url.pathname === `/api/e2ee/link/${server.link.code}` && method === "DELETE") return json({ success: true });
      if (url.pathname === `/api/e2ee/channels/${CHANNEL}/keys`) {
        const version = `${server.version}`.padStart(16, "0");
        if (url.searchParams.get("v") === version) return json({ channelId: CHANNEL, e2ee: true, version, unchanged: true });
        const bobDevice = { ...bob.device.pub, revokedAt: server.bobRevokedAt };
        return json({
          channelId: CHANNEL,
          e2ee: true,
          version,
          members: [
            { userId: ME, ...server.identity, devices: server.devices, revokedDevices: [] },
            {
              userId: BOB,
              identityPub: bob.identityPub,
              backupPub: bob.backupPub,
              backupSig: bob.backupSig,
              devices: server.bobRevokedAt ? [] : [bobDevice],
              revokedDevices: server.bobRevokedAt ? [bobDevice] : [],
            },
          ],
        });
      }
      return json({ error: `unexpected ${method} ${url.pathname}` }, 404);
    }) as unknown as typeof fetch;
    session = await import("@/lib/e2ee/client/session");
    plain = await import("@/lib/e2ee/client/plainCache");
    session.shutdownE2ee();
    await session.initE2ee({ id: ME });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    session?.shutdownE2ee();
    idb.uninstall();
  });

  async function bobSends(id: string, content: string) {
    const recipients = [
      ...server.devices.map((d) => ({ id: d.id, pub: d.ecdhPub })),
      { id: backupRecipientId(ME), pub: server.identity!.backupPub },
      { id: bob.device.pub.id, pub: bob.device.pub.ecdhPub },
      { id: backupRecipientId(BOB), pub: bob.backupPub },
    ];
    const { envelope } = await encryptMessage({
      payload: { v: 1, content, ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: BOB, senderDeviceId: bob.device.pub.id },
      recipients,
      signKey: bob.device.keys.sign.privateKey,
    });
    return { id, authorId: BOB, channelId: CHANNEL, createdAt: sentAt, e2ee: envelope } as Record<string, unknown>;
  }

  /** Simulate a reload: module memory gone, IndexedDB (keys + caches) kept. */
  async function reload() {
    session.shutdownE2ee();
    plain.forgetPlainMemory();
    void session.initE2ee({ id: ME });
    await session.whenLocalReady();
  }

  const ctx = { channelId: CHANNEL, dmPeer: BOB, selfId: ME };

  test("first device setup publishes keys, then a page decrypts", async () => {
    expect(server.identity).not.toBeNull();
    expect(server.devices).toHaveLength(1);
    const [row] = await session.decryptRawMessages([await bobSends("aaaaaaaa-0000-4000-8000-000000000001", "hi from bob")], ctx);
    expect(row.content).toBe("hi from bob");
    expect((row.e2ee as { status: string }).status).toBe("ok");
    await new Promise((r) => setTimeout(r, 80)); // write-behind flush
  });

  test("after a reload the page renders from the encrypted cache: no unwrap, no network on the critical path", async () => {
    const row = await bobSends("aaaaaaaa-0000-4000-8000-000000000002", "cached text");
    await session.decryptRawMessages([row], ctx);
    await new Promise((r) => setTimeout(r, 80));

    await reload();
    // The server never answers now: keys and decrypted text must come from this device.
    server.hang = true;
    const subtle = globalThis.crypto.subtle;
    const realDerive = subtle.deriveBits.bind(subtle);
    let derives = 0;
    (subtle as { deriveBits: typeof subtle.deriveBits }).deriveBits = ((...args: Parameters<typeof subtle.deriveBits>) => {
      derives++;
      return realDerive(...args);
    }) as typeof subtle.deriveBits;
    try {
      const [out] = await session.decryptRawMessages([row], ctx);
      expect(out.content).toBe("cached text");
      expect((out.e2ee as { status: string; verified: boolean }).status).toBe("ok");
      expect(derives).toBe(0);
    } finally {
      (subtle as { deriveBits: typeof subtle.deriveBits }).deriveBits = realDerive;
      server.hang = false;
    }
  });

  test("records at rest are encrypted (no plaintext in IndexedDB)", () => {
    const rows = idb.peek("serika-e2ee-cache", "plain") as Array<{ iv: Uint8Array; ct: ArrayBuffer }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ct).toBeInstanceOf(ArrayBuffer);
      expect(new TextDecoder().decode(new Uint8Array(r.ct)).includes("cached text")).toBe(false);
      expect(JSON.stringify(r).includes("cached text")).toBe(false);
    }
  });

  test("placeholders from the message cache are filled after a reload", async () => {
    const row = await bobSends("aaaaaaaa-0000-4000-8000-000000000003", "placeholder text");
    await session.decryptRawMessages([row], ctx);
    await new Promise((r) => setTimeout(r, 80));
    await reload();
    const placeholder = { id: String(row.id), channelId: CHANNEL, authorId: BOB, content: "", e2ee: { status: "pending", envelope: row.e2ee } };
    const [filled] = await session.hydratePlaceholders([placeholder], { kind: "dm", recipientId: BOB }, ME);
    expect(filled.content).toBe("placeholder text");
    expect(filled.e2ee?.status).toBe("ok");
    // Not in another conversation's view (a DM with someone else, or another group).
    const [other] = await session.hydratePlaceholders([placeholder], { kind: "dm", recipientId: "33333333-3333-4333-8333-333333333333" }, ME);
    expect(other.e2ee?.status).toBe("pending");
    const [group] = await session.hydratePlaceholders([placeholder], { kind: "group", channelId: "55555555-5555-4555-8555-555555555555" }, ME);
    expect(group.e2ee?.status).toBe("pending");
  });

  test("a cached result is re-checked: the sender device revoked before it was sent makes it fail", async () => {
    const row = await bobSends("aaaaaaaa-0000-4000-8000-000000000004", "from a device revoked before");
    const [ok] = await session.decryptRawMessages([row], ctx);
    expect(ok.content).toBe("from a device revoked before");
    // Bob's device turns out to have been revoked 10 minutes before this message.
    server.bobRevokedAt = new Date(Date.parse(sentAt) - 600_000).toISOString();
    server.version++;
    const before = (await import("@/lib/e2ee/client/state")).getE2eeSnapshot().keysVersion;
    await session.getChannelKeys(CHANNEL, true);
    expect((await import("@/lib/e2ee/client/state")).getE2eeSnapshot().keysVersion).toBe(before + 1);
    const [again] = await session.decryptRawMessages([row], ctx);
    expect((again.e2ee as { status: string; reason?: string }).status).toBe("error");
    expect((again.e2ee as { reason?: string }).reason).toBe("revoked_device");
    server.bobRevokedAt = null;
    server.version++;
    await session.getChannelKeys(CHANNEL, true);
  });

  test("sends carry the key-set version they were encrypted for", async () => {
    const { keysVersion } = await session.encryptForChannel(CHANNEL, { v: 1, content: "to bob", ts: Date.now() }, { kind: "dm", recipientId: BOB }, null, { selfId: ME });
    expect(keysVersion).toBe(`${server.version}`.padStart(16, "0"));
  });

  test("new device: one poll at a time, and the other device's key is pinned before ours is revealed", async () => {
    const x1 = await exportPublicKey((await generateEphemeralKeyPair()).publicKey);
    const x2 = await exportPublicKey((await generateEphemeralKeyPair()).publicKey);
    let release: () => void = () => {};
    server.link = { code: "ABCDEFGHJK", commit: null, oldPub: null, newPub: null, revealGate: new Promise<void>((r) => { release = r; }) };
    await session.startDeviceLink();
    expect(await session.pollDeviceLink()).toEqual({ step: "waiting" });
    server.link.oldPub = x1;
    // A slow reveal: polls overlapping it share the one in flight.
    const first = session.pollDeviceLink();
    const second = session.pollDeviceLink();
    expect(second).toBe(first);
    // The relay swaps the other device's key while our reveal is pending: never accepted.
    server.link.oldPub = x2;
    release();
    const progress = await first;
    expect(progress.step).toBe("compare");
    await expect(session.pollDeviceLink()).rejects.toThrow();
    await session.cancelDeviceLink();
    server.link = null;
  });

  test("a revalidation with an unchanged key set comes back without bundles", async () => {
    server.calls.length = 0;
    await session.getChannelKeys(CHANNEL, true);
    expect(server.calls).toEqual([`GET /api/e2ee/channels/${CHANNEL}/keys`]);
  });
});

describe("synchronous SHA-256 (safety numbers)", () => {
  test("matches WebCrypto for many lengths, and safety numbers are unchanged", async () => {
    const { sha256Sync } = await import("@/lib/e2ee/sha256");
    for (const len of [0, 1, 3, 55, 56, 63, 64, 65, 97, 119, 128, 1000, 4096]) {
      const data = globalThis.crypto.getRandomValues(new Uint8Array(len));
      const expected = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
      expect(Buffer.from(sha256Sync(data)).toString("hex")).toBe(Buffer.from(expected).toString("hex"));
    }
    // The 5200-round chain, the old (WebCrypto) way vs computeSafetyNumber.
    const { computeSafetyNumber, LABELS, SAFETY_NUMBER_ITERATIONS } = await import("@/lib/e2ee");
    const { concat, frame: frameFn } = await import("@/lib/e2ee/encoding");
    const id = await generateIdentityKeyPair();
    const pubB64 = await exportPublicKey(id.publicKey);
    const pub = Uint8Array.from(atob(pubB64), (c) => c.charCodeAt(0));
    const digitsOf = async (userId: string) => {
      let hash: Uint8Array = frameFn(LABELS.safety, userId, pub);
      for (let i = 0; i < SAFETY_NUMBER_ITERATIONS; i++) hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", concat(hash, pub)));
      const groups: string[] = [];
      for (let g = 0; g < 6; g++) {
        let n = 0;
        for (let b = 0; b < 5; b++) n = n * 256 + hash[g * 5 + b];
        groups.push(String(n % 100000).padStart(5, "0"));
      }
      return groups;
    };
    const expected = [...(await digitsOf(ME)), ...(await digitsOf(BOB))];
    expect(await computeSafetyNumber({ userId: BOB, identityPub: pubB64 }, { userId: ME, identityPub: pubB64 })).toEqual(expected);
  });
});
