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

describe("Discord-hosted profile images", () => {
  const animatedAvatar = "https://cdn.discordapp.com/avatars/884490892201844736/a_902469758d5f7576058d581924eabbbe.gif";

  test("an animated avatar becomes a small still WebP", () => {
    const u = new URL(cdnImage(animatedAvatar));
    expect(u.pathname).toBe("/avatars/884490892201844736/a_902469758d5f7576058d581924eabbbe.webp");
    expect(u.searchParams.get("size")).toBe("256");
    expect(u.searchParams.has("animated")).toBe(false);
  });

  test("animated keeps the original", () => {
    expect(cdnImage(animatedAvatar, { animated: true })).toBe(animatedAvatar);
  });

  test("keeps a size the caller chose; server icons and member avatars too", () => {
    expect(new URL(cdnImage("https://cdn.discordapp.com/icons/1/abc.png?size=64")).searchParams.get("size")).toBe("64");
    expect(new URL(cdnImage("https://cdn.discordapp.com/guilds/1/users/2/avatars/a_x.gif")).pathname).toBe("/guilds/1/users/2/avatars/a_x.webp");
  });

  test("attachments, emoji and stickers are left alone", () => {
    for (const u of [
      "https://cdn.discordapp.com/attachments/1/2/party.gif",
      "https://media.discordapp.net/attachments/1/2/clip.gif?width=300",
      "https://cdn.discordapp.com/emojis/123.gif",
      "https://cdn.discordapp.com/stickers/123.png",
      "https://cdn.discordapp.com.evil.example/avatars/1/a_x.gif",
    ]) expect(cdnImage(u)).toBe(u);
  });
});
