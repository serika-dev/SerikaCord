import { describe, expect, test } from "bun:test";
import { PERMISSION_BITS } from "@/lib/permissions/bits";
import {
  channelIdOfRoom,
  checkVoiceModeration,
  hasVoiceModerationChange,
  roomsContainingUser,
} from "@/lib/voice/moderation";
import {
  DEFAULT_SENSITIVITY_DB,
  GATE_HANGOVER_MS,
  SENSITIVITY_MIN_DB,
  amplitudeToDb,
  autoThresholdFor,
  clampSensitivityDb,
  createVoiceGateState,
  dbToMeterPercent,
  rmsFromByteTimeDomain,
  stepVoiceGate,
} from "@/lib/voice/voiceActivity";
import {
  USER_VOLUME_DEFAULT,
  clampUserVolume,
  effectivePlaybackPercent,
  getUserVoicePref,
  parseUserVoicePrefs,
  withUserVoicePref,
} from "@/lib/voice/userVolume";
import {
  DEFAULT_STREAM_QUALITY,
  displayMediaVideoConstraints,
  normalizeStreamQuality,
  streamContentHint,
  streamMaxBitrate,
} from "@/lib/voice/streamQuality";
import { buildStageTiles, gridColumns, resolveFocusedTile } from "@/lib/voice/callLayout";
import { DEFAULT_DEVICE_ID, deviceChoices, deviceConstraint } from "@/lib/voice/devices";
import { readVoiceCallSettings, shouldTransmit } from "@/lib/voice/settings";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = PERMISSION_BITS;

describe("voice moderation permissions", () => {
  test("an empty patch is rejected", () => {
    expect(hasVoiceModerationChange({})).toBeFalse();
    expect(checkVoiceModeration({ patch: {}, actorPerms: P.ADMINISTRATOR, targetInVoice: true })).toEqual({
      ok: false, status: 400, error: "Nothing to change",
    });
  });

  test("server mute needs MUTE_MEMBERS, deafen needs DEAFEN_MEMBERS", () => {
    expect(checkVoiceModeration({ patch: { mute: true }, actorPerms: 0n, targetInVoice: true }).ok).toBeFalse();
    expect(checkVoiceModeration({ patch: { mute: true }, actorPerms: P.MUTE_MEMBERS, targetInVoice: false }).ok).toBeTrue();
    expect(checkVoiceModeration({ patch: { deaf: true }, actorPerms: P.MUTE_MEMBERS, targetInVoice: true }).ok).toBeFalse();
    expect(checkVoiceModeration({ patch: { deaf: false }, actorPerms: P.DEAFEN_MEMBERS, targetInVoice: true }).ok).toBeTrue();
    // Both at once need both.
    expect(checkVoiceModeration({ patch: { mute: true, deaf: true }, actorPerms: P.DEAFEN_MEMBERS, targetInVoice: true }).ok).toBeFalse();
  });

  test("administrator implies every voice permission", () => {
    expect(checkVoiceModeration({ patch: { mute: true, deaf: true, channelId: null }, actorPerms: P.ADMINISTRATOR, targetInVoice: true }).ok).toBeTrue();
  });

  test("disconnect needs MOVE_MEMBERS and the member in voice", () => {
    expect(checkVoiceModeration({ patch: { channelId: null }, actorPerms: P.MOVE_MEMBERS, targetInVoice: false })).toMatchObject({ ok: false, status: 400 });
    expect(checkVoiceModeration({ patch: { channelId: null }, actorPerms: P.MUTE_MEMBERS, targetInVoice: true })).toMatchObject({ ok: false, status: 403 });
    expect(checkVoiceModeration({ patch: { channelId: null }, actorPerms: P.MOVE_MEMBERS, targetInVoice: true }).ok).toBeTrue();
  });

  test("moving needs a valid destination you can connect to and the member can see", () => {
    const base = { patch: { channelId: B }, actorPerms: P.MOVE_MEMBERS, targetInVoice: true };
    expect(checkVoiceModeration({ ...base, destinationValid: false })).toMatchObject({ ok: false, status: 400 });
    expect(checkVoiceModeration({ ...base, destinationValid: true, destinationPerms: P.VIEW_CHANNEL })).toMatchObject({ ok: false, status: 403 });
    expect(checkVoiceModeration({
      ...base, destinationValid: true, destinationPerms: P.VIEW_CHANNEL | P.CONNECT, targetCanJoinDestination: false,
    })).toMatchObject({ ok: false, status: 403 });
    expect(checkVoiceModeration({
      ...base, destinationValid: true, destinationPerms: P.VIEW_CHANNEL | P.CONNECT, targetCanJoinDestination: true,
    }).ok).toBeTrue();
  });

  test("room helpers find server channel rooms only", () => {
    expect(channelIdOfRoom(`channel-${A}`)).toBe(A);
    expect(channelIdOfRoom(`gdm:${A}`)).toBeNull();
    const rooms = new Map<string, Set<string>>([
      [`channel-${A}`, new Set(["u1"])],
      [`gdm:${B}`, new Set(["u1"])],
      [`channel-${B}`, new Set(["u2"])],
    ]);
    expect(roomsContainingUser(rooms.entries(), "u1")).toEqual([`channel-${A}`]);
  });
});

