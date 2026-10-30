// Message envelopes (v1): AES-256-GCM content under a random per-message key
// K, K wrapped to every recipient device and backup key with ephemeral ECDH +
// HKDF, a franking commitment SHA-256(K ‖ ct) and an ECDSA signature by the
// sender device. See docs/architecture/e2ee.md for the exact construction.
import {
  AES_KEY_BYTES,
  E2EE_VERSION,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  LABELS,
  LIMITS,
  RECIPIENT_RE,
  SHA256_BYTES,
  SIGNATURE_BYTES,
  UUID_RE,
  WRAPPED_KEY_BYTES,
} from "./constants";
import {
  E2eeFormatError,
  E2eeVerifyError,
  b64ByteLength,
  concat,
  equalBytes,
  frame,
  fromB64,
  fromUtf8,
  isBase64,
  randomBytes,
  toB64,
  utf8,
  type Bytes,
} from "./encoding";
import {
  exportPublicKey,
  generateEphemeralKeyPair,
  importEcdhPublicKey,
  importRecipientPublicKey,
  isDeviceId,
  isPublicKeyB64,
  publicKeyBytes,
  signBytes,
  verifyBytes,
} from "./keys";
import { validatePayload, type MessagePayload } from "./payload";

export interface EnvelopeKey {
  /** Recipient: a device id, or `backup:<userId>`. */
  r: string;
  iv: string;
  k: string;
}

export interface Envelope {
  v: typeof E2EE_VERSION;
  /** Sender device id. */
  sd: string;
  /** Ephemeral ECDH public key (raw, base64). */
  epk: string;
  iv: string;
  ct: string;
  /** Franking commitment SHA-256(K ‖ ct). */
  cm: string;
  /** Sender device ECDSA signature. */
  sig: string;
  keys: EnvelopeKey[];
}

/** Who sent a message where: bound into the AEAD associated data. */
export interface MessageContext {
  channelId: string;
  senderUserId: string;
  senderDeviceId: string;
}

export interface WrapRecipient {
  /** Device id, or `backup:<userId>`. */
  id: string;
  /** Recipient ECDH public key (raw, base64). */
  pub: string;
}

function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

const lower = (s: string) => s.toLowerCase();

export function backupRecipientId(userId: string): string {
  return `backup:${lower(userId)}`;
}

function messageAad(ctx: MessageContext): Bytes {
  if (!UUID_RE.test(ctx.channelId) || !UUID_RE.test(ctx.senderUserId)) throw new E2eeFormatError("Bad message context");
  if (!isDeviceId(ctx.senderDeviceId)) throw new E2eeFormatError("Bad sender device");
  return frame(LABELS.message, lower(ctx.channelId), lower(ctx.senderUserId), ctx.senderDeviceId);
}

function signaturePayload(channelId: string, env: Pick<Envelope, "sd" | "iv" | "ct" | "cm" | "epk">): Bytes {
  return frame(LABELS.sig, lower(channelId), env.sd, fromB64(env.iv), fromB64(env.ct), fromB64(env.cm), publicKeyBytes(env.epk));
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().digest("SHA-256", data));
}

/** SHA-256(K ‖ ct): binds the one key that opens `ct` (AES-GCM alone is not key-committing). */
export async function computeCommitment(key: Uint8Array, ct: Uint8Array): Promise<Bytes> {
  return sha256(concat(key, ct));
}

async function aesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const k = new Uint8Array(raw.byteLength);
  k.set(raw);
  return subtle().importKey("raw", k, { name: "AES-GCM" }, false, usages);
}

