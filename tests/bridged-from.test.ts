import { describe, expect, test } from "bun:test";
import { bridgedFrom, serializeMessage } from "@/lib/chat/discordMessage";

const origin = {
  platform: "discord",
  guildId: "1100000000000000001",
  channelId: "1100000000000000002",
  messageId: "1100000000000000003",
  authorId: "1100000000000000004",
  authorBot: false,
};

describe("bridged_from (Discord bridge origin for bots)", () => {
  test("a relayed message says where it came from", () => {
    expect(bridgedFrom(origin)).toEqual({
      platform: "discord",
      guild_id: "1100000000000000001",
      channel_id: "1100000000000000002",
      message_id: "1100000000000000003",
      author: { id: "1100000000000000004", bot: false },
    });
    expect(bridgedFrom({ ...origin, authorBot: true })?.author.bot).toBe(true);
    expect(bridgedFrom({ ...origin, guildId: null })?.guild_id).toBeNull();
  });

  test("anything else has none", () => {
    expect(bridgedFrom(null)).toBeNull();
    expect(bridgedFrom("discord")).toBeNull();
    expect(bridgedFrom({ ...origin, platform: "slack" })).toBeNull();
    expect(bridgedFrom({ ...origin, channelId: "not-an-id" })).toBeNull();
    expect(bridgedFrom({ ...origin, messageId: undefined })).toBeNull();
    expect(bridgedFrom({ ...origin, authorId: "123" })).toBeNull();
  });

  test("serialized messages carry it only when relayed", () => {
    const base = { id: "a", channelId: "c", authorId: "u", content: "hi" };
    expect(serializeMessage(base).bridged_from).toBeUndefined();
    expect(serializeMessage({ ...base, bridgeOrigin: origin }).bridged_from?.message_id).toBe("1100000000000000003");
  });
});
