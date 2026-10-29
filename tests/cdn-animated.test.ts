import { describe, expect, test } from "bun:test";
import { cdnImage, retryWithOriginalImage } from "@/lib/utils";

describe("animated CDN images (stickers, custom emoji)", () => {
  const sticker = "https://cdn.serika.chat/stickers/s1/party.gif";

  test("animated keeps every frame (wsrv n=-1) as WebP", () => {
    const params = new URL(cdnImage(sticker, { animated: true })).searchParams;
    expect(params.get("n")).toBe("-1");
    expect(params.get("format")).toBe("webp");
  });

  test("still keeps only the first frame", () => {
    expect(new URL(cdnImage(sticker, { still: true })).searchParams.get("n")).toBe("1");
  });

  test("the default stays unchanged (no frame setting)", () => {
    expect(new URL(cdnImage(sticker)).searchParams.has("n")).toBe(false);
  });

  test("still wins over animated", () => {
    expect(new URL(cdnImage(sticker, { still: true, animated: true })).searchParams.get("n")).toBe("1");
  });

  test("a failed conversion retries the original file once", () => {
    const img = { src: cdnImage(sticker, { animated: true }), dataset: {} as Record<string, string> };
    const onError = retryWithOriginalImage(sticker);
    onError({ currentTarget: img as unknown as HTMLImageElement });
    expect(img.src).toBe(sticker);
    img.src = "broken";
    onError({ currentTarget: img as unknown as HTMLImageElement });
    expect(img.src).toBe("broken");
  });
});
