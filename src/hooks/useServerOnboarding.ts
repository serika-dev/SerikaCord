"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** GET /api/servers/:id/onboarding (src/lib/api/community.ts). */
export interface WelcomeChannelView {
  channelId: string;
  description: string;
  emojiName: string | null;
  emojiId: string | null;
}

export interface OnboardingOptionView {
  id: string;
  title: string;
  description: string;
  emoji: string | null;
  roleIds: string[];
}

export interface OnboardingQuestionView {
  id: string;
  title: string;
  description: string;
  multiple: boolean;
  required: boolean;
  options: OnboardingOptionView[];
}

export type GuideTodoKind = "read" | "chat" | "roles" | "profile";

export interface GuideTodoView {
  id: string;
  kind: GuideTodoKind;
  title: string;
  description: string;
  channelId: string | null;
  emoji: string | null;
}

export interface GuideResourceView {
  id: string;
  title: string;
  description: string;
  channelId: string | null;
  emoji: string | null;
}

export interface ServerGuideView {
  enabled: boolean;
  welcomeMessage: string;
  todos: GuideTodoView[];
  resources: GuideResourceView[];
}

export type ApplicationQuestionType = "short" | "paragraph" | "choice";

export interface ApplicationQuestionView {
  id: string;
  type: ApplicationQuestionType;
  label: string;
  required: boolean;
  choices: string[];
}

export interface ServerConnectionView {
  id: string;
  provider: string;
  accountId: string;
  username: string | null;
  displayName: string | null;
  verified: boolean;
}

export type ApplicationStatus = "pending" | "approved" | "rejected" | "interviewed";

export interface ServerOnboarding {
  /** True for an admin's preview: nothing is saved. */
  preview: boolean;
  canManage: boolean;
  isOwner: boolean;
  server: {
    id: string;
    name: string;
    icon: string | null;
    banner: string | null;
    description: string | null;
    memberCount: number;
    onlineCount: number;
    createdAt: string | null;
    ownerId: string;
    joinMode?: "invite_only" | "apply_to_join" | "discoverable";
  };
  owner: { id: string; username: string; displayName: string | null; avatar: string | null } | null;
  welcomeScreen: { enabled: boolean; description: string; welcomeChannels: WelcomeChannelView[] } | null;
  onboarding: { questions: OnboardingQuestionView[] } | null;
  guide: ServerGuideView | null;
  screening: {
    description: string;
    rules: string[];
    manualApproval: boolean;
    questions: ApplicationQuestionView[];
    restrictChannels: boolean;
  } | null;
  connections: ServerConnectionView[];
  member: {
    pending: boolean;
    screeningBlocked: boolean;
    joinedAt: string | null;
    onboardingCompleted: boolean;
    optionIds: string[];
    todosDone: string[];
    application: {
      status: ApplicationStatus;
      rejectionReason: string | null;
      createdAt: string | null;
      /** What they answered last time (prefills "Edit and resubmit"). */
      answers?: ApplicationAnswerInput[];
    } | null;
  };
}

export interface ApplicationAnswerInput {
  questionId: string;
  answer: string;
}

export type SubmitRulesResult =
  | { ok: true; pending: boolean }
  | { ok: false; error: string; questionId?: string };

// One shared entry per server so the composer gate, the onboarding flow and
// the Server Guide read the same state, and an action updates all of them.
const store = new Map<string, ServerOnboarding | null>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load(serverId: string, force = false): Promise<void> {
  if (!force && (store.has(serverId) || inflight.has(serverId))) return inflight.get(serverId) ?? Promise.resolve();
  const p = fetch(`/api/servers/${serverId}/onboarding`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: ServerOnboarding | null) => {
      store.set(serverId, data && data.member ? data : null);
    })
    .catch(() => {
      store.set(serverId, null);
    })
    .finally(() => {
      inflight.delete(serverId);
      emit();
    });
  inflight.set(serverId, p);
  return p;
}

function patch(serverId: string, fn: (current: ServerOnboarding) => ServerOnboarding) {
  const current = store.get(serverId);
  if (!current) return;
  store.set(serverId, fn(current));
  emit();
}

/** Drop the cached state so the next reader refetches (e.g. after settings change). */
export function invalidateServerOnboarding(serverId: string) {
  store.delete(serverId);
  void load(serverId, true);
}

