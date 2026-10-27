import { describe, expect, test } from "bun:test";
import { parseInlineMarkdown } from "@/lib/chat/markdown";

describe("server page and channel mentions", () => {
  test("<id:...> server pages become guild_nav nodes", () => {
    for (const page of ["guide", "customize", "browse", "members", "home", "linked-roles"]) {
      const nodes = parseInlineMarkdown(`see <id:${page}> now`);
      expect(nodes.find((n) => n.type === "guild_nav")?.content).toBe(page);
    }
    expect(parseInlineMarkdown("<id:nope>").some((n) => n.type === "guild_nav")).toBe(false);
  });
  test("<#...> accepts UUIDs, snowflakes and 24-hex ids", () => {
    const ids = ["b652756a-345f-4668-adc7-b10bcc63a3b1", "1234567890123456789", "507f1f77bcf86cd799439011"];
    for (const id of ids) {
      expect(parseInlineMarkdown(`<#${id}>`).find((n) => n.type === "channel_mention")?.content).toBe(id);
    }
    expect(parseInlineMarkdown("<#123>").some((n) => n.type === "channel_mention")).toBe(false);
  });
});
