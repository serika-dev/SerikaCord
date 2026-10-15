// Call authentication: in E2EE conversations every SDP offer/answer carries an
// ECDSA signature by the sender device over the DTLS certificate fingerprints
// in that SDP, so the signalling server can't swap certificates and sit in the
// middle of the DTLS-SRTP media.
import { LABELS, SIGNATURE_BYTES, UUID_RE } from "./constants";
import { E2eeFormatError, b64ByteLength, frame, fromB64, isBase64, toB64 } from "./encoding";
import { signBytes, verifyBytes } from "./keys";

const FINGERPRINT_RE = /^a=fingerprint:([A-Za-z0-9-]{1,16})\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){15,63})\s*$/;

/** Normalised, sorted, unique `a=fingerprint` values of an SDP ("sha-256 AB:CD:…"). */
export function extractDtlsFingerprints(sdp: string): string[] {
  if (typeof sdp !== "string") return [];
  const out = new Set<string>();
  for (const line of sdp.split(/\r?\n/)) {
    const m = FINGERPRINT_RE.exec(line.trim());
    if (m) out.add(`${m[1].toLowerCase()} ${m[2].toUpperCase()}`);
  }
  return [...out].sort();
}

function dtlsPayload(roomId: string, userId: string, fingerprints: string[]) {
  if (typeof roomId !== "string" || roomId.length === 0 || roomId.length > 200) throw new E2eeFormatError("Bad room id");
  if (!UUID_RE.test(userId)) throw new E2eeFormatError("Bad user id");
  if (fingerprints.length === 0) throw new E2eeFormatError("No DTLS fingerprint in the SDP");
  return frame(LABELS.dtls, roomId, userId.toLowerCase(), fingerprints.join("\n"));
}

/** Sign the fingerprints of our SDP (throws when the SDP has none). */
export async function signDtlsFingerprints(signKey: CryptoKey, roomId: string, userId: string, sdp: string): Promise<string> {
  return toB64(await signBytes(signKey, dtlsPayload(roomId, userId, extractDtlsFingerprints(sdp))));
}

/** Verify a peer's fingerprint signature against the SDP it came with. */
export async function verifyDtlsFingerprints(signPub: string, signature: unknown, roomId: string, userId: string, sdp: string): Promise<boolean> {
  if (!isBase64(signature) || b64ByteLength(signature) !== SIGNATURE_BYTES) return false;
  try {
    return await verifyBytes(signPub, fromB64(signature), dtlsPayload(roomId, userId, extractDtlsFingerprints(sdp)));
  } catch {
    return false;
  }
}
