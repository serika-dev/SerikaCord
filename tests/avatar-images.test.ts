import { describe, expect, test } from "bun:test";
import { cdnImage, cdnImageFallback } from "@/lib/utils";

describe("avatar CDN image recovery", () => {
  test("can retry an optimized avatar in its original format", () => {
    const original = "https://cdn.serika.chat/avatars/test/avatar.gif";
    const optimized = cdnImage(original);
    expect(new URL(optimized).searchParams.get("format")).toBe("webp");
    expect(cdnImageFallback(optimized)).toBe(original);
    // The retry cannot generate another retry and loop on an unavailable file.
    expect(cdnImageFallback(cdnImageFallback(optimized))).toBeUndefined();
  });

  test("keeps first-frame, sizing and crop settings when conversion fails", () => {
    const optimized = cdnImage("https://cdn.serika.chat/avatars/test/avatar.gif?w=128&h=128&fit=cover&v=2#preview", { still: true });
    const fallback = new URL(cdnImageFallback(optimized)!);
    expect(fallback.searchParams.get("n")).toBe("1");
    expect(fallback.searchParams.get("w")).toBe("128");
    expect(fallback.searchParams.get("h")).toBe("128");
    expect(fallback.searchParams.get("fit")).toBe("cover");
    expect(fallback.searchParams.get("v")).toBe("2");
    expect(fallback.hash).toBe("#preview");
    expect(fallback.searchParams.has("format")).toBe(false);
  });

  test("handles all supported format aliases and preserves animated frames", () => {
    const fallback = new URL(cdnImageFallback("https://cdn.serika.chat/avatars/test/avatar.gif?format=webp&output=webp&fm=webp&n=-1")!);
    expect([...fallback.searchParams]).toEqual([["n", "-1"]]);
  });

  test("does not rewrite external, local, invalid or unconverted images", () => {
    for (const source of [
      undefined,
      null,
      "",
      "/avatars/avatar.png?format=webp",
      "blob:https://serika.chat/avatar",
      "data:image/png;base64,abc",
      "https://cdn.discordapp.com/avatars/test/avatar.png?format=webp",
      "https://cdn.serika.chat.example/avatars/test/avatar.png?format=webp",
      "https://example.com/cdn.serika.chat/avatar.png?format=webp",
      "https://cdn.serika.chat/avatars/test/avatar.png",
      "ftp://cdn.serika.chat/avatars/test/avatar.png?format=webp",
      "cdn.serika.chat/avatars/test/avatar.png?format=webp",
    ]) {
      expect(cdnImageFallback(source)).toBeUndefined();
    }
  });
});
