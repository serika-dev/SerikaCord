import { describe, expect, test } from "bun:test";
import {
  ATTACHMENT_MAGIC,
  E2eeFormatError,
  E2eeVerifyError,
  LIMITS,
  backupRecipientId,
  computeCommitment,
  computeSafetyNumber,
  decryptAttachment,
  describeDevice,
  encryptAttachment,
  encryptMessage,
  exportPrivateJwk,
  exportPublicKey,
  extractDtlsFingerprints,
  fromB64,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  hasAttachmentMagic,
  importBackupPrivateJwk,
  importIdentityPrivateJwk,
  isFrankingDisclosure,
  openBackup,
  openEnvelope,
  parseEnvelope,
  publicKeyFromJwk,
  sealBackup,
  signBackupKey,
  signDevice,
  signDtlsFingerprints,
  toB64,
  validateBackupRecord,
  validateEnvelope,
  validatePayload,
  verifyBackupKey,
  verifyDevice,
  verifyDtlsFingerprints,
  verifyEnvelopeSignature,
  verifyFranking,
  type DeviceKeys,
  type Envelope,
  type MessagePayload,
  type PublicDevice,
  type WrapRecipient,
} from "@/lib/e2ee";
import { sniffImageType } from "@/lib/safety/imageHash";
import { E2EE_NOTICE, e2eeMismatch, isE2eeChannel, isE2eeNotice, parseEncryptedBody, storedEnvelope } from "@/lib/e2ee/policy";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";
const OTHER_CHANNEL = "55555555-5555-4555-8555-555555555555";

interface TestUser {
  userId: string;
  identity: CryptoKeyPair;
  identityPub: string;
  backup: CryptoKeyPair;
  backupPub: string;
  devices: Array<{ keys: DeviceKeys; pub: PublicDevice }>;
}

async function makeUser(userId: string, deviceCount = 1): Promise<TestUser> {
  const identity = await generateIdentityKeyPair();
  const backup = await generateBackupKeyPair();
  const user: TestUser = {
    userId,
    identity,
    identityPub: await exportPublicKey(identity.publicKey),
    backup,
    backupPub: await exportPublicKey(backup.publicKey),
    devices: [],
  };
  for (let i = 0; i < deviceCount; i++) await addDevice(user);
  return user;
}

async function addDevice(user: TestUser) {
  const keys = await generateDeviceKeys();
  const desc = await describeDevice(keys);
  const sig = await signDevice(user.identity.privateKey, user.userId, desc);
  const entry = { keys, pub: { ...desc, sig } };
  user.devices.push(entry);
  return entry;
}

function recipientsFor(...users: TestUser[]): WrapRecipient[] {
  return users.flatMap((u) => [
    ...u.devices.map((d) => ({ id: d.pub.id, pub: d.pub.ecdhPub })),
    { id: backupRecipientId(u.userId), pub: u.backupPub },
  ]);
}

const payload = (over: Partial<MessagePayload> = {}): MessagePayload => ({ v: 1, content: "hello 👋 <b>world</b>", ts: 1_700_000_000_000, ...over });

async function send(sender: TestUser, users: TestUser[], over: Partial<MessagePayload> = {}, channelId = CHANNEL) {
  const device = sender.devices[0];
  return encryptMessage({
    payload: payload(over),
    context: { channelId, senderUserId: sender.userId, senderDeviceId: device.pub.id },
    recipients: recipientsFor(...users),
    signKey: device.keys.sign.privateKey,
  });
}

const ctxOf = (sender: TestUser, channelId = CHANNEL) => ({
  channelId,
  senderUserId: sender.userId,
  senderDeviceId: sender.devices[0].pub.id,
});

/** Replace one base64 field's bytes with a tampered copy. */
function flip(b64: string, index = 0): string {
  const bytes = fromB64(b64);
  bytes[index] ^= 0x01;
  return toB64(bytes);
}

