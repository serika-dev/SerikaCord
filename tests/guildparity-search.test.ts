import { describe, expect, test } from "bun:test";
import {
  arrayQuery,
  hostMatches,
  likeLiteral,
  linkHostnames,
  messageLinksTo,
  parseGuildSearchQuery,
  resolveAuthorTypes,
  searchSortFor,
  serikaHas,
  usesContentFilters,
} from "@/lib/botapi/guildSearchRules";

const SF = "1290000000000000000";
const UUID = "0b8f8d4e-1c2a-4b3c-9d4e-5f6a7b8c9d0e";

describe("parseGuildSearchQuery", () => {
  test("defaults", () => {
    const r = parseGuildSearchQuery({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.limit).toBe(25);
    expect(r.query.offset).toBe(0);
    expect(r.query.sortBy).toBe("timestamp");
    expect(r.query.sortOrder).toBe("desc");
    expect(r.query.includeNsfw).toBe(false);
    expect(r.query.authorTypes).toBeNull();
    expect(r.query.mentionEveryone).toBeNull();
  });

  test("array params: repeated keys and comma-separated ids", () => {
    const r = parseGuildSearchQuery({ author_id: [SF, UUID], channel_id: `${SF},${UUID}`, has: ["image", "-file"], embed_type: "gif" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.authorIds).toEqual([SF, UUID]);
    expect(r.query.channelIds).toEqual([SF, UUID]);
    expect(r.query.hasInclude).toEqual(["image"]);
    expect(r.query.hasExclude).toEqual(["file"]);
    expect(r.query.embedTypes).toEqual(["gif"]);
  });

  test("limits, enums and booleans are validated like Discord", () => {
    const r = parseGuildSearchQuery({ limit: "26", offset: "-1", sort_by: "best", has: "nothing", pinned: "maybe", author_id: "abc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("limit");
    expect(paths).toContain("offset");
    expect(paths).toContain("sort_by");
    expect(paths).toContain("has.0");
    expect(paths).toContain("pinned");
    expect(paths).toContain("author_id.0");
    expect(r.errors.find((e) => e.path === "limit")?.code).toBe("NUMBER_TYPE_MAX");
  });

  test("content length and list sizes", () => {
    expect(parseGuildSearchQuery({ content: "x".repeat(1025) }).ok).toBe(false);
    expect(parseGuildSearchQuery({ author_id: Array.from({ length: 101 }, (_, i) => String(100000000000000000n + BigInt(i))) }).ok).toBe(false);
    expect(parseGuildSearchQuery({ embed_type: ["image", "video", "gif", "sound", "article", "image"] }).ok).toBe(true);
  });

  test("booleans accept true/false/1/0", () => {
    const r = parseGuildSearchQuery({ pinned: "1", mention_everyone: "false", include_nsfw: "True" });
    expect(r.ok && r.query.pinned).toBe(true);
    expect(r.ok && r.query.mentionEveryone).toBe(false);
    expect(r.ok && r.query.includeNsfw).toBe(true);
  });

  test("normalizes hostnames and extensions", () => {
    const r = parseGuildSearchQuery({ link_hostname: "*.Example.COM", attachment_extension: ".PNG" });
    expect(r.ok && r.query.linkHostnames).toEqual(["example.com"]);
    expect(r.ok && r.query.attachmentExtensions).toEqual(["png"]);
  });
});

describe("author types", () => {
  test("include / exclude", () => {
    expect(resolveAuthorTypes([], [])).toBeNull();
    expect(resolveAuthorTypes(["bot"], [])).toEqual(["bot"]);
    expect(resolveAuthorTypes([], ["bot"])).toEqual(["user", "webhook"]);
    expect(resolveAuthorTypes(["bot"], ["bot"])).toEqual([]);
    expect(resolveAuthorTypes(["user", "bot", "webhook"], [])).toBeNull();
  });
});

describe("helpers", () => {
  test("sort", () => {
    expect(searchSortFor({ sortBy: "timestamp", sortOrder: "asc", content: "" })).toBe("oldest");
    expect(searchSortFor({ sortBy: "timestamp", sortOrder: "desc", content: "" })).toBe("newest");
    expect(searchSortFor({ sortBy: "relevance", sortOrder: "asc", content: "hi" })).toBe("relevant");
    // Relevance without words falls back to time order.
    expect(searchSortFor({ sortBy: "relevance", sortOrder: "desc", content: "" })).toBe("newest");
  });

  test("content filters need MESSAGE_CONTENT", () => {
    const base = parseGuildSearchQuery({ author_id: SF });
    expect(base.ok && usesContentFilters(base.query)).toBe(false);
    const withContent = parseGuildSearchQuery({ content: "hello" });
    expect(withContent.ok && usesContentFilters(withContent.query)).toBe(true);
    const withHas = parseGuildSearchQuery({ has: "-image" });
    expect(withHas.ok && usesContentFilters(withHas.query)).toBe(true);
  });

  test("serikaHas drops snapshot", () => {
    expect(serikaHas(["image", "snapshot", "poll"])).toEqual(["image", "poll"]);
  });

  test("link hostnames", () => {
    expect(linkHostnames("see https://Cdn.Example.com/a?b and http://x.org")).toEqual(["cdn.example.com", "x.org"]);
    expect(hostMatches("cdn.example.com", ["example.com"])).toBe(true);
    expect(hostMatches("notexample.com", ["example.com"])).toBe(false);
    expect(messageLinksTo("no links", [{ url: "https://youtube.com/watch" }], ["youtube.com"])).toBe(true);
    expect(messageLinksTo("https://a.com", [], ["b.com"])).toBe(false);
    expect(messageLinksTo("anything", [], [])).toBe(true);
  });

  test("likeLiteral escapes wildcards", () => {
    expect(likeLiteral("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  test("arrayQuery keeps repeated keys and parsed single values", () => {
    const q = arrayQuery(`http://h/api/v10/guilds/1/messages/search?author_id=${SF}&author_id=2&channel_id=${SF}&content=hi`, { author_id: "2", channel_id: UUID, content: "hi" });
    expect(q.author_id).toEqual([SF, "2"]);
    expect(q.channel_id).toBe(UUID); // translated by the boundary
    expect(q.content).toBe("hi");
  });
});