describe("voice activity gate", () => {
  test("levels and meter mapping", () => {
    const silence = new Uint8Array(256).fill(128);
    expect(rmsFromByteTimeDomain(silence)).toBe(0);
    expect(amplitudeToDb(0)).toBe(SENSITIVITY_MIN_DB);
    expect(Math.round(amplitudeToDb(1))).toBe(0);
    expect(Math.round(amplitudeToDb(0.1))).toBe(-20);
    expect(dbToMeterPercent(-100)).toBe(0);
    expect(dbToMeterPercent(0)).toBe(100);
    expect(dbToMeterPercent(-50)).toBe(50);
    expect(clampSensitivityDb(-150)).toBe(-100);
    expect(clampSensitivityDb(5)).toBe(0);
    expect(clampSensitivityDb("x")).toBe(DEFAULT_SENSITIVITY_DB);
  });

  test("manual threshold opens above it and holds for the hangover", () => {
    let g = createVoiceGateState();
    g = stepVoiceGate(g, { levelDb: -70, now: 0, auto: false, manualThresholdDb: -50 });
    expect(g.open).toBeFalse();
    g = stepVoiceGate(g, { levelDb: -30, now: 100, auto: false, manualThresholdDb: -50 });
    expect(g.open).toBeTrue();
    g = stepVoiceGate(g, { levelDb: -80, now: 100 + GATE_HANGOVER_MS - 10, auto: false, manualThresholdDb: -50 });
    expect(g.open).toBeTrue();
    g = stepVoiceGate(g, { levelDb: -80, now: 100 + GATE_HANGOVER_MS + 10, auto: false, manualThresholdDb: -50 });
    expect(g.open).toBeFalse();
  });

  test("auto mode tracks the noise floor and stays closed on steady noise", () => {
    let g = createVoiceGateState();
    let now = 0;
    for (let i = 0; i < 400; i++) {
      now += 50;
      g = stepVoiceGate(g, { levelDb: -55, now, auto: true, manualThresholdDb: -60 });
    }
    // Steady -55 dB fan noise: threshold climbs above it, gate closes.
    expect(g.thresholdDb).toBeGreaterThan(-55);
    expect(g.open).toBeFalse();
    // Speech well above the noise opens it.
    g = stepVoiceGate(g, { levelDb: -20, now: now + 50, auto: true, manualThresholdDb: -60 });
    expect(g.open).toBeTrue();
    expect(autoThresholdFor(-200)).toBe(-72);
    expect(autoThresholdFor(0)).toBe(-28);
  });

  test("shouldTransmit: server mute wins, gate applies outside push-to-talk", () => {
    expect(shouldTransmit({ muted: false, pttEnabled: false, pttHeld: false, serverMuted: true })).toBeFalse();
    expect(shouldTransmit({ muted: false, pttEnabled: false, pttHeld: false, voiceGateOpen: false })).toBeFalse();
    expect(shouldTransmit({ muted: false, pttEnabled: false, pttHeld: false, voiceGateOpen: true })).toBeTrue();
    expect(shouldTransmit({ muted: false, pttEnabled: true, pttHeld: true, voiceGateOpen: false })).toBeTrue();
  });

  test("settings read sensitivity fields", () => {
    expect(readVoiceCallSettings({ autoSensitivity: false, inputSensitivity: -42.4 })).toMatchObject({
      autoSensitivity: false,
      inputSensitivity: -42,
    });
    expect(readVoiceCallSettings({ inputSensitivity: "loud" }).inputSensitivity).toBeUndefined();
  });
});

describe("per-user volume", () => {
  test("clamps and drops defaults", () => {
    expect(clampUserVolume(250)).toBe(200);
    expect(clampUserVolume(-5)).toBe(0);
    expect(clampUserVolume(NaN)).toBe(USER_VOLUME_DEFAULT);
    const prefs = parseUserVoicePrefs(JSON.stringify({ [A]: { volume: 100, muted: false }, [B]: { volume: 150 } }));
    expect(Object.keys(prefs)).toEqual([B.toLowerCase()]);
    expect(parseUserVoicePrefs("{bad")).toEqual({});
  });

  test("updates are case-insensitive and resetting removes the entry", () => {
    let prefs = withUserVoicePref({}, A.toUpperCase(), { volume: 40 });
    expect(getUserVoicePref(prefs, A).volume).toBe(40);
    prefs = withUserVoicePref(prefs, A, { muted: true });
    expect(getUserVoicePref(prefs, A)).toEqual({ volume: 40, muted: true });
    prefs = withUserVoicePref(prefs, A, { volume: 100, muted: false });
    expect(prefs).toEqual({});
  });

  test("playback level combines output and user volume", () => {
    expect(effectivePlaybackPercent(100, { volume: 100, muted: false })).toBe(100);
    expect(effectivePlaybackPercent(200, { volume: 200, muted: false })).toBe(400);
    expect(effectivePlaybackPercent(50, { volume: 50, muted: false })).toBe(25);
    expect(effectivePlaybackPercent(100, { volume: 100, muted: true })).toBe(0);
    expect(effectivePlaybackPercent(100, { volume: 100, muted: false }, true)).toBe(0);
  });
});

