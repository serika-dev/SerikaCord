import { describe, expect, test } from "bun:test";
import {
  bridgeAllowedMentions,
  bridgeAvatarUrl,
  bridgeWebhookUsername,
  decideOutboundRelay,
  discordSafeName,
  formatSerikaContentForDiscord,
  interactionLine,
  serikaMentionIds,
  toDiscordEmbeds,
  type OutboundMentionLookup,
} from "@/lib/discord/outboundFormat";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOT = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const ROLE = "44444444-4444-4444-8444-444444444444";
const BRIDGED = "55555555-5555-4555-8555-555555555555";
const PRIVATE = "66666666-6666-4666-8666-666666666666";
const EMOJI = "77777777-7777-4777-8777-777777777777";

const lookup: OutboundMentionLookup = {
  users: {
    [ALICE]: { name: "Alice", discordId: "1100000000000000001" },
    [BOT]: { name: "Serika", discordId: null },
  },
  roles: { [ROLE]: "Moderators" },
  channels: {
    [BRIDGED]: { name: "general", discordChannelId: "1200000000000000001" },
    [PRIVATE]: { name: "staff", discordChannelId: null },
  },
};

describe("outbound bridge: mentions", () => {
  test("users read as real names, or real Discord mentions when in the server", () => {
    expect(formatSerikaContentForDiscord(`<@${BOT}> Yo`, lookup)).toBe("@Serika Yo");
    expect(formatSerikaContentForDiscord(`hi <@!${ALICE}>`, lookup)).toBe("hi <@1100000000000000001>");
    expect(formatSerikaContentForDiscord(`<@${STRANGER}>`, lookup)).toBe("@user");
    // Uppercase ids and HTML-escaped markup resolve too.
    expect(formatSerikaContentForDiscord(`&lt;@${BOT.toUpperCase()}&gt;`, lookup)).toBe("@Serika");
  });

  test("roles, channels and emoji", () => {
    expect(formatSerikaContentForDiscord(`<@&${ROLE}> see <#${BRIDGED}> and <#${PRIVATE}>`, lookup))
      .toBe("@Moderators see <#1200000000000000001> and #staff");
    expect(formatSerikaContentForDiscord(`<#${STRANGER}> <@&${STRANGER}>`, lookup)).toBe("#channel @role");
    expect(formatSerikaContentForDiscord(`<:wave:${EMOJI}> <a:spin:${EMOJI}>`)).toBe(":wave: :spin:");
  });

  test("names can't smuggle in mentions or markdown", () => {
    const evil: OutboundMentionLookup = { users: { [STRANGER]: { name: "<@1100000000000000009> *bold*" } } };
    const out = formatSerikaContentForDiscord(`<@${STRANGER}>`, evil);
    expect(out).not.toContain("<@1100000000000000009>");
    expect(out).toBe("@@1100000000000000009 \\*bold\\*");
    expect(discordSafeName("  \n ", "user")).toBe("user");
    expect(discordSafeName("a".repeat(100), "x").length).toBe(64);
  });

  test("collects ids from every text", () => {
    const ids = serikaMentionIds([`<@${ALICE}> <@&${ROLE}>`, null, `<#${BRIDGED}> <@!${ALICE.toUpperCase()}>`]);
    expect(ids).toEqual({ userIds: [ALICE], roleIds: [ROLE], channelIds: [BRIDGED] });
  });
});

describe("outbound bridge: allowed_mentions", () => {
  test("never @everyone, @here or roles; only users pinged on SerikaCord too", () => {
    const content = `@everyone <@${ALICE}> <@&${ROLE}>`;
    expect(bridgeAllowedMentions({ content, lookup, mentionedUserIds: [ALICE], authorIsBot: true }))
      .toEqual({ parse: [], users: ["1100000000000000001"] });
    // A bot whose allowed_mentions kept Alice from being pinged doesn't ping her on Discord either.
    expect(bridgeAllowedMentions({ content, lookup, mentionedUserIds: [], authorIsBot: true }))
      .toEqual({ parse: [], users: [] });
    // Names without a Discord account never ping.
    expect(bridgeAllowedMentions({ content: `<@${BOT}>`, lookup, mentionedUserIds: [BOT], authorIsBot: false }).users).toEqual([]);
  });

  test("raw Discord mentions ping only when a person typed them", () => {
    const content = "<@1100000000000000042>";
    expect(bridgeAllowedMentions({ content, lookup, authorIsBot: false }).users).toEqual(["1100000000000000042"]);
    expect(bridgeAllowedMentions({ content, lookup, authorIsBot: true }).users).toEqual([]);
  });
});

