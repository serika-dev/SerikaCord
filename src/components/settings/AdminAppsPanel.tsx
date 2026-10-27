"use client";

import { useCallback, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import {
  BadgeCheck, Bot, Check, ExternalLink, EyeOff, Hourglass, Library, Search, Star, StarOff, X,
} from "lucide-react";
import { useJsonQuery, sendJson } from "@/components/safety/useJsonQuery";
import { cardClass, dangerBtn, inputClass, primaryBtn, secondaryBtn, successBtn, textareaClass } from "@/components/safety/admin/shared";
import { SettingsStatCard } from "@/components/settings/blocks/SettingsStatCard";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSubTabs } from "@/components/settings/blocks/SettingsSubTabs";
import { Loader } from "@/components/ui/Loader";
import { AppIcon, formatCount } from "@/components/apps/AppDirectoryCard";
import { appCategoryLabel, LISTING_LIMITS, VERIFICATION_SERVER_THRESHOLD } from "@/lib/appDirectory/listing";
import { cn } from "@/lib/utils";

// Staff "Apps & Bots" tools (Settings → Admin → Apps & Bots, needs apps.manage):
// verification queue, App Directory moderation (feature / delist) and an
// overview. Routes: src/lib/api/appDirectory.ts (/api/admin/apps). Every
// action is written to the activity log.

interface StaffApp {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  categories: string[];
  botId: string | null;
  botPublic: boolean;
  verified: boolean;
  verificationStatus: string;
  verificationRequestedAt: string | null;
  verificationReviewedAt: string | null;
  verificationNote: string | null;
  directoryListed: boolean | null;
  directoryFeatured: boolean;
  directoryDelisted: boolean;
  directoryDelistedReason: string | null;
  serverCount: number;
  createdAt: string | null;
  owner: { id: string; username: string | null; displayName: string | null; avatar: string | null; isBanned: boolean };
}

interface Overview {
  pending: number;
  verified: number;
  listed: number;
  featured: number;
  delisted: number;
  publicBots: number;
  total: number;
}

type Tab = "overview" | "verification" | "directory";
type QueueStatus = "pending" | "approved" | "rejected";
type DirFilter = "listed" | "featured" | "delisted" | "verified" | "all";

export default function AdminAppsPanel() {
  const gt = useGT();
  const [tab, setTab] = useState<Tab>("overview");
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const { data: overview } = useJsonQuery<{ overview: Overview }>("/api/admin/apps/overview", version);
  const stats = overview?.overview ?? null;

  return (
    <div className="text-[var(--text-primary)]">
      <div className="mb-4">
        <h2 className="text-xl font-bold leading-tight text-[var(--text-primary)] max-md:hidden">{gt("Apps & Bots")}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {gt("Review bot verification requests and moderate the App Directory (/bots). Every action is written to the activity log.")}
        </p>
      </div>

      <SettingsSubTabs<Tab>
        className="mb-5"
        ariaLabel={gt("Apps & Bots sections")}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: gt("Overview") },
          { id: "verification", label: stats?.pending ? gt("Verification ({count})", { count: stats.pending }) : gt("Verification") },
          { id: "directory", label: gt("Directory") },
        ]}
      />

      {tab === "overview" && <OverviewTab stats={stats} onOpen={setTab} />}
      {tab === "verification" && <VerificationTab version={version} onChanged={bump} />}
      {tab === "directory" && <DirectoryTab version={version} onChanged={bump} />}
    </div>
  );
}

