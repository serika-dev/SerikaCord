// Client-side owner of the DM call lifecycle (Discord-style), for 1:1 calls
// and group DM calls: who we're calling, ringing/connected/ended, the outgoing
// ringback tone, the no-answer timeout, and (1:1 only) hanging up when the
// other person leaves. The media itself is voiceService; the transitions are
// the pure reducer in lib/voice/callState.
//
// Every DM call entry point goes through here: the DM header buttons, the
// "Call" items in user menus (?call=), group DM calls, and answering an
// incoming call.
import { voiceService } from "./voiceService";
import { startRingtone, stopRingtone } from "./ringtone";
import { dmCallRoomId, dmCallPeers, isGroupCallRoom, type CallGroup } from "@/lib/chat/dmCall";
import { groupCallRoomId } from "@/lib/voice/rooms";
import {
  callReducer,
  IDLE,
  RING_TIMEOUT_MS,
  shouldPlayRingback,
  type CallAction,
  type CallEndReason,
  type CallState,
} from "@/lib/voice/callState";

export type CallPeer = { id: string; name?: string; avatar?: string | null };

export type CallSnapshot = { state: CallState; peer: CallPeer | null; group?: CallGroup | null };

/** A call just ended; the UI decides whether that deserves a toast. */
export type CallNotice = { roomId: string; peer: CallPeer | null; reason: CallEndReason; group?: CallGroup | null };

let snapshot: CallSnapshot = { state: IDLE, peer: null };
const listeners = new Set<() => void>();
const noticeListeners = new Set<(notice: CallNotice) => void>();
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeVoice: (() => void) | null = null;