describe("keys and device certificates", () => {
  test("a device signed by the identity key verifies, others don't", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const dev = alice.devices[0].pub;
    expect(await verifyDevice(alice.identityPub, ALICE, dev)).toBe(true);
    // Wrong identity key, wrong user id, tampered key, tampered signature.
    expect(await verifyDevice(bob.identityPub, ALICE, dev)).toBe(false);
    expect(await verifyDevice(alice.identityPub, BOB, dev)).toBe(false);
    expect(await verifyDevice(alice.identityPub, ALICE, { ...dev, ecdhPub: bob.devices[0].pub.ecdhPub })).toBe(false);
    expect(await verifyDevice(alice.identityPub, ALICE, { ...dev, sig: flip(dev.sig, 5) })).toBe(false);
    expect(await verifyDevice(alice.identityPub, ALICE, { ...dev, sig: "not base64!" })).toBe(false);
  });

  test("private JWK export/import keeps the same public key", async () => {
    const id = await generateIdentityKeyPair();
    const jwk = await exportPrivateJwk(id.privateKey);
    expect(publicKeyFromJwk(jwk)).toBe(await exportPublicKey(id.publicKey));
    const restored = await importIdentityPrivateJwk(jwk);
    const desc = await describeDevice(await generateDeviceKeys());
    const sig = await signDevice(restored, ALICE, desc);
    expect(await verifyDevice(await exportPublicKey(id.publicKey), ALICE, { ...desc, sig })).toBe(true);
    await expect(importBackupPrivateJwk({ kty: "RSA" })).rejects.toBeInstanceOf(E2eeFormatError);
  });

  test("device private keys are not extractable", async () => {
    const dev = await generateDeviceKeys();
    expect(dev.ecdh.privateKey.extractable).toBe(false);
    expect(dev.sign.privateKey.extractable).toBe(false);
    expect(dev.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("message envelopes", () => {
  test("round trip to the recipient, the sender's other device and both backup keys", async () => {
    const alice = await makeUser(ALICE, 2);
    const bob = await makeUser(BOB, 2);
    const { envelope, key } = await send(alice, [alice, bob]);
    expect(envelope.keys).toHaveLength(6);
    const targets = [
      ...bob.devices.map((d) => ({ id: d.pub.id, privateKey: d.keys.ecdh.privateKey })),
      { id: alice.devices[1].pub.id, privateKey: alice.devices[1].keys.ecdh.privateKey },
      { id: backupRecipientId(BOB), privateKey: bob.backup.privateKey },
      { id: backupRecipientId(ALICE), privateKey: alice.backup.privateKey },
    ];
    for (const t of targets) {
      const opened = await openEnvelope(envelope, ctxOf(alice), t);
      expect(opened.payload.content).toBe("hello 👋 <b>world</b>");
      expect(toB64(opened.key)).toBe(toB64(key));
    }
    expect(await verifyEnvelopeSignature(envelope, CHANNEL, alice.devices[0].pub.signPub)).toBe(true);
  });

  test("backup key restored from the passphrase blob reads history", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const { envelope } = await send(alice, [alice, bob]);
    const record = await sealBackup("correct horse battery", BOB, {
      identity: await exportPrivateJwk(bob.identity.privateKey),
      backup: await exportPrivateJwk(bob.backup.privateKey),
    });
    const secrets = await openBackup("correct horse battery", BOB, record);
    const backupKey = await importBackupPrivateJwk(secrets.backup);
    const opened = await openEnvelope(envelope, ctxOf(alice), { id: backupRecipientId(BOB), privateKey: backupKey });
    expect(opened.payload.content).toContain("hello");
    // A new device signed with the restored identity key verifies.
    const restoredIdentity = await importIdentityPrivateJwk(secrets.identity);
    const desc = await describeDevice(await generateDeviceKeys());
    const sig = await signDevice(restoredIdentity, BOB, desc);
    expect(await verifyDevice(bob.identityPub, BOB, { ...desc, sig })).toBe(true);
  });

  test("a non-recipient or the wrong key can't open it", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const carol = await makeUser(CAROL);
    const { envelope } = await send(alice, [alice, bob]);
    await expect(
      openEnvelope(envelope, ctxOf(alice), { id: carol.devices[0].pub.id, privateKey: carol.devices[0].keys.ecdh.privateKey }),
    ).rejects.toMatchObject({ code: "no_key" });
    // Carol's key presented under Bob's device id: unwrap fails.
    await expect(
      openEnvelope(envelope, ctxOf(alice), { id: bob.devices[0].pub.id, privateKey: carol.devices[0].keys.ecdh.privateKey }),
    ).rejects.toMatchObject({ code: "unwrap" });
  });

  test("tampered ciphertext, commitment, signature or context is rejected", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const { envelope } = await send(alice, [alice, bob]);
    const bobKey = { id: bob.devices[0].pub.id, privateKey: bob.devices[0].keys.ecdh.privateKey };

    await expect(openEnvelope({ ...envelope, ct: flip(envelope.ct, 3) }, ctxOf(alice), bobKey)).rejects.toMatchObject({ code: "commitment" });
    await expect(openEnvelope({ ...envelope, cm: flip(envelope.cm) }, ctxOf(alice), bobKey)).rejects.toMatchObject({ code: "commitment" });
    await expect(openEnvelope({ ...envelope, iv: flip(envelope.iv) }, ctxOf(alice), bobKey)).rejects.toBeInstanceOf(E2eeVerifyError);
    // Moved to another channel or re-attributed to another sender: AAD mismatch.
    await expect(openEnvelope(envelope, ctxOf(alice, OTHER_CHANNEL), bobKey)).rejects.toMatchObject({ code: "decrypt" });
    await expect(openEnvelope(envelope, { ...ctxOf(alice), senderUserId: CAROL }, bobKey)).rejects.toMatchObject({ code: "decrypt" });
    // Swapped wrapped key entry.
    const swapped = { ...envelope, keys: envelope.keys.map((k) => ({ ...k, k: flip(k.k, 7) })) };
    await expect(openEnvelope(swapped, ctxOf(alice), bobKey)).rejects.toMatchObject({ code: "unwrap" });

    const signPub = alice.devices[0].pub.signPub;
    expect(await verifyEnvelopeSignature({ ...envelope, sig: flip(envelope.sig, 10) }, CHANNEL, signPub)).toBe(false);
    expect(await verifyEnvelopeSignature({ ...envelope, ct: flip(envelope.ct) }, CHANNEL, signPub)).toBe(false);
    expect(await verifyEnvelopeSignature(envelope, OTHER_CHANNEL, signPub)).toBe(false);
    expect(await verifyEnvelopeSignature(envelope, CHANNEL, bob.devices[0].pub.signPub)).toBe(false);
  });

  test("a re-encrypted ciphertext under another key fails the commitment check", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const first = await send(alice, [alice, bob]);
    const second = await send(alice, [alice, bob], { content: "different" });
    // Splice the second message's ct into the first envelope.
    const spliced: Envelope = { ...first.envelope, ct: second.envelope.ct };
    const bobKey = { id: bob.devices[0].pub.id, privateKey: bob.devices[0].keys.ecdh.privateKey };
    await expect(openEnvelope(spliced, ctxOf(alice), bobKey)).rejects.toMatchObject({ code: "commitment" });
    expect(toB64(await computeCommitment(first.key, fromB64(first.envelope.ct)))).toBe(first.envelope.cm);
  });

  test("shape validation rejects bad envelopes", () => {
    const good = {
      v: 1,
      sd: "AAAAAAAAAAAAAAAAAAAAAA",
      epk: toB64(new Uint8Array([4, ...new Array(64).fill(1)])),
      iv: toB64(new Uint8Array(12)),
      ct: toB64(new Uint8Array(40)),
      cm: toB64(new Uint8Array(32)),
      sig: toB64(new Uint8Array(64)),
      keys: [{ r: "AAAAAAAAAAAAAAAAAAAAAA", iv: toB64(new Uint8Array(12)), k: toB64(new Uint8Array(48)) }],
    };
    expect(() => validateEnvelope(good)).not.toThrow();
    expect(parseEnvelope({ ...good, extra: 1 })).toBeNull();
    expect(parseEnvelope({ ...good, v: 2 })).toBeNull();
    expect(parseEnvelope({ ...good, sig: toB64(new Uint8Array(63)) })).toBeNull();
    expect(parseEnvelope({ ...good, iv: toB64(new Uint8Array(16)) })).toBeNull();
    expect(parseEnvelope({ ...good, epk: toB64(new Uint8Array(65)) })).toBeNull();
    expect(parseEnvelope({ ...good, keys: [] })).toBeNull();
    expect(parseEnvelope({ ...good, keys: [good.keys[0], good.keys[0]] })).toBeNull();
    expect(parseEnvelope({ ...good, keys: [{ ...good.keys[0], r: "backup:nope" }] })).toBeNull();
    expect(parseEnvelope({ ...good, ct: toB64(new Uint8Array(LIMITS.maxPayloadBytes + 17)) })).toBeNull();
    expect(parseEnvelope({ ...good, keys: new Array(LIMITS.maxRecipients + 1).fill(0).map((_, i) => ({ ...good.keys[0], r: `AAAAAAAAAAAAAAAAAAAA${String(i).padStart(2, "0")}` })) })).toBeNull();
    expect(parseEnvelope({ ...good, keys: [{ ...good.keys[0], r: `backup:${ALICE.toUpperCase()}` }] })?.keys[0].r).toBe(`backup:${ALICE}`);
    expect(parseEnvelope("nope")).toBeNull();
    expect(parseEnvelope([])).toBeNull();
  });

  test("payload validation", () => {
    expect(() => validatePayload(payload({ content: "" }))).toThrow(E2eeFormatError);
    expect(() => validatePayload({ ...payload(), v: 2 })).toThrow(E2eeFormatError);
    expect(() => validatePayload(payload({ content: "x".repeat(4001) }))).toThrow(E2eeFormatError);
    expect(validatePayload({ ...payload(), junk: true })).not.toHaveProperty("junk");
    const att = { id: "a1", url: "https://cdn.serika.chat/attachments/x/e2ee-a.bin", name: "cat.png", type: "image/png", size: 10, key: toB64(new Uint8Array(32)), iv: toB64(new Uint8Array(12)), sha256: toB64(new Uint8Array(32)) };
    expect(validatePayload(payload({ content: "", attachments: [att] })).attachments).toHaveLength(1);
    expect(() => validatePayload(payload({ attachments: [{ ...att, url: "javascript:alert(1)" }] }))).toThrow(E2eeFormatError);
    expect(() => validatePayload(payload({ attachments: [{ ...att, key: toB64(new Uint8Array(16)) }] }))).toThrow(E2eeFormatError);
    expect(() => validatePayload(payload({ mid: "not-a-uuid" }))).toThrow(E2eeFormatError);
  });

  test("encrypt refuses bad input", async () => {
    const alice = await makeUser(ALICE);
    await expect(
      encryptMessage({ payload: payload(), context: ctxOf(alice), recipients: [], signKey: alice.devices[0].keys.sign.privateKey }),
    ).rejects.toBeInstanceOf(E2eeFormatError);
    await expect(
      encryptMessage({ payload: payload(), context: { ...ctxOf(alice), channelId: "x" }, recipients: recipientsFor(alice), signKey: alice.devices[0].keys.sign.privateKey }),
    ).rejects.toBeInstanceOf(E2eeFormatError);
  });
});

