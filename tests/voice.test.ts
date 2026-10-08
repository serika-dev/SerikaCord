import { describe, expect, test } from "bun:test";
import { canSignalBetween, hasRoomForParticipant, isDmRoomPeer, parseVoiceRoomId } from "@/lib/voice/rooms";
import {
  isPttKeyEvent,
  normalizePttKey,
  outputVolumeLevels,
  readVoiceCallSettings,
  shouldTransmit,
} from "@/lib/voice/settings";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("parseVoiceRoomId", () => {
  test("channel rooms", () => {
    expect(parseVoiceRoomId(`channel-${A}`)).toEqual({ kind: "channel", channelId: A });
  });

  test("DM pair rooms lower-case both peers", () => {
    expect(parseVoiceRoomId(`dm:${A.toUpperCase()}_${B}`)).toEqual({ kind: "dm", peers: [A, B] });
  });

  test("unknown and legacy formats are rejected", () => {
    expect(parseVoiceRoomId(`dm:${A}`)).toBeNull();
    expect(parseVoiceRoomId("channel-not-a-uuid")).toBeNull();
    expect(parseVoiceRoomId(A)).toBeNull();
    expect(parseVoiceRoomId(`channel-${A}/../x`)).toBeNull();
    expect(parseVoiceRoomId("")).toBeNull();
  });
});

describe("isDmRoomPeer", () => {
  const room = parseVoiceRoomId(`dm:${A}_${B}`)!;
  test("only the two users are peers", () => {
    expect(isDmRoomPeer(room, A)).toBeTrue();
    expect(isDmRoomPeer(room, B.toUpperCase())).toBeTrue();
    expect(isDmRoomPeer(room, C)).toBeFalse();
    expect(isDmRoomPeer({ kind: "channel", channelId: A }, A)).toBeFalse();
  });
});

describe("hasRoomForParticipant", () => {
  test("0 or missing limit is unlimited", () => {
    expect(hasRoomForParticipant(0, 500, false)).toBeTrue();
    expect(hasRoomForParticipant(null, 500, false)).toBeTrue();
  });
  test("a full channel rejects newcomers but not people already in it", () => {
    expect(hasRoomForParticipant(2, 1, false)).toBeTrue();
    expect(hasRoomForParticipant(2, 2, false)).toBeFalse();
    expect(hasRoomForParticipant(2, 2, true)).toBeTrue();
  });
});

describe("canSignalBetween", () => {
  test("both users must be joined", () => {
    expect(canSignalBetween([A, B], A, B)).toBeTrue();
    expect(canSignalBetween([A], C, A)).toBeFalse();
    expect(canSignalBetween([A, B], A, C)).toBeFalse();
    expect(canSignalBetween(undefined, A, B)).toBeFalse();
    expect(canSignalBetween([A, B], A, A)).toBeFalse();
    expect(canSignalBetween(new Map([[A, 1], [B, 2]]).keys(), B, A)).toBeTrue();
  });
});

describe("voice call settings", () => {
  test("only usable fields are read", () => {
    expect(readVoiceCallSettings({ echoCancellation: false, autoGainControl: "yes", inputVolume: 250, outputVolume: 40 })).toEqual({
      constraints: { echoCancellation: false },
      inputVolume: 200,
      outputVolume: 40,
    });
    expect(readVoiceCallSettings(null)).toEqual({ constraints: {} });
    expect(readVoiceCallSettings({ pushToTalk: true, pushToTalkKey: "b" })).toEqual({
      constraints: {},
      pushToTalk: true,
      pushToTalkKey: "B",
    });
  });

  test("normalizePttKey falls back to V", () => {
    expect(normalizePttKey("")).toBe("V");
    expect(normalizePttKey(undefined)).toBe("V");
    expect(normalizePttKey(" x ")).toBe("X");
  });

  test("shouldTransmit honours mute and push-to-talk", () => {
    expect(shouldTransmit({ muted: false, pttEnabled: false, pttHeld: false })).toBeTrue();
    expect(shouldTransmit({ muted: false, pttEnabled: true, pttHeld: false })).toBeFalse();
    expect(shouldTransmit({ muted: false, pttEnabled: true, pttHeld: true })).toBeTrue();
    expect(shouldTransmit({ muted: true, pttEnabled: true, pttHeld: true })).toBeFalse();
    expect(shouldTransmit({ muted: true, pttEnabled: false, pttHeld: false })).toBeFalse();
  });

  test("isPttKeyEvent matches key or physical code", () => {
    expect(isPttKeyEvent({ key: "v", code: "KeyV" }, "V")).toBeTrue();
    expect(isPttKeyEvent({ key: "V", code: "KeyV" }, "v")).toBeTrue();
    expect(isPttKeyEvent({ key: "м", code: "KeyV" }, "V")).toBeTrue();
    expect(isPttKeyEvent({ key: "!", code: "Digit1" }, "1")).toBeTrue();
    expect(isPttKeyEvent({ key: "b", code: "KeyB" }, "V")).toBeFalse();
    expect(isPttKeyEvent({ key: "Shift", code: "ShiftLeft" }, "V")).toBeFalse();
  });

  test("outputVolumeLevels", () => {
    expect(outputVolumeLevels(40)).toEqual({ elementVolume: 0.4, boostGain: null });
    expect(outputVolumeLevels(100)).toEqual({ elementVolume: 1, boostGain: null });
    expect(outputVolumeLevels(150)).toEqual({ elementVolume: 1, boostGain: 1.5 });
    expect(outputVolumeLevels(Number.NaN)).toEqual({ elementVolume: 1, boostGain: null });
  });
});
