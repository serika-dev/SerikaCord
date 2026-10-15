import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIMITS,
  backupRecipientId,
  canonicalKeySet,
  capRecipients,
  deviceSignaturePayload,
  describeDevice,
  encryptMessage,
  encryptedPreviewText,
  envelopeForRecipients,
  envelopeOfPushBlock,
  exportPublicKey,
  fromB64,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  isPublicNotifyKey,
  mentionsUser,
  newDeviceId,
  notifyPushBlock,
  openNotifyPushBlock,
  selectNotifyRecipients,
  signDevice,
  signNotifyKey,
  toB64,
  verifyEnvelopeSignature,
  verifyNotifyKey,
  type DeviceKeys,
  type PublicNotifyKey,
  type VersionedBundle,
  type WrapRecipient,
} from "@/lib/e2ee";
import { signBytes } from "@/lib/e2ee/keys";
import { E2EE_PUSH_PROTOCOL, RICH_DATA_BUDGET, buildFcmMessage, buildRichMessageData, type PushPayload } from "@/lib/push/fcm";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "44444444-4444-4444-8444-444444444444";
const OTHER_CHANNEL = "55555555-5555-4555-8555-555555555555";

interface Device {
  keys: DeviceKeys;
  signPub: string;
  ecdhPub: string;
}

async function makeDevice(): Promise<Device> {
  const keys = await generateDeviceKeys();
  const d = await describeDevice(keys);
  return { keys, signPub: d.signPub, ecdhPub: d.ecdhPub };
}

async function makeNotifyKey(owner: Device, userId: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = await exportPublicKey(pair.publicKey);
  const id = newDeviceId();
  const sig = await signNotifyKey(owner.keys.sign.privateKey, userId, { id, deviceId: owner.keys.id, ecdhPub: pub });
  const key: PublicNotifyKey = { id, deviceId: owner.keys.id, ecdhPub: pub, sig };
  return { pair, key };
}

function bytes(data: Record<string, string>): number {
  return Object.entries(data).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
}

