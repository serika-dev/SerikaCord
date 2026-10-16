import { describe, expect, test } from "bun:test";
import { fromDiscordRuleBody, hasTimeoutAction } from "@/lib/botapi/automodRules";
import { normalizeRuleInput } from "@/lib/automod/rules";
import { fromDiscordEventBody } from "@/lib/botapi/scheduledEventRules";
import { normalizeEventInput } from "@/lib/chat/scheduledEvents";
import {
  fromDiscordOnboarding,
  numericOnboardingId,
  templateFieldError,
  toDiscordOnboarding,
  toDiscordSerializedGuild,
  toDiscordWelcomeScreen,
} from "@/lib/botapi/communityRules";
import { inviteExpired } from "@/lib/botapi/invites";
import type { OnboardingConfig } from "@/lib/servers/onboarding";

const CHAN = "22222222-2222-4222-8222-222222222222";

describe("AutoMod bodies", () => {
  test("a Discord keyword rule maps to Serika's input and validates", () => {
    const r = fromDiscordRuleBody({
      name: "No swears",
      event_type: 1,
      trigger_type: 1,
      trigger_metadata: { keyword_filter: ["bad*"], allow_list: ["badge"] },
      actions: [{ type: 1, metadata: { custom_message: "nope" } }, { type: 2, metadata: { channel_id: CHAN } }, { type: 3, metadata: { duration_seconds: 60 } }],
      exempt_roles: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = normalizeRuleInput(r.input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.triggerType).toBe("keyword");
    expect(parsed.value.triggerMetadata.keywordFilter).toEqual(["bad*"]);
    expect(parsed.value.actions.map((a) => a.type)).toEqual(["block_message", "send_alert", "timeout"]);
    expect(hasTimeoutAction(parsed.value)).toBe(true);
  });
  test("unsupported triggers, regex and action types are 50035", () => {
    expect(fromDiscordRuleBody({ name: "x", event_type: 1, trigger_type: 4, actions: [{ type: 1 }] }).ok).toBe(false);
    expect(fromDiscordRuleBody({ name: "x", event_type: 2, trigger_type: 1, actions: [{ type: 1 }] }).ok).toBe(false);
    expect(fromDiscordRuleBody({ name: "x", event_type: 1, trigger_type: 1, trigger_metadata: { regex_patterns: ["a+"] }, actions: [{ type: 1 }] }).ok).toBe(false);
    expect(fromDiscordRuleBody({ name: "x", event_type: 1, trigger_type: 1, actions: [{ type: 4 }] }).ok).toBe(false);
  });
  test("PATCH cannot change the trigger type; link rules read allow_list as domains", () => {
    expect(fromDiscordRuleBody({ trigger_type: 5 }, { triggerType: "keyword" }).ok).toBe(false);
    const r = fromDiscordRuleBody({ trigger_metadata: { allow_list: ["example.com"] } }, { triggerType: "links" });
    expect(r.ok && r.input.triggerMetadata).toEqual({ allowedDomains: ["example.com"] });
  });
  test("mention spam limit", () => {
    const r = fromDiscordRuleBody({ name: "m", event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 5 }, actions: [{ type: 1 }] });
    expect(r.ok && normalizeRuleInput(r.input).ok).toBe(true);
  });
});

describe("scheduled event bodies", () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const later = new Date(Date.now() + 7200_000).toISOString();
  test("external events map to Serika fields and validate", () => {
    const r = fromDiscordEventBody({ name: "Meetup", privacy_level: 2, entity_type: 3, channel_id: null, entity_metadata: { location: "Park" }, scheduled_start_time: future, scheduled_end_time: later }, { create: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = normalizeEventInput(r.fields);
    expect("value" in v && v.value.entityType).toBe("external");
    expect("value" in v && v.value.location).toBe("Park");
  });
  test("voice events need a channel; privacy level must be guild-only", () => {
    const r = fromDiscordEventBody({ name: "VC", privacy_level: 2, entity_type: 2, channel_id: CHAN, scheduled_start_time: future }, { create: true });
    expect(r.ok && r.fields.channelId).toBe(CHAN);
    expect(fromDiscordEventBody({ name: "VC", privacy_level: 1, entity_type: 2, scheduled_start_time: future }, { create: true }).ok).toBe(false);
    expect(fromDiscordEventBody({ name: "VC", entity_type: 2, scheduled_start_time: future }, { create: true }).ok).toBe(false);
  });
  test("recurrence is unsupported, status only on PATCH", () => {
    expect(fromDiscordEventBody({ name: "x", privacy_level: 2, entity_type: 2, scheduled_start_time: future, recurrence_rule: { frequency: 2 } }, { create: true }).ok).toBe(false);
    expect(fromDiscordEventBody({ name: "x", privacy_level: 2, entity_type: 2, scheduled_start_time: future, status: 2 }, { create: true }).ok).toBe(false);
    const p = fromDiscordEventBody({ status: 4 }, { create: false, existingEntityType: "voice" });
    expect(p.ok && p.fields).toEqual({ status: "canceled" });
  });
});

const CONFIG: OnboardingConfig = {
  enabled: true,
  questions: [{ id: "q0", title: "Games?", description: "", multiple: true, required: false, options: [{ id: "q0_o0", title: "Chess", description: "", emoji: "♟", roleIds: ["r1"] }] }],
  guide: { enabled: true, welcomeMessage: "hi", todos: [], resources: [] },
};

describe("onboarding / welcome screen / templates", () => {
  test("numeric ids are stable and snowflake-shaped", () => {
    const a = numericOnboardingId("q0");
    expect(a).toMatch(/^\d{19}$/);
    expect(numericOnboardingId("q0")).toBe(a);
    expect(numericOnboardingId("q1")).not.toBe(a);
    expect(numericOnboardingId("1234567890123456789")).toBe("1234567890123456789");
  });
  test("GET shape and PUT round trip keep stored ids and the guide", () => {
    const out = toDiscordOnboarding("g", CONFIG);
    expect(out.prompts[0].single_select).toBe(false);
    expect(out.prompts[0].options[0].role_ids).toEqual(["r1"]);
    const back = fromDiscordOnboarding(out, CONFIG) as { questions: Array<{ id: string; options: Array<{ id: string }> }>; guide: unknown };
    expect(back.questions[0].id).toBe("q0");
    expect(back.questions[0].options[0].id).toBe("q0_o0");
    expect(back.guide).toEqual(CONFIG.guide);
  });
  test("welcome screen shape", () => {
    expect(toDiscordWelcomeScreen({ enabled: true, description: "", welcomeChannels: [{ channelId: CHAN, description: "Rules", emojiName: "📜", emojiId: null }] })).toEqual({
      description: null,
      welcome_channels: [{ channel_id: CHAN, description: "Rules", emoji_id: null, emoji_name: "📜" }],
    });
  });
  test("serialized source guild uses Discord numbers", () => {
    const g = toDiscordSerializedGuild({
      name: "S", description: null, verificationLevel: "medium", explicitContentFilter: "all_members", defaultNotifications: "all_messages",
      afkTimeout: 300, systemChannelId: 1, afkChannelId: null,
      roles: [{ id: 0, name: "everyone", color: 0, hoist: false, mentionable: false, permissions: "1024", unicodeEmoji: null, position: 0 }],
      channels: [{ id: 1, name: "general", type: "text", topic: null, position: 0, parentId: null, nsfw: false, rateLimitPerUser: 0, bitrate: 64000, userLimit: 0, forumMode: null, availableTags: [], defaultAutoArchiveDuration: null, permissionOverwrites: [] }],
    });
    expect(g.verification_level).toBe(2);
    expect(g.explicit_content_filter).toBe(2);
    expect(g.default_message_notifications).toBe(0);
    expect(g.roles[0].name).toBe("@everyone");
    expect(g.channels[0].type).toBe(0);
  });
  test("template field limits", () => {
    expect(templateFieldError({ name: "ok" }, true)).toBeNull();
    expect(templateFieldError({}, true)?.path).toBe("name");
    expect(templateFieldError({ description: "x".repeat(121) }, false)?.path).toBe("description");
  });
});

describe("invites", () => {
  test("expired or used up", () => {
    expect(inviteExpired({ expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(inviteExpired({ maxUses: 2, uses: 2 })).toBe(true);
    expect(inviteExpired({ maxUses: 0, uses: 50, expiresAt: null })).toBe(false);
  });
});
