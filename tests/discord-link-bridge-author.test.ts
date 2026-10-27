import { describe, expect, test } from "bun:test";
import { canRelayAsLinkedBot, linkedBotWebAuthor } from "@/lib/discord/botLink";

describe("bridge: who may be posted as a linked SerikaCord bot", () => {
  test("only Discord bot authors with a valid id", () => {
    expect(canRelayAsLinkedBot({ id: "1310000000000000123", bot: true })).toBe(true);
    expect(canRelayAsLinkedBot({ id: "1310000000000000123", bot: false })).toBe(false);
    expect(canRelayAsLinkedBot({ id: "1310000000000000123" })).toBe(false);
    expect(canRelayAsLinkedBot({ id: "not-an-id", bot: true })).toBe(false);
    expect(canRelayAsLinkedBot(null)).toBe(false);
  });
});

describe("bridge: live web payload author for a linked bot", () => {
  test("is the real bot account, never a Discord copy", () => {
    const author = linkedBotWebAuthor({
      id: "6a4a78b3-9c1f-460c-2d06-a90700000000",
      username: "serika",
      displayName: "Serika",
      avatar: "https://cdn.serika.chat/avatars/x.png",
      isBot: true,
      isVerified: true,
      badges: ["official_app"],
    });
    expect(author).toEqual({
      id: "6a4a78b3-9c1f-460c-2d06-a90700000000",
      username: "serika",
      displayName: "Serika",
      avatar: "https://cdn.serika.chat/avatars/x.png",
      status: "online",
      badges: ["official_app"],
      isBot: true,
      isSystem: false,
      isVerified: true,
      isDiscord: false,
    });
  });

  test("falls back to the username and empty badges", () => {
    const author = linkedBotWebAuthor({ id: "u", username: "mybot", displayName: null, avatar: null, badges: null });
    expect(author.displayName).toBe("mybot");
    expect(author.badges).toEqual([]);
    expect(author.isVerified).toBe(false);
    expect(author.isBot).toBe(true);
  });
});