describe("franking", () => {
  test("an honest disclosure verifies and returns the payload", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const { envelope } = await send(alice, [alice, bob], { content: "abusive text" });
    const opened = await openEnvelope(envelope, ctxOf(alice), { id: bob.devices[0].pub.id, privateKey: bob.devices[0].keys.ecdh.privateKey });
    const disclosure = { key: toB64(opened.key), payload: opened.payloadText };
    expect(isFrankingDisclosure(disclosure)).toBe(true);
    const result = await verifyFranking(envelope, ctxOf(alice), alice.devices[0].pub.signPub, disclosure);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.content).toBe("abusive text");
  });

  test("forged plaintext, wrong key, wrong sender key or wrong context are rejected", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const { envelope, key } = await send(alice, [alice, bob], { content: "hi" });
    const opened = await openEnvelope(envelope, ctxOf(alice), { id: bob.devices[0].pub.id, privateKey: bob.devices[0].keys.ecdh.privateKey });
    const signPub = alice.devices[0].pub.signPub;

    const forged = opened.payloadText.replace("hi", "send me money");
    expect(await verifyFranking(envelope, ctxOf(alice), signPub, { key: toB64(key), payload: forged })).toEqual({ ok: false, reason: "mismatch" });
    const otherKey = new Uint8Array(32).fill(7);
    expect(await verifyFranking(envelope, ctxOf(alice), signPub, { key: toB64(otherKey), payload: opened.payloadText })).toEqual({ ok: false, reason: "commitment" });
    expect(await verifyFranking(envelope, ctxOf(alice), bob.devices[0].pub.signPub, { key: toB64(key), payload: opened.payloadText })).toEqual({ ok: false, reason: "signature" });
    expect(await verifyFranking(envelope, ctxOf(alice, OTHER_CHANNEL), signPub, { key: toB64(key), payload: opened.payloadText })).toEqual({ ok: false, reason: "decrypt" });
    expect(await verifyFranking(envelope, ctxOf(alice), signPub, { key: "x", payload: opened.payloadText })).toEqual({ ok: false, reason: "format" });
    // The reporter (Bob) can't build a fake message "from Alice": he has no Alice device key.
    const fake = await encryptMessage({
      payload: payload({ content: "fake" }),
      context: { channelId: CHANNEL, senderUserId: ALICE, senderDeviceId: alice.devices[0].pub.id },
      recipients: recipientsFor(bob),
      signKey: bob.devices[0].keys.sign.privateKey,
    });
    const fakeOpened = await openEnvelope(fake.envelope, ctxOf(alice), { id: bob.devices[0].pub.id, privateKey: bob.devices[0].keys.ecdh.privateKey });
    expect(await verifyFranking(fake.envelope, ctxOf(alice), signPub, { key: toB64(fake.key), payload: fakeOpened.payloadText })).toEqual({ ok: false, reason: "signature" });
  });
});

