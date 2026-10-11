"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { T } from "gt-next";
import { ScrollText } from "lucide-react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useServerOnboarding, type ServerOnboarding } from "@/hooks/useServerOnboarding";

const ServerWelcomeModal = dynamic(() => import("./ServerWelcomeModal"), { ssr: false });

// Welcome screens auto-open once per server per device, and only for members
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

function shouldAutoOpen(serverId: string, data: ServerOnboarding | null, blocked: boolean): "welcome" | "rules" | null {
  if (!data || typeof window === "undefined" || dismissedThisSession.has(serverId)) return null;
  const joinedAt = data.member.joinedAt ? Date.parse(data.member.joinedAt) : NaN;
  const recent = Number.isFinite(joinedAt) && Date.now() - joinedAt < WELCOME_RECENT_MS;
  if (data.welcomeScreen && recent && !welcomeSeen(serverId)) return "welcome";
  if (blocked) return "rules";
  return null;
}

/**
 * Rendered above the channel composer: opens the server's Welcome Screen for
 * new members and, while Rules Screening blocks them, shows Discord's
 * "complete the steps" bar that reopens the rules.
 */
export function ServerOnboardingGate({ serverId }: { serverId: string }) {
  const { data, blocked } = useServerOnboarding(serverId);
  const [manual, setManual] = useState<{ serverId: string; step: "welcome" | "rules" } | null>(null);
  const [, setDismissTick] = useState(0);

  const auto = shouldAutoOpen(serverId, data, blocked);
  const manualStep = manual && manual.serverId === serverId ? manual.step : null;
  const step = manualStep ?? auto;
  const open = step !== null;

  const close = () => {
    dismissedThisSession.add(serverId);
    if (data?.welcomeScreen) markWelcomeSeen(serverId);
    setManual(null);
    setDismissTick((n) => n + 1);
  };

  return (
    <>
      {blocked && (
        <div
          role="status"
          className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center gap-3 text-sm text-[var(--text-primary)]"
        >
          <ScrollText className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />
          <span className="flex-1 min-w-0"><T>Accept the server rules to start talking.</T></span>
          <button
            type="button"
            onClick={() => setManual({ serverId, step: "rules" })}
            className="shrink-0 h-8 px-3 rounded-md bg-[var(--app-accent)] text-white text-xs font-semibold hover:opacity-90"
          >
            <T>Complete</T>
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