function publish(next: CallSnapshot) {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function clearRingTimer() {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
}

function dispatch(action: CallAction) {
  const prev = snapshot.state;
  const next = callReducer(prev, action);
  if (next === prev) return;

  // Ringback: only while we're the caller and nobody has picked up.
  const ringing = shouldPlayRingback(next);
  if (ringing && !shouldPlayRingback(prev)) void startRingtone("outgoing");
  if (!ringing && shouldPlayRingback(prev)) stopRingtone(false, "outgoing");
  if (next.phase !== "ringing") clearRingTimer();

  if (next.phase === "ended") {
    const peer = snapshot.peer;
    const group = snapshot.group ?? null;
    const roomId = next.roomId;
    // Back to idle before anything else reacts, so a new call can start from
    // inside a notice handler.
    publish({ state: IDLE, peer: null });
    if (voiceService.currentRoomId === roomId || voiceService.joiningRoomId === roomId) {
      void voiceService.leaveChannel();
    }
    const notice: CallNotice = { roomId, peer, reason: next.endReason ?? "hangup", group };
    noticeListeners.forEach((fn) => fn(notice));
    return;
  }
  publish({ state: next, peer: snapshot.peer, group: snapshot.group });
}

function otherParticipantIds(): string[] {
  const me = voiceService.myId.toLowerCase();
  return voiceService.currentParticipants.map((p) => p.userId).filter((id) => id.toLowerCase() !== me);
}

function ensureVoiceSubscription() {
  if (unsubscribeVoice || typeof window === "undefined") return;
  unsubscribeVoice = voiceService.subscribe((event) => {
    const state = snapshot.state;
    if (state.phase === "idle" || state.phase === "ended") return;
    switch (event.type) {
      case "participants_changed":
        if (voiceService.connected && voiceService.currentRoomId === state.roomId) {
          dispatch({ type: "participants", roomId: state.roomId, others: otherParticipantIds(), now: Date.now() });
        }
        break;
      case "call_declined":
        dispatch({ type: "declined", roomId: state.roomId });
        break;
      case "disconnected": {
        // Leaving a previous room to switch into this call isn't the end of it.
        if (voiceService.joiningRoomId === state.roomId) break;
        // Never got in (mic blocked, join refused): the error toast says why.
        const failed = state.phase === "ringing" && state.connectedAt === null && !voiceService.connected;
        dispatch({ type: "disconnected", failed });
        break;
      }
    }
  });
}

function begin(roomId: string, peer: CallPeer, direction: "outgoing" | "incoming", group: CallGroup | null = null) {
  ensureVoiceSubscription();
  clearRingTimer();
  // Starting a new call silently replaces whatever was being tracked.
  stopRingtone(false, "outgoing");
  snapshot = { state: IDLE, peer: null };
  const state = callReducer(IDLE, { type: "start", roomId, peerId: peer.id, direction, now: Date.now(), group: !!group });
  publish({ state, peer, group });
  if (direction === "outgoing") void startRingtone("outgoing");
  ringTimer = setTimeout(() => {
    ringTimer = null;
    dispatch({ type: "tick", now: Date.now() });
  }, RING_TIMEOUT_MS + 50);
}

function roomMeta(peer: CallPeer) {
  return { label: peer.name, href: `/dm/${peer.id}` };
}

// Group DMs have no conversation page yet, so the voice bar only names them.
function groupRoomMeta(group: CallGroup) {
  return { label: group.name };
}

/** Is this DM call already up (or being set up) on this tab? */
export function isInDmCall(roomId: string): boolean {
  const s = snapshot.state;
  return (s.phase !== "idle" && s.phase !== "ended" && s.roomId === roomId)
    || voiceService.currentRoomId === roomId;
}

/** Call someone from their DM (or a "Call" menu item). */
export function startDmCall(opts: { myId: string; peer: CallPeer; video?: boolean }): Promise<void> {
  const roomId = dmCallRoomId(opts.myId, opts.peer.id);
  if (isInDmCall(roomId)) {
    if (opts.peer.name) voiceService.setRoomMeta(roomId, roomMeta(opts.peer));
    // Asked for video while already in the voice call: turn the camera on.
    if (opts.video && voiceService.connected && !voiceService.videoOn) void voiceService.toggleVideo();
    return Promise.resolve();
  }
  begin(roomId, opts.peer, "outgoing");
  return voiceService.joinChannel(roomId, !!opts.video, roomMeta(opts.peer));
}

/**
 * Start (or join) a group DM's call. Everyone else in the group is rung; the
 * call goes on until the last person leaves.
 */
export function startGroupCall(opts: { group: CallGroup; video?: boolean }): Promise<void> {
  const roomId = groupCallRoomId(opts.group.channelId);
  if (isInDmCall(roomId)) {
    voiceService.setRoomMeta(roomId, groupRoomMeta(opts.group));
    if (opts.video && voiceService.connected && !voiceService.videoOn) void voiceService.toggleVideo();
    return Promise.resolve();
  }
  begin(roomId, { id: opts.group.channelId, name: opts.group.name, avatar: opts.group.icon }, "outgoing", opts.group);
  return voiceService.joinChannel(roomId, !!opts.video, groupRoomMeta(opts.group));
}

/** Pick up an incoming call (1:1 or group). */
export function answerDmCall(opts: { roomId: string; caller: CallPeer; group?: CallGroup | null; video?: boolean }): Promise<void> {
  const group = isGroupCallRoom(opts.roomId) ? opts.group ?? null : null;
  if (!dmCallPeers(opts.roomId) && !group) return Promise.resolve();
  if (isInDmCall(opts.roomId)) return Promise.resolve();
  begin(opts.roomId, opts.caller, "incoming", group);
  return voiceService.joinChannel(opts.roomId, !!opts.video, group ? groupRoomMeta(group) : roomMeta(opts.caller));
}

/** Hang up the current call (whatever kind of room it is). */
export function hangUp(): Promise<void> {
  if (snapshot.state.phase !== "idle") dispatch({ type: "hangup" });
  return voiceService.leaveChannel();
}

/** Fill in the peer's name/avatar once their profile has loaded. */
export function updateCallPeer(roomId: string, peer: CallPeer) {
  const s = snapshot.state;
  if (s.phase !== "idle" && s.roomId === roomId && snapshot.peer?.id.toLowerCase() === peer.id.toLowerCase()) {
    const merged = { ...snapshot.peer, ...peer };
    if (merged.name !== snapshot.peer.name || merged.avatar !== snapshot.peer.avatar) {
      publish({ state: s, peer: merged, group: snapshot.group });
    }
  }
  if (peer.name) voiceService.setRoomMeta(roomId, roomMeta(peer));
}

export function subscribeCall(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getCallSnapshot(): CallSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: CallSnapshot = { state: IDLE, peer: null };
export function getServerCallSnapshot(): CallSnapshot {
  return SERVER_SNAPSHOT;
}

export function onCallNotice(fn: (notice: CallNotice) => void): () => void {
  noticeListeners.add(fn);
  return () => { noticeListeners.delete(fn); };
}