describe("attachments", () => {
  test("round trip with magic header and hash check", async () => {
    const file = new Uint8Array(5000).map((_, i) => (i * 31) & 0xff);
    const enc = await encryptAttachment(file);
    expect(hasAttachmentMagic(enc.blob)).toBe(true);
    expect(enc.blobName).toMatch(/^e2ee-[A-Za-z0-9_-]{22}\.bin$/);
    expect(enc.blob.byteLength).toBe(file.byteLength + ATTACHMENT_MAGIC.byteLength + 16);
    const plain = await decryptAttachment(enc.blob, enc);
    expect(Array.from(plain)).toEqual(Array.from(file));
  });

  test("ciphertext never sniffs as an image", async () => {
    for (let i = 0; i < 20; i++) {
      const enc = await encryptAttachment(new Uint8Array(64).fill(i));
      expect(sniffImageType(enc.blob)).toBeNull();
    }
  });

  test("tampered blob, wrong key or wrong hash is rejected", async () => {
    const enc = await encryptAttachment(new Uint8Array([1, 2, 3, 4, 5]));
    const tampered = enc.blob.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptAttachment(tampered, enc)).rejects.toMatchObject({ code: "attachment" });
    await expect(decryptAttachment(enc.blob, { ...enc, key: toB64(new Uint8Array(32)) })).rejects.toMatchObject({ code: "attachment" });
    await expect(decryptAttachment(enc.blob, { ...enc, sha256: toB64(new Uint8Array(32)) })).rejects.toMatchObject({ code: "attachment_hash" });
    await expect(decryptAttachment(new Uint8Array(40), enc)).rejects.toBeInstanceOf(E2eeFormatError);
  });
});

