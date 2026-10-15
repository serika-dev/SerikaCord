/**
 * Rules for the full-page join flow (/channels/:serverId/onboarding): which
 * steps a member goes through, where it starts, when the app sends a member
 * there on its own, and the URL that carries the step (so Back / refresh
 * work). Pure functions plus the small "already seen" storage helpers.
 * Tests: tests/server-join-flow.test.ts.
 */

import type { ServerOnboarding } from "@/hooks/useServerOnboarding";

export type OnboardingFlowStep = "welcome" | "questions" | "rules" | "status";

export type FlowStatusKind = "approved" | "pending" | "rejected";

export type ApplicationState = "none" | "reviewing" | "rejected";

const FLOW_STEPS: readonly OnboardingFlowStep[] = ["welcome", "questions", "rules", "status"];

/** The join flow auto-opens only for members who joined recently (an owner
 *  enabling it later shouldn't send everyone through it). */
export const WELCOME_RECENT_MS = 3 * 24 * 60 * 60_000;

/** Rules Screening blocks this member (and the server has screening on). */
export function isScreeningBlocked(data: ServerOnboarding | null | undefined): boolean {
  return Boolean(data?.member.screeningBlocked && data.screening);
}

/** Whether the server has anything to show in the join flow at all. */
export function hasJoinFlow(data: ServerOnboarding): boolean {
  return Boolean(data.welcomeScreen || (data.onboarding?.questions.length ?? 0) > 0 || data.screening);
}

/** The steps this member goes through, fixed when the flow opens. */
export function planSteps(data: ServerOnboarding, preview: boolean, initialStep?: OnboardingFlowStep): OnboardingFlowStep[] {
  const steps: OnboardingFlowStep[] = [];
  const questions = data.onboarding?.questions ?? [];
  const hasQuestions = questions.length > 0 && (preview || !data.member.onboardingCompleted || initialStep === "questions");
  const hasRules = Boolean(data.screening) && (preview || data.member.screeningBlocked);
  if (data.welcomeScreen || initialStep === "welcome" || (!hasQuestions && !hasRules)) steps.push("welcome");
  if (hasQuestions) steps.push("questions");
  if (hasRules) steps.push("rules");
  steps.push("status");
  return steps;
}

/** Where the flow opens. */
export function startStep(
  steps: OnboardingFlowStep[],
  data: ServerOnboarding,
  preview: boolean,
  initialStep?: OnboardingFlowStep,
): OnboardingFlowStep {
  let start = initialStep && steps.includes(initialStep) ? initialStep : steps[0];
  const app = data.member.application;
  // Someone with an application in review (or turned down) lands on its status.
  if (!preview && data.member.screeningBlocked && app && app.status !== "approved" && (start === "rules" || initialStep === "status")) {
    start = "status";
  }
  return start;
}

/** What the status step says for a member (preview: the simulated outcome). */
export function flowStatusKind(data: ServerOnboarding, preview: boolean, previewOutcome: FlowStatusKind | null): FlowStatusKind {
  if (preview) return previewOutcome ?? "approved";
  const app = data.member.application;
  if (data.member.screeningBlocked && app?.status === "rejected") return "rejected";
  if (data.member.screeningBlocked && (app?.status === "pending" || app?.status === "interviewed" || data.screening?.manualApproval)) {
    return "pending";
  }
  return "approved";
}

export function applicationState(data: ServerOnboarding | null | undefined, blocked: boolean): ApplicationState {
  const status = data?.member.application?.status;
  if (!blocked || !status) return "none";
  if (status === "pending" || status === "interviewed") return "reviewing";
  if (status === "rejected") return "rejected";
  return "none";
}

/**
 * The step the app opens the join flow on by itself, or null to leave the
 * member alone: recent joiners who haven't seen the welcome screen /
 * answered the questions start at the beginning; members Rules Screening
 * still blocks go to the rules (unless their application is with a
 * moderator, or was turned down: the composer bar covers those).
 */
export function autoOnboardingStep(data: ServerOnboarding, opts: { seen: boolean; now: number }): OnboardingFlowStep | null {
  const joinedAt = data.member.joinedAt ? Date.parse(data.member.joinedAt) : NaN;
  const recent = Number.isFinite(joinedAt) && opts.now - joinedAt < WELCOME_RECENT_MS;
  const unansweredQuestions = (data.onboarding?.questions.length ?? 0) > 0 && !data.member.onboardingCompleted;
  if (recent && (data.welcomeScreen || unansweredQuestions) && !opts.seen) return "welcome";
  const blocked = isScreeningBlocked(data);
  if (blocked && applicationState(data, blocked) === "none") return "rules";
  return null;
}

export function parseFlowStep(value: string | null | undefined): OnboardingFlowStep | undefined {
  return FLOW_STEPS.find((s) => s === value);
}

/** `?q=` is 1-based in the URL; returns a 0-based index (0 when absent/invalid). */
export function parseQuestionParam(value: string | null | undefined): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n - 1 : 0;
}

/** /channels/:serverId/onboarding[?step=…[&q=…]] */
export function onboardingHref(serverId: string, step?: OnboardingFlowStep, questionIndex = 0): string {
  const base = `/channels/${serverId}/onboarding`;
  if (!step) return base;
  return step === "questions" ? `${base}?step=questions&q=${questionIndex + 1}` : `${base}?step=${step}`;
}

// ── "Seen" bookkeeping (browser only) ────────────────────────────────────────

const seenKey = (serverId: string) => `serika:welcome-seen:${serverId}`;
const draftKey = (serverId: string) => `serika:onboarding-draft:${serverId}`;
// Opened (or left) this session, so moving around the server doesn't send the
// member back into the flow.
const dismissedThisSession = new Set<string>();

export function welcomeSeen(serverId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(serverId)) === "1";
  } catch {
    return true;
  }
}

export function markWelcomeSeen(serverId: string) {
  try {
    window.localStorage.setItem(seenKey(serverId), "1");
  } catch {
    // storage unavailable: it just shows again next time
  }
}

export function dismissOnboardingForSession(serverId: string) {
  dismissedThisSession.add(serverId);
}

/** autoOnboardingStep for this device and session (null once handled this session). */
export function autoOnboardingStepNow(serverId: string, data: ServerOnboarding, opts: { ignoreSession?: boolean } = {}): OnboardingFlowStep | null {
  if (typeof window === "undefined") return null;
  if (!opts.ignoreSession && dismissedThisSession.has(serverId)) return null;
  return autoOnboardingStep(data, { seen: welcomeSeen(serverId), now: Date.now() });
}

/** Unsent onboarding picks, kept per tab so a refresh resumes with them. */
export function readOnboardingDraft(serverId: string): string[] | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(serverId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(serverId: string, optionIds: string[] | null) {
  try {
    if (optionIds) window.sessionStorage.setItem(draftKey(serverId), JSON.stringify(optionIds));
    else window.sessionStorage.removeItem(draftKey(serverId));
  } catch {
    // storage unavailable: picks just don't survive a refresh
  }
}
