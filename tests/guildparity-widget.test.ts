import { describe, expect, test } from "bun:test";
import { buildWidget, publicVoiceChannels } from "@/lib/botapi/guildWidgetRules";
import { fitText, fontText, initials, PixelCanvas, renderWidgetImage, widgetStyleOf, WIDGET_STYLES } from "@/lib/botapi/guildWidgetImage";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

const G = "77777777-7777-4777-8777-777777777777";
const EVERYONE = "88888888-8888-4888-8888-888888888888";
const VIEW_CONNECT = (PERMISSION_BITS.VIEW_CHANNEL | PERMISSION_BITS.CONNECT).toString();

describe("publicVoiceChannels", () => {
  const channels = [
    { id: "v2", name: "Second", type: "voice", position: 2 },
    { id: "v1", name: "First", type: "voice", position: 1 },
    { id: "t", name: "text", type: "text", position: 0 },
    { id: "s", name: "Stage", type: "stage", position: 3 },
    { id: "priv", name: "Private", type: "voice", position: 4, permissionOverwrites: [{ id: EVERYONE, type: "role", allow: "0", deny: PERMISSION_BITS.VIEW_CHANNEL.toString() }] },
    { id: "noconn", name: "Listen only", type: "voice", position: 5, permissionOverwrites: [{ id: G, type: "role", allow: "0", deny: PERMISSION_BITS.CONNECT.toString() }] },
    { id: "nsfw", name: "Adults", type: "voice", position: 6, nsfw: true },
  ];
  test("voice/stage channels @everyone can view and join, by position", () => {
    const out = publicVoiceChannels(channels, { serverId: G, everyoneRoleId: EVERYONE, everyonePermissions: BigInt(VIEW_CONNECT) });
    expect(out).toEqual([
      { id: "v1", name: "First", position: 1 },
      { id: "v2", name: "Second", position: 2 },
      { id: "s", name: "Stage", position: 3 },
    ]);
  });
  test("nothing when @everyone can't connect", () => {
    const out = publicVoiceChannels(channels, { serverId: G, everyoneRoleId: EVERYONE, everyonePermissions: PERMISSION_BITS.VIEW_CHANNEL });
    expect(out).toEqual([]);
  });
});

describe("buildWidget", () => {
  test("anonymized members with voice state only in listed channels", () => {
    const w = buildWidget({
      id: G,
      name: "Guild",
      instantInvite: null,
      channels: [{ id: "v1", name: "First", position: 1 }],
      members: [
        { userId: "a", username: "alice", displayName: "Alice", avatarUrl: "https://x/a.png", status: "online" },
        { userId: "b", username: "bob", avatarUrl: "https://x/b.png", status: "idle", activityName: "Chess" },
      ],
      voiceStates: [
        { user_id: "A", channel_id: "V1", self_mute: true },
        { user_id: "b", channel_id: "hidden" },
      ],
      presenceCount: 7,
    });
    expect(w.presence_count).toBe(7);
    expect(w.members[0]).toEqual({
      id: "0", username: "Alice", discriminator: "0000", avatar: null, status: "online", avatar_url: "https://x/a.png",
      channel_id: "V1", deaf: false, mute: false, self_deaf: false, self_mute: true, suppress: false,
    });
    expect(w.members[1]).toEqual({ id: "1", username: "bob", discriminator: "0000", avatar: null, status: "idle", avatar_url: "https://x/b.png", activity: { name: "Chess" } });
  });
  test("at most 100 members", () => {
    const members = Array.from({ length: 150 }, (_, i) => ({ userId: String(i), username: `u${i}`, avatarUrl: "x", status: "online" as const }));
    expect(buildWidget({ id: G, name: "n", instantInvite: null, channels: [], members, voiceStates: [], presenceCount: 150 }).members).toHaveLength(100);
  });
});

describe("widget image", () => {
  test("style parameter", () => {
    expect(widgetStyleOf(undefined)).toBe("shield");
    expect(widgetStyleOf("BANNER3")).toBe("banner3");
    expect(widgetStyleOf("weird")).toBe("shield");
  });
  test("font text", () => {
    expect(fontText("Café ☕ Club")).toBe("CAFE CLUB");
    expect(initials("the cozy corner")).toBe("TC");
    expect(initials("☕☕")).toBe("?");
    expect(fitText("ABCDEFGHIJ", 1, PixelCanvas.textWidth("ABCDE...", 1))).toBe("ABCDE...");
    expect(fitText("ABC", 1, 1000)).toBe("ABC");
  });
  test("every style renders an RGBA buffer of its size", () => {
    for (const style of WIDGET_STYLES) {
      const img = renderWidgetImage(style, { name: "A very long server name that will not fit anywhere at all", online: 12345 });
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(img.data.length).toBe(img.width * img.height * 4);
      // Something was drawn (non-transparent pixels).
      expect(img.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
    const banner1 = renderWidgetImage("banner1", { name: "x", online: 0 });
    expect([banner1.width, banner1.height]).toEqual([320, 82]);
  });
  test("encodes as PNG with sharp", async () => {
    const img = renderWidgetImage("shield", { name: "Guild", online: 3 });
    const { default: sharp } = await import("sharp");
    const png = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
