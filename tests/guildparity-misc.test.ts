import { describe, expect, test } from "bun:test";
import { parseStageInstanceBody, toDiscordStageInstance } from "@/lib/botapi/guildStageInstanceRules";
import { incidentsDataOf, invitesPaused, parseIncidentActions, readIncidents } from "@/lib/botapi/guildIncidentRules";
import { toDiscordNewMemberWelcome } from "@/lib/botapi/guildWelcomeRules";
import { NOT_RECURRING_ERROR, parseExceptionBody, parseExceptionIds } from "@/lib/botapi/guildEventExceptionRules";
import { recommendedShards, sessionStartLimit } from "@/lib/botapi/guildGatewayRules";
import { normalizeOnboardingConfig, withBotOnboardingFields } from "@/lib/servers/onboarding";
import { fromDiscordOnboarding, toDiscordOnboarding } from "@/lib/botapi/communityRules";
import { AuditLogEvent, auditTargetKind, auditVerb } from "@/lib/audit/auditLog";

const NOW = Date.parse("2026-10-27T12:00:00Z");

describe("stage instances", () => {
  test("create body", () => {
    expect(parseStageInstanceBody({ channel_id: "c", topic: " Town hall " }, { create: true })).toEqual({ ok: true, fields: { channelId: "c", topic: "Town hall" } });
    expect(parseStageInstanceBody({ topic: "x" }, { create: true }).ok).toBe(false);
    expect(parseStageInstanceBody({ channel_id: "c", topic: "x".repeat(121) }, { create: true }).ok).toBe(false);
    // PUBLIC (1) is deprecated and refused.
    expect(parseStageInstanceBody({ channel_id: "c", topic: "t", privacy_level: 1 }, { create: true }).ok).toBe(false);
    const full = parseStageInstanceBody({ channel_id: "c", topic: "t", privacy_level: 2, send_start_notification: true, guild_scheduled_event_id: "e" }, { create: true });
    expect(full.ok && full.fields).toEqual({ channelId: "c", topic: "t", privacyLevel: 2, sendStartNotification: true, guildScheduledEventId: "e" });
  });
  test("patch body ignores create-only fields", () => {
    expect(parseStageInstanceBody({ topic: "new", channel_id: "z", send_start_notification: true }, { create: false })).toEqual({ ok: true, fields: { topic: "new" } });
    expect(parseStageInstanceBody({}, { create: false })).toEqual({ ok: true, fields: {} });
  });
  test("shape", () => {
    expect(toDiscordStageInstance({ id: "i", serverId: "g", channelId: "c", topic: "t", privacyLevel: 2, discoverableDisabled: true, guildScheduledEventId: null }))
      .toEqual({ id: "i", guild_id: "g", channel_id: "c", topic: "t", privacy_level: 2, discoverable_disabled: true, guild_scheduled_event_id: null });
  });
});

describe("incident actions", () => {
  const inAnHour = new Date(NOW + 3600_000).toISOString();
  test("parse: set, keep, clear, past, too far", () => {
    const set = parseIncidentActions({ invites_disabled_until: inAnHour }, {}, NOW);
    expect(set).toEqual({ ok: true, value: { invitesDisabledUntil: inAnHour, dmsDisabledUntil: null } });
    const settings = { incidents: { invitesDisabledUntil: inAnHour, dmsDisabledUntil: inAnHour } };
    expect(parseIncidentActions({ dms_disabled_until: null }, settings, NOW)).toEqual({ ok: true, value: { invitesDisabledUntil: inAnHour, dmsDisabledUntil: null } });
    expect(parseIncidentActions({ invites_disabled_until: new Date(NOW - 1000).toISOString() }, {}, NOW)).toEqual({ ok: true, value: { invitesDisabledUntil: null, dmsDisabledUntil: null } });
    expect(parseIncidentActions({ invites_disabled_until: new Date(NOW + 25 * 3600_000).toISOString() }, {}, NOW).ok).toBe(false);
    expect(parseIncidentActions({ dms_disabled_until: "soon" }, {}, NOW).ok).toBe(false);
  });
  test("read + pause checks expire", () => {
    const settings = { incidents: { invitesDisabledUntil: inAnHour } };
    expect(invitesPaused(settings, NOW)).toBe(true);
    expect(invitesPaused(settings, NOW + 2 * 3600_000)).toBe(false);
    expect(readIncidents(settings, NOW)).toEqual({ invites_disabled_until: inAnHour, dms_disabled_until: null });
    expect(incidentsDataOf({}, NOW)).toBeNull();
    expect(incidentsDataOf(null, NOW)).toBeNull();
  });
});

