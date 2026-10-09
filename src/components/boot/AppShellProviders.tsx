"use client";

import { useEffect, type ReactNode } from "react";
import { ServerProvider } from "@/contexts/ServerContext";
import { UnreadProvider } from "@/contexts/UnreadContext";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { NotificationHosts } from "@/components/notifications/NotificationHosts";

// Heavy dialogs are code-split so they don't slow the first paint, but the
// first click must not wait on a download: warm their chunks once the browser
// is idle after startup.
const IDLE_PREFETCH = [
  () => import("@/components/dialogs/UserSettingsDialog"),
  () => import("@/components/dialogs/ServerSettingsDialog"),
  () => import("@/components/user/FullProfileDialog"),
  () => import("@/components/dialogs/CreateServerDialog"),
  () => import("@/components/dialogs/InviteDialog"),
  () => import("@/components/dialogs/ChannelSettingsDialog"),
];

function usePrefetchDialogsWhenIdle() {
  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    let cancelled = false;
    let idleId: number | null = null;
    const run = (i: number) => {
      if (cancelled || i >= IDLE_PREFETCH.length) return;
      void IDLE_PREFETCH[i]().catch(() => {}).finally(() => schedule(i + 1));
    };
    const schedule = (i: number) => {
      if (cancelled) return;
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => run(i), { timeout: 5000 });
      else idleId = window.setTimeout(() => run(i), 300);
    };
    // Give startup data and hydration a head start.
    const startTimer = window.setTimeout(() => schedule(0), 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (idleId !== null) {
        if (w.cancelIdleCallback) w.cancelIdleCallback(idleId);
        else window.clearTimeout(idleId);
      }
    };
  }, []);
}

export default function AppShellProviders({ children }: { children: ReactNode }) {
  usePrefetchDialogsWhenIdle();
  return (
    <ServerProvider>
      <UnreadProvider>
        <ConfirmProvider>
          {children}
          <NotificationHosts />
        </ConfirmProvider>
      </UnreadProvider>
    </ServerProvider>
  );
}
