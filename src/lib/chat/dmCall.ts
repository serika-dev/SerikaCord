// A DM call's voice room id is derived from both user ids (sorted), so the
// caller and the callee always land in the same room no matter who dials.
const DM_CALL_ROOM = /^dm:([0-9a-f-]{36})_([0-9a-f-]{36})$/i;

export function dmCallRoomId(userA: string, userB: string): string {
  return `dm:${[userA.toLowerCase(), userB.toLowerCase()].sort().join("_")}`;
}

/** The two user ids of a DM call room, or null if `roomId` isn't one. */
export function dmCallPeers(roomId: string): [string, string] | null {
  const m = DM_CALL_ROOM.exec(roomId);
  return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
}

// ── Client-side call event bus ──────────────────────────────────────────────
// The activity stream (UnreadContext) forwards ring/cancel events here; the
// incoming-call UI listens.

export type CallRing = {
  roomId: string;
  video: boolean;
  caller: { id: string; username: string; displayName: string; avatar: string | null };
};

export type CallEvent =
  | ({ type: "call_ring" } & CallRing)
  | { type: "call_cancel"; roomId: string; reason: "answered" | "declined" | "ended" };

const CALL_EVENT = "serika:call";

export function emitCallEvent(event: CallEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CallEvent>(CALL_EVENT, { detail: event }));
}

export function onCallEvent(handler: (event: CallEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<CallEvent>).detail);
  window.addEventListener(CALL_EVENT, listener);
  return () => window.removeEventListener(CALL_EVENT, listener);
}
