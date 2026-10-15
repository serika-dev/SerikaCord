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
        "flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:flex-nowrap",
        className,
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-app)]">
        <KeyRound className="h-5 w-5 text-[var(--app-accent)]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Passkeys")}</p>
        <p className="text-xs text-[var(--text-secondary)]">
          {gt("Sign in with your fingerprint, face or security key. Add and manage passkeys in your Serika account.")}
        </p>
      </div>
      <a
        href={ACCOUNTS_SECURITY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] max-sm:w-full max-sm:justify-center"
      >
        {gt("Manage passkeys")}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