describe("new member welcome", () => {
  test("maps the Server Guide", () => {
    const out = toDiscordNewMemberWelcome("g", {
      enabled: true,
      welcomeMessage: "Hi &amp; welcome",
      todos: [
        { id: "t0", kind: "read", title: "Rules", description: "Read them", channelId: "c1", emoji: "📜" },
        { id: "t1", kind: "chat", title: "Say hi", description: "", channelId: "c2", emoji: null },
        { id: "t2", kind: "roles", title: "Pick roles", description: "", channelId: null, emoji: null },
      ],
      resources: [
        { id: "r0", title: "FAQ", description: "Answers", channelId: "c3", emoji: null },
        { id: "r1", title: "Orphan", description: "", channelId: null, emoji: null },
      ],
    }, { ownerId: "o", decode: (s) => s.replace("&amp;", "&") });
    expect(out.enabled).toBe(true);
    expect(out.welcome_message).toEqual({ author_ids: ["o"], message: "Hi & welcome" });
    expect(out.new_member_actions).toEqual([
      { channel_id: "c1", action_type: 0, title: "Rules", description: "Read them", emoji: { id: null, name: "📜", animated: false } },
      { channel_id: "c2", action_type: 1, title: "Say hi", description: "" },
    ]);
    expect(out.resource_channels).toEqual([{ channel_id: "c3", title: "FAQ", description: "Answers" }]);
  });
  test("disabled guide", () => {
    const out = toDiscordNewMemberWelcome("g", { enabled: false, welcomeMessage: "", todos: [], resources: [] });
    expect(out.enabled).toBe(false);
    expect("welcome_message" in out).toBe(false);
  });
});

describe("scheduled event exceptions", () => {
  test("create body needs the original start time", () => {
    expect(parseExceptionBody({}, { create: true }).ok).toBe(false);
    expect(parseExceptionBody({ original_scheduled_start_time: "nope" }, { create: true }).ok).toBe(false);
    expect(parseExceptionBody({ original_scheduled_start_time: "2026-11-01T10:00:00Z", is_canceled: true }, { create: true }))
      .toEqual({ ok: true, fields: { originalScheduledStartTime: "2026-11-01T10:00:00Z", isCanceled: true } });
    expect(parseExceptionBody({ scheduled_end_time: null }, { create: false })).toEqual({ ok: true, fields: { scheduledEndTime: null } });
    expect(NOT_RECURRING_ERROR.path).toBe("original_scheduled_start_time");
  });
  test("exception id lists", () => {
    expect(parseExceptionIds(undefined)).toEqual({ ok: true, ids: [] });
    expect(parseExceptionIds(["1290000000000000000", "1290000000000000001"])).toEqual({ ok: true, ids: ["1290000000000000000", "1290000000000000001"] });
    expect(parseExceptionIds(Array.from({ length: 11 }, (_, i) => String(i + 1))).ok).toBe(false);
    expect(parseExceptionIds("x").ok).toBe(false);
  });
});

describe("gateway/bot", () => {
  test("shards: one per 1000 guilds", () => {
    expect(recommendedShards(0)).toBe(1);
    expect(recommendedShards(1000)).toBe(1);
    expect(recommendedShards(1001)).toBe(2);
    expect(recommendedShards(2500)).toBe(3);
  });
  test("session start limit", () => {
    expect(sessionStartLimit(null)).toEqual({ total: 1000, remaining: 1000, reset_after: 86_400_000, max_concurrency: 1 });
    expect(sessionStartLimit({ consumedPoints: 3, msBeforeNext: 1234.4 })).toEqual({ total: 1000, remaining: 997, reset_after: 1234, max_concurrency: 1 });
    expect(sessionStartLimit({ consumedPoints: 1200, msBeforeNext: 5 }).remaining).toBe(0);
  });
});

