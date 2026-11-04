import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, PERMISSION_BITS as P } from "@/lib/permissions/bits";
import { computeChannelPermissions, DEFAULT_EVERYONE_PERMISSIONS, type ChannelOverwrite } from "@/lib/permissions/channelOverwrites";
import {
  ALL_VOICE_PERMISSIONS,
  refusedVoiceStateFields,
  resolveVoicePermissions,
  voiceBitAllowed,
  voiceBitEnforcement,
} from "@/lib/voice/permissions";
import { contentLengthTooLarge, MAX_SIGNAL_BYTES, signalPayloadProblem } from "@/lib/voice/signal";

const SERVER = "11111111-1111-4111-8111-111111111111";
const EVERYONE = "22222222-2222-4222-8222-222222222222";
const DJ = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const ctx = (roles: string[] = []) => ({ serverId: SERVER, everyoneRoleId: EVERYONE, memberRoleIds: roles, userId: USER });
const bits = (...b: bigint[]) => b.reduce((a, x) => a | x, 0n).toString();

function voicePerms(opts: { everyone?: bigint; roles?: bigint[]; roleIds?: string[]; overwrites?: ChannelOverwrite[]; owner?: boolean }) {
  const final = computeChannelPermissions({
    isOwner: opts.owner,
    everyonePermissions: opts.everyone ?? DEFAULT_EVERYONE_PERMISSIONS,
    rolePermissions: opts.roles ?? [],
    overwrites: opts.overwrites ?? [],
    ctx: ctx(opts.roleIds),
  });
  return resolveVoicePermissions(final, opts.overwrites ?? [], ctx(opts.roleIds));
}

describe("which voice bits the @everyone defaults grant", () => {
  test("new servers' @everyone (servers.ts DEFAULT_PERMISSIONS) matches DEFAULT_EVERYONE_PERMISSIONS", () => {
    expect(DEFAULT_EVERYONE_PERMISSIONS).toBe(1071698660929n);
  });

  test("CONNECT, SPEAK and STREAM (VIDEO) are in the defaults: enforced fully", () => {
    expect(voiceBitEnforcement(P.CONNECT)).toBe("full");
    expect(voiceBitEnforcement(P.SPEAK)).toBe("full");
    expect(voiceBitEnforcement(P.VIDEO)).toBe("full");
  });

  test("USE_SOUNDBOARD is not: only an explicit overwrite deny counts", () => {
    expect(voiceBitEnforcement(P.USE_SOUNDBOARD)).toBe("overwrite-deny");
    expect(voiceBitEnforcement(P.PRIORITY_SPEAKER)).toBe("overwrite-deny");
  });
});

describe("voiceBitAllowed", () => {
  test("full: only the final permissions decide", () => {
    expect(voiceBitAllowed(P.SPEAK, P.SPEAK, "full")).toBe(true);
    expect(voiceBitAllowed(0n, P.SPEAK, "full")).toBe(false);
  });

  test("overwrite-deny: a role simply not granting it is not a deny", () => {
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", [], ctx())).toBe(true);
  });

  test("overwrite-deny: an @everyone overwrite deny blocks it even though no role ever granted it", () => {
    const ow: ChannelOverwrite[] = [{ id: EVERYONE, type: "role", deny: bits(P.USE_SOUNDBOARD) }];
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx())).toBe(false);
  });

  test("overwrite-deny: @everyone keyed by the server id counts too", () => {
    const ow: ChannelOverwrite[] = [{ id: SERVER, type: "role", deny: bits(P.USE_SOUNDBOARD) }];
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx())).toBe(false);
  });

  test("overwrite-deny: a role overwrite allow re-grants what @everyone denied", () => {
    const ow: ChannelOverwrite[] = [
      { id: EVERYONE, type: "role", deny: bits(P.USE_SOUNDBOARD) },
      { id: DJ, type: "role", allow: bits(P.USE_SOUNDBOARD) },
    ];
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx([DJ]))).toBe(true);
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx())).toBe(false);
  });

  test("overwrite-deny: a member overwrite deny beats a role allow", () => {
    const ow: ChannelOverwrite[] = [
      { id: DJ, type: "role", allow: bits(P.USE_SOUNDBOARD) },
      { id: USER, type: "member", deny: bits(P.USE_SOUNDBOARD) },
    ];
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx([DJ]))).toBe(false);
  });

  test("overwrite-deny: unrelated denies don't matter", () => {
    const ow: ChannelOverwrite[] = [{ id: EVERYONE, type: "role", deny: bits(P.SEND_MESSAGES) }];
    expect(voiceBitAllowed(0n, P.USE_SOUNDBOARD, "overwrite-deny", ow, ctx())).toBe(true);
  });
});