describe("outbound bridge: what gets relayed", () => {
  const discordOrigin = { platform: "discord", messageId: "1100000000000000003" };
  const base = { action: "create" as const, includeBots: true };

  test("people need their outbound consent", () => {
    expect(decideOutboundRelay({ ...base, author: {}, authorConsented: true })).toEqual({ relay: true });
    expect(decideOutboundRelay({ ...base, author: {}, authorConsented: false })).toEqual({ relay: false, reason: "no_consent" });
  });

  test("bot, webhook and interaction messages go out, no consent needed", () => {
    expect(decideOutboundRelay({ ...base, author: { isBot: true } })).toEqual({ relay: true });
    expect(decideOutboundRelay({ ...base, author: { isWebhook: true } })).toEqual({ relay: true });
    expect(decideOutboundRelay({ ...base, action: "edit", author: { isBot: true } })).toEqual({ relay: true });
  });

  test("the bot messages option turns them off", () => {
    expect(decideOutboundRelay({ ...base, includeBots: false, author: { isBot: true } })).toEqual({ relay: false, reason: "bots_off" });
    expect(decideOutboundRelay({ ...base, includeBots: false, author: { isWebhook: true } })).toEqual({ relay: false, reason: "bots_off" });
    // People are unaffected by it.
    expect(decideOutboundRelay({ ...base, includeBots: false, author: {}, authorConsented: true })).toEqual({ relay: true });
  });

  test("never loops a message back to Discord", () => {
    expect(decideOutboundRelay({ ...base, bridgeOrigin: discordOrigin, author: { isBot: true } })).toEqual({ relay: false, reason: "from_discord" });
    expect(decideOutboundRelay({ ...base, bridgeOrigin: discordOrigin, author: {}, authorConsented: true })).toEqual({ relay: false, reason: "from_discord" });
    expect(decideOutboundRelay({ ...base, action: "delete", bridgeOrigin: discordOrigin, author: {} })).toEqual({ relay: false, reason: "from_discord" });
    expect(decideOutboundRelay({ ...base, author: { isDiscordCopy: true }, authorConsented: true })).toEqual({ relay: false, reason: "discord_copy" });
  });

  test("ephemeral and still-loading messages stay on SerikaCord", () => {
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, flags: 1 << 6 })).toEqual({ relay: false, reason: "ephemeral" });
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, flags: 1 << 7 })).toEqual({ relay: false, reason: "loading" });
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, flags: 1 << 12 })).toEqual({ relay: true });
  });

  test("a bot on both platforms isn't doubled when answering a Discord message", () => {
    const linked = { ...base, author: { isBot: true }, linkedDiscordBotInGuild: true };
    expect(decideOutboundRelay({ ...linked, replyToBridgeOrigin: discordOrigin })).toEqual({ relay: false, reason: "linked_bot_native" });
    // Answering a SerikaCord message: Discord only sees it through the bridge.
    expect(decideOutboundRelay({ ...linked, replyToBridgeOrigin: null })).toEqual({ relay: true });
    // Not in the Discord server: relayed.
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, linkedDiscordBotInGuild: false, replyToBridgeOrigin: discordOrigin })).toEqual({ relay: true });
  });

  test("a bot answering a Discord bot isn't sent back (no bot ping-pong)", () => {
    const fromDiscordBot = { ...discordOrigin, authorBot: true };
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, replyToBridgeOrigin: fromDiscordBot })).toEqual({ relay: false, reason: "bot_chain" });
    expect(decideOutboundRelay({ ...base, author: { isBot: true }, replyToBridgeOrigin: { ...discordOrigin, authorBot: false } })).toEqual({ relay: true });
    // People may still answer Discord bots.
    expect(decideOutboundRelay({ ...base, author: {}, authorConsented: true, replyToBridgeOrigin: fromDiscordBot })).toEqual({ relay: true });
  });

  test("deletes of SerikaCord messages always go through", () => {
    expect(decideOutboundRelay({ ...base, action: "delete", includeBots: false, author: { isBot: true } })).toEqual({ relay: true });
  });
});

describe("outbound bridge: webhook identity and embeds", () => {
  test("username carries the (Serika) tag within 80 characters", () => {
    expect(bridgeWebhookUsername("Serika")).toBe("Serika (Serika)");
    expect(bridgeWebhookUsername("x".repeat(200)).length).toBe(80);
    expect(bridgeWebhookUsername("")).toBe("User (Serika)");
  });

  test("avatar URLs are absolute http(s)", () => {
    expect(bridgeAvatarUrl("https://cdn.serika.chat/a.png", "https://serika.chat")).toBe("https://cdn.serika.chat/a.png");
    expect(bridgeAvatarUrl("/uploads/a.png", "https://serika.chat/")).toBe("https://serika.chat/uploads/a.png");
    expect(bridgeAvatarUrl("javascript:alert(1)", "https://serika.chat")).toBeUndefined();
    expect(bridgeAvatarUrl(null, "https://serika.chat")).toBeUndefined();
  });

  test("bot embeds keep known fields, http(s) URLs and readable mentions", () => {
    const fmt = (s: string) => formatSerikaContentForDiscord(s, lookup);
    const out = toDiscordEmbeds([
      {
        type: "rich",
        title: "Hello",
        description: `ping <@${BOT}>`,
        url: "javascript:alert(1)",
        color: 0x5865f2,
        image: { url: "https://cdn.serika.chat/i.png" },
        fields: [{ name: "a", value: `<#${BRIDGED}>`, inline: true }, { name: "", value: "dropped" }],
        footer: { text: "foot", iconUrl: "https://cdn.serika.chat/f.png" },
        extra: "dropped",
      },
      { type: "link", url: "https://example.com" },
      "nonsense",
    ], fmt);
    expect(out).toEqual([{
      title: "Hello",
      description: "ping @Serika",
      color: 0x5865f2,
      footer: { text: "foot", icon_url: "https://cdn.serika.chat/f.png" },
      image: { url: "https://cdn.serika.chat/i.png" },
      fields: [{ name: "a", value: "<#1200000000000000001>", inline: true }],
    }]);
    expect(toDiscordEmbeds(Array.from({ length: 12 }, () => ({ title: "t" }))).length).toBe(10);
    expect(toDiscordEmbeds(null)).toEqual([]);
  });

  test("interaction responses say who used which command", () => {
    expect(interactionLine({ name: "ask", user: { username: "pika_chu" } })).toBe("-# pika\\_chu used /ask\n");
    expect(interactionLine({ name: "", user: { username: "x" } })).toBe("");
    expect(interactionLine(null)).toBe("");
  });
});