describe("passphrase backup", () => {
  test("wrong passphrase, wrong user and malformed records are rejected", async () => {
    const id = await generateIdentityKeyPair();
    const bk = await generateBackupKeyPair();
    const secrets = { identity: await exportPrivateJwk(id.privateKey), backup: await exportPrivateJwk(bk.privateKey) };
    await expect(sealBackup("short", ALICE, secrets)).rejects.toBeInstanceOf(E2eeFormatError);
    const record = await sealBackup("a long enough passphrase", ALICE, secrets);
    expect(record.iters).toBe(600_000);
    expect(validateBackupRecord(record)).toEqual(record);
    await expect(openBackup("a wrong passphrase!!", ALICE, record)).rejects.toMatchObject({ code: "passphrase" });
    await expect(openBackup("a long enough passphrase", BOB, record)).rejects.toMatchObject({ code: "passphrase" });
    expect(() => validateBackupRecord({ ...record, iters: 1000 })).toThrow(E2eeFormatError);
    expect(() => validateBackupRecord({ ...record, salt: toB64(new Uint8Array(4)) })).toThrow(E2eeFormatError);
    expect(() => validateBackupRecord({ ...record, blob: "A".repeat(LIMITS.maxBackupBlobB64 + 4) })).toThrow(E2eeFormatError);
    const restored = await openBackup("a long enough passphrase", ALICE, record);
    expect(publicKeyFromJwk(restored.identity)).toBe(await exportPublicKey(id.publicKey));
  }, 30_000);
});

