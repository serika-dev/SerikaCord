import { describe, expect, test } from "bun:test";
import {
  blockResponse,
  canAddRule,
  countUniqueMentions,
  evaluateAutoMod,
  findBlockedLink,
  looksLikeSpam,
  matchKeywords,
  normalizeRuleInput,
  toDiscordRule,
  type AutoModRule,
} from "../src/lib/automod/rules";
import {
  DEFAULT_STREAMER_PREFS,
  isStreamerModeActive,
  isStreamingSoftwareRunning,
  maskEmail,
  maskInviteLink,
  parseStreamerPrefs,
  streamerHides,
} from "../src/lib/streamer/streamerMode";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const CH = "44444444-4444-4444-8444-444444444444";
const ROLE = "55555555-5555-4555-8555-555555555555";

function rule(partial: Partial<AutoModRule>): AutoModRule {
  return {
    id: "r1",
    serverId: "s1",
    name: "Rule",
    creatorId: null,
    enabled: true,
    triggerType: "keyword",
    triggerMetadata: {},
    actions: [{ type: "block_message" }],
    exemptRoles: [],
    exemptChannels: [],
    ...partial,
  };
}

describe("automod keywords", () => {
  test("whole word by default", () => {
    expect(matchKeywords("I like cats", ["cat"])).toBeNull();
    expect(matchKeywords("a cat here", ["cat"])?.keyword).toBe("cat");
  });
  test("wildcards", () => {
    expect(matchKeywords("catch it", ["cat*"])?.matchedContent).toBe("catch");
    expect(matchKeywords("bobcat", ["*cat"])?.matchedContent).toBe("bobcat");
    expect(matchKeywords("bobcats", ["*cat*"])?.matchedContent).toBe("bobcats");
  });
  test("case-insensitive phrases", () => {
    expect(matchKeywords("FREE   Nitro now", ["free nitro"])).not.toBeNull();
  });
  test("allow list wins", () => {
    expect(matchKeywords("scunthorpe", ["*cunt*"], ["scunthorpe"])).toBeNull();
  });
});

describe("automod mentions, links, spam", () => {
  test("counts unique user + role mentions", () => {
    expect(countUniqueMentions(`<@${U1}> <@!${U1}> <@${U2}> <@&${U3}>`)).toBe(3);
  });
  test("links and invites", () => {
    expect(findBlockedLink("see https://evil.com/x.", {})).toBe("https://evil.com/x");
    expect(findBlockedLink("see https://youtube.com/watch", { allowedDomains: ["youtube.com"] })).toBeNull();
    expect(findBlockedLink("see https://evil.com", { invitesOnly: true })).toBeNull();
    expect(findBlockedLink("join discord.gg/abc", { invitesOnly: true })).toBe("discord.gg/abc");
  });
  test("spam heuristics", () => {
    const now = 1_000_000;
    const recent = [{ content: "buy now", at: now - 1000 }, { content: "Buy now!", at: now - 2000 }];
    expect(looksLikeSpam("buy now", recent, now)).toBe("repeated message");
    expect(looksLikeSpam("a".repeat(60))).toBe("repeated characters");
    expect(looksLikeSpam("hello there, how are you today?")).toBeNull();
  });
});

describe("automod evaluation", () => {
  test("exempt roles and channels skip the rule", () => {
    const r = rule({ triggerMetadata: { keywordFilter: ["bad"] }, exemptRoles: [ROLE], exemptChannels: [CH] });
    expect(evaluateAutoMod([r], { content: "bad", channelId: "x", memberRoleIds: [] })).toHaveLength(1);
    expect(evaluateAutoMod([r], { content: "bad", channelId: "x", memberRoleIds: [ROLE] })).toHaveLength(0);
    expect(evaluateAutoMod([r], { content: "bad", channelId: "t", parentChannelId: CH, memberRoleIds: [] })).toHaveLength(0);
  });
  test("disabled rules never match; mention limit", () => {
    const m = rule({ triggerType: "mention_spam", triggerMetadata: { mentionTotalLimit: 2 } });
    expect(evaluateAutoMod([{ ...m, enabled: false }], { content: `<@${U1}><@${U2}><@${U3}>`, channelId: "c", memberRoleIds: [] })).toHaveLength(0);
    expect(evaluateAutoMod([m], { content: `<@${U1}><@${U2}><@${U3}>`, channelId: "c", memberRoleIds: [] })).toHaveLength(1);
  });
  test("block response carries the custom message", () => {
    const a = rule({ actions: [{ type: "send_alert", channelId: CH }] });
    const b = rule({ id: "r2", actions: [{ type: "block_message", customMessage: "Nope" }] });
    const res = blockResponse([{ rule: a, keyword: null, matchedContent: null }, { rule: b, keyword: null, matchedContent: null }]);
    expect(res.blocked).toBe(true);
    expect(res.customMessage).toBe("Nope");
    expect(blockResponse([{ rule: a, keyword: null, matchedContent: null }]).blocked).toBe(false);
  });
});

