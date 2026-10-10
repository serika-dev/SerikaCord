"use client";

import dynamic from "next/dynamic";
import { useIsClient } from "@/hooks/useIsClient";
import { isDesktopShell } from "@/lib/desktop/bridge";

// Only the desktop app downloads the integration chunk.
const DesktopIntegration = dynamic(() => import("./DesktopIntegration"), { ssr: false });

/** Mounted once in the root layout; renders nothing in a browser. */
export function DesktopShell() {
  const isClient = useIsClient();
  if (!isClient || !isDesktopShell()) return null;
  return <DesktopIntegration />;
}
