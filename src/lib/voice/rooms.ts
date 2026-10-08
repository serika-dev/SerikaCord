// Voice room ids and who may use them. Pure: shared by the voice API (server)
// and unit tests.
//
// Room id formats:
//   channel-<channelId>      a server voice channel
//   dm:<userA>_<userB>       a 1:1 DM call (both ids lower-cased, sorted)
//   gdm:<channelId>          a group DM call (any current member of the group)
// Anything else (including the old per-recipient "dm:<userId>" form, where the
// two sides never shared a room) is rejected.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANNEL_ROOM = new RegExp(`^channel-(${UUID})$`, "i");
const DM_PAIR_ROOM = new RegExp(`^dm:(${UUID})_(${UUID})$`, "i");
const GROUP_DM_ROOM = new RegExp(`^gdm:(${UUID})$`, "i");

export type VoiceRoom =
  | { kind: "channel"; channelId: string }
  | { kind: "dm"; peers: [string, string] }
  | { kind: "group"; channelId: string };

/** Parse a voice room id, or null when it isn't a recognised format. */
export function parseVoiceRoomId(roomId: string): VoiceRoom | null {
  if (typeof roomId !== "string") return null;
  const ch = CHANNEL_ROOM.exec(roomId);
  if (ch) return { kind: "channel", channelId: ch[1] };
  const dm = DM_PAIR_ROOM.exec(roomId);
  if (dm) return { kind: "dm", peers: [dm[1].toLowerCase(), dm[2].toLowerCase()] };
  const group = GROUP_DM_ROOM.exec(roomId);
  if (group) return { kind: "group", channelId: group[1].toLowerCase() };
  return null;
}

/** The voice room of a group DM's call. */
export function groupCallRoomId(channelId: string): string {
  return `gdm:${String(channelId).toLowerCase()}`;
}

/** The group DM channel id of a group call room, or null if `roomId` isn't one. */
export function groupCallChannelId(roomId: string): string | null {
  const room = parseVoiceRoomId(roomId);
  return room?.kind === "group" ? room.channelId : null;
}

/**
 * Whether `userId` may use a group DM call room: the channel must be a group
 * DM and the user one of its current recipients (someone who left the group
 * loses access to its calls at once).
 */
export function isGroupCallMember(
  channel: { type?: string | null; recipientIds?: string[] | null } | null | undefined,
  userId: string,
): boolean {
  if (!channel || channel.type !== "group_dm" || !userId) return false;
  const me = String(userId).toLowerCase();
  return (channel.recipientIds || []).some((id) => String(id).toLowerCase() === me);
}

/** The other members of a group call to ring: everyone but the caller, de-duplicated. */
export function groupCallRingTargets(recipientIds: string[] | null | undefined, callerId: string): string[] {
  const me = String(callerId).toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of recipientIds || []) {
    const key = String(id).toLowerCase();
    if (key === me || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** Whether `userId` is one of the two people in a DM call room. */
export function isDmRoomPeer(room: VoiceRoom, userId: string): boolean {
  if (room.kind !== "dm") return false;
  const me = String(userId || "").toLowerCase();
  return room.peers.includes(me);
}

/**
 * Whether a channel with this user limit can take one more participant.
 * A limit of 0 (or missing) means unlimited; someone already in the room
 * (rejoining after a dropped connection) is always let back in.
 */
export function hasRoomForParticipant(
  userLimit: number | null | undefined,
  currentCount: number,
  alreadyInRoom: boolean,
): boolean {
  if (alreadyInRoom) return true;
  const limit = Number(userLimit) || 0;
  if (limit <= 0) return true;
  return currentCount < limit;
}

/**
 * WebRTC signaling (offer/answer/ICE) may only flow between two users who are
 * both joined participants of the room, so nobody can open a hidden peer
 * connection to a participant without appearing in the room.
 */
export function canSignalBetween(
  participantIds: Iterable<string> | null | undefined,
  fromUserId: string,
  targetUserId: string,
): boolean {
  if (!participantIds || !fromUserId || !targetUserId) return false;
  if (fromUserId === targetUserId) return false;
  let hasFrom = false;
  let hasTarget = false;
  for (const id of participantIds) {
    if (id === fromUserId) hasFrom = true;
    if (id === targetUserId) hasTarget = true;
  }
  return hasFrom && hasTarget;
}
