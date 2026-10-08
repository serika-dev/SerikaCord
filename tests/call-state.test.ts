import { describe, expect, test } from "bun:test";
import {
  callReducer,
  formatCallDuration,
  IDLE,
  isPolitePeer,
  peerRetryDelayMs,
  RING_TIMEOUT_MS,
  ringAllowed,
  shouldPlayRingback,
  signalRetryDelayMs,
  type CallState,
} from "@/lib/voice/callState";
import { dmCallPeers, dmCallRoomId } from "@/lib/chat/dmCall";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ROOM = dmCallRoomId(A, B);

function outgoing(now = 1000): CallState {
  return callReducer(IDLE, { type: "start", roomId: ROOM, peerId: B, direction: "outgoing", now });
}

describe("dmCallRoomId", () => {
  test("is the same no matter who dials", () => {
    expect(dmCallRoomId(A, B)).toBe(dmCallRoomId(B, A));
    expect(dmCallRoomId(A.toUpperCase(), B)).toBe(dmCallRoomId(A, B));
    expect(dmCallPeers(ROOM)).toEqual([A, B]);
    expect(dmCallPeers(`channel-${A}`)).toBeNull();
  });
});

describe("callReducer", () => {
  test("start rings and plays the ringback for the caller only", () => {
    const s = outgoing();
    expect(s.phase).toBe("ringing");
    expect(shouldPlayRingback(s)).toBeTrue();
    const incoming = callReducer(IDLE, { type: "start", roomId: ROOM, peerId: A, direction: "incoming", now: 0 });
    expect(shouldPlayRingback(incoming)).toBeFalse();
    expect(shouldPlayRingback(IDLE)).toBeFalse();
  });

  test("the other person joining connects the call and starts the timer", () => {
    const s = callReducer(outgoing(), { type: "participants", roomId: ROOM, others: [B.toUpperCase()], now: 5000 });
    expect(s.phase).toBe("connected");
    expect(s.phase !== "idle" && s.connectedAt).toBe(5000);
    expect(shouldPlayRingback(s)).toBeFalse();
  });

  test("someone else's membership doesn't connect a 1:1 call", () => {
    const s = callReducer(outgoing(), { type: "participants", roomId: ROOM, others: [C], now: 5000 });
    expect(s.phase).toBe("ringing");
  });

  test("events for another room are ignored", () => {
    const s0 = outgoing();
    expect(callReducer(s0, { type: "participants", roomId: dmCallRoomId(A, C), others: [B], now: 1 })).toBe(s0);
    expect(callReducer(s0, { type: "declined", roomId: dmCallRoomId(A, C) })).toBe(s0);
  });

  test("the other person leaving ends a connected call", () => {
    let s = callReducer(outgoing(), { type: "participants", roomId: ROOM, others: [B], now: 2000 });
    s = callReducer(s, { type: "participants", roomId: ROOM, others: [], now: 9000 });
    expect(s.phase).toBe("ended");
    expect(s.phase !== "idle" && s.endReason).toBe("peer-left");
  });

  test("an empty room while still ringing is not 'peer left'", () => {
    const s = callReducer(outgoing(), { type: "participants", roomId: ROOM, others: [], now: 2000 });
    expect(s.phase).toBe("ringing");
  });

  test("declined only ends a call that is still ringing", () => {
    const declined = callReducer(outgoing(), { type: "declined", roomId: ROOM });
    expect(declined.phase !== "idle" && declined.endReason).toBe("declined");
    const connected = callReducer(outgoing(), { type: "participants", roomId: ROOM, others: [B], now: 2000 });
    expect(callReducer(connected, { type: "declined", roomId: ROOM })).toBe(connected);
  });

  test("no answer after the ring timeout", () => {
    const s0 = outgoing(1000);
    expect(callReducer(s0, { type: "tick", now: 1000 + RING_TIMEOUT_MS - 1 })).toBe(s0);
    const s = callReducer(s0, { type: "tick", now: 1000 + RING_TIMEOUT_MS });
    expect(s.phase !== "idle" && s.endReason).toBe("no-answer");
    // A connected call never times out.
    const c = callReducer(s0, { type: "participants", roomId: ROOM, others: [B], now: 2000 });
    expect(callReducer(c, { type: "tick", now: 10 * RING_TIMEOUT_MS }).phase).toBe("connected");
  });

  test("hang up and disconnect end the call; ended is terminal until reset", () => {
    const hung = callReducer(outgoing(), { type: "hangup" });
    expect(hung.phase !== "idle" && hung.endReason).toBe("hangup");
    const failed = callReducer(outgoing(), { type: "disconnected", failed: true });
    expect(failed.phase !== "idle" && failed.endReason).toBe("failed");
    expect(callReducer(hung, { type: "participants", roomId: ROOM, others: [B], now: 1 })).toBe(hung);
    expect(callReducer(hung, { type: "reset" })).toBe(IDLE);
  });

  test("idle ignores everything but start", () => {
    expect(callReducer(IDLE, { type: "hangup" })).toBe(IDLE);
    expect(callReducer(IDLE, { type: "tick", now: 1e12 })).toBe(IDLE);
  });
});

describe("formatCallDuration", () => {
  test("m:ss under an hour, h:mm:ss after", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(-5000)).toBe("0:00");
    expect(formatCallDuration(7_900)).toBe("0:07");
    expect(formatCallDuration(754_000)).toBe("12:34");
    expect(formatCallDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("ringAllowed", () => {
  test("sound toggle silences both rings; DND only the incoming one", () => {
    expect(ringAllowed("incoming", { soundEnabled: true, dnd: false })).toBeTrue();
    expect(ringAllowed("incoming", { soundEnabled: true, dnd: true })).toBeFalse();
    expect(ringAllowed("outgoing", { soundEnabled: true, dnd: true })).toBeTrue();
    expect(ringAllowed("outgoing", { soundEnabled: false, dnd: false })).toBeFalse();
    expect(ringAllowed("incoming", { soundEnabled: false, dnd: false })).toBeFalse();
  });
});

describe("glare + retry", () => {
  test("exactly one side of a pair is polite", () => {
    expect(isPolitePeer(A, B)).not.toBe(isPolitePeer(B, A));
    expect(isPolitePeer(B, A)).toBeTrue();
    expect(isPolitePeer(B.toUpperCase(), A)).toBeTrue();
  });

  test("the impolite side retries first, with capped backoff", () => {
    expect(peerRetryDelayMs(A, B, 0)).toBeLessThan(peerRetryDelayMs(B, A, 0));
    expect(peerRetryDelayMs(A, B, 1)).toBeGreaterThan(peerRetryDelayMs(A, B, 0));
    expect(peerRetryDelayMs(A, B, 50)).toBe(30_000);
    expect(signalRetryDelayMs(0)).toBe(1000);
    expect(signalRetryDelayMs(3)).toBe(8000);
    expect(signalRetryDelayMs(99)).toBe(15_000);
  });
});
