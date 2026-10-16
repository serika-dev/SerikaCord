import { describe, expect, test } from "bun:test";
import {
  MAX_EMOJI_BYTES,
  emojiNameError,
  isAnimatedImage,
  parseImageDataUri,
  parseStickerFields,
  sniffImage,
  stickerKind,
  stickerTagList,
} from "@/lib/botapi/expressionRules";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1");
const dataUri = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

describe("parseImageDataUri", () => {
  test("accepts a PNG and reports the sniffed type", () => {
    const r = parseImageDataUri(dataUri("image/png", PNG), MAX_EMOJI_BYTES);
    expect(r.ok && r.kind).toBe("image/png");
    expect(r.ok && r.animated).toBe(false);
  });
  test("uses the bytes, not the declared type", () => {
    const r = parseImageDataUri(dataUri("image/png", GIF), MAX_EMOJI_BYTES);
    expect(r.ok && r.kind).toBe("image/gif");
  });
  test("rejects non-images, urls and svg", () => {
    expect(parseImageDataUri("https://example.com/a.png", MAX_EMOJI_BYTES).ok).toBe(false);
    expect(parseImageDataUri(dataUri("image/svg+xml", Buffer.from("<svg/>")), MAX_EMOJI_BYTES).ok).toBe(false);
    expect(parseImageDataUri(dataUri("image/png", Buffer.from("not an image")), MAX_EMOJI_BYTES).ok).toBe(false);
    expect(parseImageDataUri(42, MAX_EMOJI_BYTES).ok).toBe(false);
  });
  test("size cap applies before decoding (no truncation)", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
    const r = parseImageDataUri(dataUri("image/png", big), 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BINARY_TYPE_MAX_SIZE");
    const huge = `data:image/png;base64,${"A".repeat(100_000)}`;
    expect(parseImageDataUri(huge, 1024).ok).toBe(false);
  });
});

describe("sniffing", () => {
  test("magic numbers", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(GIF)).toBe("image/gif");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(sniffImage(Buffer.from("hello"))).toBeNull();
  });
  test("animated gif needs two frames", () => {
    const one = Buffer.concat([GIF, Buffer.from([0x21, 0xf9, 0x04])]);
    const two = Buffer.concat([one, Buffer.from([0x21, 0xf9, 0x04])]);
    expect(isAnimatedImage("image/gif", one)).toBe(false);
    expect(isAnimatedImage("image/gif", two)).toBe(true);
  });
  test("sticker kinds: png / gif / lottie json, not jpeg", () => {
    expect(stickerKind(PNG, "image/png")).toBe("image/png");
    expect(stickerKind(Buffer.from('{"v":"5.5"}'), "application/json")).toBe("application/json");
    expect(stickerKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBeNull();
  });
});

describe("names and fields", () => {
  test("emoji names", () => {
    expect(emojiNameError("ok_name")).toBeNull();
    expect(emojiNameError("a")?.code).toBe("BASE_TYPE_BAD_LENGTH");
    expect(emojiNameError("bad name")?.code).toBe("STRING_TYPE_REGEX");
    expect(emojiNameError(undefined)?.code).toBe("BASE_TYPE_REQUIRED");
  });
  test("sticker fields on create", () => {
    expect(parseStickerFields({ name: "cat", tags: "cat" }, true).ok).toBe(true);
    expect(parseStickerFields({ name: "cat" }, true).ok).toBe(false);
    expect(parseStickerFields({ name: "c", tags: "x" }, true).ok).toBe(false);
    expect(parseStickerFields({ name: "cat", tags: "x", description: "a" }, true).ok).toBe(false);
    const r = parseStickerFields({ name: "cat", tags: "x", description: "" }, true);
    expect(r.ok && r.value.description).toBeNull();
  });
  test("sticker fields on edit only validate what is sent", () => {
    const r = parseStickerFields({ description: "new text" }, false);
    expect(r.ok && r.value).toEqual({ description: "new text" });
  });
  test("tags string -> stored list", () => {
    expect(stickerTagList("cat, dog,,  bird ")).toEqual(["cat", "dog", "bird"]);
  });
});
