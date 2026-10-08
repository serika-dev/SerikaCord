// Voice room ids and who may use them. Pure: shared by the voice API (server)
// and unit tests.
//
// Room id formats:
//   channel-<channelId>      a server voice channel
//   dm:<userA>_<userB>       a 1:1 DM call (both ids lower-cased, sorted)
// Anything else (including the old per-recipient "dm:<userId>" form, where the
// two sides never shared a room) is rejected.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANNEL_ROOM = new RegExp(`^channel-(${UUID})$`, "i");
const DM_PAIR_ROOM = new RegExp(`^dm:(${UUID})_(${UUID})$`, "i");

export type VoiceRoom =
  | { kind: "channel"; channelId: string }
  | { kind: "dm"; peers: [string, string] };

/** Parse a voice room id, or null when it isn't a recognised format. */
export function parseVoiceRoomId(roomId: string): VoiceRoom | null {
  if (typeof roomId !== "string") return null;
  const ch = CHANNEL_ROOM.exec(roomId);
  if (ch) return { kind: "channel", channelId: ch[1] };
  const dm = DM_PAIR_ROOM.exec(roomId);
  if (dm) return { kind: "dm", peers: [dm[1].toLowerCase(), dm[2].toLowerCase()] };
  return null;
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
