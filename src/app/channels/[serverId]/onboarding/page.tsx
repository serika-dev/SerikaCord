"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useGT } from "gt-next";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { Loader } from "@/components/ui/Loader";
import { ServerJoinFlow } from "@/components/server/community/ServerJoinFlow";
import {
  autoOnboardingStepNow,
  dismissOnboardingForSession,
  hasJoinFlow,
  markWelcomeSeen,
  onboardingHref,
  parseFlowStep,
  parseQuestionParam,
  type OnboardingFlowStep,
} from "@/components/server/community/joinFlowPlan";

/**
 * /channels/:serverId/onboarding — the server's join flow as a full page
 * (welcome screen, onboarding questions, rules screening / application, the
 * outcome). `?step=` (and `?q=` for the questions) say where to open; the flow
 * keeps them current so Back and refresh behave like any page. Without a
 * step it opens wherever the member still has something to do, and goes on
 * to the server when there is nothing.
 */
export default function ServerOnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const gt = useGT();
  const serverId = params.serverId as string;
  const { servers, setCurrentServer, setCurrentChannel, isLoading, currentServer } = useServer();
  const { data } = useServerOnboarding(serverId);
  const [slow, setSlow] = useState(false);
  // Read once: afterwards the flow writes its own step into the URL.
  const [requested] = useState(() => ({
    step: parseFlowStep(searchParams.get("step")),
    question: parseQuestionParam(searchParams.get("q")),
  }));

  // Where the flow opens, decided once the data is in (latched, so the flow's
  // own actions — accepting the rules, saving answers — don't send us away).
  const [entry, setEntry] = useState<{ serverId: string; step: OnboardingFlowStep | null } | null>(null);
  const latched = entry && entry.serverId === serverId ? entry : null;
  if (!latched && data) {
    const step = hasJoinFlow(data) ? requested.step ?? autoOnboardingStepNow(serverId, data, { ignoreSession: true }) : null;
    setEntry({ serverId, step });
  }

  // Same as the server page: select the server once the list is loaded.
  useEffect(() => {
    if (isLoading || servers.length === 0) return;
    const server = servers.find((s) => s.id === serverId);
    if (server) setCurrentServer(server);
    else router.push("/channels/me");
  }, [serverId, servers, isLoading, setCurrentServer, router]);

  // No channel is open while the join flow is.
  useEffect(() => {
    if (currentServer?.id === serverId) setCurrentChannel(null);
  }, [currentServer?.id, serverId, setCurrentChannel]);

  // Handled for this session: moving around the server afterwards doesn't
  // send the member back here.
  useEffect(() => {
    dismissOnboardingForSession(serverId);
  }, [serverId]);

  // Nothing to do here (no onboarding configured, or all done): on to the server.
  const nothingToDo = Boolean(latched && latched.step === null);
  useEffect(() => {
    if (nothingToDo) router.replace(`/channels/${serverId}`);
  }, [nothingToDo, serverId, router]);

  // The onboarding store can't tell "loading" from "failed"; give up after a while.
  useEffect(() => {
    if (data) return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [data]);

  const exit = useCallback(
    (target?: string) => {
      if (data?.welcomeScreen || data?.onboarding) markWelcomeSeen(serverId);
      // Replace: Back from where they land shouldn't reopen the flow.
      router.replace(target ?? `/channels/${serverId}`);
    },
    [data?.welcomeScreen, data?.onboarding, serverId, router],
  );

  const syncUrl = useCallback(
    (step: OnboardingFlowStep, questionIndex: number) => {
      const href = onboardingHref(serverId, step, questionIndex);
      if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
    },
    [serverId],
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--bg-app)]">
      {data && latched?.step ? (
        <ServerJoinFlow
          key={serverId}
          serverId={serverId}
          data={data}
          initialStep={latched.step}
          initialQuestion={requested.question}
          onExit={exit}
          onStepChange={syncUrl}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 pt-safe text-center text-[var(--text-secondary)]">
          {slow && !data ? (
            <>
              <h1 className="text-base font-semibold text-[var(--text-primary)]">{gt("Couldn't load this server's welcome steps.")}</h1>
              <button
                type="button"
                onClick={() => router.replace(`/channels/${serverId}`)}
                className="h-11 px-5 rounded-xl bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
              >
                {gt("Back to the server")}
              </button>
            </>
          ) : (
            <>
              <Loader size={32} />
              <span className="sr-only" role="status">{gt("Loading the server's welcome steps.")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
