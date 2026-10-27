"use client";

import { useCallback, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import {
  BadgeCheck, Bot, Check, ExternalLink, EyeOff, Hourglass, Library, Pencil, Search, ShieldCheck, ShieldOff, Sparkles, Star, StarOff, X,
} from "lucide-react";
import { useJsonQuery, sendJson } from "@/components/safety/useJsonQuery";
import { cardClass, CopyButton, dangerBtn, inputClass, primaryBtn, secondaryBtn, successBtn, textareaClass } from "@/components/safety/admin/shared";
import { SettingsStatCard } from "@/components/settings/blocks/SettingsStatCard";
import { SettingsStatusPill, type SettingsStatusTone } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSubTabs } from "@/components/settings/blocks/SettingsSubTabs";
import { Loader } from "@/components/ui/Loader";
import { AppIcon, formatCount } from "@/components/apps/AppDirectoryCard";
import {
  APP_CATEGORIES, appCategoryLabel, isDirectoryPageVisible, LISTING_LIMITS, staffAppChips, VERIFICATION_SERVER_THRESHOLD,
  type StaffAppChip,
} from "@/lib/appDirectory/listing";
import { cn } from "@/lib/utils";

// Staff "Apps & Bots" tools (Settings → Admin → Apps & Bots, needs apps.manage):
// verification queue, a search over every app with verify / revoke / official
// / feature / delist / listing fixes, and an overview. Routes:
// src/lib/api/appDirectory.ts (/api/admin/apps). Every action is written to
// the activity log.

interface StaffApp {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  categories: string[];
  tags: string[];
  botId: string | null;
  botUsername: string | null;
  botPublic: boolean;
  verified: boolean;
  official: boolean;
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
  official: number;
  listed: number;
  featured: number;
  delisted: number;
  publicBots: number;
  total: number;
}

type Tab = "overview" | "verification" | "apps";
type QueueStatus = "pending" | "approved" | "rejected";
type AppFilter = "all" | "listed" | "featured" | "delisted" | "verified" | "official" | "pending" | "private";

/** One confirmable staff action on an app (each needs a confirm step). */
type ActionKind =
  | "verify" | "approve" | "reject" | "revoke"
  | "official_on" | "official_off"
  | "feature" | "unfeature" | "delist" | "relist";

type Gt = ReturnType<typeof useGT>;

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
          {gt("Verify bots, mark official SerikaCord apps, review verification requests and moderate the App Directory (/bots). Every action is written to the activity log.")}
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
          { id: "apps", label: gt("All apps") },
        ]}
      />

      {tab === "overview" && <OverviewTab stats={stats} onOpen={setTab} />}
      {tab === "verification" && <VerificationTab version={version} onChanged={bump} />}
      {tab === "apps" && <AppsTab version={version} onChanged={bump} />}
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
        <SettingsStatCard icon={Sparkles} label={gt("Official apps")} value={stats.official} hint={gt("Made by SerikaCord")} />
        <SettingsStatCard icon={Library} label={gt("Listed in directory")} value={stats.listed} />
        <SettingsStatCard icon={Star} label={gt("Staff picks")} value={stats.featured} />
        <SettingsStatCard icon={EyeOff} label={gt("Delisted")} value={stats.delisted} valueTone={stats.delisted > 0 ? "danger" : "default"} />
        <SettingsStatCard icon={Bot} label={gt("Public bots")} value={stats.publicBots} hint={gt("{count} applications in total", { count: stats.total })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} onClick={() => onOpen("verification")}>{gt("Open verification queue")}</button>
        <button type="button" className={secondaryBtn} onClick={() => onOpen("apps")}>{gt("Find any app")}</button>
        <a href="/bots" target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
          {gt("Open /bots")}
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {gt("Developers can apply for verification once their bot is in {count} servers. Staff can also verify any app directly from All apps, whatever its server count, including private and unlisted apps.", { count: VERIFICATION_SERVER_THRESHOLD })}
      </p>
      <p className="text-xs text-[var(--text-muted)]">
        {gt("Verified apps get a check on their BOT tag and in the directory, and their owner gets the Verified Bot Developer badge. Official apps are made by SerikaCord: they show an Official badge and always count as verified.")}
      </p>
    </div>
  );
}

function chipLabel(chip: StaffAppChip, gt: Gt): { label: string; tone: SettingsStatusTone } {
  switch (chip) {
    case "official": return { label: gt("Official"), tone: "accent" };
    case "verified": return { label: gt("Verified"), tone: "success" };
    case "pending": return { label: gt("Pending review"), tone: "warning" };
    case "listed": return { label: gt("Listed"), tone: "info" };
    case "featured": return { label: gt("Staff pick"), tone: "info" };
    case "delisted": return { label: gt("Delisted"), tone: "danger" };
    case "private": return { label: gt("Private"), tone: "neutral" };
    case "no_bot":
    default: return { label: gt("No bot user"), tone: "warning" };
  }
}

