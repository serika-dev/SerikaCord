// Limits on the WebRTC signals relayed through /api/voice/signal/* (SDP offers
// and answers, ICE candidates, simple-peer renegotiate / transceiver requests).
// The server relays them as-is to the other peer, so an unbounded payload let a
// modified client push megabytes into everyone's signalling stream. Pure.

/** Largest signal relayed, as JSON. Real SDP is a few KB; video + screen share stays well under 20 KB. */
export const MAX_SIGNAL_BYTES = 64 * 1024;
/** Largest request body accepted by a signal route (the signal plus targetUserId / pcId). */
export const MAX_SIGNAL_REQUEST_BYTES = MAX_SIGNAL_BYTES + 1024;

/**
 * Why a signal payload is refused, or null when it may be relayed. A signal
 * is always a JSON object (simple-peer's `{ type, sdp }`, `{ candidate }`,
 * `{ renegotiate }`, `{ transceiverRequest }`).
 */
export function signalPayloadProblem(value: unknown, maxBytes: number = MAX_SIGNAL_BYTES): "invalid" | "too_large" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "invalid";
  }
  // UTF-16 length is a lower bound on UTF-8 bytes; SDP is ASCII anyway.
  if (json.length > maxBytes) return "too_large";
  return null;
}

/** A declared Content-Length above the limit (missing or malformed: not decided here). */
export function contentLengthTooLarge(header: string | null | undefined, maxBytes: number = MAX_SIGNAL_REQUEST_BYTES): boolean {
  if (!header) return false;
  const n = Number(header);
  return Number.isFinite(n) && n > maxBytes;
}
