"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { autoOnboardingStepNow, dismissOnboardingForSession, onboardingHref } from "./joinFlowPlan";

/**
 * Mounted once by the app shell for the open server (desktop and phone): sends
 * a member who still has join steps to do — a recent joiner who hasn't seen
 * the welcome screen / answered the questions, or someone Rules Screening
 * blocks — to the full-page join flow, once per session. Renders nothing.
 */
export function ServerOnboardingAutoRoute({ serverId }: { serverId: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { data } = useServerOnboarding(serverId);

  const base = `/channels/${serverId}`;
  const onServer = pathname === base || pathname.startsWith(`${base}/`);
  const onFlow = pathname.startsWith(`${base}/onboarding`);

  useEffect(() => {
    if (!data || !onServer || onFlow) return;
    const step = autoOnboardingStepNow(serverId, data);
    if (!step) return;
    dismissOnboardingForSession(serverId);
    router.push(onboardingHref(serverId, step));
  }, [data, onServer, onFlow, serverId, router]);

  return null;
}

export default ServerOnboardingAutoRoute;
