// Notification keys (stage 2, docs/architecture/e2ee.md "Push notifications").
//
// An Android install that can draw encrypted push previews gets one more ECDH
// P-256 key: its notification key. The WebView generates it, hands the
// private half to native code once (stored there under an Android Keystore
// key) and publishes the public half, signed by the owning device's signing
// key under its own label:
//
//   sig = ECDSA(deviceSignKey, frame("serika-e2ee-notify-v1", userId, deviceId, notifyId, ecdhPub))
//
// The id is device-shaped (16 random bytes, base64url), so a notification key
// is just one more wrap recipient in a v1 envelope: every existing client
// ignores an entry that isn't its own. A notification key never signs
// anything, and a device signature can never pass as a notification-key
// signature (different label), so the server can neither invent one nor turn
// one into a sender. Senders only wrap to a notification key whose owning
// device is one of that user's verified, active encryption targets.
//
// A push for such a device carries only its own wrap entry plus the envelope
// fields needed to open and verify the message (`NotifyPushBlock`).
import { LABELS, LIMITS, SIGNATURE_BYTES, UUID_RE } from "./constants";
import { E2eeFormatError, E2eeVerifyError, b64ByteLength, frame, fromB64, isBase64, toB64, type Bytes } from "./encoding";
import { isDeviceId, isPublicKeyB64, publicKeyBytes, signBytes, verifyBytes } from "./keys";
import {
  openEnvelope,
  parseEnvelope,
  verifyEnvelopeSignature,
  type Envelope,
  type EnvelopeKey,
  type OpenedMessage,
  type WrapRecipient,
} from "./envelope";

export interface PublicNotifyKey {
  /** Device-shaped id (wrap recipient id). */
  id: string;
  /** The E2EE device that owns (and signed) it. */
  deviceId: string;
  /** ECDH P-256 public key (raw, base64). */
  ecdhPub: string;
  /** Signature by the owning device's signing key (notifyKeyPayload). */
  sig: string;
}