function AppHeader({ app }: { app: StaffApp }) {
  const gt = useGT();
  const locale = useLocale();
  const owner = app.owner.displayName || app.owner.username || gt("Unknown user");
  const chips = staffAppChips(app);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <AppIcon icon={app.icon} name={app.name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold text-[var(--text-primary)]">{app.name}</span>
          {chips.map((chip) => {
            const c = chipLabel(chip, gt);
            return <SettingsStatusPill key={chip} tone={c.tone}>{c.label}</SettingsStatusPill>;
          })}
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {gt("by {owner}", { owner })}
          {app.owner.username && <> (@{app.owner.username})</>}
          {app.owner.isBanned && <> · <span className="text-red-500">{gt("Owner suspended")}</span></>}
          {app.botUsername && <> · {gt("Bot: @{username}", { username: app.botUsername })}</>}
          {" · "}
          {app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) })}
          {app.createdAt && <> · {gt("Created {date}", { date: new Date(app.createdAt).toLocaleDateString(locale) })}</>}
        </p>
        {app.shortDescription && <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{app.shortDescription}</p>}
        {(app.categories.length > 0 || app.tags.length > 0) && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {[...app.categories.map((c) => appCategoryLabel(c, gt)), ...app.tags.map((t) => `#${t}`)].join(" · ")}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-[var(--text-muted)]">
          <span className="truncate">{app.id}</span>
          <CopyButton value={app.id} label={gt("Copy app ID")} />
        </p>
      </div>
    </div>
  );
}

/** Copy for each action's confirm step. `reason`: whether a reason/note is asked for and if it is required. */
function actionCopy(kind: ActionKind, app: StaffApp, gt: Gt): {
  question: string; confirmLabel: string; tone: "danger" | "primary" | "success";
  reason: "required" | "optional" | "none"; reasonLabel?: string; placeholder?: string; note?: string; max: number;
} {
  const devSees = gt("The developer sees this in the developer portal.");
  const logged = gt("Saved in the activity log only.");
  switch (kind) {
    case "verify":
      return {
        question: gt("Verify {name}? Its bot gets the verified check right away, whatever its server count or listing.", { name: app.name }),
        confirmLabel: gt("Verify app"), tone: "success", reason: "optional",
        reasonLabel: gt("Note (optional)"), placeholder: gt("For example: verified by staff after review"), note: devSees, max: LISTING_LIMITS.verificationNote,
      };
    case "approve":
      return {
        question: gt("Approve the verification request for {name}?", { name: app.name }),
        confirmLabel: gt("Approve"), tone: "success", reason: "optional",
        reasonLabel: gt("Note (optional)"), placeholder: gt("For example: welcome aboard"), note: devSees, max: LISTING_LIMITS.verificationNote,
      };
    case "reject":
      return {
        question: gt("Reject the verification request for {name}?", { name: app.name }),
        confirmLabel: gt("Reject request"), tone: "danger", reason: "required",
        reasonLabel: gt("Why is this request rejected?"), placeholder: gt("For example: the bot doesn't respond to commands"), note: devSees, max: LISTING_LIMITS.verificationNote,
      };
    case "revoke":
      return {
        question: app.official
          ? gt("Revoke verification of {name}? It is official, so it keeps showing as verified until you remove the official flag.", { name: app.name })
          : gt("Revoke verification of {name}? The check disappears from its BOT tag and directory listing.", { name: app.name }),
        confirmLabel: gt("Revoke verification"), tone: "danger", reason: "required",
        reasonLabel: gt("Why is verification revoked?"), placeholder: gt("For example: the bot broke the developer terms"), note: devSees, max: LISTING_LIMITS.verificationNote,
      };
    case "official_on":
      return {
        question: gt("Mark {name} as an official app made by SerikaCord? It gets the Official badge everywhere and shows as verified.", { name: app.name }),
        confirmLabel: gt("Mark as official"), tone: "primary", reason: "optional",
        reasonLabel: gt("Reason (optional)"), placeholder: gt("For example: built by the SerikaCord team"), note: logged, max: LISTING_LIMITS.verificationNote,
      };
    case "official_off":
      return {
        question: gt("Remove the official flag from {name}?", { name: app.name }),
        confirmLabel: gt("Remove official"), tone: "danger", reason: "optional",
        reasonLabel: gt("Reason (optional)"), placeholder: gt("For example: handed over to a community developer"), note: logged, max: LISTING_LIMITS.verificationNote,
      };
    case "feature":
      return { question: gt("Add {name} to staff picks on /bots?", { name: app.name }), confirmLabel: gt("Feature"), tone: "primary", reason: "none", max: 0 };
    case "unfeature":
      return { question: gt("Remove {name} from staff picks?", { name: app.name }), confirmLabel: gt("Unfeature"), tone: "primary", reason: "none", max: 0 };
    case "delist":
      return {
        question: gt("Delist {name}? It disappears from /bots and App Discovery until it is relisted.", { name: app.name }),
        confirmLabel: gt("Delist app"), tone: "danger", reason: "required",
        reasonLabel: gt("Why is this app delisted?"), placeholder: gt("For example: misleading description"), note: devSees, max: LISTING_LIMITS.delistReason,
      };
    case "relist":
    default:
      return { question: gt("Relist {name} in the directory?", { name: app.name }), confirmLabel: gt("Relist"), tone: "success", reason: "none", max: 0 };
  }
}