describe("automod rule validation", () => {
  test("keyword rule needs keywords and an action", () => {
    expect(normalizeRuleInput({ triggerType: "keyword", name: "x", actions: [{ type: "block_message" }] }).ok).toBe(false);
    expect(normalizeRuleInput({ triggerType: "keyword", name: "x", triggerMetadata: { keywordFilter: ["a"] }, actions: [] }).ok).toBe(false);
    const ok = normalizeRuleInput({ triggerType: "keyword", name: " x ", triggerMetadata: { keywordFilter: ["Bad", "bad"] }, actions: [{ type: "block_message" }] });
    expect(ok.ok && ok.value.triggerMetadata.keywordFilter).toEqual(["bad"]);
  });
  test("trigger type can't change on edit and unknown types fail", () => {
    expect(normalizeRuleInput({ triggerType: "nope", name: "x" }).ok).toBe(false);
    const base = normalizeRuleInput({ triggerType: "spam", name: "s", actions: [{ type: "block_message" }] });
    if (!base.ok) throw new Error("expected ok");
    const edited = normalizeRuleInput({ triggerType: "keyword", enabled: false }, base.value);
    expect(edited.ok && edited.value.triggerType).toBe("spam");
    expect(edited.ok && edited.value.enabled).toBe(false);
  });
  test("per-type limits and Discord shape", () => {
    expect(canAddRule([{ triggerType: "spam" }], "spam")).toBe(false);
    expect(canAddRule([{ triggerType: "spam" }], "keyword")).toBe(true);
    const d = toDiscordRule(rule({ triggerMetadata: { keywordFilter: ["a"] } })) as { trigger_type: number; guild_id: string };
    expect(d.trigger_type).toBe(1);
    expect(d.guild_id).toBe("s1");
  });
});

describe("streamer mode", () => {
  test("parses prefs with defaults", () => {
    expect(parseStreamerPrefs(null)).toEqual(DEFAULT_STREAMER_PREFS);
    expect(parseStreamerPrefs("{bad json")).toEqual(DEFAULT_STREAMER_PREFS);
    expect(parseStreamerPrefs(JSON.stringify({ enabled: true, hideInviteLinks: false })).enabled).toBe(true);
    expect(parseStreamerPrefs({ hideInviteLinks: false }).hideInviteLinks).toBe(false);
  });
  test("detects streaming software", () => {
    expect(isStreamingSoftwareRunning([{ exe: "obs64", name: "OBS Studio" }])).toBe(true);
    expect(isStreamingSoftwareRunning([{ exe: "OBS64.exe" }])).toBe(true);
    expect(isStreamingSoftwareRunning([{ exe: "code", name: "VS Code" }])).toBe(false);
    expect(isStreamingSoftwareRunning("nope")).toBe(false);
  });
  test("active state and what it hides", () => {
    const p = { ...DEFAULT_STREAMER_PREFS };
    expect(isStreamerModeActive(p, false)).toBe(false);
    expect(isStreamerModeActive(p, true)).toBe(true);
    expect(isStreamerModeActive({ ...p, autoEnable: false }, true)).toBe(false);
    expect(streamerHides(p, false, "personal")).toBe(false);
    expect(streamerHides(p, true, "invites")).toBe(true);
    expect(streamerHides({ ...p, hideNotificationContent: false }, true, "notifications")).toBe(false);
  });
  test("masks email and invite links", () => {
    const masked = maskEmail("alice@example.com");
    expect(masked).not.toContain("alice");
    expect(masked).not.toContain("example");
    expect(masked.endsWith(".com")).toBe(true);
    expect(maskEmail("")).toBe("");
    expect(maskInviteLink("serika.cc/AbC123")).toBe("serika.cc/••••••");
  });
});
