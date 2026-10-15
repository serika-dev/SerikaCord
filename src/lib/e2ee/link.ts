// Device linking without the recovery passphrase (docs/architecture/e2ee.md,
// "Linking a device"). A new device (N) and one of the account's existing
// devices (E) run an ephemeral ECDH P-256 exchange through a short-lived
// server relay, compare a 6-digit short authentication string (SAS), and E
// then sends the identity + backup private keys (what a passphrase restore
// would give) encrypted to the shared key.
//
// The server relays everything, so it could try to sit in the middle. Two
// things stop it: N commits to its public key (SHA-256) before E reveals its
// own, and N reveals its key only after it has E's — so a man in the middle
// has to fix both of its keys before it knows the other side's, and its two
// SAS values match by chance only (1 in 10^6 per attempt). Both devices show
// the SAS; the user confirms on both before anything secret moves or is
// accepted.
//
// Isomorphic (WebCrypto only); unit-tested in tests/e2ee.test.ts.
import { E2EE_VERSION, GCM_IV_BYTES, PUBLIC_KEY_BYTES, UUID_RE } from "./constants";
import {
  E2eeFormatError,
  E2eeVerifyError,
  b64ByteLength,
  frame,
  fromB64,
  fromUtf8,
  isBase64,
  randomBytes,
  toB64,
  utf8,
  type Bytes,
} from "./encoding";
import { importEcdhPublicKey, publicKeyBytes, publicKeyFromJwk } from "./keys";
import type { BackupSecrets } from "./backup";

export const LINK_LABELS = {
  commit: "serika-e2ee-link-commit-v1",
  transcript: "serika-e2ee-link-transcript-v1",
  sas: "serika-e2ee-link-sas-v1",
  key: "serika-e2ee-link-key-v1",
  payload: "serika-e2ee-link-payload-v1",
} as const;

/** How long a link session lives on the server. */
export const LINK_TTL_SECONDS = 300;
/** Digits of the short authentication string both devices show. */
export const LINK_SAS_DIGITS = 6;
/** Sealed payload ceiling (two P-256 JWKs + framing, base64). */
export const LINK_MAX_PAYLOAD_B64 = 4096;

// ─── Codes ────────────────────────────────────────────────────────────────────
// 10 characters of Crockford base32 (50 random bits). The code only names a
// session of the signed-in account (the server binds it to the user), so it
// isn't a secret; it just has to be easy to type.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function newLinkCode(): string {
  // 5 bits of each random byte (32 divides 256, so every character is uniform).
  let out = "";
  for (const b of randomBytes(10)) out += CROCKFORD[b & 31];
  return out;
}

/** Normalise a typed code (case, spaces, dashes, look-alikes); null when it can't be one. */
export function normalizeLinkCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return LINK_CODE_RE.test(cleaned) ? cleaned : null;
}

/** "ABCDE-FGHJK" */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// ─── QR payload ───────────────────────────────────────────────────────────────
// `<origin>/e2ee/link#<code>.<new device public key, base64url>`: a phone's own
// camera opens the approve page; the key in the fragment (never sent to a
// server) also lets the scanning device check N's commitment directly.

function toB64UrlStr(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64UrlStr(s: string): string {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return std + "=".repeat((4 - (std.length % 4)) % 4);
}

export function linkQrPayload(origin: string, code: string, newPub: string): string {
  return `${origin.replace(/\/+$/, "")}/e2ee/link#${code}.${toB64UrlStr(newPub)}`;
}

/** Code (+ the new device's key when present) from a scanned QR / pasted link / typed code. */
export function parseLinkInput(raw: unknown): { code: string; newPub: string | null } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : text;
  const [codePart, keyPart] = hash.split(".");
  const code = normalizeLinkCode(codePart);
  if (!code) return null;
  if (!keyPart) return { code, newPub: null };
  const pub = fromB64UrlStr(keyPart);
  try {
    publicKeyBytes(pub);
  } catch {
    return null;
  }
  return { code, newPub: pub };
}

// ─── Commitment, transcript, SAS, transfer key ────────────────────────────────

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

/** The new device's commitment to its public key (sent first, opened later). */
export async function linkCommitment(newPub: string): Promise<string> {
  return toB64(await sha256(frame(LINK_LABELS.commit, publicKeyBytes(newPub))));
}

export function isLinkCommitment(value: unknown): value is string {
  return isBase64(value) && b64ByteLength(value) === 32;
}

export interface LinkTranscript {
  userId: string;
  code: string;
  commit: string;
  /** The new device's ephemeral public key. */
  newPub: string;
  /** The existing device's ephemeral public key. */
  oldPub: string;
}

export function linkTranscriptBytes(t: LinkTranscript): Bytes {
  if (!UUID_RE.test(t.userId)) throw new E2eeFormatError("Bad user id");
  if (!LINK_CODE_RE.test(t.code)) throw new E2eeFormatError("Bad link code");
  if (!isLinkCommitment(t.commit)) throw new E2eeFormatError("Bad commitment");
  return frame(LINK_LABELS.transcript, t.userId.toLowerCase(), t.code, fromB64(t.commit), publicKeyBytes(t.newPub), publicKeyBytes(t.oldPub));
}

