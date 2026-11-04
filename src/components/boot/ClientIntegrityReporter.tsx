"use client";

import { useEffect } from "react";
import { detectClientIntegrity } from "@/lib/clientIntegrity/detect";
import { parseSignals } from "@/lib/clientIntegrity/signals";

/** Script hosts the app itself loads from, matching script-src in next.config.ts (anything else was injected). */
const ALLOWED_SCRIPT_HOSTS = ["serika.chat", "canary.serika.chat", "cdn.serika.chat", "static.cloudflareinsights.com"];
const SESSION_KEY = "sc:ci";
/** Mods load late (after the first chunks): check after startup, then once more. */
const CHECK_DELAYS_MS = [15_000, 120_000];

/**
 * Reports signs of a client mod (src/lib/clientIntegrity) once per session and
 * whenever they change. Log only; renders nothing.
 */
export function ClientIntegrityReporter() {
  useEffect(() => {
    const timers = CHECK_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        const signals = parseSignals(
          detectClientIntegrity(window as unknown as Record<string, unknown>, { allowedScriptHosts: ALLOWED_SCRIPT_HOSTS }),
        );
        if (signals.length === 0) return;
        const key = signals.join(",");
        try {
          if (sessionStorage.getItem(SESSION_KEY) === key) return;
          sessionStorage.setItem(SESSION_KEY, key);
        } catch {
          /* storage unavailable: report anyway */
        }
        void fetch("/api/users/@me/client-integrity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signals }),
          keepalive: true,
        }).catch(() => {});
      }, delay),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return null;
}
