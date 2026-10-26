import { describe, expect, test } from "bun:test";
import {
  BUILTIN_LINK_OPTIONS,
  applyAffixes,
  autoMatchByName,
  bridgeInvitePermissions,
  bridgeInviteUrl,
  compactOverrides,
  isInboundActive,
  isOutboundActive,
  isBridgeIntegrationKey,
  isOutboundBridgedChannel,
  normalizeBridge,
  pickClientIntegrations,
  withoutBridgeKeys,
  pickGuildOwner,
  resolveLinkOptions,
  sanitizeAffix,
  sanitizeBridgeDefaults,
  sanitizeLinkOptions,
  serializeLinks,
  upsertLink,
} from "@/lib/discord/bridgeConfig";
import { webhookIdFromUrl } from "@/lib/discord/rest";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const D1 = "100000000000000001";
const D2 = "100000000000000002";
const D3 = "100000000000000003";

describe("normalizeBridge", () => {
  test("legacy maps of plain ids and webhook URLs keep working", () => {
    const b = normalizeBridge({
      discord: true,
      discordGuildId: "900000000000000009",
      discordChannelsMap: { [D1]: S1, [D2]: S2 },
      discordWebhooks: { [S1]: "https://discord.com/api/webhooks/1/abc", [S2]: "sealed:v1:xyz" },
    });
    expect(b.enabled).toBe(true);
    expect(b.guildId).toBe("900000000000000009");
    expect(b.links).toEqual([
      { discordChannelId: D1, serikaChannelId: S1, webhook: "https://discord.com/api/webhooks/1/abc", overrides: {} },
      { discordChannelId: D2, serikaChannelId: S2, webhook: "sealed:v1:xyz", overrides: {} },
    ]);
  });

  test("object-valued map entries carry their channel and options", () => {
    const b = normalizeBridge({
      discordChannelsMap: { [D1]: { serikaChannelId: S1, direction: "to_serika", bogus: 1 }, [D2]: { channelId: S2.toUpperCase() } },
    });
    expect(b.links[0]).toMatchObject({ serikaChannelId: S1, overrides: { direction: "to_serika" } });
    expect(b.links[1].serikaChannelId).toBe(S2);
  });

  test("stored option overrides apply per SerikaCord channel", () => {
    const b = normalizeBridge({
      discordChannelsMap: { [D1]: S1 },
      discordLinkOptions: { [S1]: { paused: true, prefix: "[D]", direction: "nope" } },
    });
    expect(b.links[0].overrides).toEqual({ paused: true, prefix: "[D]" });
  });

  test("one SerikaCord channel per Discord channel, first Discord id wins", () => {
    const b = normalizeBridge({ discordChannelsMap: { [D2]: S1, [D1]: S1 } });
    expect(b.links).toHaveLength(1);
    expect(b.links[0].discordChannelId).toBe(D1);
  });

  test("junk is ignored, never thrown", () => {
    expect(normalizeBridge(null).links).toEqual([]);
    expect(normalizeBridge("x").guildId).toBeNull();
    const b = normalizeBridge({ discordGuildId: "not-a-snowflake", discordChannelsMap: { abc: S1, [D1]: "not-a-uuid", [D2]: 5 }, discordWebhooks: [1, 2] });
    expect(b.guildId).toBeNull();
    expect(b.links).toEqual([]);
  });

  test("serialize round-trips into the plain legacy shape", () => {
    const b = normalizeBridge({
      discordChannelsMap: { [D1]: S1, [D2]: S2 },
      discordWebhooks: { [S1]: "w1" },
      discordLinkOptions: { [S2]: { mirrorEdits: false } },
    });
    expect(serializeLinks(b.links)).toEqual({
      discordChannelsMap: { [D1]: S1, [D2]: S2 },
      discordWebhooks: { [S1]: "w1" },
      discordLinkOptions: { [S2]: { mirrorEdits: false } },
    });
  });
});

