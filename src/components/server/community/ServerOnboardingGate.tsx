"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { T } from "gt-next";
import { CircleX, Hourglass, ScrollText } from "lucide-react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding, type ServerOnboarding } from "@/hooks/useServerOnboarding";
import type { OnboardingFlowStep } from "./ServerWelcomeModal";

const ServerWelcomeModal = dynamic(() => import("./ServerWelcomeModal"), { ssr: false });

// The join flow auto-opens once per server per device, and only for members
// who joined recently (an owner enabling it later shouldn't pop it for everyone).
const WELCOME_RECENT_MS = 3 * 24 * 60 * 60_000;
const seenKey = (serverId: string) => `serika:welcome-seen:${serverId}`;
// Dismissed this session (rules prompt), so switching channels doesn't reopen it.
const dismissedThisSession = new Set<string>();

function welcomeSeen(serverId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(serverId)) === "1";
  } catch {
    return true;
  }
}

function markWelcomeSeen(serverId: string) {
  try {
    window.localStorage.setItem(seenKey(serverId), "1");
  } catch {
    // storage unavailable: it just shows again next time
  }
}

type ApplicationState = "none" | "reviewing" | "rejected";

function applicationState(data: ServerOnboarding | null, blocked: boolean): ApplicationState {
  const status = data?.member.application?.status;
  if (!blocked || !status) return "none";
  if (status === "pending" || status === "interviewed") return "reviewing";
  if (status === "rejected") return "rejected";
  return "none";
}

function shouldAutoOpen(serverId: string, data: ServerOnboarding | null, blocked: boolean): OnboardingFlowStep | null {
  if (!data || typeof window === "undefined" || dismissedThisSession.has(serverId)) return null;
  const joinedAt = data.member.joinedAt ? Date.parse(data.member.joinedAt) : NaN;
  const recent = Number.isFinite(joinedAt) && Date.now() - joinedAt < WELCOME_RECENT_MS;
  const unansweredQuestions = (data.onboarding?.questions.length ?? 0) > 0 && !data.member.onboardingCompleted;
  // The flow starts at its first step (welcome screen, else the questions).
  if (recent && (data.welcomeScreen || unansweredQuestions) && !welcomeSeen(serverId)) return "welcome";
  // Rules screening: prompt until accepted, but leave people waiting on a
  // moderator (or turned down) alone; the composer bar covers them.
  if (blocked && applicationState(data, blocked) === "none") return "rules";
  return null;
}

/**
 * Rendered above the channel composer: opens the server's join flow
 * (welcome screen, onboarding questions, rules) for new members and, while
 * Rules Screening blocks them, shows Discord's "complete the steps" bar —
 * or where their application stands when moderators review members.
 */
export function ServerOnboardingGate({ serverId }: { serverId: string }) {
  const { data, blocked } = useServerOnboarding(serverId);
  const { fetchChannels } = useServer();
  const [manual, setManual] = useState<{ serverId: string; step: OnboardingFlowStep } | null>(null);

  // Let in (rules accepted elsewhere, or a moderator approved the
  // application): channels hidden while pending appear now.
  const lastBlocked = useRef<{ serverId: string; blocked: boolean } | null>(null);
  useEffect(() => {
    if (!data) return;
    const prev = lastBlocked.current;
    if (prev && prev.serverId === serverId && prev.blocked && !blocked) void fetchChannels(serverId);
    lastBlocked.current = { serverId, blocked };
  }, [data, blocked, serverId, fetchChannels]);

  const manualStep = manual && manual.serverId === serverId ? manual.step : null;
  // Latch an auto-open so the flow stays up while its own actions change the
  // state it was opened for (accepting the rules unblocks the member).
  const auto = manualStep ? null : shouldAutoOpen(serverId, data, blocked);
  if (auto) setManual({ serverId, step: auto });
  const step = manualStep ?? auto;
  const open = step !== null;
  const appState = applicationState(data, blocked);

  const close = () => {
    dismissedThisSession.add(serverId);
    if (data?.welcomeScreen || data?.onboarding) markWelcomeSeen(serverId);
    setManual(null);
  };

  return (
    <>
      {blocked && (
        <div
          role="status"
          className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center gap-3 text-sm text-[var(--text-primary)]"
        >
          {appState === "reviewing" ? (
            <Hourglass className="w-4 h-4 shrink-0 text-amber-500" aria-hidden />
          ) : appState === "rejected" ? (
            <CircleX className="w-4 h-4 shrink-0 text-red-500" aria-hidden />
          ) : (
            <ScrollText className="w-4 h-4 shrink-0 text-[var(--app-accent)]" aria-hidden />
          )}
          <span className="flex-1 min-w-0">
            {appState === "reviewing" ? (
              <T>Your application is being reviewed by the moderators.</T>
            ) : appState === "rejected" ? (
              <T>Your application was not approved.</T>
            ) : (
              <T>Accept the server rules to start talking.</T>
            )}
          </span>
          <button
            type="button"
            onClick={() => setManual({ serverId, step: appState === "none" ? "rules" : "status" })}
            className={
              appState === "none"
                ? "shrink-0 h-8 px-3 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
                : "shrink-0 h-8 px-3 rounded-md bg-[var(--app-surface-alt)] text-[var(--text-primary)] text-xs font-semibold hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
            }
          >
            {appState === "none" ? <T>Complete</T> : <T>View</T>}
          </button>
        </div>
      )}
      <MountWhenOpened open={open}>
        <ServerWelcomeModal
          key={`${serverId}:${step ?? "closed"}`}
          serverId={serverId}
          open={open}
          initialStep={step ?? undefined}
          onOpenChange={(next) => {
            if (!next) close();
          }}
        />
      </MountWhenOpened>
    </>
  );
}
