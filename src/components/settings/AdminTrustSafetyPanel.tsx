"use client";

import { useCallback, useState } from "react";
import { useGT } from "gt-next";
import { Fingerprint, Gavel, Inbox, LayoutDashboard, Scale, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJsonQuery } from "@/components/safety/useJsonQuery";
import { OverviewTab, type OverviewTarget, type TrustSafetyStats } from "@/components/safety/admin/OverviewTab";
import { IncidentsTab } from "@/components/safety/admin/IncidentsTab";
import { AppealsTab } from "@/components/safety/admin/AppealsTab";
import { AccountsTab } from "@/components/safety/admin/AccountsTab";
import { HashesTab } from "@/components/safety/admin/HashesTab";
import { UserSafetyProfile } from "@/components/safety/admin/UserSafetyProfile";

// Staff Trust & Safety (Settings → Admin → Trust & Safety, needs safety.review):
// scanner incidents (PhotoDNA / scam hashes), appeals, account actions
// (strikes, chat restrictions, suspension) and the scam image hash list.
// Routes: src/lib/api/trustSafety.ts.

type Tab = "overview" | OverviewTarget;

export default function AdminTrustSafetyPanel() {
  const gt = useGT();
  const [tab, setTab] = useState<Tab>("overview");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Bumped after any staff action so the lists and counters refetch.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const { data: overview } = useJsonQuery<{ stats: TrustSafetyStats }>("/api/admin/trust-safety/overview", version);
  const stats = overview?.stats ?? null;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Inbox; count?: number }> = [
    { id: "overview", label: gt("Overview"), icon: LayoutDashboard },
    { id: "incidents", label: gt("Incidents"), icon: Inbox, count: stats?.openIncidents },
    { id: "appeals", label: gt("Appeals"), icon: Scale, count: stats?.openAppeals },
    { id: "accounts", label: gt("Accounts"), icon: Users },
    { id: "hashes", label: gt("Scam hashes"), icon: Fingerprint },
  ];

  return (
    <div className="text-[var(--text-primary)]">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--text-primary)]">
          <Gavel className="h-5 w-5 text-[var(--app-accent)]" aria-hidden />
          {gt("Trust & Safety")}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {gt("Review blocked uploads, decide appeals and act on accounts. Every action is written to the activity log.")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={gt("Trust & Safety sections")}
        className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-1 [scrollbar-width:none]"
      >
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
              tab === id
                ? "border-[var(--app-accent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {count ? (
              <span className="min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab stats={stats} onNavigate={setTab} />}
        {tab === "incidents" && <IncidentsTab onOpenUser={setProfileUserId} onChanged={bump} reloadKey={version} />}
        {tab === "appeals" && <AppealsTab onOpenUser={setProfileUserId} onChanged={bump} reloadKey={version} />}
        {tab === "accounts" && <AccountsTab onOpenUser={setProfileUserId} />}
        {tab === "hashes" && <HashesTab onChanged={bump} reloadKey={version} />}
      </div>

      <UserSafetyProfile userId={profileUserId} onClose={() => setProfileUserId(null)} onChanged={bump} />
    </div>
  );
}