describe("link options", () => {
  test("sanitize keeps known keys with valid values", () => {
    expect(sanitizeLinkOptions({ direction: "both", mirrorEdits: "yes", paused: true, extra: 1 })).toEqual({ direction: "both", paused: true });
    expect(sanitizeLinkOptions([])).toEqual({});
  });

  test("affixes are one line, no control or bidi characters, capped", () => {
    expect(sanitizeAffix("  [Discord]\n‮ x ")).toBe("[Discord] x");
    expect(sanitizeAffix("a".repeat(100))).toHaveLength(64);
    expect(sanitizeAffix(5)).toBe("");
  });

  test("defaults never pause new links", () => {
    expect(sanitizeBridgeDefaults({ paused: true, attachments: false })).toEqual({ attachments: false });
  });

  test("resolve: builtin <- defaults <- overrides", () => {
    const o = resolveLinkOptions({ attachments: false, direction: "to_discord" }, { direction: "both" });
    expect(o).toEqual({ ...BUILTIN_LINK_OPTIONS, attachments: false, direction: "both" });
  });

  test("compactOverrides drops values the link would inherit anyway", () => {
    expect(compactOverrides({ attachments: false }, { attachments: false, mirrorEdits: true, paused: true })).toEqual({ paused: true });
  });

  test("direction and pause gate each side", () => {
    const base = resolveLinkOptions({}, {});
    expect(isInboundActive(base) && isOutboundActive(base)).toBe(true);
    expect(isInboundActive({ ...base, direction: "to_discord" })).toBe(false);
    expect(isOutboundActive({ ...base, direction: "to_serika" })).toBe(false);
    expect(isOutboundActive({ ...base, paused: true })).toBe(false);
  });

  test("outbound bridged channel needs bridge on, a webhook and an outbound link", () => {
    const integ = { discord: true, discordChannelsMap: { [D1]: S1, [D2]: S2 }, discordWebhooks: { [S1]: "w", [S2]: "w" }, discordLinkOptions: { [S2]: { direction: "to_serika" } } };
    expect(isOutboundBridgedChannel(integ, S1.toUpperCase())).toBe(true);
    expect(isOutboundBridgedChannel(integ, S2)).toBe(false);
    expect(isOutboundBridgedChannel({ ...integ, discord: false }, S1)).toBe(false);
    expect(isOutboundBridgedChannel(integ, S3)).toBe(false);
  });

  test("applyAffixes wraps text and respects the length cap", () => {
    expect(applyAffixes("hi", { prefix: "[D]", suffix: "!" })).toBe("[D] hi !");
    expect(applyAffixes("", { prefix: "[D]", suffix: "" })).toBe("");
    expect(applyAffixes("hello world", { prefix: "", suffix: "" }, 5)).toBe("hello");
    expect(applyAffixes("x".repeat(3000), { prefix: "[D]", suffix: "" }, 2000)).toHaveLength(2000);
  });
});

describe("upsertLink", () => {
  const links = normalizeBridge({ discordChannelsMap: { [D1]: S1, [D2]: S2 }, discordWebhooks: { [S1]: "w1" }, discordLinkOptions: { [S1]: { paused: true } } }).links;

  test("relinking the same pair keeps webhook and options", () => {
    const next = upsertLink(links, { discordChannelId: D1, serikaChannelId: S1 });
    expect(next.find((l) => l.discordChannelId === D1)).toEqual({ discordChannelId: D1, serikaChannelId: S1, webhook: "w1", overrides: { paused: true } });
  });

  test("keeps the 1:1 rule on both sides", () => {
    const next = upsertLink(links, { discordChannelId: D3, serikaChannelId: S2, webhook: "w3" });
    expect(next.map((l) => [l.discordChannelId, l.serikaChannelId]).sort()).toEqual([[D1, S1], [D3, S2]]);
    const moved = upsertLink(links, { discordChannelId: D1, serikaChannelId: S3, webhook: "w" });
    expect(moved.find((l) => l.discordChannelId === D1)?.serikaChannelId).toBe(S3);
    expect(moved.find((l) => l.discordChannelId === D1)?.overrides).toEqual({});
  });
});

