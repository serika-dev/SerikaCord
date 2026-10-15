// Message franking: how a recipient proves to Trust & Safety what an encrypted
// message said. The reporter discloses the message key K and the exact
// plaintext; the server (which stored the envelope) checks
//   1. SHA-256(K ‖ ct) equals the stored commitment (K is the one key for ct),
//   2. ct decrypts under K, bound to this channel / sender / sender device,
//      to exactly the disclosed plaintext,
//   3. the sender device signed (channel, iv, ct, commitment, epk).
// A reporter can't forge any of it without the sender's device key.
import { AES_KEY_BYTES, LIMITS } from "./constants";
import { E2eeVerifyError, b64ByteLength, fromB64, isBase64 } from "./encoding";
import {
  decryptWithKey,
  verifyEnvelopeSignature,
  type Envelope,
  type MessageContext,
} from "./envelope";
import type { MessagePayload } from "./payload";

export interface FrankingDisclosure {
  /** Message key K, base64. */
  key: string;
  /** Exact decrypted payload JSON. */
  payload: string;
}

export type FrankingResult =
  | { ok: true; payload: MessagePayload }
  | { ok: false; reason: "format" | "commitment" | "decrypt" | "mismatch" | "signature" };

export function isFrankingDisclosure(value: unknown): value is FrankingDisclosure {
  const v = value as Record<string, unknown> | null;
  return Boolean(
    v &&
      typeof v === "object" &&
      isBase64(v.key) &&
      b64ByteLength(v.key) === AES_KEY_BYTES &&
      typeof v.payload === "string" &&
      v.payload.length > 0 &&
      v.payload.length <= LIMITS.maxPayloadBytes,
  );
}

/**
 * Verify a franking disclosure against a stored envelope. `senderSignPub` is
 * the stored signing key of device `envelope.sd`, which must belong to
 * `context.senderUserId` (the caller looks it up by both).
 */
export async function verifyFranking(
  envelope: Envelope,
  context: MessageContext,
  senderSignPub: string,
  disclosure: unknown,
): Promise<FrankingResult> {
  if (!isFrankingDisclosure(disclosure)) return { ok: false, reason: "format" };
  let opened;
  try {
    opened = await decryptWithKey(envelope, context, fromB64(disclosure.key));
  } catch (err) {
    const code = err instanceof E2eeVerifyError ? err.code : "decrypt";
    return { ok: false, reason: code === "commitment" ? "commitment" : code === "context" ? "format" : "decrypt" };
  }
  if (opened.payloadText !== disclosure.payload) return { ok: false, reason: "mismatch" };
  if (!(await verifyEnvelopeSignature(envelope, context.channelId, senderSignPub))) return { ok: false, reason: "signature" };
  return { ok: true, payload: opened.payload };
}
