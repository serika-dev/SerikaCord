import { describe, expect, test } from "bun:test";
import {
  IS_VOICE_MESSAGE,
  canSendVoiceMessages,
  decodeWaveform,
  downsampleWaveform,
  encodeWaveform,
  formatVoiceDuration,
  fromDiscordVoiceAttachment,
  isVoiceAttachment,
  nextPlaybackRate,
  normalizeVoiceMessage,
  pickRecorderFormat,
  recorderFormatForBlobType,
  toDiscordVoiceFields,
  waveformBars,
  waveformSampleCount,
} from "@/lib/chat/voiceMessage";
import { MESSAGE_FLAGS, sendFlags } from "@/lib/chat/messageFlags";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

const audio = { id: "a", url: "u", filename: "voice-message.ogg", contentType: "audio/ogg" };

describe("voice message flag", () => {
  test("matches Discord's IS_VOICE_MESSAGE", () => {
    expect(IS_VOICE_MESSAGE).toBe(8192);
    expect(MESSAGE_FLAGS.IS_VOICE_MESSAGE).toBe(IS_VOICE_MESSAGE);
    // sendFlags never passes it through on its own; normalizeVoiceMessage adds it.
    expect(sendFlags(IS_VOICE_MESSAGE, false)).toBe(0);
  });
});

describe("waveform", () => {
  test("round-trips through base64", () => {
    const samples = [0, 0.5, 1, 0.25, 0.75];
    const decoded = decodeWaveform(encodeWaveform(samples))!;
    expect(decoded.length).toBe(5);
    decoded.forEach((v, i) => expect(Math.abs(v - samples[i])).toBeLessThan(0.01));
  });

  test("matches standard base64", () => {
    expect(encodeWaveform([0, 1, 0])).toBe("AP8A");
    expect(encodeWaveform([1])).toBe("/w==");
    expect(encodeWaveform([1, 1])).toBe("//8=");
  });

  test("rejects junk and oversize", () => {
    expect(decodeWaveform("not base64!")).toBeNull();
    expect(decodeWaveform("")).toBeNull();
    expect(decodeWaveform(42)).toBeNull();
    expect(decodeWaveform(encodeWaveform(new Array(300).fill(1)))).not.toBeNull(); // capped at encode
    expect(decodeWaveform("A".repeat(400))).toBeNull(); // 300 bytes
  });

  test("downsample keeps peaks and normalizes", () => {
    expect(downsampleWaveform([0.1, 0.2, 0.05, 0.4], 2)).toEqual([0.5, 1]);
    expect(downsampleWaveform([], 3)).toEqual([0, 0, 0]);
    expect(downsampleWaveform([0.2], 4).length).toBe(4);
  });

  test("sample count ~10/s within 1..256", () => {
    expect(waveformSampleCount(0)).toBe(1);
    expect(waveformSampleCount(3.2)).toBe(32);
    expect(waveformSampleCount(600)).toBe(256);
  });

  test("bars resample and fall back to flat", () => {
    expect(waveformBars(null, 4)).toEqual([0.15, 0.15, 0.15, 0.15]);
    expect(waveformBars([0, 1], 4).length).toBe(4);
  });
});