/** The admin preview of the join experience: everything shown, as a brand-new member. */
export async function fetchOnboardingPreview(serverId: string): Promise<ServerOnboarding | null> {
  try {
    const res = await fetch(`/api/servers/${serverId}/onboarding?preview=1`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerOnboarding;
    return data?.member ? data : null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: {} };
  }
}

// A moderator approving / rejecting the member arrives over the activity
// stream (UnreadContext re-dispatches it as a window event).
if (typeof window !== "undefined") {
  window.addEventListener("serika:server-onboarding", (e) => {
    const serverId = (e as CustomEvent<{ serverId?: string }>).detail?.serverId;
    if (serverId && store.has(serverId)) invalidateServerOnboarding(serverId);
  });
}

/**
 * Onboarding, Server Guide and rules screening state of the current member in
 * a server. `blocked` is true while they must still be let in past the rules.
 */
export function useServerOnboarding(serverId: string | null | undefined) {
  const data = useSyncExternalStore(
    subscribe,
    () => (serverId ? store.get(serverId) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (serverId) void load(serverId);
  }, [serverId]);

  // While an application waits for a moderator, check now and then in case
  // the live event was missed (other instance down, tab asleep).
  const awaitingReview = data?.member.application?.status === "pending" && data.member.screeningBlocked;
  useEffect(() => {
    if (!serverId || !awaitingReview) return;
    const timer = setInterval(() => invalidateServerOnboarding(serverId), 60_000);
    return () => clearInterval(timer);
  }, [serverId, awaitingReview]);

  /** Accept the rules (with application answers when the server reviews them). */
  const submitRules = useCallback(async (answers: ApplicationAnswerInput[] = []): Promise<SubmitRulesResult> => {
    if (!serverId) return { ok: false, error: "" };
    const { ok, data: body } = await postJson(`/api/servers/${serverId}/screening/accept`, { accepted: true, answers });
    if (!ok) return { ok: false, error: typeof body.error === "string" ? body.error : "", questionId: typeof body.questionId === "string" ? body.questionId : undefined };
    const pending = body.pending === true;
    patch(serverId, (current) => ({
      ...current,
      member: {
        ...current.member,
        pending,
        screeningBlocked: pending,
        application: pending
          ? ((body.application as ServerOnboarding["member"]["application"]) ?? { status: "pending", rejectionReason: null, createdAt: new Date().toISOString() })
          : current.member.application,
      },
    }));
    return { ok: true, pending };
  }, [serverId]);

  /** Back-compat: accept the rules without answers. */
  const accept = useCallback(async () => (await submitRules([])).ok, [submitRules]);

  /** Save onboarding picks; roles follow once the member is past screening. */
  const submitOnboarding = useCallback(async (optionIds: string[]): Promise<{ ok: boolean; error?: string; questionId?: string }> => {
    if (!serverId) return { ok: false };
    const { ok, data: body } = await postJson(`/api/servers/${serverId}/onboarding/responses`, { optionIds });
    if (!ok) return { ok: false, error: typeof body.error === "string" ? body.error : undefined, questionId: typeof body.questionId === "string" ? body.questionId : undefined };
    const saved = Array.isArray(body.optionIds) ? (body.optionIds as string[]) : optionIds;
    patch(serverId, (current) => ({ ...current, member: { ...current.member, onboardingCompleted: true, optionIds: saved } }));
    return { ok: true };
  }, [serverId]);

  /** Tick a Server Guide to-do (optimistic). */
  const completeTodo = useCallback(async (todoId: string) => {
    if (!serverId) return;
    patch(serverId, (current) => current.member.todosDone.includes(todoId)
      ? current
      : { ...current, member: { ...current.member, todosDone: [...current.member.todosDone, todoId] } });
    await postJson(`/api/servers/${serverId}/onboarding/todos/${encodeURIComponent(todoId)}`, {});
  }, [serverId]);

  const refresh = useCallback(() => {
    if (serverId) invalidateServerOnboarding(serverId);
  }, [serverId]);

  return {
    data,
    blocked: Boolean(data?.member.screeningBlocked && data.screening),
    accept,
    submitRules,
    submitOnboarding,
    completeTodo,
    refresh,
  };
}
