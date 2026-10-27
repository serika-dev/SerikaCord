"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { LogOut, PartyPopper } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/ui/Logo";
import { Loader } from "@/components/ui/Loader";
import { AccountStanding } from "./AccountStanding";

/**
 * Shown instead of the app when the signed-in account is suspended
 * (/api/users/@me answered 403 account_banned). Nothing else mounts: no
 * server list, sockets or polling. The user can read their standing, appeal,
 * or sign out.
 */
export default function SuspendedScreen() {
  const gt = useGT();
  const router = useRouter();
  const { logout, refresh } = useAuth();
  const [leaving, setLeaving] = useState(false);

  const handleLogout = async () => {
    setLeaving(true);
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  };

  return (
    <div className="h-dvh overflow-y-auto bg-[var(--bg-app)] text-[var(--text-primary)]">
      <header className="theme-solid sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-app)] pt-safe">
        <div className="mx-auto flex h-14 max-w-[760px] items-center justify-between gap-3 px-4">
          <Logo variant="full" size="sm" />
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={leaving}
            className="flex h-9 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            {leaving ? <Loader size={14} /> : <LogOut className="h-4 w-4" aria-hidden />}
            {gt("Log out")}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-4 pb-[calc(2rem+var(--safe-area-bottom))] pt-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{gt("Your account is suspended")}</h1>
        <p className="mb-6 mt-1 text-sm text-[var(--text-secondary)]">
          {gt("While your account is suspended you can't use SerikaCord. Here's what happened and how to appeal.")}
        </p>
        <AccountStanding
          banner={(standing) =>
            standing.banned ? null : (
              // An approved appeal (or staff) restored the account meanwhile.
              <div className="mb-5 flex flex-col gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 sm:flex-row sm:items-center">
                <PartyPopper className="h-6 w-6 shrink-0 text-emerald-500" aria-hidden />
                <p className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                  {gt("Your account has been restored. Welcome back!")}
                </p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="h-9 rounded-md bg-[var(--app-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
                >
                  {gt("Continue to SerikaCord")}
                </button>
              </div>
            )
          }
        />
      </main>
    </div>
  );
}
