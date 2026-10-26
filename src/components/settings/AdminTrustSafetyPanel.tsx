"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { Fingerprint, Flag, Inbox, LayoutDashboard, Scale, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStaffAccess } from "@/hooks/useStaffAccess";
import { useJsonQuery } from "@/components/safety/useJsonQuery";
import { LoadingBlock } from "@/components/safety/admin/shared";
import { OverviewTab, type OverviewTarget, type TrustSafetyStats } from "@/components/safety/admin/OverviewTab";
import { IncidentsTab } from "@/components/safety/admin/IncidentsTab";
import { AppealsTab } from "@/components/safety/admin/AppealsTab";
import { AccountsTab } from "@/components/safety/admin/AccountsTab";
import { HashesTab } from "@/components/safety/admin/HashesTab";
import { UserSafetyProfile } from "@/components/safety/admin/UserSafetyProfile";

// Staff Trust & Safety (Settings → Admin → Trust & Safety, needs safety.review
// or reports.review): scanner incidents (PhotoDNA / scam hashes), reported
// messages, appeals, account actions (strikes, chat restrictions, suspension)
// and the scam image hash list. Staff with only reports.review see the
// Reports tab alone. Routes: src/lib/api/trustSafety.ts, ./messageReports.ts.

// The report queue and its review sheet load on first open of the tab.
const ReportsTab = dynamic(() => import("@/components/safety/admin/ReportsTab"));

type Tab = "overview" | OverviewTarget;

export default function AdminTrustSafetyPanel() {
  const gt = useGT();
  const access = useStaffAccess(true);
  const canSafety = access.can("safety.review");
  const canReports = access.can("reports.review");
  const [chosenTab, setTab] = useState<Tab>("overview");
  // Report reviewers without Trust & Safety only have the Reports tab.
  const tab: Tab = !canSafety ? "reports" : chosenTab === "reports" && !canReports ? "overview" : chosenTab;
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Bumped after any staff action so the lists and counters refetch.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const { data: overview } = useJsonQuery<{ stats: TrustSafetyStats }>(canSafety ? "/api/admin/trust-safety/overview" : null, version);
  const { data: reportStats } = useJsonQuery<{ stats: { openCases: number } }>(canReports ? "/api/admin/trust-safety/message-reports/stats" : null, version);
  const stats = overview?.stats ?? null;
  const openReports = reportStats?.stats.openCases;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Inbox; count?: number }> = [
    ...(canSafety ? [
      { id: "overview" as Tab, label: gt("Overview"), icon: LayoutDashboard },
      { id: "incidents" as Tab, label: gt("Incidents"), icon: Inbox, count: stats?.openIncidents },
    ] : []),
    ...(canReports ? [{ id: "reports" as Tab, label: gt("Reports"), icon: Flag, count: openReports }] : []),
    ...(canSafety ? [
      { id: "appeals" as Tab, label: gt("Appeals"), icon: Scale, count: stats?.openAppeals },
      { id: "accounts" as Tab, label: gt("Accounts"), icon: Users },
      { id: "hashes" as Tab, label: gt("Scam hashes"), icon: Fingerprint },
    ] : []),
  ];

  return (
    <div className="text-[var(--text-primary)]">
      <div className="mb-4">
        <h2 className="text-xl font-bold leading-tight text-[var(--text-primary)] max-md:hidden">
          {gt("Trust & Safety")}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {gt("Review blocked uploads and reported messages, decide appeals and act on accounts. Every action is written to the activity log.")}
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
        {!canSafety && !canReports && <LoadingBlock />}
        {canReports && tab === "reports" && (
          <ReportsTab onOpenUser={canSafety ? setProfileUserId : null} onChanged={bump} reloadKey={version} />
        )}
        {canSafety && tab === "overview" && <OverviewTab stats={stats} onNavigate={setTab} />}
        {canSafety && tab === "incidents" && <IncidentsTab onOpenUser={setProfileUserId} onChanged={bump} reloadKey={version} />}
        {canSafety && tab === "appeals" && <AppealsTab onOpenUser={setProfileUserId} onChanged={bump} reloadKey={version} />}
        {canSafety && tab === "accounts" && <AccountsTab onOpenUser={setProfileUserId} />}
        {canSafety && tab === "hashes" && <HashesTab onChanged={bump} reloadKey={version} />}
      </div>

      {canSafety && <UserSafetyProfile userId={profileUserId} onClose={() => setProfileUserId(null)} onChanged={bump} />}
    </div>
  );
}
