import { describe, expect, test } from "bun:test";
import { shouldAutoPlayTts, tameSegmentEffects, ttsPlaybackOptions, ttsSoundEffectsEnabled } from "@/lib/chat/ttsPrefs";

describe("TTS preferences (CORD-35)", () => {
  test("/tts messages from others play by default and can be turned off", () => {
    expect(shouldAutoPlayTts(undefined, "/tts hello")).toBe(true);
    expect(shouldAutoPlayTts({}, "/tts hello")).toBe(true);
    expect(shouldAutoPlayTts({ ttsFromOthers: false }, "/tts hello")).toBe(false);
    expect(shouldAutoPlayTts({}, "plain message")).toBe(false);
    expect(shouldAutoPlayTts({}, "")).toBe(false);
    expect(shouldAutoPlayTts({}, null)).toBe(false);
  });

  test("reading every message aloud still reads everything", () => {
    expect(shouldAutoPlayTts({ tts: true }, "plain message")).toBe(true);
    expect(shouldAutoPlayTts({ tts: true, ttsFromOthers: false }, "/tts hi")).toBe(true);
  });

  test("sound effects are on unless turned off", () => {
    expect(ttsSoundEffectsEnabled(undefined)).toBe(true);
    expect(ttsSoundEffectsEnabled({ ttsSoundEffects: false })).toBe(false);
    expect(ttsPlaybackOptions({ ttsRate: 1.5, ttsVoice: "male", ttsSoundEffects: false })).toEqual({
      rate: 1.5,
      voiceGender: "male",
      soundEffects: false,
    });
  });

  test("with effects off, ear rape and bass boost are dropped and volume is capped", () => {
    expect(tameSegmentEffects({ volume: 5, earRape: true }, false)).toEqual({ volume: 1, bassBoost: false, earRape: false });
    expect(tameSegmentEffects({ volume: 1, bassBoost: true }, false)).toEqual({ volume: 1, bassBoost: false, earRape: false });
    expect(tameSegmentEffects({ volume: 0.5 }, false)).toEqual({ volume: 0.5, bassBoost: false, earRape: false });
    expect(tameSegmentEffects({ volume: 5, earRape: true }, true)).toEqual({ volume: 5, bassBoost: false, earRape: true });
    expect(tameSegmentEffects({ volume: null }, true).volume).toBe(1);
  });
});