describe("helpers", () => {
  test("duration text", () => {
    expect(formatVoiceDuration(7.9)).toBe("0:07");
    expect(formatVoiceDuration(65)).toBe("1:05");
    expect(formatVoiceDuration(NaN)).toBe("0:00");
  });

  test("playback speed cycles", () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
    expect(nextPlaybackRate(3)).toBe(1);
  });

  test("recorder format prefers opus, falls back to m4a", () => {
    expect(pickRecorderFormat((t) => t === "audio/webm;codecs=opus")?.fileType).toBe("audio/webm");
    expect(pickRecorderFormat((t) => t.startsWith("audio/mp4"))?.extension).toBe("m4a");
    expect(pickRecorderFormat(() => false)).toBeNull();
    expect(pickRecorderFormat(() => { throw new Error("x"); })).toBeNull();
    const fallback = pickRecorderFormat((t) => t === "audio/webm")!;
    expect(recorderFormatForBlobType("audio/mp4;codecs=mp4a", fallback).fileType).toBe("audio/mp4");
    expect(recorderFormatForBlobType("", fallback)).toBe(fallback);
  });

  test("player detection", () => {
    expect(isVoiceAttachment({ ...audio, durationSecs: 3 })).toBeTrue();
    expect(isVoiceAttachment(audio)).toBeFalse();
    expect(isVoiceAttachment({ contentType: "image/png", durationSecs: 3 })).toBeFalse();
  });

  test("discord shape", () => {
    expect(toDiscordVoiceFields({ durationSecs: 2.5, waveform: "AP8A" })).toEqual({ duration_secs: 2.5, waveform: "AP8A" });
    expect(toDiscordVoiceFields({})).toEqual({});
    const att = fromDiscordVoiceAttachment({ url: "u", content_type: "audio/ogg", duration_secs: 4 });
    expect(att.durationSecs).toBe(4);
    expect((att as { contentType?: string }).contentType).toBe("audio/ogg");
  });
});

describe("normalizeVoiceMessage", () => {
  test("accepts one audio attachment with a duration", () => {
    const r = normalizeVoiceMessage({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...audio, durationSecs: 3.14159, waveform: "AP8A" }] });
    if ("error" in r) throw new Error(r.error);
    expect(r.flag).toBe(IS_VOICE_MESSAGE);
    expect(r.attachments[0].durationSecs).toBe(3.14);
    expect(r.attachments[0].waveform).toBe("AP8A");
  });

  test("drops a malformed waveform but keeps the message", () => {
    const r = normalizeVoiceMessage({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...audio, durationSecs: 2, waveform: "@@" }] });
    if ("error" in r) throw new Error(r.error);
    expect(r.attachments[0].waveform).toBeUndefined();
  });

  test("rejects text, stickers, several files, non-audio, bad durations", () => {
    const ok = { ...audio, durationSecs: 2 };
    const bad = (input: Parameters<typeof normalizeVoiceMessage>[0]) => "error" in normalizeVoiceMessage(input);
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, content: "hi", attachments: [ok] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, hasSticker: true, attachments: [ok] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [ok, ok] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...ok, contentType: "image/png" }] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...audio }] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...audio, durationSecs: 99999 }] })).toBeTrue();
    expect(bad({ requestedFlags: IS_VOICE_MESSAGE, attachments: [{ ...audio, durationSecs: -1 }] })).toBeTrue();
  });

  test("strips voice metadata from normal sends", () => {
    const r = normalizeVoiceMessage({ requestedFlags: 0, attachments: [{ ...audio, durationSecs: 2, waveform: "AP8A" }] });
    if ("error" in r) throw new Error(r.error);
    expect(r.flag).toBe(0);
    expect(r.attachments[0]).toEqual(audio);
  });
});

describe("SEND_VOICE_MESSAGES", () => {
  const bit = PERMISSION_BITS.SEND_VOICE_MESSAGES;
  const ctx = { serverId: "s", everyoneRoleId: "e", memberRoleIds: ["r"], userId: "u" };
  test("granted bit allows", () => {
    expect(canSendVoiceMessages(bit, [], ctx)).toBeTrue();
  });
  test("legacy bitfield without the bit is allowed unless an overwrite denies it", () => {
    expect(canSendVoiceMessages(0n, [], ctx)).toBeTrue();
    expect(canSendVoiceMessages(0n, [{ id: "e", type: "role", deny: bit.toString() }], ctx)).toBeFalse();
    expect(
      canSendVoiceMessages(0n, [
        { id: "e", type: "role", deny: bit.toString() },
        { id: "r", type: "role", allow: bit.toString() },
      ], ctx),
    ).toBeTrue();
    expect(canSendVoiceMessages(0n, [{ id: "u", type: "member", deny: bit.toString() }], ctx)).toBeFalse();
  });
});