describe("safety numbers", () => {
  test("same for both parties, changes with the key", async () => {
    const a = { userId: ALICE, identityPub: await exportPublicKey((await generateIdentityKeyPair()).publicKey) };
    const b = { userId: BOB, identityPub: await exportPublicKey((await generateIdentityKeyPair()).publicKey) };
    const ab = await computeSafetyNumber(a, b);
    const ba = await computeSafetyNumber(b, a);
    expect(ab).toEqual(ba);
    expect(ab).toHaveLength(12);
    for (const g of ab) expect(g).toMatch(/^\d{5}$/);
    const b2 = { userId: BOB, identityPub: await exportPublicKey((await generateIdentityKeyPair()).publicKey) };
    const ab2 = await computeSafetyNumber(a, b2);
    expect(ab2.slice(0, 6)).toEqual(ab.slice(0, 6));
    expect(ab2.slice(6)).not.toEqual(ab.slice(6));
  });
});

describe("DTLS fingerprint signatures", () => {
  const sdp = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fingerprint:sha-256 ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89",
  ].join("\r\n");
  const mitm = sdp.replace(/AB:CD:EF:01/gi, "00:11:22:33");

  test("extraction normalises and dedupes", () => {
    expect(extractDtlsFingerprints(sdp)).toEqual([
      "sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
    ]);
    expect(extractDtlsFingerprints("v=0\r\n")).toEqual([]);
  });

  test("valid signature verifies; swapped certificate, room, user or key fails", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const room = `dm:${ALICE}_${BOB}`;
    const sig = await signDtlsFingerprints(alice.devices[0].keys.sign.privateKey, room, ALICE, sdp);
    const pub = alice.devices[0].pub.signPub;
    expect(await verifyDtlsFingerprints(pub, sig, room, ALICE, sdp)).toBe(true);
    expect(await verifyDtlsFingerprints(pub, sig, room, ALICE, mitm)).toBe(false);
    expect(await verifyDtlsFingerprints(pub, sig, "gdm:other", ALICE, sdp)).toBe(false);
    expect(await verifyDtlsFingerprints(pub, sig, room, BOB, sdp)).toBe(false);
    expect(await verifyDtlsFingerprints(bob.devices[0].pub.signPub, sig, room, ALICE, sdp)).toBe(false);
    expect(await verifyDtlsFingerprints(pub, "garbage", room, ALICE, sdp)).toBe(false);
    await expect(signDtlsFingerprints(alice.devices[0].keys.sign.privateKey, room, ALICE, "v=0")).rejects.toBeInstanceOf(E2eeFormatError);
  });
});

