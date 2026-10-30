"use client";

import { useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleTooltips } from "./TitleTooltips";

// Loaded only on app routes, so the landing and auth pages don't ship the
// server/chat state code.
const AppShellProviders = dynamic(() => import("./AppShellProviders"));

/**
 * Server + unread state for the app shell (/channels/* and /dm/*). Mounted
 * once above both layouts so switching between a DM and a server keeps it:
 * each layout used to mount its own copy, so every switch reconnected the
 * activity stream, refetched servers/DMs/mentions/read states and dropped
 * live unread counts.
 */
// Opening the app on a DM / group DM: start loading the encryption code at
// once (as the page hydrates), instead of when the conversation first needs it
// (after the shell and the page chunk have loaded): its cached messages are
// decrypted with it.
let e2eePreloaded = false;
function preloadE2eeFor(pathname: string) {
  if (e2eePreloaded || typeof window === "undefined" || !/^\/dm\//.test(pathname)) return;
  e2eePreloaded = true;
  void import("@/lib/e2ee/client/state").then((m) => m.loadE2eeSession()).catch(() => {});
}

export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const inApp = /^\/(channels|dm)(\/|$)/.test(pathname);
  useEffect(() => {
    preloadE2eeFor(pathname);
  }, [pathname]);
  // One tooltip delay group for every page (the first tooltip waits a beat,
  // neighbours then open instantly), plus the global native-`title` upgrade.
  return (
    <TooltipProvider>
      {inApp ? <AppShellProviders>{children}</AppShellProviders> : children}
      <TitleTooltips />
    </TooltipProvider>
  );
}