describe("resolveVoicePermissions", () => {
  test("a default member in a plain voice channel can do everything", () => {
    expect(voicePerms({})).toEqual({ connect: true, speak: true, stream: true, soundboard: true });
  });

  test("private voice channel: @everyone CONNECT deny, allowed role re-granted", () => {
    const overwrites: ChannelOverwrite[] = [
      { id: EVERYONE, type: "role", deny: bits(P.VIEW_CHANNEL, P.CONNECT) },
      { id: DJ, type: "role", allow: bits(P.VIEW_CHANNEL, P.CONNECT) },
    ];
    expect(voicePerms({ overwrites }).connect).toBe(false);
    expect(voicePerms({ overwrites, roleIds: [DJ] }).connect).toBe(true);
  });

  test("SPEAK and STREAM denied by overwrite", () => {
    const overwrites: ChannelOverwrite[] = [{ id: EVERYONE, type: "role", deny: bits(P.SPEAK, P.VIDEO) }];
    expect(voicePerms({ overwrites })).toEqual({ connect: true, speak: false, stream: false, soundboard: true });
  });

  test("an @everyone role edited to drop SPEAK is enforced (it was a default bit)", () => {
    expect(voicePerms({ everyone: DEFAULT_EVERYONE_PERMISSIONS & ~P.SPEAK }).speak).toBe(false);
  });

  test("owner and ADMINISTRATOR ignore overwrites", () => {
    const overwrites: ChannelOverwrite[] = [
      { id: EVERYONE, type: "role", deny: bits(P.CONNECT, P.SPEAK, P.VIDEO, P.USE_SOUNDBOARD) },
    ];
    expect(voicePerms({ overwrites, owner: true })).toEqual(ALL_VOICE_PERMISSIONS);
    expect(voicePerms({ overwrites, roles: [P.ADMINISTRATOR], roleIds: [DJ] })).toEqual(ALL_VOICE_PERMISSIONS);
    expect(resolveVoicePermissions(ALL_PERMISSIONS, overwrites, ctx())).toEqual(ALL_VOICE_PERMISSIONS);
  });

  test("soundboard denied in the channel for @everyone", () => {
    const overwrites: ChannelOverwrite[] = [{ id: EVERYONE, type: "role", deny: bits(P.USE_SOUNDBOARD) }];
    expect(voicePerms({ overwrites }).soundboard).toBe(false);
    // A role that grants it server-wide doesn't beat the @everyone overwrite (Discord order).
    expect(voicePerms({ overwrites, roles: [P.USE_SOUNDBOARD], roleIds: [DJ] }).soundboard).toBe(false);
  });
});

describe("refusedVoiceStateFields", () => {
  const none = { connect: true, speak: false, stream: false, soundboard: false };
  test("turning things on needs SPEAK / STREAM", () => {
    expect(refusedVoiceStateFields({ audio: true, video: true, screenShare: true }, none)).toEqual(["audio", "video", "screenShare"]);
    expect(refusedVoiceStateFields({ audio: true, video: true }, ALL_VOICE_PERMISSIONS)).toEqual([]);
  });
  test("turning things off is always fine", () => {
    expect(refusedVoiceStateFields({ audio: false, video: false, screenShare: false }, none)).toEqual([]);
    expect(refusedVoiceStateFields({}, none)).toEqual([]);
  });
});

describe("signal payload limits", () => {
  test("accepts real signals", () => {
    expect(signalPayloadProblem({ type: "offer", sdp: "v=0\r\n".repeat(500) })).toBeNull();
    expect(signalPayloadProblem({ type: "candidate", candidate: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0" } })).toBeNull();
    expect(signalPayloadProblem({ renegotiate: true })).toBeNull();
  });
  test("refuses non-objects", () => {
    expect(signalPayloadProblem(null)).toBe("invalid");
    expect(signalPayloadProblem("offer")).toBe("invalid");
    expect(signalPayloadProblem(42)).toBe("invalid");
    expect(signalPayloadProblem([1, 2])).toBe("invalid");
  });
  test("refuses oversized payloads", () => {
    expect(signalPayloadProblem({ type: "offer", sdp: "a".repeat(MAX_SIGNAL_BYTES) })).toBe("too_large");
  });
  test("content-length guard", () => {
    expect(contentLengthTooLarge(undefined)).toBe(false);
    expect(contentLengthTooLarge("1000")).toBe(false);
    expect(contentLengthTooLarge(String(10 * 1024 * 1024))).toBe(true);
    expect(contentLengthTooLarge("nope")).toBe(false);
  });
});