describe("stream quality", () => {
  test("normalizes unknown values to defaults", () => {
    expect(normalizeStreamQuality(null)).toEqual(DEFAULT_STREAM_QUALITY);
    expect(normalizeStreamQuality({ resolution: 999, frameRate: 60 })).toEqual({ resolution: 720, frameRate: 60 });
    expect(normalizeStreamQuality({ resolution: "source", frameRate: 15 })).toEqual({ resolution: "source", frameRate: 15 });
  });

  test("constraints, bitrate and hint", () => {
    const c = displayMediaVideoConstraints({ resolution: 1080, frameRate: 60 });
    expect(c.height).toEqual({ ideal: 1080, max: 1080 });
    expect(c.width).toEqual({ ideal: 1920, max: 1920 });
    expect(c.frameRate).toEqual({ ideal: 60, max: 60 });
    expect(displayMediaVideoConstraints({ resolution: "source", frameRate: 30 }).height).toBeUndefined();
    expect(streamMaxBitrate({ resolution: 1080, frameRate: 60 })).toBeGreaterThan(streamMaxBitrate({ resolution: 720, frameRate: 30 }));
    expect(streamContentHint({ resolution: 720, frameRate: 60 })).toBe("motion");
    expect(streamContentHint({ resolution: 1080, frameRate: 30 })).toBe("detail");
  });
});

describe("call stage layout", () => {
  const me = "me";
  test("screens first, then self, then others; avatars only in channel calls", () => {
    const members = [
      { userId: "bob", camera: false, screen: true },
      { userId: me, camera: true, screen: false },
      { userId: "amy", camera: false, screen: false },
    ];
    const channel = buildStageTiles({ members, selfId: me, includeAudioOnly: true });
    expect(channel.map((t) => t.id)).toEqual(["screen:bob", "user:me", "user:bob", "user:amy"]);
    expect(channel.map((t) => t.kind)).toEqual(["screen", "camera", "avatar", "avatar"]);
    const dm = buildStageTiles({ members, selfId: me, includeAudioOnly: false });
    expect(dm.map((t) => t.id)).toEqual(["screen:bob", "user:me"]);
  });

  test("spotlight falls back to the grid when its tile disappears", () => {
    const tiles = buildStageTiles({ members: [{ userId: me, camera: true, screen: false }], selfId: me, includeAudioOnly: true });
    expect(resolveFocusedTile(tiles, "user:me")?.userId).toBe(me);
    expect(resolveFocusedTile(tiles, "screen:bob")).toBeNull();
    expect(resolveFocusedTile(tiles, null)).toBeNull();
  });

  test("grid columns", () => {
    expect(gridColumns(1, false)).toBe(1);
    expect(gridColumns(2, false)).toBe(2);
    expect(gridColumns(5, false)).toBe(3);
    expect(gridColumns(12, false)).toBe(4);
    expect(gridColumns(30, false)).toBe(5);
    expect(gridColumns(7, true)).toBe(2);
  });
});

describe("device pickers", () => {
  test("lists one kind, skips browser defaults, numbers unlabeled devices", () => {
    const list = deviceChoices([
      { deviceId: "default", kind: "audioinput", label: "Default" },
      { deviceId: "communications", kind: "audioinput", label: "Comms" },
      { deviceId: "mic1", kind: "audioinput", label: "USB Mic" },
      { deviceId: "mic2", kind: "audioinput", label: "" },
      { deviceId: "mic1", kind: "audioinput", label: "USB Mic" },
      { deviceId: "spk", kind: "audiooutput", label: "Speakers" },
    ], "audioinput", (n) => `Microphone ${n}`);
    expect(list).toEqual([
      { deviceId: "mic1", label: "USB Mic" },
      { deviceId: "mic2", label: "Microphone 2" },
    ]);
  });

  test("constraint is ideal so a missing device falls back", () => {
    expect(deviceConstraint(DEFAULT_DEVICE_ID)).toEqual({});
    expect(deviceConstraint(null)).toEqual({});
    expect(deviceConstraint("mic1")).toEqual({ deviceId: { ideal: "mic1" } });
  });
});
