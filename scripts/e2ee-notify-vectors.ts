// Test vectors for encrypted push previews (docs/architecture/e2ee.md "Push
// notifications"): encrypts a sample payload to a notification key with the
// real web code (src/lib/e2ee), opens it again the way the Android app does,
// and prints the vector as JSON with every intermediate value.
//
//   bun scripts/e2ee-notify-vectors.ts            print a fresh vector
//   bun scripts/e2ee-notify-vectors.ts --write    replace docs/architecture/e2ee-notify-vectors.json
//
// No network, no database. The committed vector is checked by
// tests/e2ee-notify.test.ts (TypeScript) and E2eeNotifyCryptoTest (Android JVM
// unit test, mobile/android/app/src/test).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  encryptMessage,
  exportPublicKey,
  fromB64,
  generateDeviceKeys,
  LABELS,
  newDeviceId,
  notifyPushBlock,
  openNotifyPushBlock,
  publicKeyBytes,
  toB64,
  unwrapMessageKey,
  validatePayload,
  type MessagePayload,
} from "../src/lib/e2ee";
import { frame } from "../src/lib/e2ee/encoding";

const subtle = globalThis.crypto.subtle;

async function main() {
  const channelId = "0b9f6c7e-3d2a-4c1b-9e8f-7a6b5c4d3e2f";
  const senderUserId = "5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
  const recipientUserId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const sender = await generateDeviceKeys(true);
  const senderSignPub = await exportPublicKey(sender.sign.publicKey);

  const notifyPair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const notifyId = newDeviceId();
  const notifyPub = await exportPublicKey(notifyPair.publicKey);
  const pkcs8 = toB64(new Uint8Array(await subtle.exportKey("pkcs8", notifyPair.privateKey)));

  const payload: MessagePayload = validatePayload({
    v: 1,
    content: `Hi <@${recipientUserId}>! Notification preview test ✓ ||secret||`,
    ts: 1_760_000_000_000,
  });
  const { envelope, key } = await encryptMessage({
    payload,
    context: { channelId, senderUserId, senderDeviceId: sender.id },
    // A real envelope also carries every device + backup key; the push block keeps only this entry.
    recipients: [{ id: notifyId, pub: notifyPub }, { id: newDeviceId(), pub: await exportPublicKey((await generateDeviceKeys()).ecdh.publicKey) }],
    signKey: sender.sign.privateKey,
  });
  const block = notifyPushBlock(envelope, notifyId);
  if (!block) throw new Error("no push block");

  // Intermediate values, from the recipient side (what the app computes).
  const epk = await subtle.importKey("raw", publicKeyBytes(block.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: epk }, notifyPair.privateKey, 256));
  const ikm = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const wrapKey = new Uint8Array(await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: fromB64(block.iv), info: frame(LABELS.wrap, notifyId, publicKeyBytes(block.epk)) },
    ikm,
    256,
  ));
  const unwrapped = await unwrapMessageKey(envelope, { id: notifyId, privateKey: notifyPair.privateKey });
  if (toB64(unwrapped) !== toB64(key)) throw new Error("unwrap mismatch");
  const opened = await openNotifyPushBlock(block, { channelId, senderUserId }, { id: notifyId, privateKey: notifyPair.privateKey }, senderSignPub);

  const vector = {
    description: "Encrypted push preview (protocol 3): open `fcmData.e2ee` with the notification key, verify with the sender device key. All binary values are standard base64 with padding.",
    notifyKey: { id: notifyId, pkcs8, publicKey: notifyPub },
    channelId,
    senderUserId,
    senderDeviceId: sender.id,
    senderSignPub,
    /** The `e2ee` value of the FCM data map, exactly as sent. */
    fcmE2ee: JSON.stringify(block),
    expected: {
      sharedSecret: toB64(shared),
      wrapAad: toB64(frame(LABELS.wrap, notifyId)),
      wrapKey: toB64(wrapKey),
      messageKey: toB64(key),
      messageAad: toB64(frame(LABELS.message, channelId, senderUserId, sender.id)),
      signedData: toB64(frame(LABELS.sig, channelId, block.sd, fromB64(block.iv), fromB64(block.ct), fromB64(block.cm), publicKeyBytes(block.epk))),
      payloadJson: opened.payloadText,
    },
  };
  const json = `${JSON.stringify(vector, null, 2)}\n`;
  if (process.argv.includes("--write")) {
    const out = join(import.meta.dir, "..", "docs", "architecture", "e2ee-notify-vectors.json");
    writeFileSync(out, json);
    console.log(`Wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
