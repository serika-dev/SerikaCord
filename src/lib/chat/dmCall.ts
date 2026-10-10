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

/** The group DM a group call belongs to (absent for 1:1 calls). */
export type CallGroup = { channelId: string; name: string; icon: string | null; memberCount?: number };

export type CallUser = { id: string; username: string; displayName: string; avatar: string | null };

export type CallRing = {
  roomId: string;
  video: boolean;
  caller: CallUser;
  group?: CallGroup | null;
};

/** A call that rang for the user ended without them joining or declining. */
export type CallMissed = {
  /** The call message id: one notification per call, on every device. */
  callId: string;
  roomId: string;
  channelId: string;
  caller: CallUser;
  group?: CallGroup | null;
  endedAt: string;
};

export type CallEvent =
  | ({ type: "call_ring" } & CallRing)
  | { type: "call_cancel"; roomId: string; reason: "answered" | "declined" | "ended" }
  | ({ type: "call_missed" } & CallMissed);

/** A group DM call room ("gdm:<channelId>"). */
export function isGroupCallRoom(roomId: string): boolean {
  return /^gdm:[0-9a-f-]{36}$/i.test(roomId);
}

/** Where to open the conversation a call belongs to. */
export function callConversationHref(call: { caller: { id: string }; group?: CallGroup | null }): string {
  return call.group ? `/dm/group/${call.group.channelId}` : `/dm/${call.caller.id}`;
}

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

const DEFAULT_GROUP_NAMES = new Set(["", "group dm", "group", "direct message"]);

/**
 * A group DM's display name: its own name when it has a real one, otherwise
 * the first few members ("Alice, Bob, Carol"), like Discord.
 */
export function groupDisplayName(channelName: string | null | undefined, memberNames: string[]): string {
  const own = (channelName || "").trim();
  if (own && !DEFAULT_GROUP_NAMES.has(own.toLowerCase())) return own;
  const names = memberNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return own || "Group";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}
