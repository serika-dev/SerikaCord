import { describe, expect, test } from "bun:test";
import {
  RICH_DATA_BUDGET,
  RICH_PUSH_PROTOCOL,
  attachmentPreview,
  buildFcmMessage,
  buildRichMessageData,
  normalizePushPlatform,
  pushImageUrl,
  pushPreview,
  pushProtocolOf,
  type PushPayload,
} from "@/lib/push/fcm";

type MessagePayload = Extract<PushPayload, { kind: "message" }>;

const dm = (over: Partial<MessagePayload> = {}): MessagePayload => ({
  kind: "message",
  title: "Alice",
  body: "hi there",
  route: "/dm/u-alice?jump=m1",
  tag: "message-c1",
  rich: {
    kind: "dm",
    channelId: "c1",
    conversationTitle: "Alice",
    authorId: "u-alice",
    authorName: "Alice",
    authorAvatar: "https://cdn.serika.chat/avatars/u-alice/a.png?w=128",
    messageId: "m1",
    mention: false,
    timestamp: 1_760_000_000_000,
    canReply: true,
  },
  ...over,
});

function bytes(data: Record<string, string>): number {
  return Object.entries(data).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
}

describe("push protocol", () => {
  test("platform strings map to a protocol; unknown means legacy", () => {
    expect(pushProtocolOf("android")).toBe(1);
    expect(pushProtocolOf("ios")).toBe(1);
    expect(pushProtocolOf(null)).toBe(1);
    expect(pushProtocolOf("android-2")).toBe(2);
    expect(pushProtocolOf("android-x")).toBe(1);
  });

  test("normalizes registered platforms", () => {
    expect(normalizePushPlatform("android")).toBe("android");
    expect(normalizePushPlatform("ios")).toBe("ios");
    expect(normalizePushPlatform("android-2")).toBe("android-2");
    expect(normalizePushPlatform("android-1")).toBe("android");
    expect(normalizePushPlatform("android-1000")).toBe("android");
    expect(normalizePushPlatform("weird")).toBe("android");
    expect(normalizePushPlatform(undefined)).toBe("android");
  });
});

describe("rich message pushes", () => {
  test("old APKs keep the system-rendered notification push", () => {
    for (const protocol of [undefined, 1]) {
      const msg = buildFcmMessage("tok", dm(), { protocol }) as { notification?: unknown; data: Record<string, string> };
      expect(msg.notification).toEqual({ title: "Alice", body: "hi there" });
      expect(msg.data).toEqual({ type: "message", route: "/dm/u-alice?jump=m1", tag: "message-c1" });
    }
  });

  test("capable APKs get a data-only, high-priority push", () => {
    const msg = buildFcmMessage("tok", dm(), { protocol: RICH_PUSH_PROTOCOL }) as {
      token: string;
      notification?: unknown;
      apns?: unknown;
      data: Record<string, string>;
      android: { priority: string; collapse_key?: string; notification?: unknown };
    };
    expect(msg.token).toBe("tok");
    expect(msg.notification).toBeUndefined();
    expect(msg.android.notification).toBeUndefined();
    expect(msg.android.priority).toBe("HIGH");
    expect(msg.android.collapse_key).toBeUndefined();
    expect(msg.data).toEqual({
      type: "message",
      v: "2",
      tag: "message-c1",
      route: "/dm/u-alice?jump=m1",
      kind: "dm",
      channelId: "c1",
      serverId: "",
      title: "Alice",
      authorId: "u-alice",
      authorName: "Alice",
      avatar: "https://cdn.serika.chat/avatars/u-alice/a.png?w=128",
      icon: "",
      messageId: "m1",
      body: "hi there",
      image: "",
      mention: "0",
      ts: "1760000000000",
      replyChannelId: "c1",
      canReply: "1",
    });
    expect(Object.values(msg.data).every((v) => typeof v === "string")).toBe(true);
  });

  test("a payload without rich info stays legacy even for capable APKs", () => {
    const msg = buildFcmMessage("tok", { ...dm(), rich: undefined }, { protocol: 2 }) as { notification?: unknown };
    expect(msg.notification).toBeDefined();
  });

  test("server mentions carry the channel title, icon and mention flag", () => {
    const data = buildRichMessageData(dm({
      route: "/channels/s1/c9?jump=m9",
      tag: "message-c9",
      rich: {
        kind: "channel",
        channelId: "c9",
        serverId: "s1",
        conversationTitle: "#general · Serika",
        authorId: "u-bob",
        authorName: "Bob",
        icon: "https://cdn.serika.chat/icons/s1.png",
        image: "https://cdn.serika.chat/attachments/u-bob/x.png",
        messageId: "m9",
        mention: true,
        canReply: false,
      },
    }));
    expect(data.kind).toBe("channel");
    expect(data.title).toBe("#general · Serika");
    expect(data.serverId).toBe("s1");
    expect(data.mention).toBe("1");
    expect(data.icon).toBe("https://cdn.serika.chat/icons/s1.png");
    expect(data.image).toBe("https://cdn.serika.chat/attachments/u-bob/x.png");
    expect(data.canReply).toBe("0");
    expect(data.replyChannelId).toBe("");
  });

  test("drops non-https picture URLs", () => {
    const base = dm();
    const data = buildRichMessageData({
      ...base,
      rich: { ...base.rich!, authorAvatar: "http://evil.example/a.png", image: "javascript:alert(1)", icon: "/relative.png" },
    });
    expect(data.avatar).toBe("");
    expect(data.image).toBe("");
    expect(data.icon).toBe("");
  });

  test("clips long fields and stays under the FCM 4KB data limit", () => {
    const long = "🎉".repeat(2000);
    const url = `https://cdn.serika.chat/${"a".repeat(590)}`;
    const base = dm();
    const data = buildRichMessageData({
      ...base,
      title: long,
      body: long,
      route: `/dm/u?jump=${"x".repeat(400)}`,
      rich: { ...base.rich!, conversationTitle: long, authorName: long, authorAvatar: url, icon: url, image: url },
    });
    expect(bytes(data) <= RICH_DATA_BUDGET).toBe(true);
    expect(bytes(data)).toBeLessThan(4096);
    expect(data.body.length).toBeGreaterThan(0);
    expect(data.title.length <= 100).toBe(true);
    // Whole FCM message JSON for a worst case is still well within limits.
    const msg = buildFcmMessage("t".repeat(200), { ...base, title: long, body: long, rich: base.rich }, { protocol: 2 });
    expect(Buffer.byteLength(JSON.stringify(msg))).toBeLessThan(4096);
  });
});

