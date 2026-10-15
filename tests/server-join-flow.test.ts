import { describe, expect, test } from "bun:test";
import type { ServerOnboarding } from "../src/hooks/useServerOnboarding";
import {
  WELCOME_RECENT_MS,
  applicationState,
  autoOnboardingStep,
  flowStatusKind,
  hasJoinFlow,
  onboardingHref,
  parseFlowStep,
  parseQuestionParam,
  planSteps,
  startStep,
} from "../src/components/server/community/joinFlowPlan";

const NOW = Date.parse("2026-10-15T12:00:00Z");

function make(over: {
  welcome?: boolean;
  questions?: number;
  screening?: { manualApproval?: boolean } | null;
  member?: Partial<ServerOnboarding["member"]>;
} = {}): ServerOnboarding {
  const questions = Array.from({ length: over.questions ?? 0 }, (_, i) => ({
    id: `q${i}`,
    title: `Q${i}`,
    description: "",
    multiple: false,
    required: false,
    options: [{ id: `o${i}`, title: "A", description: "", emoji: null, roleIds: [] }],
  }));
  return {
    preview: false,
    canManage: false,
    isOwner: false,
    server: { id: "s1", name: "Test", icon: null, banner: null, description: null, memberCount: 2, onlineCount: 1, createdAt: null, ownerId: "u0" },
    owner: null,
    welcomeScreen: over.welcome ? { enabled: true, description: "hi", welcomeChannels: [] } : null,
    onboarding: questions.length ? { questions } : null,
    guide: null,
    screening: over.screening
      ? { description: "", rules: ["Be nice"], manualApproval: Boolean(over.screening.manualApproval), questions: [], restrictChannels: false }
      : null,
    connections: [],
    member: {
      pending: false,
      screeningBlocked: false,
      joinedAt: new Date(NOW - 60_000).toISOString(),
      onboardingCompleted: false,
      optionIds: [],
      todosDone: [],
      application: null,
      ...over.member,
    },
  };
}

describe("join flow steps", () => {
  test("welcome, questions and rules in order, then the outcome", () => {
    const data = make({ welcome: true, questions: 2, screening: {}, member: { screeningBlocked: true, pending: true } });
    expect(planSteps(data, false)).toEqual(["welcome", "questions", "rules", "status"]);
  });

  test("answered questions and accepted rules are skipped", () => {
    const data = make({ welcome: true, questions: 2, screening: {}, member: { onboardingCompleted: true } });
    expect(planSteps(data, false)).toEqual(["welcome", "status"]);
    // …unless the member reopens the questions (Server Guide "pick your roles").
    expect(planSteps(data, false, "questions")).toEqual(["welcome", "questions", "status"]);
  });

  test("the preview always shows everything", () => {
    const data = make({ questions: 1, screening: {}, member: { onboardingCompleted: true } });
    expect(planSteps(data, true)).toEqual(["questions", "rules", "status"]);
  });

  test("an application with the moderators opens on its status", () => {
    const data = make({
      screening: { manualApproval: true },
      member: { screeningBlocked: true, application: { status: "pending", rejectionReason: null, createdAt: null } },
    });
    const steps = planSteps(data, false, "rules");
    expect(startStep(steps, data, false, "rules")).toBe("status");
    expect(flowStatusKind(data, false, null)).toBe("pending");
  });

  test("a turned-down application reads as rejected", () => {
    const data = make({
      screening: { manualApproval: true },
      member: { screeningBlocked: true, application: { status: "rejected", rejectionReason: "no", createdAt: null } },
    });
    expect(flowStatusKind(data, false, null)).toBe("rejected");
    expect(applicationState(data, true)).toBe("rejected");
  });

  test("an unknown start step falls back to the first one", () => {
    const data = make({ questions: 1 });
    const steps = planSteps(data, false, "rules");
    expect(startStep(steps, data, false, "rules")).toBe(steps[0]);
  });
});

describe("opening the join flow on its own", () => {
  test("recent joiners with a welcome screen start at the beginning, once", () => {
    const data = make({ welcome: true });
    expect(autoOnboardingStep(data, { seen: false, now: NOW })).toBe("welcome");
    expect(autoOnboardingStep(data, { seen: true, now: NOW })).toBeNull();
  });

  test("long-time members aren't sent through a newly enabled flow", () => {
    const data = make({ welcome: true, questions: 1, member: { joinedAt: new Date(NOW - WELCOME_RECENT_MS - 1).toISOString() } });
    expect(autoOnboardingStep(data, { seen: false, now: NOW })).toBeNull();
  });

  test("Rules Screening keeps asking until accepted, but not while an application waits", () => {
    const blocked = make({ screening: {}, member: { screeningBlocked: true, joinedAt: null } });
    expect(autoOnboardingStep(blocked, { seen: true, now: NOW })).toBe("rules");
    const waiting = make({
      screening: { manualApproval: true },
      member: { screeningBlocked: true, application: { status: "pending", rejectionReason: null, createdAt: null } },
    });
    expect(autoOnboardingStep(waiting, { seen: true, now: NOW })).toBeNull();
  });

  test("servers without onboarding have no flow", () => {
    expect(hasJoinFlow(make())).toBe(false);
    expect(hasJoinFlow(make({ screening: {} }))).toBe(true);
    expect(autoOnboardingStep(make(), { seen: false, now: NOW })).toBeNull();
  });
});

describe("join flow URL", () => {
  test("carries the step and the 1-based question", () => {
    expect(onboardingHref("s1")).toBe("/channels/s1/onboarding");
    expect(onboardingHref("s1", "rules")).toBe("/channels/s1/onboarding?step=rules");
    expect(onboardingHref("s1", "questions", 2)).toBe("/channels/s1/onboarding?step=questions&q=3");
  });

  test("parses back defensively", () => {
    expect(parseFlowStep("questions")).toBe("questions");
    expect(parseFlowStep("nope")).toBeUndefined();
    expect(parseFlowStep(null)).toBeUndefined();
    expect(parseQuestionParam("3")).toBe(2);
    expect(parseQuestionParam("0")).toBe(0);
    expect(parseQuestionParam("x")).toBe(0);
    expect(parseQuestionParam(null)).toBe(0);
  });
});