async function wrapKeyFor(sharedSecret: ArrayBuffer, salt: Bytes, recipientId: string, epkRaw: Bytes): Promise<CryptoKey> {
  const ikm = await subtle().importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: frame(LABELS.wrap, recipientId, epkRaw) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─── Shape validation (server + client) ───────────────────────────────────────

const ENVELOPE_KEYS = ["v", "sd", "epk", "iv", "ct", "cm", "sig", "keys"].sort().join(",");

function b64OfSize(value: unknown, bytes: number): value is string {
  return isBase64(value) && b64ByteLength(value) === bytes;
}

/**
 * Strictly validate an envelope's shape and sizes (no cryptography). Throws
 * E2eeFormatError; returns a clean copy with exactly the known fields.
 */
export function validateEnvelope(input: unknown): Envelope {
  const e = input as Record<string, unknown> | null;
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new E2eeFormatError("Envelope must be an object");
  if (Object.keys(e).sort().join(",") !== ENVELOPE_KEYS) throw new E2eeFormatError("Envelope has unexpected fields");
  if (e.v !== E2EE_VERSION) throw new E2eeFormatError("Unsupported envelope version");
  if (!isDeviceId(e.sd)) throw new E2eeFormatError("Bad sender device");
  if (!isPublicKeyB64(e.epk)) throw new E2eeFormatError("Bad ephemeral key");
  if (!b64OfSize(e.iv, GCM_IV_BYTES)) throw new E2eeFormatError("Bad iv");
  if (!isBase64(e.ct)) throw new E2eeFormatError("Bad ciphertext");
  const ctLen = b64ByteLength(e.ct);
  if (ctLen < GCM_TAG_BYTES + 2 || ctLen > LIMITS.maxPayloadBytes + GCM_TAG_BYTES) throw new E2eeFormatError("Ciphertext size out of range");
  if (!b64OfSize(e.cm, SHA256_BYTES)) throw new E2eeFormatError("Bad commitment");
  if (!b64OfSize(e.sig, SIGNATURE_BYTES)) throw new E2eeFormatError("Bad signature");
  if (!Array.isArray(e.keys) || e.keys.length === 0 || e.keys.length > LIMITS.maxRecipients) {
    throw new E2eeFormatError("Bad recipient list");
  }
  const seen = new Set<string>();
  const keys: EnvelopeKey[] = e.keys.map((raw) => {
    const k = raw as Record<string, unknown> | null;
    if (!k || typeof k !== "object" || Array.isArray(k) || Object.keys(k).sort().join(",") !== "iv,k,r") {
      throw new E2eeFormatError("Bad recipient entry");
    }
    if (typeof k.r !== "string" || !RECIPIENT_RE.test(k.r)) throw new E2eeFormatError("Bad recipient id");
    const r = k.r.startsWith("backup:") ? lower(k.r) : k.r;
    if (seen.has(r)) throw new E2eeFormatError("Duplicate recipient");
    seen.add(r);
    if (!b64OfSize(k.iv, GCM_IV_BYTES)) throw new E2eeFormatError("Bad wrap iv");
    if (!b64OfSize(k.k, WRAPPED_KEY_BYTES)) throw new E2eeFormatError("Bad wrapped key");
    return { r, iv: k.iv, k: k.k };
  });
  const env: Envelope = {
    v: E2EE_VERSION,
    sd: e.sd,
    epk: e.epk,
    iv: e.iv,
    ct: e.ct,
    cm: e.cm,
    sig: e.sig,
    keys,
  };
  if (utf8(JSON.stringify(env)).byteLength > LIMITS.maxEnvelopeJsonBytes) throw new E2eeFormatError("Envelope too large");
  return env;
}

/** Non-throwing variant of validateEnvelope. */
export function parseEnvelope(input: unknown): Envelope | null {
  try {
    return validateEnvelope(input);
  } catch {
    return null;
  }
}

// ─── Encrypt ──────────────────────────────────────────────────────────────────

export interface EncryptedMessage {
  envelope: Envelope;
  /** The message key K (kept by the sender only for its own cache). */
  key: Bytes;
}

/**
 * Encrypt `payload` for `recipients`, signed by the sender device. Throws
 * E2eeFormatError on bad input (sizes, ids, keys).
 */
export async function encryptMessage(opts: {
  payload: MessagePayload;
  context: MessageContext;
  recipients: WrapRecipient[];
  signKey: CryptoKey;
}): Promise<EncryptedMessage> {
  const payload = validatePayload(opts.payload);
  const plaintext = utf8(JSON.stringify(payload));
  if (plaintext.byteLength > LIMITS.maxPayloadBytes) throw new E2eeFormatError("Message is too large to encrypt");
  const unique = new Map<string, WrapRecipient>();
  for (const r of opts.recipients) {
    const id = r.id.startsWith("backup:") ? lower(r.id) : r.id;
    if (!RECIPIENT_RE.test(id)) throw new E2eeFormatError("Bad recipient id");
    if (!unique.has(id)) unique.set(id, { id, pub: r.pub });
  }
  if (unique.size === 0) throw new E2eeFormatError("No recipients");
  if (unique.size > LIMITS.maxRecipients) throw new E2eeFormatError("Too many recipients");

  const aad = messageAad(opts.context);
  const key = randomBytes(AES_KEY_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const contentKey = await aesKey(key, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad }, contentKey, plaintext));

  const eph = await generateEphemeralKeyPair();
  const epk = await exportPublicKey(eph.publicKey);
  const epkRaw = publicKeyBytes(epk);

  const keys: EnvelopeKey[] = await Promise.all(
    [...unique.values()].map(async (r) => {
      const pub = await importRecipientPublicKey(r.pub);
      const shared = await subtle().deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
      const wrapKey = await wrapKeyFor(shared, iv, r.id, epkRaw);
      const wrapIv = randomBytes(GCM_IV_BYTES);
      const wrapped = new Uint8Array(
        await subtle().encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: frame(LABELS.wrap, r.id) }, wrapKey, key),
      );
      return { r: r.id, iv: toB64(wrapIv), k: toB64(wrapped) };
    }),
  );

  const cm = await computeCommitment(key, ct);
  const partial = { sd: opts.context.senderDeviceId, iv: toB64(iv), ct: toB64(ct), cm: toB64(cm), epk };
  const sig = await signBytes(opts.signKey, signaturePayload(opts.context.channelId, partial));
  const envelope: Envelope = { v: E2EE_VERSION, ...partial, sig: toB64(sig), keys };
  return { envelope: validateEnvelope(envelope), key };
}

