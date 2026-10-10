// Voice moderation rules (Server Mute, Server Deafen, Move To, Disconnect),
// matching Discord's: MUTE_MEMBERS / DEAFEN_MEMBERS / MOVE_MEMBERS, checked in
// the voice channel the member is in (channel overwrites apply), and a move
// also needs CONNECT in the destination. Pure: used by the voice API and tests.

import { PERMISSION_BITS, hasPermission } from "@/lib/permissions/bits";

export interface VoiceModerationPatch {
  mute?: boolean;
  deaf?: boolean;
  /** Move to this voice channel, or `null` to disconnect. Omitted: no move. */
  channelId?: string | null;
}

export type VoiceModerationDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

export interface VoiceModerationContext {
  patch: VoiceModerationPatch;
  /**
   * The actor's permissions where the target is: their current voice channel,
   * or server-wide when they aren't in voice.
   */
  actorPerms: bigint;
  /** Whether the target is connected to a voice channel of this server. */
  targetInVoice: boolean;
  /** The actor's permissions in the destination channel (moves only). */
  destinationPerms?: bigint | null;
  /** The destination is a voice channel of the same server (moves only). */
  destinationValid?: boolean;
  /** The target can see/join the destination (moves only). */
  targetCanJoinDestination?: boolean;
}

export function hasVoiceModerationChange(patch: VoiceModerationPatch): boolean {
  return patch.mute !== undefined || patch.deaf !== undefined || patch.channelId !== undefined;
}

export function checkVoiceModeration(ctx: VoiceModerationContext): VoiceModerationDecision {
  const { patch, actorPerms } = ctx;
  if (!hasVoiceModerationChange(patch)) {
    return { ok: false, status: 400, error: "Nothing to change" };
  }
  if (patch.mute !== undefined && !hasPermission(actorPerms, PERMISSION_BITS.MUTE_MEMBERS)) {
    return { ok: false, status: 403, error: "You need the Mute Members permission" };
  }
  if (patch.deaf !== undefined && !hasPermission(actorPerms, PERMISSION_BITS.DEAFEN_MEMBERS)) {
    return { ok: false, status: 403, error: "You need the Deafen Members permission" };
  }
  if (patch.channelId !== undefined) {
    if (!ctx.targetInVoice) {
      return { ok: false, status: 400, error: "Target user is not connected to voice" };
    }
    if (!hasPermission(actorPerms, PERMISSION_BITS.MOVE_MEMBERS)) {
      return { ok: false, status: 403, error: "You need the Move Members permission" };
    }
    if (patch.channelId !== null) {
      if (!ctx.destinationValid) {
        return { ok: false, status: 400, error: "That is not a voice channel in this server" };
      }
      const dest = ctx.destinationPerms ?? 0n;
      if (!hasPermission(dest, PERMISSION_BITS.VIEW_CHANNEL) || !hasPermission(dest, PERMISSION_BITS.CONNECT)) {
        return { ok: false, status: 403, error: "You can't connect to that channel" };
      }
      if (ctx.targetCanJoinDestination === false) {
        return { ok: false, status: 403, error: "That member can't access that channel" };
      }
    }
  }
  return { ok: true };
}

/** The server voice channel id a room id belongs to, or null (DM/group calls). */
export function channelIdOfRoom(roomId: string): string | null {
  const m = /^channel-([0-9a-f-]{36})$/i.exec(roomId);
  return m ? m[1] : null;
}

/**
 * Which channel rooms (of the given candidates) the user is in. A user is in
 * at most one room per session, but stale mirrors can briefly show two.
 */
export function roomsContainingUser(
  rooms: Iterable<[string, { has(userId: string): boolean }]>,
  userId: string,
): string[] {
  const out: string[] = [];
  for (const [roomId, members] of rooms) {
    if (channelIdOfRoom(roomId) && members.has(userId)) out.push(roomId);
  }
  return out;
}
