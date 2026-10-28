import { describe, expect, test } from "bun:test";
import {
  buildNotificationContent,
  buildNotificationEmbed,
  extractYouTubeChannelFromHtml,
  neutralizeMentions,
  newYouTubeEntries,
  normalizeMention,
  parseTwitchLogin,
  parseYouTubeChannelInput,
  parseYouTubeFeed,
  readIntegrationConfig,
  shouldAnnounceTwitch,
  twitchPreviewUrl,
  twitchThumbnailUrl,
  youTubeChannelPageUrl,
  TWITCH_RENOTIFY_COOLDOWN_MS,
  type IntegrationItem,
} from "@/lib/integrations/notifications";

const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
const ROLE_ID = "3f1c2b8e-6a0d-4c1e-9b7a-2d5e8f9a1b2c";

describe("YouTube channel input", () => {
  test("bare channel id", () => {
    expect(parseYouTubeChannelInput(CHANNEL_ID)).toEqual({ kind: "id", id: CHANNEL_ID });
  });
  test("channel URLs with and without scheme", () => {
    expect(parseYouTubeChannelInput(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toEqual({ kind: "id", id: CHANNEL_ID });
    expect(parseYouTubeChannelInput(`youtube.com/channel/${CHANNEL_ID}/videos`)).toEqual({ kind: "id", id: CHANNEL_ID });
    expect(parseYouTubeChannelInput(`https://m.youtube.com/channel/${CHANNEL_ID}?si=x`)).toEqual({ kind: "id", id: CHANNEL_ID });
  });
  test("@handles, handle URLs and bare names", () => {
    expect(parseYouTubeChannelInput("@MrBeast")).toEqual({ kind: "handle", handle: "MrBeast" });
    expect(parseYouTubeChannelInput("https://www.youtube.com/@GoogleDevelopers/videos")).toEqual({ kind: "handle", handle: "GoogleDevelopers" });
    expect(parseYouTubeChannelInput("MrBeast")).toEqual({ kind: "handle", handle: "MrBeast" });
  });
  test("legacy custom and user URLs", () => {
    expect(parseYouTubeChannelInput("https://www.youtube.com/c/LinusTechTips")).toEqual({ kind: "path", path: "c/LinusTechTips" });
    expect(parseYouTubeChannelInput("https://youtube.com/user/pewdiepie")).toEqual({ kind: "path", path: "user/pewdiepie" });
    expect(parseYouTubeChannelInput("https://youtube.com/somevanity")).toEqual({ kind: "path", path: "somevanity" });
  });
  test("HTML-escaped input (stored settings are sanitized)", () => {
    expect(parseYouTubeChannelInput(`https:&#x2F;&#x2F;www.youtube.com&#x2F;channel&#x2F;${CHANNEL_ID}`)).toEqual({ kind: "id", id: CHANNEL_ID });
  });
  test("rejects other hosts, videos and junk", () => {
    expect(parseYouTubeChannelInput("https://evil.example/channel/" + CHANNEL_ID)).toBeNull();
    expect(parseYouTubeChannelInput("https://youtube.com.evil.example/@x")).toBeNull();
    expect(parseYouTubeChannelInput("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(parseYouTubeChannelInput("")).toBeNull();
    expect(parseYouTubeChannelInput("has spaces in it")).toBeNull();
    expect(parseYouTubeChannelInput("@a")).toBeNull();
  });
  test("channel page URL only ever points at youtube.com", () => {
    expect(youTubeChannelPageUrl({ kind: "handle", handle: "MrBeast" })).toBe("https://www.youtube.com/@MrBeast");
    expect(youTubeChannelPageUrl({ kind: "path", path: "c/Some Name" })).toBe("https://www.youtube.com/c/Some%20Name");
  });
});

describe("YouTube channel page", () => {
  test("reads id, name and avatar from the canonical link and meta tags", () => {
    const html = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">
      <meta property="og:title" content="Google for Developers">
      <meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c-k">
      </head></html>`;
    expect(extractYouTubeChannelFromHtml(html)).toEqual({
      channelId: CHANNEL_ID,
      name: "Google for Developers",
      avatarUrl: "https://yt3.googleusercontent.com/abc=s900-c-k",
    });
  });
  test("falls back to the identifier meta / externalId and drops foreign avatars", () => {
    const html = `<meta itemprop="identifier" content="${CHANNEL_ID}"><meta property="og:image" content="https://evil.example/a.png">`;
    expect(extractYouTubeChannelFromHtml(html)).toEqual({ channelId: CHANNEL_ID, name: null, avatarUrl: null });
    expect(extractYouTubeChannelFromHtml(`{"externalId":"${CHANNEL_ID}"}`)?.channelId).toBe(CHANNEL_ID);
    expect(extractYouTubeChannelFromHtml("<html>consent page</html>")).toBeNull();
  });
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}"/>
 <id>yt:channel:_x5XG1OV2P6uZZ5FSM9Ttw</id>
 <yt:channelId>_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
 <title>Dev &amp; Friends</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${CHANNEL_ID}"/>
 <author><name>Dev &amp; Friends</name><uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri></author>
 <entry>
  <id>yt:video:AAAAAAAAAA1</id>
  <yt:videoId>AAAAAAAAAA1</yt:videoId>
  <title>Building &lt;things&gt; &amp; more</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAA1"/>
  <published>2026-10-27T16:18:01+00:00</published>
  <media:group><media:thumbnail url="https://i1.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg" width="480" height="360"/></media:group>
 </entry>
 <entry>
  <id>yt:video:BBBBBBBBBB2</id>
  <yt:videoId>BBBBBBBBBB2</yt:videoId>
  <title>A short one</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/BBBBBBBBBB2"/>
  <published>2026-10-21T23:00:08+00:00</published>
 </entry>
 <entry>
  <id>yt:video:CCCCCCCCCC3</id>
  <yt:videoId>CCCCCCCCCC3</yt:videoId>
  <title>Older</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=CCCCCCCCCC3"/>
  <published>2026-10-01T10:00:00+00:00</published>
 </entry>
</feed>`;

describe("YouTube feed parsing", () => {
  const feed = parseYouTubeFeed(FEED);
  test("channel info (feed-level id gets its UC prefix back)", () => {
    expect(feed.channelId).toBe(CHANNEL_ID);
    expect(feed.channelName).toBe("Dev & Friends");
    expect(feed.channelUrl).toBe(`https://www.youtube.com/channel/${CHANNEL_ID}`);
  });
  test("entries newest first with decoded titles, watch URLs and thumbnails", () => {
    expect(feed.entries.map((e) => e.videoId)).toEqual(["AAAAAAAAAA1", "BBBBBBBBBB2", "CCCCCCCCCC3"]);
    expect(feed.entries[0]).toEqual({
      videoId: "AAAAAAAAAA1",
      title: "Building <things> & more",
      url: "https://www.youtube.com/watch?v=AAAAAAAAAA1",
      publishedAt: "2026-10-27T16:18:01.000Z",
      thumbnailUrl: "https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg",
      isShort: false,
    });
  });
  test("Shorts are recognised from their link", () => {
    expect(feed.entries[1].isShort).toBe(true);
    expect(feed.entries[1].url).toBe("https://www.youtube.com/shorts/BBBBBBBBBB2");
  });
  test("garbage in, empty feed out", () => {
    expect(parseYouTubeFeed("").entries).toEqual([]);
    expect(parseYouTubeFeed("<html>nope</html>").entries).toEqual([]);
  });
  test("only entries newer than the last announced one, oldest first", () => {
    const key = `id:${CHANNEL_ID}`;
    const state = { channel: key, lastVideoId: "CCCCCCCCCC3", lastPublishedAt: "2026-10-01T10:00:00.000Z" };
    expect(newYouTubeEntries(feed.entries, state, key).map((e) => e.videoId)).toEqual(["BBBBBBBBBB2", "AAAAAAAAAA1"]);
    expect(newYouTubeEntries(feed.entries, { ...state, lastVideoId: "AAAAAAAAAA1", lastPublishedAt: feed.entries[0].publishedAt }, key)).toEqual([]);
    // First look (or another channel): baseline only, nothing posted.
    expect(newYouTubeEntries(feed.entries, null, key)).toEqual([]);
    expect(newYouTubeEntries(feed.entries, { ...state, channel: "handle:other" }, key)).toEqual([]);
    // A deleted latest video never re-announces older uploads.
    expect(newYouTubeEntries(feed.entries, { channel: key, lastVideoId: "gone", lastPublishedAt: "2026-10-28T00:00:00.000Z" }, key)).toEqual([]);
  });
});

describe("Twitch", () => {
  test("logins from names, @names and links", () => {
    expect(parseTwitchLogin("Shroud")).toBe("shroud");
    expect(parseTwitchLogin("@shroud")).toBe("shroud");
    expect(parseTwitchLogin("https://www.twitch.tv/Shroud/videos")).toBe("shroud");
    expect(parseTwitchLogin("twitch.tv/some_user")).toBe("some_user");
    expect(parseTwitchLogin("https://evil.example/shroud")).toBeNull();
    expect(parseTwitchLogin("bad name")).toBeNull();
    expect(parseTwitchLogin("")).toBeNull();
  });
  test("thumbnail size substitution for live previews and VODs", () => {
    expect(twitchThumbnailUrl("https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-{width}x{height}.jpg"))
      .toBe("https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-1280x720.jpg");
    expect(twitchThumbnailUrl("https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-%{width}x%{height}.jpg", 640, 360))
      .toBe("https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg");
    expect(twitchThumbnailUrl("https://evil.example/{width}x{height}.jpg")).toBeNull();
    expect(twitchThumbnailUrl("")).toBeNull();
    expect(twitchPreviewUrl("shroud")).toBe("https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-1280x720.jpg");
  });
  test("go-live announcements: baseline first, once per stream, cooldown for restarts", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(shouldAnnounceTwitch("s1", null, "shroud", now)).toBe(false);
    const offline = { channel: "shroud", lastStreamId: null, notifiedAt: null };
    expect(shouldAnnounceTwitch("s1", offline, "shroud", now)).toBe(true);
    const announced = { channel: "shroud", lastStreamId: "s1", notifiedAt: new Date(now - 60_000).toISOString() };
    expect(shouldAnnounceTwitch("s1", announced, "shroud", now)).toBe(false);
    expect(shouldAnnounceTwitch("s2", announced, "shroud", now)).toBe(false);
    expect(shouldAnnounceTwitch("s2", announced, "shroud", now + TWITCH_RENOTIFY_COOLDOWN_MS)).toBe(true);
    expect(shouldAnnounceTwitch("s1", { ...offline, channel: "other" }, "shroud", now)).toBe(false);
  });
});

const video: IntegrationItem = {
  kind: "youtube",
  type: "video",
  id: "AAAAAAAAAA1",
  title: "Hello @everyone <@&x> world",
  url: "https://www.youtube.com/watch?v=AAAAAAAAAA1",
  thumbnailUrl: "https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg",
  publishedAt: "2026-10-27T16:18:01.000Z",
  channelName: "Pikachubolk",
  channelUrl: `https://www.youtube.com/channel/${CHANNEL_ID}`,
  channelAvatarUrl: "https://yt3.googleusercontent.com/abc",
};

describe("notification content", () => {
  test("default line without a ping", () => {
    const out = buildNotificationContent({ item: video, mention: { type: "none" } });
    expect(out).toEqual({ content: "**Pikachubolk** just uploaded a new video!", mentionEveryone: false, mentionedRoleIds: [] });
  });
  test("@everyone / @here go first and flag mentionEveryone", () => {
    expect(buildNotificationContent({ item: video, mention: { type: "everyone" } }).content).toBe("@everyone **Pikachubolk** just uploaded a new video!");
    const here = buildNotificationContent({ item: video, mention: { type: "here" } });
    expect(here.content.startsWith("@here ")).toBe(true);
    expect(here.mentionEveryone).toBe(true);
  });
  test("role ping uses role mention syntax and only that role", () => {
    const out = buildNotificationContent({ item: video, mention: { type: "role", roleId: ROLE_ID } });
    expect(out.content.startsWith(`<@&${ROLE_ID}> `)).toBe(true);
    expect(out.mentionedRoleIds).toEqual([ROLE_ID]);
    expect(out.mentionEveryone).toBe(false);
  });
  test("templates fill placeholders but can't ping on their own", () => {
    const out = buildNotificationContent({ item: video, mention: { type: "none" }, template: "@everyone {channel}: {title} {url}" });
    expect(out.mentionEveryone).toBe(false);
    expect(out.content).not.toContain("@everyone");
    expect(out.content).not.toContain("<@&");
    expect(out.content).toContain("Pikachubolk");
    expect(out.content).toContain(video.url);
    expect(neutralizeMentions("@here <@123>")).toBe("@​here <​@123>");
  });
  test("Shorts and Twitch get their own default lines", () => {
    expect(buildNotificationContent({ item: { ...video, type: "short" }, mention: { type: "none" } }).content).toBe("**Pikachubolk** just posted a new Short!");
    expect(buildNotificationContent({ item: { ...video, kind: "twitch", type: "live" }, mention: { type: "none" } }).content).toBe("**Pikachubolk** is now live on Twitch!");
  });
});

describe("notification embed", () => {
  test("YouTube embed: red, author, thumbnail, timestamp, Watch button", () => {
    const { embed, components } = buildNotificationEmbed(video);
    expect(embed.color).toBe(0xff0000);
    expect(embed.url).toBe(video.url);
    expect(embed.author).toEqual({ name: "Pikachubolk", url: video.channelUrl, icon_url: video.channelAvatarUrl! });
    expect(embed.image).toEqual({ url: video.thumbnailUrl! });
    expect(embed.timestamp).toBe(video.publishedAt!);
    expect(embed.footer.text).toBe("YouTube");
    expect(components[0].components[0]).toEqual({ type: 2, style: 5, label: "Watch", url: video.url });
  });
  test("Twitch live embed: purple, game + viewers, test footer", () => {
    const live: IntegrationItem = { ...video, kind: "twitch", type: "live", game: "Minecraft", viewerCount: 1234, url: "https://www.twitch.tv/x" };
    const { embed, components } = buildNotificationEmbed(live, { test: true });
    expect(embed.color).toBe(0x9146ff);
    expect(embed.fields).toEqual([
      { name: "Game", value: "Minecraft", inline: true },
      { name: "Viewers", value: "1,234", inline: true },
    ]);
    expect(embed.footer.text).toBe("Twitch · Test notification");
    expect(components[0].components[0].label).toBe("Watch stream");
  });
});

describe("integration settings", () => {
  test("defaults and normalisation", () => {
    expect(readIntegrationConfig(undefined, "youtube")).toEqual({
      enabled: false, channelInput: "", notifyChannelId: null, mention: { type: "none" }, template: "",
    });
    const cfg = readIntegrationConfig({
      youtube: true,
      youtubeChannel: " @MrBeast ",
      youtubeNotificationChannelId: "c1",
      youtubeMention: "role",
      youtubeMentionRoleId: ROLE_ID,
      youtubeMessage: "New: {title} &amp; more",
    }, "youtube");
    expect(cfg).toEqual({
      enabled: true, channelInput: "@MrBeast", notifyChannelId: "c1", mention: { type: "role", roleId: ROLE_ID }, template: "New: {title} & more",
    });
    expect(normalizeMention("role", "")).toEqual({ type: "none" });
    expect(normalizeMention("bogus", ROLE_ID)).toEqual({ type: "none" });
    expect(normalizeMention("here", ROLE_ID)).toEqual({ type: "here" });
  });
});
