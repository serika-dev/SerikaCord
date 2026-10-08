"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

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
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const inApp = /^\/(channels|dm)(\/|$)/.test(pathname);
  if (!inApp) return <>{children}</>;
  return <AppShellProviders>{children}</AppShellProviders>;
}
