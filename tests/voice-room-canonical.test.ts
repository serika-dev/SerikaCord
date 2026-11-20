import { describe, expect, test } from "bun:test";
import { canonicalVoiceRoomId, isCanonicalVoiceRoomId, parseVoiceRoomId, voiceRoomIdOf } from "@/lib/voice/rooms";
import { dmCallRoomId } from "@/lib/chat/dmCall";
import { channelIdOfRoom } from "@/lib/voice/moderation";
import { checkLaunch, type LaunchCheckInput } from "@/lib/activities/instances";

const A = "1111aaaa-1111-4111-8111-11111111abcd";
const B = "22222222-2222-4222-8222-222222222222";
const G = "9999ffff-9999-4999-8999-99999999eeee";

describe("parseVoiceRoomId canonical form", () => {
  test("lower-cases channel and group ids", () => {
    expect(parseVoiceRoomId(`channel-${A.toUpperCase()}`)).toEqual({ kind: "channel", channelId: A });
    expect(parseVoiceRoomId(`GDM:${G.toUpperCase()}`)).toEqual({ kind: "group", channelId: G });
  });

  test("sorts DM peers like dmCallRoomId", () => {
    expect(parseVoiceRoomId(`dm:${B}_${A}`)).toEqual({ kind: "dm", peers: [A, B] });
    expect(canonicalVoiceRoomId(`dm:${B}_${A.toUpperCase()}`)).toBe(dmCallRoomId(B, A));
  });

  test("canonical id round-trips", () => {
    for (const id of [`channel-${A}`, dmCallRoomId(A, B), `gdm:${G}`]) {
      expect(voiceRoomIdOf(parseVoiceRoomId(id)!)).toBe(id);
      expect(isCanonicalVoiceRoomId(id)).toBeTrue();
    }
  });

  test("other spellings of the same room are not canonical", () => {
    expect(isCanonicalVoiceRoomId(`CHANNEL-${A}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId(`Channel-${A}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId(`channel-${A.toUpperCase()}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId(`dm:${B}_${A}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId(`DM:${A}_${B}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId(`gdm:${G.toUpperCase()}`)).toBeFalse();
    expect(isCanonicalVoiceRoomId("channel-not-a-uuid")).toBeFalse();
    expect(isCanonicalVoiceRoomId(undefined)).toBeFalse();
    expect(isCanonicalVoiceRoomId(42)).toBeFalse();
    expect(canonicalVoiceRoomId(`dm:${A}`)).toBeNull();
  });

  test("moderation only recognises canonical channel rooms", () => {
    expect(channelIdOfRoom(`channel-${A}`)).toBe(A);
    expect(channelIdOfRoom(`CHANNEL-${A}`)).toBeNull();
    expect(channelIdOfRoom(`channel-${A.toUpperCase()}`)).toBeNull();
  });
});

describe("checkLaunch in a 1:1 DM someone may not write into", () => {
  const base = (over: Partial<LaunchCheckInput>): LaunchCheckInput => ({
    channel: { id: "d", type: "dm" },
    permissions: 0n,
    inVoiceRoom: false,
    voice: false,
    ageConfirmed: false,
    app: { enabled: true, ageGated: false, supportedPlatforms: ["web"] },
    platform: "web",
    domainConfigured: true,
    ...over,
  });

  test("blocked / DM privacy refuses launch and join", () => {
    expect(checkLaunch(base({}), "launch")).toEqual({ ok: true });
    expect(checkLaunch(base({ dmWriteDenied: true }), "launch")).toEqual({ ok: false, reason: "no_access" });
    expect(checkLaunch(base({ dmWriteDenied: true }), "join")).toEqual({ ok: false, reason: "no_access" });
  });

  test("group DMs have no per-pair rule", () => {
    expect(checkLaunch(base({ channel: { id: "g", type: "group_dm" }, dmWriteDenied: true }), "launch")).toEqual({ ok: true });
  });
});
