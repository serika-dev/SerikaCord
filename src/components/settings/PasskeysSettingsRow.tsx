"use client";

import { ExternalLink, KeyRound } from "lucide-react";
import { useGT } from "gt-next";
import { ACCOUNTS_SECURITY_URL } from "@/lib/accountsHandoff";
import { cn } from "@/lib/utils";

/**
 * Passkeys are registered and managed on Serika Accounts (passkey ceremonies
 * only run on the accounts origin); SerikaCord just links there.
 */
export function PasskeysSettingsRow({ className = "" }: { className?: string }) {
  const gt = useGT();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3.5 sm:flex-nowrap",
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-hover)]">
        <KeyRound className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Passkeys")}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
          {gt("Sign in with your fingerprint, face or security key. Add and manage passkeys in your Serika account.")}
        </p>
      </div>
      <a
        href={ACCOUNTS_SECURITY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] px-3 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_13%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] max-sm:w-full max-sm:justify-center"
      >
        {gt("Manage passkeys")}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
