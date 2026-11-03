import { describe, expect, test } from "bun:test";
import { looksLikeAudio } from "@/lib/media/audioSniff";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string, pad = 0) => new Uint8Array([...Array(pad).fill(0), ...[...s].map((c) => c.charCodeAt(0))]);

describe("looksLikeAudio", () => {
  test("recognises what browsers record and common audio files", () => {
    expect(looksLikeAudio(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0))).toBeTrue(); // webm
    expect(looksLikeAudio(text("OggS\0\0"))).toBeTrue();
    expect(looksLikeAudio(text("ftypM4A ", 4))).toBeTrue();
    expect(looksLikeAudio(text("ID3\x04"))).toBeTrue();
    expect(looksLikeAudio(bytes(0xff, 0xfb, 0x90, 0x64))).toBeTrue(); // mp3 frame
    expect(looksLikeAudio(text("RIFF\0\0\0\0WAVE"))).toBeTrue();
    expect(looksLikeAudio(text("fLaC\0"))).toBeTrue();
  });
  test("rejects other files claiming to be audio", () => {
    expect(looksLikeAudio(text("<html><script>"))).toBeFalse();
    expect(looksLikeAudio(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeFalse(); // exe
    expect(looksLikeAudio(bytes(0x89, 0x50, 0x4e, 0x47))).toBeFalse(); // png
    expect(looksLikeAudio(text("RIFF\0\0\0\0AVI "))).toBeFalse();
    expect(looksLikeAudio(bytes(1, 2))).toBeFalse();
  });
});