function ConfirmAction({ kind, app, busy, onCancel, onConfirm }: {
  kind: ActionKind; app: StaffApp; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const gt = useGT();
  const copy = actionCopy(kind, app, gt);
  const [reason, setReason] = useState("");
  const missing = copy.reason === "required" && !reason.trim();
  const btn = copy.tone === "danger" ? dangerBtn : copy.tone === "success" ? successBtn : primaryBtn;
  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) onConfirm(reason.trim());
      }}
    >
      <p className="text-sm text-[var(--text-primary)]">{copy.question}</p>
      {copy.reason !== "none" && (
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {copy.reasonLabel}
          <textarea
            className={cn(textareaClass, "mt-1 normal-case tracking-normal")}
            rows={2}
            maxLength={copy.max}
            value={reason}
            required={copy.reason === "required"}
            placeholder={copy.placeholder}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </label>
      )}
      {copy.reason !== "none" && copy.note && <p className="text-xs text-[var(--text-muted)]">{copy.note}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || missing} className={btn} autoFocus={copy.reason === "none"}>
          {busy ? <Loader size={16} /> : copy.confirmLabel}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel} disabled={busy}>{gt("Cancel")}</button>
      </div>
    </form>
  );
}

/** Runs one staff action against the admin API and reports the result. */
function useAppActions(onChanged: () => void) {
  const gt = useGT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: ActionKind | "edit" } | null>(null);

  const run = async (app: StaffApp, kind: ActionKind, reason: string) => {
    const r = reason || undefined;
    let url: string;
    let json: Record<string, unknown>;
    switch (kind) {
      case "verify": case "approve": case "reject": case "revoke":
        url = `/api/admin/apps/${app.id}/verification`; json = { action: kind, reason: r }; break;
      case "official_on": case "official_off":
        url = `/api/admin/apps/${app.id}/official`; json = { official: kind === "official_on", reason: r }; break;
      case "feature": case "unfeature":
        url = `/api/admin/apps/${app.id}/directory`; json = { featured: kind === "feature" }; break;
      case "delist": case "relist":
      default:
        url = `/api/admin/apps/${app.id}/directory`; json = { delisted: kind === "delist", reason: r }; break;
    }
    setBusyId(app.id);
    try {
      await sendJson(url, { method: "POST", json });
      toast.success(actionDone(kind, app.name, gt));
      setPending(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, setBusyId, pending, setPending, run };
}

function actionDone(kind: ActionKind, name: string, gt: Gt): string {
  switch (kind) {
    case "verify": case "approve": return gt("{name} is now verified", { name });
    case "reject": return gt("Verification request rejected");
    case "revoke": return gt("Verification revoked");
    case "official_on": return gt("{name} is now an official app", { name });
    case "official_off": return gt("{name} is no longer official", { name });
    case "feature": return gt("Added to staff picks");
    case "unfeature": return gt("Removed from staff picks");
    case "delist": return gt("{name} was delisted", { name });
    case "relist":
    default: return gt("{name} was relisted", { name });
  }
}

function VerificationTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const gt = useGT();
  const locale = useLocale();
  const [status, setStatus] = useState<QueueStatus>("pending");
  const { data, loading, error } = useJsonQuery<{ apps: StaffApp[] }>(`/api/admin/apps/verification?status=${status}`, version);
  const { busyId, pending, setPending, run } = useAppActions(onChanged);

  const apps = data?.apps ?? [];
  return (
    <div className="space-y-4">
      <SettingsSubTabs<QueueStatus>
        variant="segmented"
        ariaLabel={gt("Verification status")}
        value={status}
        onChange={(s) => { setStatus(s); setPending(null); }}
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
            const open = pending?.id === app.id && pending.kind !== "edit" ? pending.kind : null;
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
                {open ? (
                  <ConfirmAction
                    key={open}
                    kind={open}
                    app={app}
                    busy={busyId === app.id}
                    onCancel={() => setPending(null)}
                    onConfirm={(reason) => void run(app, open, reason)}
                  />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(status === "pending" || status === "rejected") && !app.verified && (
                      <button type="button" className={successBtn} disabled={busyId === app.id} onClick={() => setPending({ id: app.id, kind: "approve" })}>
                        <Check className="h-4 w-4" aria-hidden />
                        {gt("Approve")}
                      </button>
                    )}
                    {status === "pending" && (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => setPending({ id: app.id, kind: "reject" })}>
                        <X className="h-4 w-4" aria-hidden />
                        {gt("Reject")}
                      </button>
                    )}
                    {app.verified && (
                      <button type="button" className={secondaryBtn} disabled={busyId === app.id} onClick={() => setPending({ id: app.id, kind: "revoke" })}>
                        <ShieldOff className="h-4 w-4" aria-hidden />
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
  if (!isDirectoryPageVisible(app)) return null;
  return (
    <a href={`/bots/${app.id}`} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
      {gt("View page")}
      <ExternalLink className="h-4 w-4" aria-hidden />
    </a>
  );
}

function AppsTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const gt = useGT();
  const [filter, setFilter] = useState<AppFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const url = `/api/admin/apps/directory?filter=${filter}&page=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  const { data, loading, error } = useJsonQuery<{ apps: StaffApp[]; total: number; page: number; limit: number }>(url, version);
  const { busyId, setBusyId, pending, setPending, run } = useAppActions(onChanged);

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
          setPending(null);
        }}
      >
        <input
          className={inputClass}
          value={searchInput}
          maxLength={100}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={gt("Search by app name, bot or owner username, app ID, bot ID, owner ID or client ID")}
          aria-label={gt("Search apps")}
        />
        <button type="submit" className={secondaryBtn}>
          <Search className="h-4 w-4" aria-hidden />
          <span className="max-sm:sr-only">{gt("Search")}</span>
        </button>
      </form>
      <SettingsSubTabs<AppFilter>
        variant="segmented"
        ariaLabel={gt("Filter apps")}
        value={filter}
        onChange={(f) => { setFilter(f); setPage(1); setPending(null); }}
        tabs={[
          { id: "all", label: gt("All") },
          { id: "official", label: gt("Official") },
          { id: "verified", label: gt("Verified") },
          { id: "pending", label: gt("Pending") },
          { id: "listed", label: gt("Listed") },
          { id: "featured", label: gt("Staff picks") },
          { id: "delisted", label: gt("Delisted") },
          { id: "private", label: gt("Private") },
        ]}
      />
      {data && (
        <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
          {data.total === 1 ? gt("1 app") : gt("{count} apps", { count: data.total })}
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader size={24} /></div>
      ) : apps.length === 0 ? (
        <SettingsEmptyState icon={Library} title={gt("No apps found")} />
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => {
            const busy = busyId === app.id;
            const open = pending?.id === app.id ? pending.kind : null;
            return (
              <li key={app.id} className={cn(cardClass, "p-4")}>
                <AppHeader app={app} />
                {app.directoryDelisted && app.directoryDelistedReason && (
                  <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    <span className="font-semibold">{gt("Delisted:")}</span> {app.directoryDelistedReason}
                  </p>
                )}
                {app.verificationNote && (
                  <p className="mt-2 rounded-md bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    <span className="font-semibold">{gt("Staff note:")}</span> {app.verificationNote}
                  </p>
                )}
                {open === "edit" ? (
                  <ListingEditor
                    app={app}
                    busy={busy}
                    onCancel={() => setPending(null)}
                    onSave={async (patch) => {
                      setBusyId(app.id);
                      try {
                        await sendJson(`/api/admin/apps/${app.id}/listing`, { method: "POST", json: patch });
                        toast.success(gt("Listing updated"));
                        setPending(null);
                        onChanged();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : gt("Action failed"));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  />
                ) : open ? (
                  <ConfirmAction
                    key={open}
                    kind={open}
                    app={app}
                    busy={busy}
                    onCancel={() => setPending(null)}
                    onConfirm={(reason) => void run(app, open, reason)}
                  />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {app.verified ? (
                      <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "revoke" })}>
                        <ShieldOff className="h-4 w-4" aria-hidden />
                        {gt("Revoke verification")}
                      </button>
                    ) : (
                      <button type="button" className={successBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "verify" })}>
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        {gt("Verify")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      aria-pressed={app.official}
                      onClick={() => setPending({ id: app.id, kind: app.official ? "official_off" : "official_on" })}
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                      {app.official ? gt("Remove official") : gt("Mark as official")}
                    </button>
                    {!app.directoryDelisted && (
                      app.directoryFeatured ? (
                        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "unfeature" })}>
                          <StarOff className="h-4 w-4" aria-hidden />
                          {gt("Unfeature")}
                        </button>
                      ) : (
                        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "feature" })}>
                          <Star className="h-4 w-4" aria-hidden />
                          {gt("Feature")}
                        </button>
                      )
                    )}
                    {app.directoryDelisted ? (
                      <button type="button" className={successBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "relist" })}>
                        {gt("Relist")}
                      </button>
                    ) : (
                      <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "delist" })}>
                        <EyeOff className="h-4 w-4" aria-hidden />
                        {gt("Delist")}
                      </button>
                    )}
                    <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setPending({ id: app.id, kind: "edit" })}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      {gt("Edit listing")}
                    </button>
                    <DirectoryLink app={app} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className={secondaryBtn} disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); setPending(null); }}>{gt("Previous")}</button>
          <span className="text-[var(--text-muted)]">{gt("Page {page} of {pages}", { page, pages })}</span>
          <button type="button" className={secondaryBtn} disabled={page >= pages} onClick={() => { setPage((p) => p + 1); setPending(null); }}>{gt("Next")}</button>
        </div>
      )}
    </div>
  );
}

/** Staff fix for a bad listing: short description, categories and tags (owner limits apply). */
function ListingEditor({ app, busy, onCancel, onSave }: {
  app: StaffApp; busy: boolean; onCancel: () => void;
  onSave: (patch: { shortDescription: string; categories: string[]; tags: string[]; reason?: string }) => void;
}) {
  const gt = useGT();
  const [description, setDescription] = useState(app.shortDescription);
  const [categories, setCategories] = useState<string[]>(app.categories);
  const [tags, setTags] = useState(app.tags.join(", "));
  const [reason, setReason] = useState("");
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const tooManyTags = tagList.length > LISTING_LIMITS.tags;
  const longTag = tagList.some((t) => t.length > LISTING_LIMITS.tagLength);

  const toggle = (c: string) => {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : prev.length >= LISTING_LIMITS.categories ? prev : [...prev, c]));
  };

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (tooManyTags || longTag) return;
        onSave({ shortDescription: description, categories, tags: tagList, reason: reason.trim() || undefined });
      }}
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {gt("Short description")}
        <textarea
          className={cn(textareaClass, "mt-1 normal-case tracking-normal")}
          rows={2}
          maxLength={LISTING_LIMITS.shortDescription}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
        />
        <span className="mt-0.5 block text-end font-normal normal-case tracking-normal">
          {gt("{count} of {max}", { count: description.length, max: LISTING_LIMITS.shortDescription })}
        </span>
      </label>
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {gt("Categories (up to {count})", { count: LISTING_LIMITS.categories })}
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {APP_CATEGORIES.map((c) => {
            const on = categories.includes(c);
            const disabled = !on && categories.length >= LISTING_LIMITS.categories;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(c)}
                className={cn(
                  "h-7 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-40",
                  on
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--text-on-accent)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]",
                )}
              >
                {appCategoryLabel(c, gt)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {gt("Tags, separated by commas (up to {count})", { count: LISTING_LIMITS.tags })}
        <input className={cn(inputClass, "mt-1 normal-case tracking-normal")} value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} />
      </label>
      {(tooManyTags || longTag) && (
        <p className="text-xs text-red-500">
          {tooManyTags
            ? gt("Add at most {count} tags", { count: LISTING_LIMITS.tags })
            : gt("Tags must be {count} characters or fewer", { count: LISTING_LIMITS.tagLength })}
        </p>
      )}
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {gt("Reason (optional)")}
        <input
          className={cn(inputClass, "mt-1 normal-case tracking-normal")}
          value={reason}
          maxLength={LISTING_LIMITS.delistReason}
          placeholder={gt("For example: fixed a misleading description")}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-xs text-[var(--text-muted)]">{gt("Changes show on /bots within a minute and are saved in the activity log.")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || tooManyTags || longTag} className={primaryBtn}>
          {busy ? <Loader size={16} /> : gt("Save listing")}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel} disabled={busy}>{gt("Cancel")}</button>
      </div>
    </form>
  );
}
