"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { T } from "gt-next";
import { CircleX, Hourglass, ScrollText } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { applicationState, onboardingHref } from "./joinFlowPlan";

/**
 * Rendered above the channel composer: while Rules Screening blocks the
 * member, shows Discord's "complete the steps" bar — or where their
 * application stands when moderators review members — and opens the
 * full-page join flow (/channels/:serverId/onboarding) at the right step.
 * Sending new members there on their own is ServerOnboardingAutoRoute's job.
 */
export function ServerOnboardingGate({ serverId }: { serverId: string }) {
  const router = useRouter();
  const { data, blocked } = useServerOnboarding(serverId);
  const { fetchChannels } = useServer();

  // Let in (rules accepted elsewhere, or a moderator approved the
  // application): channels hidden while pending appear now.
  const lastBlocked = useRef<{ serverId: string; blocked: boolean } | null>(null);
  useEffect(() => {
    if (!data) return;
    const prev = lastBlocked.current;
    if (prev && prev.serverId === serverId && prev.blocked && !blocked) void fetchChannels(serverId);
    lastBlocked.current = { serverId, blocked };
  }, [data, blocked, serverId, fetchChannels]);

  if (!blocked) return null;
  const appState = applicationState(data, blocked);

  return (
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
        onClick={() => router.push(onboardingHref(serverId, appState === "none" ? "rules" : "status"))}
        className={
          appState === "none"
            ? "shrink-0 h-8 px-3 rounded-md bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
            : "shrink-0 h-8 px-3 rounded-md bg-[var(--app-surface-alt)] text-[var(--text-primary)] text-xs font-semibold hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
        }
      >
        {appState === "none" ? <T>Complete</T> : <T>View</T>}
      </button>
    </div>
  );
}