// ─── Decrypt ──────────────────────────────────────────────────────────────────

export interface OpenedMessage {
  payload: MessagePayload;
  /** Exact plaintext JSON (what a franking report discloses). */
  payloadText: string;
  key: Bytes;
}

/** Recover K from the entry addressed to `recipient`. */
export async function unwrapMessageKey(
  envelope: Envelope,
  recipient: { id: string; privateKey: CryptoKey },
): Promise<Bytes> {
  const id = recipient.id.startsWith("backup:") ? lower(recipient.id) : recipient.id;
  const entry = envelope.keys.find((k) => k.r === id);
  if (!entry) throw new E2eeVerifyError("no_key", "This message wasn't encrypted for this device");
  try {
    const epk = await importEcdhPublicKey(envelope.epk);
    const shared = await subtle().deriveBits({ name: "ECDH", public: epk }, recipient.privateKey, 256);
    const wrapKey = await wrapKeyFor(shared, fromB64(envelope.iv), id, publicKeyBytes(envelope.epk));
    const key = new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv: fromB64(entry.iv), additionalData: frame(LABELS.wrap, id) }, wrapKey, fromB64(entry.k)),
    );
    if (key.byteLength !== AES_KEY_BYTES) throw new Error("bad key size");
    return key;
  } catch {
    throw new E2eeVerifyError("unwrap", "The message key couldn't be unwrapped");
  }
}

/**
 * Decrypt with a known message key K: checks the commitment, then the AEAD
 * (bound to channel, sender user and sender device) and the payload shape.
 */
export async function decryptWithKey(envelope: Envelope, context: MessageContext, key: Uint8Array): Promise<OpenedMessage> {
  if (context.senderDeviceId !== envelope.sd) throw new E2eeVerifyError("context", "Sender device mismatch");
  if (key.byteLength !== AES_KEY_BYTES) throw new E2eeVerifyError("key", "Bad message key");
  const ct = fromB64(envelope.ct);
  const cm = await computeCommitment(key, ct);
  if (!equalBytes(cm, fromB64(envelope.cm))) throw new E2eeVerifyError("commitment", "The message commitment doesn't match");
  let plaintext: Bytes;
  try {
    const contentKey = await aesKey(key, ["decrypt"]);
    plaintext = new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv: fromB64(envelope.iv), additionalData: messageAad(context) }, contentKey, ct),
    );
  } catch {
    throw new E2eeVerifyError("decrypt", "The message couldn't be decrypted");
  }
  let payloadText: string;
  let payload: MessagePayload;
  try {
    payloadText = fromUtf8(plaintext);
    payload = validatePayload(JSON.parse(payloadText));
  } catch {
    throw new E2eeVerifyError("payload", "The decrypted message is malformed");
  }
  const k = new Uint8Array(key.byteLength);
  k.set(key);
  return { payload, payloadText, key: k };
}

/** Unwrap + decrypt for one of our keys (device or backup). Signature is checked separately. */
export async function openEnvelope(
  envelope: Envelope,
  context: MessageContext,
  recipient: { id: string; privateKey: CryptoKey },
): Promise<OpenedMessage> {
  const key = await unwrapMessageKey(envelope, recipient);
  return decryptWithKey(envelope, context, key);
}

/** Verify the sender device signature (false on any malformed input). */
export async function verifyEnvelopeSignature(envelope: Envelope, channelId: string, senderSignPub: string): Promise<boolean> {
  try {
    return await verifyBytes(senderSignPub, fromB64(envelope.sig), signaturePayload(channelId, envelope));
  } catch {
    return false;
  }
}
