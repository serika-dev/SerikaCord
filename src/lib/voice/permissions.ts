// Voice permissions in server voice channels (CONNECT, SPEAK, STREAM/VIDEO,
// USE_SOUNDBOARD), enforced by the voice API (src/lib/api/voice.ts). Pure: no
// DB, used by the API and tests.
//
// Enforcing a bit that the @everyone defaults never granted would lock every
// existing server out of the feature (nobody ever ticked it on a role). So:
//   - bits in DEFAULT_EVERYONE_PERMISSIONS are enforced fully: the member's
//     final channel permissions must include them;
//   - bits outside the defaults only honour an explicit channel-overwrite deny:
//     a role not granting them is not a deny, but an overwrite that removes
//     them (for @everyone, a role or the member) is.
// Owner and ADMINISTRATOR resolve to every bit upstream, so they always pass.

import { applyChannelOverwrites, DEFAULT_EVERYONE_PERMISSIONS, type ChannelOverwrite, type ChannelPermissionContext } from "@/lib/permissions/channelOverwrites";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

export type VoiceBitEnforcement = "full" | "overwrite-deny";

/** How a bit is enforced, given the permissions new servers' @everyone gets. */
export function voiceBitEnforcement(bit: bigint, defaults: bigint = DEFAULT_EVERYONE_PERMISSIONS): VoiceBitEnforcement {
  return (defaults & bit) === bit ? "full" : "overwrite-deny";
}

/**
 * Whether a member may use `bit` in a voice channel.
 *
 * `finalPerms` is their resolved channel permission bitfield (roles + overwrites,
 * owner/ADMINISTRATOR already expanded to everything). For "overwrite-deny" bits
 * the channel's overwrites are re-applied to a base that grants the bit: if they
 * still leave it on, nothing in the channel denies it and it is allowed. The
 * per-bit result of the overwrite steps does not depend on any other bit, so
 * applying them to `bit` alone is exact.
 */
export function voiceBitAllowed(
  finalPerms: bigint,
  bit: bigint,
  enforcement: VoiceBitEnforcement,
  overwrites?: readonly ChannelOverwrite[] | null,
  ctx?: ChannelPermissionContext,
): boolean {
  if ((finalPerms & bit) === bit) return true;
  if (enforcement === "full") return false;
  const afterOverwrites = applyChannelOverwrites(bit, overwrites, ctx ?? {});
  return (afterOverwrites & bit) === bit;
}

export interface VoicePermissions {
  /** Join the channel (CONNECT). */
  connect: boolean;
  /** Be heard (SPEAK). Without it the member is suppressed (shown and played as server muted). */
  speak: boolean;
  /** Camera and screen share (VIDEO, Discord's STREAM). */
  stream: boolean;
  /** Play soundboard sounds (USE_SOUNDBOARD). */
  soundboard: boolean;
}

/** Everything allowed: DM and group DM calls have no server permissions. */
export const ALL_VOICE_PERMISSIONS: VoicePermissions = Object.freeze({
  connect: true,
  speak: true,
  stream: true,
  soundboard: true,
});

const VOICE_BITS: Record<keyof VoicePermissions, bigint> = {
  connect: PERMISSION_BITS.CONNECT,
  speak: PERMISSION_BITS.SPEAK,
  stream: PERMISSION_BITS.VIDEO,
  soundboard: PERMISSION_BITS.USE_SOUNDBOARD,
};

/** A member's voice permissions in a server voice channel. */
export function resolveVoicePermissions(
  finalPerms: bigint,
  overwrites: readonly ChannelOverwrite[] | null | undefined,
  ctx: ChannelPermissionContext,
  defaults: bigint = DEFAULT_EVERYONE_PERMISSIONS,
): VoicePermissions {
  const allowed = (key: keyof VoicePermissions) =>
    voiceBitAllowed(finalPerms, VOICE_BITS[key], voiceBitEnforcement(VOICE_BITS[key], defaults), overwrites, ctx);
  return {
    connect: allowed("connect"),
    speak: allowed("speak"),
    stream: allowed("stream"),
    soundboard: allowed("soundboard"),
  };
}

export type VoiceStatePatch = { audio?: boolean; video?: boolean; screenShare?: boolean };

/**
 * Which of a PATCH /voice/state request's fields the member may not turn on:
 * unmuting needs SPEAK, camera and screen share need STREAM. Turning things
 * off is always allowed.
 */
export function refusedVoiceStateFields(patch: VoiceStatePatch, perms: VoicePermissions): Array<keyof VoiceStatePatch> {
  const out: Array<keyof VoiceStatePatch> = [];
  if (patch.audio === true && !perms.speak) out.push("audio");
  if (patch.video === true && !perms.stream) out.push("video");
  if (patch.screenShare === true && !perms.stream) out.push("screenShare");
  return out;
}

const STAGE_MODERATOR_BITS = PERMISSION_BITS.MUTE_MEMBERS | PERMISSION_BITS.MOVE_MEMBERS | PERMISSION_BITS.MANAGE_CHANNELS;

/**
 * A stage moderator (Discord: Mute Members, Move Members or Manage Channels in
 * the stage): joins as a speaker and can invite people to speak or move them
 * to the audience. Everyone else joins the audience.
 */
export function isStageModerator(finalPerms: bigint): boolean {
  if ((finalPerms & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR) return true;
  return (finalPerms & STAGE_MODERATOR_BITS) !== 0n;
}

/** May raise a hand (REQUEST_TO_SPEAK) in the stage. */
export function canRequestToSpeak(finalPerms: bigint): boolean {
  if ((finalPerms & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR) return true;
  return (finalPerms & PERMISSION_BITS.REQUEST_TO_SPEAK) === PERMISSION_BITS.REQUEST_TO_SPEAK;
}