describe("push previews", () => {
  test("mention names and hidden spoilers", () => {
    expect(pushPreview("hi <@u1> in <#c1> ||secret|| ok", undefined, { users: { u1: "Alice" }, channels: { c1: "general" } }))
      .toBe("hi @Alice in #general [spoiler] ok");
    expect(pushPreview("&lt;@u1&gt; ||a\nb||")).toBe("@user [spoiler]");
  });

  test("attachment labels", () => {
    const img = { url: "https://cdn.serika.chat/a.png", contentType: "image/png", filename: "a.png" };
    expect(attachmentPreview([img])).toEqual({ label: "📷 Photo", image: img.url });
    expect(attachmentPreview([img, img]).label).toBe("📷 2 photos");
    expect(attachmentPreview([{ contentType: "image/gif", filename: "x.gif", url: "https://x/y.gif" }])).toEqual({ label: "🖼️ GIF", image: null });
    expect(attachmentPreview([{ contentType: "video/mp4", filename: "v.mp4" }]).label).toBe("🎥 Video");
    expect(attachmentPreview([{ contentType: "audio/ogg", filename: "voice.ogg", durationSecs: 4 }]).label).toBe("🎤 Voice message");
    expect(attachmentPreview([{ contentType: "audio/mpeg", filename: "song.mp3" }]).label).toBe("🎵 Audio");
    expect(attachmentPreview([{ contentType: "application/pdf", filename: "report.pdf" }]).label).toBe("📎 report.pdf");
    expect(attachmentPreview([img, { contentType: "application/pdf", filename: "r.pdf" }]))
      .toEqual({ label: "📎 2 attachments", image: img.url });
    expect(attachmentPreview([], { name: "Wave" })).toEqual({ label: "Sticker: Wave", image: null });
    expect(attachmentPreview([])).toEqual({ label: "", image: null });
  });

  test("spoiler and sensitive images are never shown inline", () => {
    const img = { url: "https://cdn.serika.chat/a.png", contentType: "image/png", filename: "a.png" };
    expect(attachmentPreview([{ ...img, spoiler: true }])).toEqual({ label: "📷 Photo (spoiler)", image: null });
    expect(attachmentPreview([{ ...img, sensitive: true }]).image).toBeNull();
  });

  test("CDN picture URLs get a small still rendition", () => {
    const u = new URL(pushImageUrl("https://cdn.serika.chat/avatars/u/a.gif", 128)!);
    expect(u.searchParams.get("w")).toBe("128");
    expect(u.searchParams.get("h")).toBe("128");
    expect(u.searchParams.get("fit")).toBe("cover");
    expect(u.searchParams.get("n")).toBe("1");
    expect(u.searchParams.get("format")).toBe("webp");
    expect(new URL(pushImageUrl("https://cdn.serika.chat/a.png?format=png", 720)!).searchParams.get("format")).toBe("png");
    // Other hosts are dropped: the phone would reveal its IP to them.
    expect(pushImageUrl("https://cdn.discordapp.com/avatars/1/a.png", 128)).toBeNull();
    expect(pushImageUrl("http://cdn.serika.chat/a.png", 128)).toBeNull();
    expect(pushImageUrl("/api/avatar.png", 128)).toBeNull();
    expect(pushImageUrl(null, 128)).toBeNull();
  });
});

describe("clipping", () => {
  test("never splits an emoji", () => {
    const data = buildRichMessageData(dm({ body: `a${"🎉".repeat(400)}` }));
    expect(data.body.endsWith("…")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(data.body)).toBe(false);
  });
});