describe("autoMatchByName", () => {
  test("pairs unlinked channels with the same name, skipping ambiguous ones", () => {
    const discord = [
      { id: D1, name: "general" },
      { id: D2, name: "off-topic" },
      { id: D3, name: "memes" },
      { id: "100000000000000004", name: "Memes" },
    ];
    const serika = [
      { id: S1, name: "General" },
      { id: S2, name: "off_topic" },
      { id: S3, name: "memes" },
    ];
    expect(autoMatchByName(discord, serika, [])).toEqual([
      { discordChannelId: D1, serikaChannelId: S1 },
      { discordChannelId: D2, serikaChannelId: S2 },
    ]);
  });

  test("already-linked channels on either side are left alone", () => {
    const links = normalizeBridge({ discordChannelsMap: { [D3]: S1 } }).links;
    expect(autoMatchByName([{ id: D1, name: "general" }], [{ id: S1, name: "general" }], links)).toEqual([]);
  });
});

describe("pickGuildOwner", () => {
  test("earliest verified link wins, then oldest server", () => {
    expect(pickGuildOwner([])).toBeNull();
    expect(pickGuildOwner([
      { id: "b", linkedAt: null, createdAt: "2024-01-01" },
      { id: "a", linkedAt: "2026-05-01", createdAt: "2025-01-01" },
    ])).toBe("a");
    expect(pickGuildOwner([
      { id: "b", createdAt: "2024-01-01" },
      { id: "a", createdAt: "2025-01-01" },
    ])).toBe("b");
  });
});

describe("bot invite", () => {
  test("asks only for the permissions the bridge uses", () => {
    const perms = BigInt(bridgeInvitePermissions());
    expect(perms & (1n << 3n)).toBe(0n); // never Administrator
    expect(perms & (1n << 29n)).toBe(1n << 29n); // Manage Webhooks
    const url = new URL(bridgeInviteUrl("1524469730256355421", "900000000000000009"));
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
    expect(url.searchParams.get("guild_id")).toBe("900000000000000009");
    expect(new URL(bridgeInviteUrl("1", "nope")).searchParams.get("guild_id")).toBeNull();
  });
});

describe("general settings writers can't touch the bridge", () => {
  test("every discord* key is a bridge key", () => {
    for (const k of ["discord", "discordGuildId", "discordLinkedAt", "discordLinkedBy", "discordWebhooks", "discordChannelsMap", "discordLinkOptions", "discordBridgeDefaults", "discordRestrictUnconsented", "discordGuildName", "discordMode"]) {
      expect(isBridgeIntegrationKey(k)).toBe(true);
    }
    expect(isBridgeIntegrationKey("twitch")).toBe(false);
  });

  test("client input keeps only allowlisted, typed non-Discord keys", () => {
    expect(pickClientIntegrations({
      discord: true,
      discordLinkedAt: "2000-01-01",
      discordGuildId: "900000000000000009",
      twitch: true,
      youtube: "yes",
      twitchChannel: "shroud",
      youtubeNotificationChannelId: 5,
      somethingElse: 1,
    })).toEqual({ twitch: true, twitchChannel: "shroud" });
    expect(pickClientIntegrations(null)).toEqual({});
    expect((pickClientIntegrations({ youtubeChannel: "x".repeat(5000) }).youtubeChannel as string).length).toBe(1024);
  });

  test("withoutBridgeKeys drops every bridge key", () => {
    expect(withoutBridgeKeys({ discord: true, discordWebhooks: {}, twitch: false, webhooks: true })).toEqual({ twitch: false, webhooks: true });
    expect(withoutBridgeKeys(undefined)).toEqual({});
  });
});

describe("webhookIdFromUrl", () => {
  test("only real Discord webhook URLs", () => {
    expect(webhookIdFromUrl("https://discord.com/api/webhooks/123456789012345678/abc-DEF_1")).toBe("123456789012345678");
    expect(webhookIdFromUrl("https://discordapp.com/api/v10/webhooks/123456789012345678/tok")).toBe("123456789012345678");
    expect(webhookIdFromUrl("https://discord.com.evil.test/api/webhooks/123456789012345678/tok")).toBeNull();
    expect(webhookIdFromUrl("https://discord.com@evil.test/api/webhooks/123456789012345678/tok")).toBeNull();
    expect(webhookIdFromUrl("https://evil.test/?https://discord.com/api/webhooks/123456789012345678/tok")).toBeNull();
    expect(webhookIdFromUrl("http://discord.com/api/webhooks/123456789012345678/tok")).toBeNull();
    expect(webhookIdFromUrl("https://discord.com/api/webhooks/123456789012345678/tok/../../x")).toBeNull();
  });
});
