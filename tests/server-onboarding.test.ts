import { describe, expect, test } from "bun:test";
import {
  applyOnboardingRoles,
  isGuideVisible,
  isOnboardingVisible,
  isSafeOnboardingRole,
  normalizeLinkedConnectionIds,
  normalizeOnboardingConfig,
  onboardingRoleChanges,
  validateOnboardingSelection,
} from "@/lib/servers/onboarding";
import {
  isChannelAccessibleWhilePending,
  normalizeApplicationQuestions,
  normalizeScreeningConfig,
  validateApplicationAnswers,
} from "@/lib/servers/community";
import {
  containsLink,
  evaluateVerificationGate,
  formatVerificationWait,
  normalizeVerificationOptions,
  restrictsAny,
  verificationErrorMessage,
} from "@/lib/servers/verification";
import { PERMISSION_BITS } from "@/lib/permissions/bits";

const config = normalizeOnboardingConfig({
  enabled: true,
  questions: [
    {
      id: "games",
      title: "What do you play?",
      multiple: true,
      required: true,
      options: [
        { id: "osu", title: "osu!", emoji: "🎵", roleIds: ["r-osu"] },
        { id: "mc", title: "Minecraft", roleIds: ["r-mc", "r-mc"] },
      ],
    },
    {
      id: "region",
      title: "Where are you?",
      options: [
        { id: "eu", title: "Europe", roleIds: ["r-eu"] },
        { id: "na", title: "Americas", roleIds: ["r-na"] },
      ],
    },
    { id: "empty", title: "No options", options: [] },
  ],
  guide: {
    enabled: true,
    welcomeMessage: "  Hi\n\n\n\nthere  ",
    todos: [
      { id: "t1", kind: "read", title: "Read the rules", channelId: "c-rules" },
      { id: "t2", kind: "chat", title: "Say hi", channelId: "c-gone" },
      { id: "t3", kind: "roles", title: "Pick roles", channelId: "c-rules" },
    ],
    resources: [{ id: "res", title: "FAQ", channelId: "c-gone" }],
  },
}, { channelIds: new Set(["c-rules"]), roleIds: new Set(["r-osu", "r-mc", "r-eu", "r-na"]) });

describe("onboarding config", () => {
  test("normalizes questions, options, roles and the guide", () => {
    expect(config.questions.map((q) => q.id)).toEqual(["games", "region"]);
    expect(config.questions[0].options[1].roleIds).toEqual(["r-mc"]);
    expect(config.questions[1].multiple).toBe(false);
    expect(config.guide.welcomeMessage).toBe("Hi\n\nthere");
    // A chat to-do pointing at a deleted channel is dropped; 'roles' needs none.
    expect(config.guide.todos.map((t) => [t.id, t.channelId])).toEqual([["t1", "c-rules"], ["t3", null]]);
    expect(config.guide.resources[0].channelId).toBeNull();
    expect(isOnboardingVisible(config)).toBe(true);
    expect(isGuideVisible(config.guide)).toBe(true);
  });

  test("roles outside the allowed set are dropped", () => {
    const c = normalizeOnboardingConfig({
      enabled: true,
      questions: [{ title: "Q", options: [{ title: "A", roleIds: ["admin-role", "ok"] }] }],
    }, { roleIds: new Set(["ok"]) });
    expect(c.questions[0].options[0].roleIds).toEqual(["ok"]);
  });

  test("can't be enabled without a question", () => {
    expect(normalizeOnboardingConfig({ enabled: true, questions: [] }).enabled).toBe(false);
  });
});

describe("onboarding selection and roles", () => {
  test("required questions must be answered; single choice keeps one pick", () => {
    expect(validateOnboardingSelection(config, ["eu"])).toEqual({ error: "Please answer: What do you play?", questionId: "games" });
    expect(validateOnboardingSelection(config, ["osu", "mc", "eu", "na", "bogus"])).toEqual({ optionIds: ["osu", "mc", "eu"] });
  });

  test("roles follow the picks and other roles are kept", () => {
    const changes = onboardingRoleChanges(config, ["osu", "eu"]);
    expect([...changes.grant].sort()).toEqual(["r-eu", "r-osu"]);
    // Had Minecraft + NA before; switched to osu! + EU. A mod-given role stays.
    expect(applyOnboardingRoles(["everyone", "r-mc", "r-na", "mod-given"], changes)).toEqual(["everyone", "mod-given", "r-osu", "r-eu"]);
  });

  test("only harmless roles can be self-assigned", () => {
    expect(isSafeOnboardingRole({ id: "a", permissions: (PERMISSION_BITS.SEND_MESSAGES | PERMISSION_BITS.ADD_REACTIONS).toString() })).toBe(true);
    for (const bit of [PERMISSION_BITS.ADMINISTRATOR, PERMISSION_BITS.MANAGE_ROLES, PERMISSION_BITS.BAN_MEMBERS, PERMISSION_BITS.MENTION_EVERYONE, PERMISSION_BITS.MODERATE_MEMBERS]) {
      expect(isSafeOnboardingRole({ id: "b", permissions: bit.toString() })).toBe(false);
    }
    expect(isSafeOnboardingRole({ id: "c", permissions: "0", managed: true })).toBe(false);
    expect(isSafeOnboardingRole({ id: "d", permissions: "0", isDefault: true })).toBe(false);
    expect(isSafeOnboardingRole({ id: "e", permissions: "garbage" })).toBe(true);
  });

  test("linked connection ids are uuids, deduped and capped", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(normalizeLinkedConnectionIds([id, id, "nope", 5])).toEqual([id]);
  });
});