describe("backup key certificate", () => {
  test("the identity key vouches for the backup key; a swapped key fails", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const sig = await signBackupKey(alice.identity.privateKey, ALICE, alice.backupPub);
    expect(await verifyBackupKey(alice.identityPub, ALICE, alice.backupPub, sig)).toBe(true);
    // A server substituting its own backup key, a wrong user or identity, or a tampered signature.
    expect(await verifyBackupKey(alice.identityPub, ALICE, bob.backupPub, sig)).toBe(false);
    expect(await verifyBackupKey(alice.identityPub, BOB, alice.backupPub, sig)).toBe(false);
    expect(await verifyBackupKey(bob.identityPub, ALICE, alice.backupPub, sig)).toBe(false);
    expect(await verifyBackupKey(alice.identityPub, ALICE, alice.backupPub, flip(sig, 3))).toBe(false);
    expect(await verifyBackupKey(alice.identityPub, ALICE, alice.backupPub, null)).toBe(false);
    // The device and backup labels differ: a device signature never passes as a backup one.
    expect(await verifyBackupKey(alice.identityPub, ALICE, alice.backupPub, alice.devices[0].pub.sig)).toBe(false);
  });
});

describe("server policy (policy.ts)", () => {
  const CDN = "https://cdn.serika.chat";
  const blob = (over: Record<string, unknown> = {}) => ({
    id: "abc123",
    url: `${CDN}/attachments/${ALICE}/AbCdEfGhIjKlMnOp.bin`,
    filename: "e2ee-AAAAAAAAAAAAAAAAAAAAAA.bin",
    contentType: "application/octet-stream",
    size: 120,
    ...over,
  });

  test("a well-formed encrypted body passes and keeps only opaque blob facts", async () => {
    const alice = await makeUser(ALICE);
    const bob = await makeUser(BOB);
    const { envelope } = await send(alice, [alice, bob]);
    const parsed = parseEncryptedBody(ALICE, CDN, { e2ee: envelope, content: "", attachments: [blob({ spoiler: true })] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.envelope.sig).toBe(envelope.sig);
      expect(parsed.attachments).toEqual([{ id: "abc123", url: blob().url, filename: blob().filename, contentType: "application/octet-stream", size: 120 }]);
    }
  });

  test("plaintext, stickers, bad envelopes and readable attachments are refused", async () => {
    const alice = await makeUser(ALICE);
    const { envelope } = await send(alice, [alice]);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, content: "leaked plaintext" }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, sticker: { id: "s" } }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: { ...envelope, v: 2 } }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: "nope" }).ok).toBe(false);
    // A readable file, a wrong name, another user's upload, another host.
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, attachments: [blob({ contentType: "image/png" })] }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, attachments: [blob({ filename: "cat.png" })] }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, attachments: [blob({ url: `${CDN}/attachments/${BOB}/x.bin` })] }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, attachments: [blob({ url: `https://evil.example/attachments/${ALICE}/x.bin` })] }).ok).toBe(false);
    expect(parseEncryptedBody(ALICE, CDN, { e2ee: envelope, attachments: [blob({ url: `${CDN}/attachments/${ALICE}/x.png` })] }).ok).toBe(false);
  });

  test("encrypted conversations take only envelopes, plain ones only plaintext", () => {
    expect(e2eeMismatch({ e2ee: true }, true)).toBeNull();
    expect(e2eeMismatch({ e2ee: true }, false)?.status).toBe(400);
    expect(e2eeMismatch({ e2ee: false }, false)).toBeNull();
    expect(e2eeMismatch({ e2ee: null }, false)).toBeNull();
    expect(e2eeMismatch({ e2ee: false }, true)?.status).toBe(400);
    expect(e2eeMismatch({ e2ee: null }, true)?.status).toBe(400);
    expect(isE2eeChannel({ e2ee: null })).toBe(false);
    expect(isE2eeChannel(null)).toBe(false);
  });

  test("stored rows: envelopes vs the 'encryption on' notice", async () => {
    const alice = await makeUser(ALICE);
    const { envelope } = await send(alice, [alice]);
    expect(storedEnvelope(envelope)?.sig).toBe(envelope.sig);
    expect(storedEnvelope(E2EE_NOTICE)).toBeNull();
    expect(storedEnvelope(null)).toBeNull();
    expect(storedEnvelope({ v: 1, junk: true })).toBeNull();
    expect(isE2eeNotice(E2EE_NOTICE)).toBe(true);
    expect(isE2eeNotice(envelope)).toBe(false);
  });
});