/** 6 decimal digits from 5 bytes (40-bit integer mod 10^6: bias < 10^-6). */
export function sasDigits(bytes: Uint8Array): string {
  if (bytes.byteLength < 5) throw new E2eeFormatError("Not enough SAS bytes");
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + bytes[i];
  return String(n % 10 ** LINK_SAS_DIGITS).padStart(LINK_SAS_DIGITS, "0");
}

/** "123 456" */
export function formatSas(sas: string): string {
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}

export interface LinkSecrets {
  /** What both devices show and the user compares. */
  sas: string;
  /** AES-256-GCM key the existing device seals the key material with. */
  key: CryptoKey;
}

/**
 * Both sides: ECDH(own ephemeral private, other's public) → HKDF-SHA-256 with
 * the whole transcript (user, code, commitment, both keys) as info, once for
 * the SAS and once for the transfer key.
 */
export async function deriveLinkSecrets(myPrivate: CryptoKey, theirPub: string, transcript: LinkTranscript): Promise<LinkSecrets> {
  const subtle = globalThis.crypto.subtle;
  const info = linkTranscriptBytes(transcript);
  const peer = await importEcdhPublicKey(theirPub);
  const shared = await subtle.deriveBits({ name: "ECDH", public: peer }, myPrivate, 256);
  const ikm = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits", "deriveKey"]);
  const salt = new Uint8Array(32);
  const [sasBits, key] = await Promise.all([
    subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: frame(LINK_LABELS.sas, info) }, ikm, 64),
    subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: frame(LINK_LABELS.key, info) },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
  ]);
  return { sas: sasDigits(new Uint8Array(sasBits)), key };
}

// ─── Sealed key material ──────────────────────────────────────────────────────

export interface LinkPayload {
  iv: string;
  ct: string;
}

function payloadAad(userId: string, code: string): Bytes {
  if (!UUID_RE.test(userId) || !LINK_CODE_RE.test(code)) throw new E2eeFormatError("Bad link context");
  return frame(LINK_LABELS.payload, userId.toLowerCase(), code);
}

export function validateLinkPayload(input: unknown): LinkPayload {
  const p = input as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new E2eeFormatError("Bad link payload");
  if (!isBase64(p.iv) || b64ByteLength(p.iv) !== GCM_IV_BYTES) throw new E2eeFormatError("Bad link payload iv");
  if (!isBase64(p.ct) || p.ct.length > LINK_MAX_PAYLOAD_B64 || b64ByteLength(p.ct) < 32) throw new E2eeFormatError("Bad link payload");
  return { iv: p.iv, ct: p.ct };
}

/** Existing device: seal the identity + backup private keys for the new device. */
export async function sealLinkPayload(key: CryptoKey, userId: string, code: string, secrets: BackupSecrets): Promise<LinkPayload> {
  publicKeyFromJwk(secrets.identity);
  publicKeyFromJwk(secrets.backup);
  const iv = randomBytes(GCM_IV_BYTES);
  const body = utf8(JSON.stringify({ v: E2EE_VERSION, userId: userId.toLowerCase(), identity: secrets.identity, backup: secrets.backup }));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: payloadAad(userId, code) }, key, body));
  return validateLinkPayload({ iv: toB64(iv), ct: toB64(ct) });
}

/** New device: open the sealed key material (throws E2eeVerifyError when it wasn't sealed with our key). */
export async function openLinkPayload(key: CryptoKey, userId: string, code: string, input: unknown): Promise<BackupSecrets> {
  const p = validateLinkPayload(input);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(p.iv), additionalData: payloadAad(userId, code) }, key, fromB64(p.ct)),
    );
  } catch {
    throw new E2eeVerifyError("link_payload", "The keys from the other device couldn't be opened");
  }
  let parsed: { v?: unknown; userId?: unknown; identity?: unknown; backup?: unknown };
  try {
    parsed = JSON.parse(fromUtf8(plain));
  } catch {
    throw new E2eeFormatError("Link payload is malformed");
  }
  if (parsed.v !== E2EE_VERSION || typeof parsed.userId !== "string" || parsed.userId !== userId.toLowerCase()) {
    throw new E2eeFormatError("Link payload is for another account");
  }
  publicKeyFromJwk(parsed.identity);
  publicKeyFromJwk(parsed.backup);
  return { identity: parsed.identity as JsonWebKey, backup: parsed.backup as JsonWebKey };
}

/** A public key in a link request: well-formed raw P-256 point (curve membership is checked on import). */
export function isLinkPublicKey(value: unknown): value is string {
  return isBase64(value) && b64ByteLength(value) === PUBLIC_KEY_BYTES && fromB64(value)[0] === 0x04;
}