describe("notification keys", () => {
  test("signed by the owning device, bound to user, device, id and key", async () => {
    const phone = await makeDevice();
    const other = await makeDevice();
    const { key } = await makeNotifyKey(phone, BOB);
    expect(isPublicNotifyKey(key)).toBe(true);
    expect(await verifyNotifyKey(phone.signPub, BOB, key)).toBe(true);
    expect(await verifyNotifyKey(phone.signPub, BOB.toUpperCase(), key)).toBe(true);
    // Another device, another user, another id or key: refused.
    expect(await verifyNotifyKey(other.signPub, BOB, key)).toBe(false);
    expect(await verifyNotifyKey(phone.signPub, ALICE, key)).toBe(false);
    expect(await verifyNotifyKey(phone.signPub, BOB, { ...key, id: newDeviceId() })).toBe(false);
    expect(await verifyNotifyKey(phone.signPub, BOB, { ...key, deviceId: other.keys.id })).toBe(false);
    expect(await verifyNotifyKey(phone.signPub, BOB, { ...key, ecdhPub: other.ecdhPub })).toBe(false);
    expect(await verifyNotifyKey(phone.signPub, BOB, { ...key, sig: "AAAA" })).toBe(false);
    // Its id can't be the device's own id (they share the wrap-recipient namespace).
    expect(isPublicNotifyKey({ ...key, id: key.deviceId })).toBe(false);
  });

  test("a device certificate can't pass as a notification key signature (domain separation)", async () => {
    const identity = await generateIdentityKeyPair();
    const phone = await makeDevice();
    const desc = await describeDevice(phone.keys);
    const deviceSig = await signDevice(identity.privateKey, BOB, desc);
    // Even signed by the same key over the same public point, the label differs.
    const forged: PublicNotifyKey = { id: newDeviceId(), deviceId: phone.keys.id, ecdhPub: desc.ecdhPub, sig: deviceSig };
    expect(await verifyNotifyKey(await exportPublicKey(identity.publicKey), BOB, forged)).toBe(false);
    const raw = await signBytes(phone.keys.sign.privateKey, deviceSignaturePayload(BOB, desc));
    expect(await verifyNotifyKey(phone.signPub, BOB, { ...forged, sig: toB64(raw) })).toBe(false);
  });

  test("senders only wrap to keys of trusted, active devices with a valid signature", async () => {
    const phone = await makeDevice();
    const laptop = await makeDevice();
    const stranger = await makeDevice();
    const good = await makeNotifyKey(phone, BOB);
    const second = await makeNotifyKey(phone, BOB);
    const untrusted = await makeNotifyKey(stranger, BOB);
    const badSig = await makeNotifyKey(laptop, BOB);
    const trusted = new Map([[phone.keys.id, phone.signPub], [laptop.keys.id, laptop.signPub]]);
    const picked = await selectNotifyRecipients(BOB, [
      good.key,
      second.key, // one per device: the first listed wins
      untrusted.key, // its device isn't one we encrypt to
      { ...badSig.key, sig: good.key.sig }, // signature doesn't verify
      { ...good.key, id: laptop.keys.id }, // collides with a device id
      { nonsense: true },
    ], trusted);
    expect(picked).toEqual([{ id: good.key.id, pub: good.key.ecdhPub }]);
    expect(await selectNotifyRecipients(BOB, undefined, trusted)).toEqual([]);
    expect(await selectNotifyRecipients(BOB, [good.key], new Map())).toEqual([]);
    // Signed for another user: refused.
    expect(await selectNotifyRecipients(ALICE, [good.key], trusted)).toEqual([]);
  });

  test("recipient cap: readers first, notification keys only while under the limit", () => {
    const r = (n: number, prefix: string): WrapRecipient[] =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(21, "0")}`.slice(0, 22), pub: "x" }));
    const primary = r(120, "p");
    const optional = r(20, "o");
    const out = capRecipients(primary, optional);
    expect(out.length).toBe(LIMITS.maxRecipients);
    expect(out.slice(0, 120)).toEqual(primary);
    expect(capRecipients(primary.slice(0, 2), [...optional.slice(0, 2), primary[0]])).toEqual([...primary.slice(0, 2), ...optional.slice(0, 2)]);
  });

  test("key-set versions: unchanged without notification keys, changed when one is added", () => {
    const base: VersionedBundle = { userId: BOB, identityPub: "i", backupPub: "b", backupSig: "s", devices: [{ id: "d", ecdhPub: "e", signPub: "p", sig: "g" }] };
    const before = canonicalKeySet([base]);
    expect(canonicalKeySet([{ ...base, notifyKeys: [] }])).toBe(before);
    expect(before).toBe(JSON.stringify(["serika-e2ee-keyset-v1", [[BOB, "i", "b", "s", [["d", "e", "p", "g", 0]]]]]));
    const withKey = canonicalKeySet([{ ...base, notifyKeys: [{ id: "n", deviceId: "d", ecdhPub: "k", sig: "z" }] }]);
    expect(withKey).not.toBe(before);
  });
});

describe("push blocks", () => {
  async function setup(content = "hi <@22222222-2222-4222-8222-222222222222> ||secret||") {
    const sender = await makeDevice();
    const bobPhone = await makeDevice();
    const backup = await generateBackupKeyPair();
    const notify = await makeNotifyKey(bobPhone, BOB);
    const { envelope } = await encryptMessage({
      payload: { v: 1, content, ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: ALICE, senderDeviceId: sender.keys.id },
      recipients: [
        { id: sender.keys.id, pub: sender.ecdhPub },
        { id: bobPhone.keys.id, pub: bobPhone.ecdhPub },
        { id: backupRecipientId(BOB), pub: await exportPublicKey(backup.publicKey) },
        { id: notify.key.id, pub: notify.key.ecdhPub },
      ],
      signKey: sender.keys.sign.privateKey,
    });
    return { sender, bobPhone, notify, envelope };
  }

  test("carries only this key's entry and opens + verifies like the app does", async () => {
    const { sender, notify, envelope } = await setup();
    const block = notifyPushBlock(envelope, notify.key.id)!;
    expect(block.k.r).toBe(notify.key.id);
    expect(JSON.stringify(block)).not.toContain("backup:");
    expect(envelopeOfPushBlock(block)?.keys.length).toBe(1);
    const opened = await openNotifyPushBlock(block, { channelId: CHANNEL, senderUserId: ALICE }, { id: notify.key.id, privateKey: notify.pair.privateKey }, sender.signPub);
    expect(opened.payload.content).toContain("||secret||");
    // The block's signature is the envelope's: the trimmed envelope still verifies.
    expect(await verifyEnvelopeSignature(envelopeOfPushBlock(block)!, CHANNEL, sender.signPub)).toBe(true);
  });

  test("refuses another conversation, another sender, an untrusted signer or tampering", async () => {
    const { sender, bobPhone, notify, envelope } = await setup();
    const block = notifyPushBlock(envelope, notify.key.id)!;
    const key = { id: notify.key.id, privateKey: notify.pair.privateKey };
    await expect(openNotifyPushBlock(block, { channelId: OTHER_CHANNEL, senderUserId: ALICE }, key, sender.signPub)).rejects.toBeDefined();
    await expect(openNotifyPushBlock(block, { channelId: CHANNEL, senderUserId: BOB }, key, sender.signPub)).rejects.toBeDefined();
    await expect(openNotifyPushBlock(block, { channelId: CHANNEL, senderUserId: ALICE }, key, bobPhone.signPub)).rejects.toMatchObject({ code: "signature" });
    const ct = fromB64(block.ct);
    ct[2] ^= 1;
    await expect(openNotifyPushBlock({ ...block, ct: toB64(ct) }, { channelId: CHANNEL, senderUserId: ALICE }, key, sender.signPub)).rejects.toBeDefined();
    expect(notifyPushBlock(envelope, newDeviceId())).toBeNull();
    expect(notifyPushBlock({ junk: 1 }, notify.key.id)).toBeNull();
    expect(envelopeOfPushBlock({ ...block, extra: 1, k: { ...block.k, more: 2 } })).toBeNull();
  });

  test("trimmed envelopes (DM list) keep only the viewer's entries and still verify", async () => {
    const { sender, bobPhone, envelope } = await setup();
    const trimmed = envelopeForRecipients(envelope, new Set([bobPhone.keys.id, backupRecipientId(BOB)]))!;
    expect(trimmed.keys.map((k) => k.r).sort()).toEqual([bobPhone.keys.id, backupRecipientId(BOB)].sort());
    expect(await verifyEnvelopeSignature(trimmed, CHANNEL, sender.signPub)).toBe(true);
    expect(envelopeForRecipients(envelope, new Set(["nobody"]))).toBeNull();
  });
});

describe("FCM payload with an encrypted preview", () => {
  const dm = (e2ee: unknown, over: Partial<NonNullable<Extract<PushPayload, { kind: "message" }>["rich"]>> = {}): Extract<PushPayload, { kind: "message" }> => ({
    kind: "message",
    title: "Alice",
    body: "New encrypted message",
    route: `/dm/${ALICE}?jump=m1`,
    tag: `message-${CHANNEL}`,
    rich: {
      kind: "dm",
      channelId: CHANNEL,
      conversationTitle: "Alice",
      authorId: ALICE,
      authorName: "Alice",
      authorAvatar: "https://cdn.serika.chat/avatars/a.png",
      messageId: "m1",
      canReply: false,
      timestamp: 1_760_000_000_000,
      e2ee,
      ...over,
    },
  });

  test("protocol 3 + a linked key: only that wrap entry, no plaintext", async () => {
    const secret = "the secret text";
    const sender = await makeDevice();
    const phone = await makeDevice();
    const notify = await makeNotifyKey(phone, BOB);
    const { envelope } = await encryptMessage({
      payload: { v: 1, content: secret, ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: ALICE, senderDeviceId: sender.keys.id },
      recipients: [{ id: phone.keys.id, pub: phone.ecdhPub }, { id: notify.key.id, pub: notify.key.ecdhPub }],
      signKey: sender.keys.sign.privateKey,
    });
    const data = buildRichMessageData(dm(envelope), { protocol: E2EE_PUSH_PROTOCOL, notifyId: notify.key.id });
    expect(data.enc).toBe("1");
    const block = JSON.parse(data.e2ee);
    expect(block).toEqual(notifyPushBlock(envelope, notify.key.id));
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(JSON.stringify(data)).not.toContain(phone.keys.id);
    expect(bytes(data) <= RICH_DATA_BUDGET).toBe(true);
    const opened = await openNotifyPushBlock(block, { channelId: data.channelId, senderUserId: data.authorId }, { id: notify.key.id, privateKey: notify.pair.privateKey }, sender.signPub);
    expect(opened.payload.content).toBe(secret);
    // The whole FCM message stays under FCM's 4 KB data limit.
    const msg = buildFcmMessage("t".repeat(180), dm(envelope), { protocol: E2EE_PUSH_PROTOCOL, notifyId: notify.key.id });
    expect(Buffer.byteLength(JSON.stringify((msg as { data: unknown }).data))).toBeLessThan(4096);
  });

  test("older APKs and phones without a key get nothing new", async () => {
    const sender = await makeDevice();
    const notify = await makeNotifyKey(await makeDevice(), BOB);
    const { envelope } = await encryptMessage({
      payload: { v: 1, content: "x", ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: ALICE, senderDeviceId: sender.keys.id },
      recipients: [{ id: notify.key.id, pub: notify.key.ecdhPub }],
      signKey: sender.keys.sign.privateKey,
    });
    const v2 = buildRichMessageData(dm(envelope), { protocol: 2, notifyId: notify.key.id });
    expect(v2.e2ee).toBeUndefined();
    expect(v2.enc).toBeUndefined();
    expect(v2.body).toBe("New encrypted message");
    const noKey = buildRichMessageData(dm(envelope), { protocol: 3, notifyId: null });
    expect(noKey.e2ee).toBeUndefined();
    expect(noKey.enc).toBe("1");
    const otherKey = buildRichMessageData(dm(envelope), { protocol: 3, notifyId: newDeviceId() });
    expect(otherKey.e2ee).toBeUndefined();
    // Legacy (system-rendered) pushes never carry it.
    const legacy = buildFcmMessage("tok", dm(envelope), { protocol: 1, notifyId: notify.key.id }) as { data: Record<string, string> };
    expect(legacy.data.e2ee).toBeUndefined();
  });

  test("previews off (no envelope sent): protocol 3 still learns the message is encrypted", () => {
    const data = buildRichMessageData(dm(undefined, { encrypted: true }), { protocol: 3, notifyId: newDeviceId() });
    expect(data.enc).toBe("1");
    expect(data.e2ee).toBeUndefined();
    expect(data.canReply).toBe("0");
    expect(buildRichMessageData(dm(undefined, { encrypted: true }), { protocol: 2 }).enc).toBeUndefined();
  });

  test("pictures make room for the preview; too big means no preview, never over budget", async () => {
    const sender = await makeDevice();
    const notify = await makeNotifyKey(await makeDevice(), BOB);
    const encrypt = async (content: string) => (await encryptMessage({
      payload: { v: 1, content, ts: Date.now() },
      context: { channelId: CHANNEL, senderUserId: ALICE, senderDeviceId: sender.keys.id },
      recipients: [{ id: notify.key.id, pub: notify.key.ecdhPub }],
      signKey: sender.keys.sign.privateKey,
    })).envelope;
    const url = `https://cdn.serika.chat/${"a".repeat(560)}`;
    const target = { protocol: 3, notifyId: notify.key.id };
    const medium = buildRichMessageData(dm(await encrypt("m".repeat(1200)), { authorAvatar: url, icon: url }), target);
    expect(medium.e2ee).toBeDefined();
    // The group icon goes first (then the avatar) to make room.
    expect(medium.icon).toBe("");
    expect(bytes(medium) <= RICH_DATA_BUDGET).toBe(true);
    const huge = buildRichMessageData(dm(await encrypt("h".repeat(4000)), { authorAvatar: url }), target);
    expect(huge.e2ee).toBeUndefined();
    expect(huge.enc).toBe("1");
    expect(huge.avatar).toBe(url);
    expect(bytes(huge) <= RICH_DATA_BUDGET).toBe(true);
  });
});