describe("rules screening extensions", () => {
  test("application questions", () => {
    const qs = normalizeApplicationQuestions([
      { id: "why", label: "Why join?", type: "paragraph" },
      { id: "age", label: "Age range", type: "choice", choices: ["13-17", "18+", "18+"], required: false },
      { label: "Bad choice", type: "choice", choices: ["only one"] },
      { label: "" },
    ]);
    expect(qs.map((q) => [q.id, q.type, q.required, q.choices.length])).toEqual([["why", "paragraph", true, 0], ["age", "choice", false, 2]]);
    expect(validateApplicationAnswers(qs, [])).toEqual({ error: "Please answer: Why join?", questionId: "why" });
    expect(validateApplicationAnswers(qs, [{ questionId: "why", answer: " fun " }, { questionId: "age", answer: "99" }])).toEqual({
      answers: [{ questionId: "why", question: "Why join?", answer: "fun" }, { questionId: "age", question: "Age range", answer: "" }],
    });
  });

  test("config keeps channel access and manual approval; unknown channels dropped", () => {
    const c = normalizeScreeningConfig(
      { enabled: true, rules: ["Be nice"], restrictChannels: true, accessibleChannelIds: ["info", "gone", "info"], manualApproval: true },
      new Set(["info"]),
    );
    expect(c).toMatchObject({ enabled: true, restrictChannels: true, accessibleChannelIds: ["info"], manualApproval: true, questions: [] });
    // Rows stored before the new columns existed still read.
    expect(normalizeScreeningConfig({ enabled: true, rules: ["x"] })).toMatchObject({ restrictChannels: false, manualApproval: false });
  });

  test("pending channel access follows categories and thread parents", () => {
    const allowed = new Set(["info-cat", "welcome"]);
    const all = [
      { id: "info-cat", type: "category" },
      { id: "rules", parentId: "info-cat", type: "text" },
      { id: "general-cat", type: "category" },
      { id: "welcome", parentId: "general-cat", type: "text" },
      { id: "chat", parentId: "general-cat", type: "text" },
    ];
    const ok = (id: string) => isChannelAccessibleWhilePending(all.find((c) => c.id === id)!, null, allowed, all);
    expect(["info-cat", "rules", "general-cat", "welcome"].every(ok)).toBe(true);
    expect(ok("chat")).toBe(false);
    expect(isChannelAccessibleWhilePending({ id: "thread", parentId: "rules", type: "public_thread" }, all[1], allowed)).toBe(true);
    expect(isChannelAccessibleWhilePending({ id: "thread2", parentId: "chat", type: "public_thread" }, all[4], allowed)).toBe(false);
  });
});

describe("verification options", () => {
  const NOW = Date.parse("2026-10-10T12:00:00Z");
  const old = new Date(NOW - 30 * 24 * 3600_000);

  test("defaults, clamping and restrict filtering", () => {
    expect(normalizeVerificationOptions(undefined)).toEqual({ accountAgeMinutes: 5, memberAgeMinutes: 10, restrict: ["send", "attach", "links", "react", "voice", "threads"] });
    expect(normalizeVerificationOptions({ accountAgeMinutes: 0, memberAgeMinutes: 10 ** 9, restrict: ["send", "nope"] }))
      .toEqual({ accountAgeMinutes: 1, memberAgeMinutes: 43200, restrict: ["send"] });
  });

  test("custom waits", () => {
    const joined = new Date(NOW - 3 * 3600_000);
    const r = evaluateVerificationGate({
      level: "high", roleCount: 0, emailVerified: true, accountCreatedAt: old, memberJoinedAt: joined, now: NOW,
      options: { accountAgeMinutes: 60, memberAgeMinutes: 24 * 60 },
    });
    expect(r.reason).toBe("member_age");
    expect(r.until).toBe(new Date(joined.getTime() + 24 * 3600_000).toISOString());
  });

  test("highest needs a verified connection", () => {
    const base = { level: "very_high" as const, roleCount: 0, emailVerified: true, accountCreatedAt: old, memberJoinedAt: old, now: NOW };
    expect(evaluateVerificationGate({ ...base, hasVerifiedConnection: false }).reason).toBe("connection");
    expect(evaluateVerificationGate({ ...base, hasVerifiedConnection: true }).blocked).toBe(false);
  });

  test("per-action restrictions and messages", () => {
    const opts = normalizeVerificationOptions({ restrict: ["send", "links"] });
    expect(restrictsAny(opts, ["react"])).toBe(false);
    expect(restrictsAny(opts, ["react", "links"])).toBe(true);
    expect(formatVerificationWait(90)).toBe("90 minutes");
    expect(formatVerificationWait(120)).toBe("2 hours");
    expect(formatVerificationWait(1440)).toBe("1 day");
    expect(verificationErrorMessage("account_age", { accountAgeMinutes: 2880, memberAgeMinutes: 10 })).toContain("2 days");
  });

  test("link detection", () => {
    for (const s of ["see https://x.y", "www.example.org", "join discord.gg/abc", "go to example.com now"]) expect(containsLink(s)).toBe(true);
    for (const s of ["hello there", "v1.2 is out", "e.g. this", null]) expect(containsLink(s)).toBe(false);
  });
});
