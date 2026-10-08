// 1:1 DM call lifecycle. Pure: driven by the client call controller
// (src/lib/services/dmCallController.ts) and covered by unit tests.
//
//   idle ──start──▶ ringing ──peer joins──▶ connected ──peer leaves──▶ ended
//                     │  └─ declined / no answer (timeout) ─────────▶ ended
//                     └─ hang up / disconnected ─────────────────────▶ ended
//
// "ringing" covers both sides: the caller waiting for an answer (outgoing,
// plays the ringback tone) and the callee who just answered and is waiting for
// the caller's media (incoming, normally a split second).

/** How long an unanswered call rings before it counts as missed. */
export const RING_TIMEOUT_MS = 40_000;

export type CallDirection = "outgoing" | "incoming";
export type CallEndReason = "hangup" | "declined" | "no-answer" | "peer-left" | "failed";

export type CallState =
  | { phase: "idle" }
  | {
      phase: "ringing" | "connected" | "ended";
      roomId: string;
      peerId: string;
      direction: CallDirection;
      startedAt: number;
      /** When the other person first joined (null until then). */
      connectedAt: number | null;
      endReason?: CallEndReason;
    };

export type CallAction =
  | { type: "start"; roomId: string; peerId: string; direction: CallDirection; now: number }
  /** The current room membership, other than me. */
  | { type: "participants"; roomId: string; others: string[]; now: number }
  | { type: "declined"; roomId: string }
  | { type: "tick"; now: number }
  | { type: "hangup" }
  | { type: "disconnected"; failed?: boolean }
  | { type: "reset" };

export const IDLE: CallState = { phase: "idle" };

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "start":
      return {
        phase: "ringing",
        roomId: action.roomId,
        peerId: action.peerId.toLowerCase(),
        direction: action.direction,
        startedAt: action.now,
        connectedAt: null,
      };
    case "reset":
      return IDLE;
  }
  if (state.phase === "idle" || state.phase === "ended") return state;

  switch (action.type) {
    case "participants": {
      if (action.roomId !== state.roomId) return state;
      const peerHere = action.others.some((id) => sameId(id, state.peerId));
      if (peerHere && state.phase === "ringing") {
        return { ...state, phase: "connected", connectedAt: action.now };
      }
      // The other person left a 1:1 call: it's over for both sides.
      if (!peerHere && state.phase === "connected") {
        return { ...state, phase: "ended", endReason: "peer-left" };
      }
      return state;
    }
    case "declined":
      if (action.roomId !== state.roomId || state.phase !== "ringing") return state;
      return { ...state, phase: "ended", endReason: "declined" };
    case "tick":
      if (state.phase === "ringing" && action.now - state.startedAt >= RING_TIMEOUT_MS) {
        return { ...state, phase: "ended", endReason: "no-answer" };
      }
      return state;
    case "hangup":
      return { ...state, phase: "ended", endReason: "hangup" };
    case "disconnected":
      return { ...state, phase: "ended", endReason: action.failed ? "failed" : "hangup" };
  }
  return state;
}

export type RingKind = "incoming" | "outgoing";

/**
 * Whether a ring should be audible: the notification sound toggle silences
 * both; Do Not Disturb only silences incoming calls (your own ringback isn't a
 * notification).
 */
export function ringAllowed(kind: RingKind, settings: { soundEnabled: boolean; dnd: boolean }): boolean {
  if (!settings.soundEnabled) return false;
  return kind === "outgoing" || !settings.dnd;
}

/** Whether the caller should hear the outgoing ringback tone. */
export function shouldPlayRingback(state: CallState): boolean {
  return state.phase === "ringing" && state.direction === "outgoing";
}

/** "0:07", "12:34", "1:02:03" — the in-call timer. */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ── WebRTC glare ────────────────────────────────────────────────────────────
// When both sides create an offer at once (two people joining together, or both
// retrying after a dropped connection), exactly one must give way. The side
// with the larger user id is "polite": it drops its own offer and answers the
// other one; the smaller id keeps its offer and ignores the incoming one.
export function isPolitePeer(myId: string, otherId: string): boolean {
  return myId.toLowerCase() > otherId.toLowerCase();
}

/**
 * How long to wait before re-offering after a peer connection failed while
 * both users are still in the room. The impolite side retries first; the
 * polite side only retries if nothing arrived in the meantime.
 */
export function peerRetryDelayMs(myId: string, otherId: string, attempt: number): number {
  const base = isPolitePeer(myId, otherId) ? 4000 : 1200;
  return Math.min(base * 2 ** Math.max(0, attempt), 30_000);
}

/** Backoff for re-joining the room after the signaling stream drops. */
export function signalRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 15_000);
}