describe("onboarding channels and mode", () => {
  const channels = new Set(["c1", "c2"]);
  const input = {
    enabled: true,
    questions: [{ id: "q0", title: "Games?", options: [{ id: "o0", title: "Chess", roleIds: [], channelIds: ["c1", "nope", "c1"] }] }],
    defaultChannelIds: ["c2", "zzz"],
    mode: 1,
  };
  test("normalizer keeps known channels and the mode", () => {
    const cfg = normalizeOnboardingConfig(input, { channelIds: channels });
    expect(cfg.questions[0].options[0].channelIds).toEqual(["c1"]);
    expect(cfg.defaultChannelIds).toEqual(["c2"]);
    expect(cfg.mode).toBe(1);
  });
  test("omitted when empty (stored JSON unchanged for old configs)", () => {
    const cfg = normalizeOnboardingConfig({ enabled: false, questions: [{ id: "q0", title: "A", options: [{ id: "o0", title: "B", roleIds: [] }] }] });
    expect("channelIds" in cfg.questions[0].options[0]).toBe(false);
    expect("defaultChannelIds" in cfg).toBe(false);
    expect("mode" in cfg).toBe(false);
  });
  test("bot API round trip", () => {
    const cfg = normalizeOnboardingConfig(input, { channelIds: channels });
    const out = toDiscordOnboarding("g", cfg);
    expect(out.default_channel_ids).toEqual(["c2"]);
    expect(out.mode).toBe(1);
    expect(out.prompts[0].options[0].channel_ids).toEqual(["c1"]);
    const back = fromDiscordOnboarding({ prompts: out.prompts, default_channel_ids: ["c1"], mode: 0 }, cfg);
    const again = normalizeOnboardingConfig(back, { channelIds: channels });
    expect(again.defaultChannelIds).toEqual(["c1"]);
    expect(again.mode).toBeUndefined();
    expect(again.questions[0].options[0].channelIds).toEqual(["c1"]);
    // Omitted default channels / mode keep the current values.
    const kept = normalizeOnboardingConfig(fromDiscordOnboarding({ enabled: true }, cfg), { channelIds: channels });
    expect(kept.defaultChannelIds).toEqual(["c2"]);
    expect(kept.mode).toBe(1);
  });
  test("web editor saves keep the bot-only fields", () => {
    const current = normalizeOnboardingConfig(input, { channelIds: channels });
    const submitted = { enabled: true, questions: [{ id: "q0", title: "Games?", options: [{ id: "o0", title: "Chess!", roleIds: [] }] }] };
    const merged = normalizeOnboardingConfig(withBotOnboardingFields(submitted, current), { channelIds: channels });
    expect(merged.questions[0].options[0].title).toBe("Chess!");
    expect(merged.questions[0].options[0].channelIds).toEqual(["c1"]);
    expect(merged.defaultChannelIds).toEqual(["c2"]);
    expect(merged.mode).toBe(1);
  });
});

describe("audit log event types", () => {
  test("new targets and verbs", () => {
    expect(auditTargetKind(AuditLogEvent.STAGE_INSTANCE_CREATE)).toBe("stage_instance");
    expect(auditTargetKind(AuditLogEvent.GUILD_SCHEDULED_EVENT_UPDATE)).toBe("scheduled_event");
    expect(auditTargetKind(AuditLogEvent.APPLICATION_COMMAND_PERMISSION_UPDATE)).toBe("application_command");
    expect(auditVerb(AuditLogEvent.GUILD_SCHEDULED_EVENT_DELETE)).toBe("delete");
    expect(auditVerb(AuditLogEvent.STAGE_INSTANCE_CREATE)).toBe("create");
    // Unchanged neighbours.
    expect(auditTargetKind(AuditLogEvent.MESSAGE_UNPIN)).toBe("user");
    expect(auditTargetKind(AuditLogEvent.STICKER_DELETE)).toBe("sticker");
  });
});

describe("exception users query", () => {
  test("validates like the event users list", async () => {
    const { parseExceptionUsersQuery } = await import("@/lib/botapi/guildEventExceptionRules");
    expect(parseExceptionUsersQuery({ with_member: "true", limit: "50" }).ok).toBe(true);
    expect(parseExceptionUsersQuery({ limit: "101" }).ok).toBe(false);
    expect(parseExceptionUsersQuery({ with_member: "maybe" }).ok).toBe(false);
    expect(parseExceptionUsersQuery({ after: "x" }).ok).toBe(false);
  });
});
