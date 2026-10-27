import { describe, expect, test } from "bun:test";
import {
  guildSoundboardSounds,
  parseSoundData,
  parseSoundFields,
  sniffSound,
  soundEmoji,
  storedSounds,
  toDiscordSound,
} from "@/lib/botapi/guildSoundboardRules";

const ID = "44444444-4444-4444-8444-444444444444";
const EMOJI = "55555555-5555-4555-8555-555555555555";
const GUILD = "66666666-6666-4666-8666-666666666666";

describe("toDiscordSound", () => {
  test("unicode emoji, volume default", () => {
    const s = toDiscordSound({ id: ID, name: "honk", emoji: "🔊", url: "https://cdn/x.mp3" }, GUILD, { available: true });
    expect(s).toEqual({ name: "honk", sound_id: ID, volume: 1, emoji_id: null, emoji_name: "🔊", guild_id: GUILD, available: true });
  });
  test("custom emoji token, user when allowed", () => {
    const s = toDiscordSound({ id: ID, name: "x", emoji: `<:cool:${EMOJI}>`, volume: 0.5 }, GUILD, { available: false, user: { id: "u" } });
    expect(s.emoji_id).toBe(EMOJI);
    expect(s.emoji_name).toBeNull();
    expect(s.volume).toBe(0.5);
    expect(s.available).toBe(false);
    expect(s.user).toEqual({ id: "u" });
  });
  test("soundEmoji of junk", () => {
    expect(soundEmoji("not an emoji")).toEqual({ emoji_id: null, emoji_name: null });
  });
});

describe("stored sounds", () => {
  test("only entries with a UUID id", () => {
    expect(storedSounds([{ id: ID }, { id: "legacy" }, null, "x"]).map((s) => s.id)).toEqual([ID]);
    expect(storedSounds(null)).toEqual([]);
  });
  test("GUILD_CREATE list follows settings.soundboard.enabled", () => {
    const list = guildSoundboardSounds({ id: GUILD, soundboardSounds: [{ id: ID, name: "a" }], settings: { soundboard: { enabled: false } } });
    expect(list).toHaveLength(1);
    expect(list[0].available).toBe(false);
  });
});

describe("sound data", () => {
  const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(16)]);
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(16)]);
  test("sniff", () => {
    expect(sniffSound(ogg)).toBe("audio/ogg");
    expect(sniffSound(mp3)).toBe("audio/mpeg");
    expect(sniffSound(Buffer.from([0xff, 0xfb, 0x90]))).toBe("audio/mpeg");
    expect(sniffSound(Buffer.from("RIFF...."))).toBeNull();
  });
  test("data URIs", () => {
    const ok = parseSoundData(`data:audio/ogg;base64,${ogg.toString("base64")}`);
    expect(ok.ok && ok.contentType).toBe("audio/ogg");
    expect(ok.ok && ok.ext).toBe("ogg");
    // Declared type doesn't matter, the bytes do.
    const lied = parseSoundData(`data:audio/mpeg;base64,${Buffer.from("<svg/>").toString("base64")}`);
    expect(lied.ok).toBe(false);
    expect(parseSoundData("https://example.com/a.mp3").ok).toBe(false);
    const big = parseSoundData(`data:audio/mpeg;base64,${Buffer.concat([mp3, Buffer.alloc(600 * 1024)]).toString("base64")}`);
    expect(!big.ok && big.code).toBe("BINARY_TYPE_MAX_SIZE");
  });
});

describe("fields", () => {
  test("create needs a name", () => {
    expect(parseSoundFields({}, { create: true }).ok).toBe(false);
    expect(parseSoundFields({ name: "a" }, { create: true }).ok).toBe(false);
    const ok = parseSoundFields({ name: " honk ", volume: 0.25, emoji_name: "🦆" }, { create: true });
    expect(ok).toEqual({ ok: true, fields: { name: "honk", volume: 0.25, emojiName: "🦆" } });
  });
  test("patch: volume null resets, both emojis conflict, bad emoji", () => {
    expect(parseSoundFields({ volume: null }, { create: false })).toEqual({ ok: true, fields: { volume: 1 } });
    expect(parseSoundFields({ volume: 2 }, { create: false }).ok).toBe(false);
    expect(parseSoundFields({ emoji_id: EMOJI, emoji_name: "🦆" }, { create: false }).ok).toBe(false);
    expect(parseSoundFields({ emoji_name: "duck" }, { create: false }).ok).toBe(false);
    expect(parseSoundFields({ emoji_id: null, emoji_name: null }, { create: false })).toEqual({ ok: true, fields: { emojiId: null, emojiName: null } });
  });
});