function OverviewTab({ stats, onOpen }: { stats: Overview | null; onOpen: (tab: Tab) => void }) {
  const gt = useGT();
  if (!stats) return <div className="flex justify-center py-10"><Loader size={24} /></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <SettingsStatCard icon={Hourglass} label={gt("Pending review")} value={stats.pending} valueTone={stats.pending > 0 ? "accent" : "default"} />
        <SettingsStatCard icon={BadgeCheck} label={gt("Verified apps")} value={stats.verified} />
        <SettingsStatCard icon={Library} label={gt("Listed in directory")} value={stats.listed} />
        <SettingsStatCard icon={Star} label={gt("Staff picks")} value={stats.featured} />
        <SettingsStatCard icon={EyeOff} label={gt("Delisted")} value={stats.delisted} valueTone={stats.delisted > 0 ? "danger" : "default"} />
        <SettingsStatCard icon={Bot} label={gt("Public bots")} value={stats.publicBots} hint={gt("{count} applications in total", { count: stats.total })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} onClick={() => onOpen("verification")}>{gt("Open verification queue")}</button>
        <button type="button" className={secondaryBtn} onClick={() => onOpen("directory")}>{gt("Moderate the directory")}</button>
        <a href="/bots" target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
          {gt("Open /bots")}
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {gt("Bots can apply for verification once they are in {count} servers. Approving sets the verified badge on the app and the Verified Bot Developer badge on its owner.", { count: VERIFICATION_SERVER_THRESHOLD })}
      </p>
    </div>
  );
}

function AppHeader({ app }: { app: StaffApp }) {
  const gt = useGT();
  const locale = useLocale();
  const owner = app.owner.displayName || app.owner.username || gt("Unknown user");
  return (
    <div className="flex min-w-0 items-start gap-3">
      <AppIcon icon={app.icon} name={app.name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold text-[var(--text-primary)]">{app.name}</span>
          {app.verified && <SettingsStatusPill tone="accent">{gt("Verified")}</SettingsStatusPill>}
          {app.directoryFeatured && <SettingsStatusPill tone="info">{gt("Staff pick")}</SettingsStatusPill>}
          {app.directoryDelisted && <SettingsStatusPill tone="danger">{gt("Delisted")}</SettingsStatusPill>}
          {!app.botPublic && <SettingsStatusPill tone="neutral">{gt("Private bot")}</SettingsStatusPill>}
          {!app.botId && <SettingsStatusPill tone="warning">{gt("No bot user")}</SettingsStatusPill>}
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {gt("by {owner}", { owner })}
          {app.owner.username && <> (@{app.owner.username})</>}
          {app.owner.isBanned && <> · <span className="text-red-500">{gt("Owner suspended")}</span></>}
          {" · "}
          {app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) })}
          {app.createdAt && <> · {gt("Created {date}", { date: new Date(app.createdAt).toLocaleDateString(locale) })}</>}
        </p>
        {app.shortDescription && <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{app.shortDescription}</p>}
        {app.categories.length > 0 && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">{app.categories.map((c) => appCategoryLabel(c, gt)).join(" · ")}</p>
        )}
        <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">{app.id}</p>
      </div>
    </div>
  );
}

function ReasonForm({ label, placeholder, confirmLabel, tone, busy, onCancel, onSubmit, max }: {
  label: string; placeholder: string; confirmLabel: string; tone: "danger" | "primary"; busy: boolean; max: number;
  onCancel: () => void; onSubmit: (reason: string) => void;
}) {
  const gt = useGT();
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
        <textarea
          className={cn(textareaClass, "mt-1 normal-case tracking-normal")}
          rows={2}
          maxLength={max}
          value={reason}
          placeholder={placeholder}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </label>
      <p className="text-xs text-[var(--text-muted)]">{gt("The developer sees this reason in the developer portal.")}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !reason.trim()} className={tone === "danger" ? dangerBtn : primaryBtn}>
          {busy ? <Loader size={16} /> : confirmLabel}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel} disabled={busy}>{gt("Cancel")}</button>
      </div>
    </form>
  );
}

function VerificationTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const gt = useGT();
  const locale = useLocale();
  const [status, setStatus] = useState<QueueStatus>("pending");
  const { data, loading, error } = useJsonQuery<{ apps: StaffApp[] }>(`/api/admin/apps/verification?status=${status}`, version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; action: "reject" | "revoke" } | null>(null);

  const act = async (app: StaffApp, action: "approve" | "reject" | "revoke", reason?: string) => {
    setBusyId(app.id);
    try {
      await sendJson(`/api/admin/apps/${app.id}/verification`, { method: "POST", json: { action, reason } });
      toast.success(action === "approve" ? gt("{name} is now verified", { name: app.name }) : action === "reject" ? gt("Verification request rejected") : gt("Verification revoked"));
      setReasonFor(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  const apps = data?.apps ?? [];
  return (
    <div className="space-y-4">
      <SettingsSubTabs<QueueStatus>
        variant="segmented"
        ariaLabel={gt("Verification status")}
        value={status}
        onChange={(s) => { setStatus(s); setReasonFor(null); }}
        tabs={[
          { id: "pending", label: gt("Pending") },
          { id: "approved", label: gt("Approved") },
          { id: "rejected", label: gt("Rejected") },
        ]}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader size={24} /></div>
      ) : apps.length === 0 ? (
        <SettingsEmptyState icon={BadgeCheck} title={status === "pending" ? gt("No verification requests waiting") : gt("Nothing here yet")} />
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => {
            const meetsThreshold = app.serverCount >= VERIFICATION_SERVER_THRESHOLD;
            return (
              <li key={app.id} className={cn(cardClass, "p-4")}>
                <AppHeader app={app} />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                  {app.verificationRequestedAt && <span>{gt("Requested {date}", { date: new Date(app.verificationRequestedAt).toLocaleString(locale) })}</span>}
                  {app.verificationReviewedAt && <span>{gt("Reviewed {date}", { date: new Date(app.verificationReviewedAt).toLocaleString(locale) })}</span>}
                  <span className={meetsThreshold ? "text-green-500" : "text-yellow-600 dark:text-yellow-400"}>
                    {meetsThreshold
                      ? gt("Meets the {count}-server requirement", { count: VERIFICATION_SERVER_THRESHOLD })
                      : gt("Below the {count}-server requirement", { count: VERIFICATION_SERVER_THRESHOLD })}
                  </span>
                </div>
                {app.verificationNote && (
                  <p className="mt-2 rounded-md bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    <span className="font-semibold">{gt("Staff note:")}</span> {app.verificationNote}
                  </p>
                )}
                {reasonFor?.id === app.id ? (
                  <ReasonForm
                    label={reasonFor.action === "reject" ? gt("Why is this request rejected?") : gt("Why is verification revoked?")}
                    placeholder={gt("For example: the bot doesn't respond to commands")}
                    confirmLabel={reasonFor.action === "reject" ? gt("Reject request") : gt("Revoke verification")}
                    tone="danger"
                    max={LISTING_LIMITS.verificationNote}
                    busy={busyId === app.id}
                    onCancel={() => setReasonFor(null)}
                    onSubmit={(reason) => void act(app, reasonFor.action, reason)}
                  />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(status === "pending" || status === "rejected") && (
                      <button type="button" className={successBtn} disabled={busyId === app.id} onClick={() => void act(app, "approve")}>
                        <Check className="h-4 w-4" aria-hidden />
                        {gt("Approve")}
                      </button>
                    )}
                    {status === "pending" && (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => setReasonFor({ id: app.id, action: "reject" })}>
                        <X className="h-4 w-4" aria-hidden />
                        {gt("Reject")}
                      </button>
                    )}
                    {status === "approved" && app.verified && (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => setReasonFor({ id: app.id, action: "revoke" })}>
                        {gt("Revoke verification")}
                      </button>
                    )}
                    <DirectoryLink app={app} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DirectoryLink({ app }: { app: StaffApp }) {
  const gt = useGT();
  // Mirrors isDirectoryPageVisible (src/lib/appDirectory/listing.ts).
  const listed = (app.directoryListed ?? (app.verified && app.botPublic)) && !app.directoryDelisted && !!app.botId;
  if (!listed) return null;
  return (
    <a href={`/bots/${app.id}`} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
      {gt("View page")}
      <ExternalLink className="h-4 w-4" aria-hidden />
    </a>
  );
}

function DirectoryTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const gt = useGT();
  const [filter, setFilter] = useState<DirFilter>("listed");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const url = `/api/admin/apps/directory?filter=${filter}&page=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  const { data, loading, error } = useJsonQuery<{ apps: StaffApp[]; total: number; page: number; limit: number }>(url, version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [delistFor, setDelistFor] = useState<string | null>(null);

  const update = async (app: StaffApp, body: { featured?: boolean; delisted?: boolean; reason?: string }, done: string) => {
    setBusyId(app.id);
    try {
      await sendJson(`/api/admin/apps/${app.id}/directory`, { method: "POST", json: body });
      toast.success(done);
      setDelistFor(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  const apps = data?.apps ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setPage(1);
        }}
      >
        <input
          className={inputClass}
          value={searchInput}
          maxLength={100}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={gt("Search by name, app ID, bot ID, owner ID or client ID")}
          aria-label={gt("Search apps")}
        />
        <button type="submit" className={secondaryBtn}>
          <Search className="h-4 w-4" aria-hidden />
          <span className="max-sm:sr-only">{gt("Search")}</span>
        </button>
      </form>
      <SettingsSubTabs<DirFilter>
        variant="segmented"
        ariaLabel={gt("Filter apps")}
        value={filter}
        onChange={(f) => { setFilter(f); setPage(1); setDelistFor(null); }}
        tabs={[
          { id: "listed", label: gt("Listed") },
          { id: "featured", label: gt("Staff picks") },
          { id: "delisted", label: gt("Delisted") },
          { id: "verified", label: gt("Verified") },
          { id: "all", label: gt("All apps") },
        ]}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader size={24} /></div>
      ) : apps.length === 0 ? (
        <SettingsEmptyState icon={Library} title={gt("No apps found")} />
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <li key={app.id} className={cn(cardClass, "p-4")}>
              <AppHeader app={app} />
              {app.directoryDelisted && app.directoryDelistedReason && (
                <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  <span className="font-semibold">{gt("Delisted:")}</span> {app.directoryDelistedReason}
                </p>
              )}
              {delistFor === app.id ? (
                <ReasonForm
                  label={gt("Why is this app delisted?")}
                  placeholder={gt("For example: misleading description")}
                  confirmLabel={gt("Delist app")}
                  tone="danger"
                  max={LISTING_LIMITS.delistReason}
                  busy={busyId === app.id}
                  onCancel={() => setDelistFor(null)}
                  onSubmit={(reason) => void update(app, { delisted: true, reason }, gt("{name} was delisted", { name: app.name }))}
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!app.directoryDelisted && (
                    app.directoryFeatured ? (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => void update(app, { featured: false }, gt("Removed from staff picks"))}>
                        <StarOff className="h-4 w-4" aria-hidden />
                        {gt("Unfeature")}
                      </button>
                    ) : (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => void update(app, { featured: true }, gt("Added to staff picks"))}>
                        <Star className="h-4 w-4" aria-hidden />
                        {gt("Feature")}
                      </button>
                    )
                  )}
                  {app.directoryDelisted ? (
                    <button type="button" className={successBtn} disabled={busyId === app.id} onClick={() => void update(app, { delisted: false }, gt("{name} was relisted", { name: app.name }))}>
                      {gt("Relist")}
                    </button>
                  ) : (
                    <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => setDelistFor(app.id)}>
                      <EyeOff className="h-4 w-4" aria-hidden />
                      {gt("Delist")}
                    </button>
                  )}
                  <DirectoryLink app={app} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className={secondaryBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{gt("Previous")}</button>
          <span className="text-[var(--text-muted)]">{gt("Page {page} of {pages}", { page, pages })}</span>
          <button type="button" className={secondaryBtn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{gt("Next")}</button>
        </div>
      )}
    </div>
  );
}

