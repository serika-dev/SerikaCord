import { describe, expect, test } from "bun:test";
import {
  RICH_PRESENCE_LIMITS,
  safeRichPresenceAssetImage,
  safeRichPresenceImageUrl,
  safeRichPresenceLink,
  sanitizeRichPresenceItem,
  sanitizeRichPresenceReport,
} from "@/lib/presence/richPresenceSafety";

describe("safeRichPresenceImageUrl", () => {
  test("accepts https on the allowed hosts", () => {
    for (const url of [
      "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/header.jpg",
      "https://cdn.akamai.steamstatic.com/steam/apps/10/header.jpg",
      "https://steamcdn-a.akamaihd.net/steam/apps/10/header.jpg",
      "https://i.scdn.co/image/ab67616d0000b273",
      "https://cdn.serika.chat/apps/x/cover.png",
      "https://cdn.discordapp.com/app-assets/1/2.png",
      "https://lastfm.freetls.fastly.net/i/u/300x300/a.png",
      "https://wsrv.nl/?url=cdn.serika.chat/a.png",
    ]) {
      expect(safeRichPresenceImageUrl(url)).toBe(url);
    }
  });

  test("drops other hosts, plain http, credentials and odd schemes", () => {
    for (const url of [
      "http://images.igdb.com/a.jpg",
      "https://evil.example/a.png",
      "https://images.igdb.com.evil.example/a.png",
      "https://steamstatic.com.evil.example/a.png",
      "https://user:pass@cdn.serika.chat/a.png",
      "https://cdn.serika.chat:8443/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//cdn.serika.chat/a.png",
      "/api/x.png",
      "https://cdn.serika.chat/" + "a".repeat(600),
      42,
      null,
    ]) {
      expect(safeRichPresenceImageUrl(url)).toBeNull();
    }
  });

  test("asset images: plain keys kept, URLs must be allowed", () => {
    expect(safeRichPresenceAssetImage("cover_large")).toBe("cover_large");
    expect(safeRichPresenceAssetImage("https://evil.example/a.png")).toBeNull();
    expect(safeRichPresenceAssetImage("https://cdn.serika.chat/a.png")).toBe("https://cdn.serika.chat/a.png");
  });

  test("button links are http(s) only", () => {
    expect(safeRichPresenceLink("https://store.example/game")).toBe("https://store.example/game");
    expect(safeRichPresenceLink("javascript:alert(1)")).toBeNull();
    expect(safeRichPresenceLink("data:text/html,x")).toBeNull();
  });
});

describe("sanitizeRichPresenceReport", () => {
  test("cleans one item", () => {
    const item = sanitizeRichPresenceItem({
      type: "game",
      name: "  Hades  ",
      details: "Run 12\nfloor 3",
      largeImageUrl: "https://evil.example/x.png",
      smallImageUrl: "https://images.igdb.com/a.jpg",
      startedAt: "not a date",
      endsAt: "2026-11-03T10:00:00.000Z",
      applicationId: "not-a-uuid",
      buttons: [{ label: "Play", url: "javascript:alert(1)" }, { label: "Store", url: "https://store.example" }],
      partySize: [1, "x"],
    });
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Hades");
    expect(item!.details).toBe("Run 12 floor 3");
    expect(item!.largeImageUrl).toBeNull();
    expect(item!.smallImageUrl).toBe("https://images.igdb.com/a.jpg");
    expect(item!.startedAt).toBeNull();
    expect(item!.endsAt?.toISOString()).toBe("2026-11-03T10:00:00.000Z");
    expect(item!.applicationId).toBeNull();
    expect(item!.buttons).toEqual([{ label: "Store", url: "https://store.example/" }]);
    expect(item!.partySize).toBeNull();
  });

  test("unknown type becomes other; nameless items are skipped", () => {
    expect(sanitizeRichPresenceItem({ name: "x", type: "<script>" })!.type).toBe("other");
    expect(sanitizeRichPresenceItem({ name: "   " })).toBeNull();
    expect(sanitizeRichPresenceItem("x")).toBeNull();
  });

  test("single object or list, deduped and capped", () => {
    expect(sanitizeRichPresenceReport({ name: "Zed", type: "zed" }).map((a) => a.name)).toEqual(["Zed"]);
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `App ${i}` }));
    expect(sanitizeRichPresenceReport({ activities: many })).toHaveLength(RICH_PRESENCE_LIMITS.maxActivities);
    expect(sanitizeRichPresenceReport({ activities: [{ name: "A" }, { name: "A" }, { name: "A", type: "game" }] })).toHaveLength(2);
    expect(sanitizeRichPresenceReport(null)).toEqual([]);
  });
});