describe("committed test vector (docs/architecture/e2ee-notify-vectors.json)", () => {
  test("opens with the web implementation", async () => {
    const v = JSON.parse(readFileSync(join(process.cwd(), "docs", "architecture", "e2ee-notify-vectors.json"), "utf8"));
    const privateKey = await crypto.subtle.importKey("pkcs8", fromB64(v.notifyKey.pkcs8), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const opened = await openNotifyPushBlock(JSON.parse(v.fcmE2ee), { channelId: v.channelId, senderUserId: v.senderUserId }, { id: v.notifyKey.id, privateKey }, v.senderSignPub);
    expect(opened.payloadText).toBe(v.expected.payloadJson);
    expect(toB64(opened.key)).toBe(v.expected.messageKey);
  });
});

describe("encrypted previews", () => {
  const labels = { attachment: "📎 Attachment", sticker: "Sticker", spoiler: "[spoiler]" };

  test("mentions, spoilers, whitespace", () => {
    const text = encryptedPreviewText(
      { text: `hey <@${BOB}>\n\nlook ||the ending|| <@!${ALICE}> <#${CHANNEL}> <:wave:123>`, attachments: 0, sticker: false },
      labels,
      { names: { users: { [BOB]: "Bob" } } },
    );
    expect(text).toBe("hey @Bob look [spoiler] @user #channel :wave:");
    expect(text).not.toContain("the ending");
  });

  test("files and stickers without text; nothing at all is empty", () => {
    expect(encryptedPreviewText({ text: "  ", attachments: 2, sticker: false }, labels)).toBe("📎 Attachment");
    expect(encryptedPreviewText({ text: "", attachments: 0, sticker: true }, labels)).toBe("Sticker");
    expect(encryptedPreviewText({ text: "", attachments: 0, sticker: false }, labels)).toBe("");
  });

  test("clipped without splitting an emoji", () => {
    const text = encryptedPreviewText({ text: "😀".repeat(200), attachments: 0, sticker: false }, labels, { max: 21 });
    expect(text.length <= 21).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false);
  });

  test("mention detection after decrypting", () => {
    expect(mentionsUser(`hi <@${BOB}>`, BOB)).toBe(true);
    expect(mentionsUser(`hi <@!${BOB.toUpperCase()}>`, BOB)).toBe(true);
    expect(mentionsUser(`hi <@${ALICE}>`, BOB)).toBe(false);
    expect(mentionsUser(`hi <@&${BOB}>`, BOB)).toBe(false);
    expect(mentionsUser(`hi @${BOB}`, BOB)).toBe(false);
    expect(mentionsUser("", BOB)).toBe(false);
    expect(mentionsUser(`<@${BOB}>`, null)).toBe(false);
  });
});