/** What the owning device signs to vouch for its notification key. */
export function notifyKeyPayload(userId: string, key: Pick<PublicNotifyKey, "id" | "deviceId" | "ecdhPub">): Bytes {
  if (!UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  if (!isDeviceId(key.id) || !isDeviceId(key.deviceId)) throw new E2eeFormatError("Bad notification key id");
  if (key.id === key.deviceId) throw new E2eeFormatError("A notification key needs its own id");
  return frame(LABELS.notify, userId.toLowerCase(), key.deviceId, key.id, publicKeyBytes(key.ecdhPub));
}

export async function signNotifyKey(deviceSignPrivate: CryptoKey, userId: string, key: Pick<PublicNotifyKey, "id" | "deviceId" | "ecdhPub">): Promise<string> {
  return toB64(await signBytes(deviceSignPrivate, notifyKeyPayload(userId, key)));
}

/** Whether `key` is vouched for by the device signing key `deviceSignPub` (false on any malformed input). */
export async function verifyNotifyKey(deviceSignPub: string, userId: string, key: PublicNotifyKey): Promise<boolean> {
  try {
    if (!isBase64(key.sig) || b64ByteLength(key.sig) !== SIGNATURE_BYTES) return false;
    return await verifyBytes(deviceSignPub, fromB64(key.sig), notifyKeyPayload(userId, key));
  } catch {
    return false;
  }
}

/** Shape check of a notification key as the server stores / lists it. */
export function isPublicNotifyKey(value: unknown): value is PublicNotifyKey {
  const k = value as Partial<PublicNotifyKey> | null;
  return Boolean(
    k && typeof k === "object"
      && isDeviceId(k.id)
      && isDeviceId(k.deviceId)
      && k.id !== k.deviceId
      && isPublicKeyB64(k.ecdhPub)
      && isBase64(k.sig) && b64ByteLength(k.sig as string) === SIGNATURE_BYTES,
  );
}

/**
 * The notification keys of one user a sender may wrap to. `trustedDevices`
 * maps that user's verified, active encryption devices (the ones the sender
 * already wraps to) to their signing keys: a notification key counts only
 * when its owning device is one of them and its signature verifies under that
 * device's signing key. At most one key per device, ids never equal to a
 * device id (they share the wrap-recipient namespace).
 */
export async function selectNotifyRecipients(
  userId: string,
  keys: unknown,
  trustedDevices: ReadonlyMap<string, string>,
  verify: (signPub: string, userId: string, key: PublicNotifyKey) => Promise<boolean> = verifyNotifyKey,
): Promise<WrapRecipient[]> {
  if (!Array.isArray(keys) || keys.length === 0 || trustedDevices.size === 0) return [];
  const candidates: PublicNotifyKey[] = [];
  const seenIds = new Set<string>();
  const seenDevices = new Set<string>();
  for (const raw of keys) {
    if (!isPublicNotifyKey(raw)) continue;
    if (seenIds.has(raw.id) || seenDevices.has(raw.deviceId) || trustedDevices.has(raw.id)) continue;
    if (!trustedDevices.has(raw.deviceId)) continue;
    seenIds.add(raw.id);
    seenDevices.add(raw.deviceId);
    candidates.push(raw);
    if (candidates.length >= LIMITS.maxDevicesPerUser) break;
  }
  const checked = await Promise.all(candidates.map(async (k) => ((await verify(trustedDevices.get(k.deviceId)!, userId, k)) ? k : null)));
  return checked.filter((k): k is PublicNotifyKey => k !== null).map((k) => ({ id: k.id, pub: k.ecdhPub }));
}

/**
 * The recipient list of one envelope: every `primary` recipient (devices and
 * backup keys: what readers need), then `optional` ones (notification keys:
 * push previews only) while the envelope stays within the recipient limit.
 */
export function capRecipients(primary: WrapRecipient[], optional: WrapRecipient[], max: number = LIMITS.maxRecipients): WrapRecipient[] {
  const out = primary.slice();
  const ids = new Set(primary.map((r) => r.id));
  for (const r of optional) {
    if (out.length >= max) break;
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push(r);
  }
  return out;
}

// ─── Push payload ─────────────────────────────────────────────────────────────

/** What a push to one notification key carries: the envelope minus every other recipient's entry. */
export interface NotifyPushBlock {
  v: 1;
  sd: string;
  epk: string;
  iv: string;
  ct: string;
  cm: string;
  sig: string;
  /** This notification key's wrap entry. */
  k: EnvelopeKey;
}

/** The push block for notification key `notifyId`, or null when the envelope has no entry for it. */
export function notifyPushBlock(envelope: unknown, notifyId: string): NotifyPushBlock | null {
  const env = parseEnvelope(envelope);
  if (!env || !isDeviceId(notifyId)) return null;
  const k = env.keys.find((e) => e.r === notifyId);
  if (!k) return null;
  return { v: 1, sd: env.sd, epk: env.epk, iv: env.iv, ct: env.ct, cm: env.cm, sig: env.sig, k: { r: k.r, iv: k.iv, k: k.k } };
}

/** The envelope a push block stands for (one recipient), strictly validated. Null when malformed. */
export function envelopeOfPushBlock(block: unknown): Envelope | null {
  const b = block as Partial<NotifyPushBlock> | null;
  if (!b || typeof b !== "object" || Array.isArray(b) || b.v !== 1 || !b.k || typeof b.k !== "object") return null;
  return parseEnvelope({ v: 1, sd: b.sd, epk: b.epk, iv: b.iv, ct: b.ct, cm: b.cm, sig: b.sig, keys: [b.k] });
}

/**
 * Open a push block the way the Android app does (reference implementation
 * for tests and vectors): unwrap with the notification key, check the
 * commitment, decrypt (AAD binds channel, sender and sender device) and
 * verify the sender device signature with `senderSignPub`.
 */
export async function openNotifyPushBlock(
  block: unknown,
  context: { channelId: string; senderUserId: string },
  key: { id: string; privateKey: CryptoKey },
  senderSignPub: string,
): Promise<OpenedMessage> {
  const envelope = envelopeOfPushBlock(block);
  if (!envelope) throw new E2eeFormatError("Malformed push block");
  const opened = await openEnvelope(envelope, { ...context, senderDeviceId: envelope.sd }, key);
  if (!(await verifyEnvelopeSignature(envelope, context.channelId, senderSignPub))) {
    throw new E2eeVerifyError("signature", "The sender signature doesn't verify");
  }
  return opened;
}

/**
 * The envelope with only the wrap entries in `keep` (e.g. the viewer's own
 * devices and backup key, for a DM-list preview). The signature doesn't cover
 * the entry list, so the result still verifies. Null when nothing is left.
 */
export function envelopeForRecipients(envelope: unknown, keep: ReadonlySet<string>): Envelope | null {
  const env = parseEnvelope(envelope);
  if (!env) return null;
  const keys = env.keys.filter((k) => keep.has(k.r));
  if (keys.length === 0) return null;
  return { ...env, keys };
}
