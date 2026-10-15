"use client";

import { useId, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Ban, Gavel, MessageSquareOff, RotateCcw, ShieldCheck, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cdnImage, cn } from "@/lib/utils";
import { MAX_STRIKES, STRIKE_CATEGORIES, STRIKE_EXPIRY_DAYS } from "@/lib/safety/standing";
import { StandingDisplay } from "../AccountStanding";
import { sendJson, useJsonQuery } from "../useJsonQuery";
import { categoryLabel, formatDate, formatDateTime, plain, useClock, type StandingData, type StandingRestriction, type StandingStrike } from "../standingShared";
import {
  CopyButton,
  KindBadge,
  LoadingBlock,
  StatusPill,
  TestBadge,
  actionTakenLabel,
  cardClass,
  dangerBtn,
  inputClass,
  labelClass,
  primaryBtn,
  secondaryBtn,
  textareaClass,
  type Incident,
} from "./shared";

interface ProfileResponse {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    createdAt: string | null;
    isBanned: boolean;
    isStaff: boolean;
  };
  standing: StandingData;
  incidents: Incident[];
}

const EXPIRY_PRESETS = ["30", "90", String(STRIKE_EXPIRY_DAYS), "365", "0", "custom"] as const;
const RESTRICTION_PRESETS = [
  { hours: 1, key: "1h" },
  { hours: 24, key: "24h" },
  { hours: 24 * 7, key: "7d" },
] as const;

const smallBtn =
  "inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={cn(cardClass, "p-4")}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function IssueStrikeForm({ userId, standing, onDone }: { userId: string; standing: StandingData; onDone: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const ids = useId();
  const [category, setCategory] = useState<string>("other");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState<string>(String(STRIKE_EXPIRY_DAYS));
  const [customDays, setCustomDays] = useState("60");
  const [busy, setBusy] = useState(false);
  const nextCount = standing.activeStrikes + 1;
  const willSuspend = !standing.banned && nextCount >= MAX_STRIKES;
  const days = expiry === "custom" ? Math.round(Number(customDays)) : Number(expiry);
  const validDays = expiry === "0" || (Number.isFinite(days) && days >= 1 && days <= 3650);

  const submit = async () => {
    if (reason.trim().length < 3 || !validDays) return;
    if (willSuspend) {
      const ok = await confirm({
        title: gt("Issue strike and suspend?"),
        description: gt("This is strike {count} of {max}: the account will be suspended automatically.", { count: nextCount, max: MAX_STRIKES }),
        confirmLabel: gt("Issue strike"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await sendJson<{ activeStrikes: number; suspended: boolean }>(`/api/admin/trust-safety/users/${userId}/strikes`, {
        method: "POST",
        json: { category, reason: reason.trim(), expiresInDays: expiry === "0" ? 0 : days },
      });
      toast.success(
        result.suspended
          ? gt("Strike issued — the account reached {max} strikes and was suspended", { max: MAX_STRIKES })
          : gt("Strike issued ({count} of {max} active)", { count: result.activeStrikes, max: MAX_STRIKES })
      );
      setReason("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not issue the strike"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-cat`} className={labelClass}>{gt("Category")}</label>
          <select id={`${ids}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {STRIKE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c, gt)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-exp`} className={labelClass}>{gt("Expires after")}</label>
          <div className="flex gap-2">
            <select id={`${ids}-exp`} value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputClass}>
              {EXPIRY_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p === "0" ? gt("Never") : p === "custom" ? gt("Custom…") : gt("{days} days", { days: p })}
                </option>
              ))}
            </select>
            {expiry === "custom" && (
              <input
                type="number"
                min={1}
                max={3650}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                aria-label={gt("Days until the strike expires")}
                className={cn(inputClass, "w-24")}
              />
            )}
          </div>
        </div>
      </div>
      <div>
        <label htmlFor={`${ids}-reason`} className={labelClass}>{gt("Reason (shown to the user)")}</label>
        <textarea
          id={`${ids}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          rows={2}
          placeholder={gt("e.g. Sending phishing links in DMs")}
          className={textareaClass}
        />
      </div>
      {willSuspend && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500">
          {gt("This will be strike {count} of {max} and suspends the account.", { count: nextCount, max: MAX_STRIKES })}
        </p>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 3 || !validDays} className={primaryBtn}>
          {busy ? <Loader size={14} /> : <Gavel className="h-4 w-4" aria-hidden />}
          {gt("Issue strike")}
        </button>
      </div>
    </div>
  );
}

function RestrictForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const gt = useGT();
  const ids = useId();
  const [preset, setPreset] = useState<string>("24h");
  const [customHours, setCustomHours] = useState("48");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const hours = preset === "custom" ? Math.round(Number(customHours)) : RESTRICTION_PRESETS.find((p) => p.key === preset)?.hours ?? 24;
  const validHours = Number.isFinite(hours) && hours >= 1 && hours <= 24 * 90;
  const presetLabel = (key: string) => (key === "1h" ? gt("1 hour") : key === "24h" ? gt("24 hours") : key === "7d" ? gt("7 days") : gt("Custom"));

  const submit = async () => {
    if (reason.trim().length < 3 || !validHours) return;
    setBusy(true);
    try {
      await sendJson(`/api/admin/trust-safety/users/${userId}/restrictions`, { method: "POST", json: { hours, reason: reason.trim() } });
      toast.success(gt("Chat restriction added"));
      setReason("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not add the restriction"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass} id={`${ids}-dur`}>{gt("Duration")}</span>
        <div role="radiogroup" aria-labelledby={`${ids}-dur`} className="flex flex-wrap gap-2">
          {[...RESTRICTION_PRESETS.map((p) => p.key), "custom"].map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={preset === key}
              onClick={() => setPreset(key)}
              className={cn(
                "h-8 rounded-full border px-3 text-sm font-medium transition-colors",
                preset === key
                  ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10 text-[var(--text-primary)]"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              )}
            >
              {presetLabel(key)}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={24 * 90}
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                aria-label={gt("Hours")}
                className={cn(inputClass, "h-8 w-24")}
              />
              <span className="text-sm text-[var(--text-secondary)]">{gt("hours")}</span>
            </span>
          )}
        </div>
      </div>
      <div>
        <label htmlFor={`${ids}-reason`} className={labelClass}>{gt("Reason (shown to the user)")}</label>
        <textarea
          id={`${ids}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          rows={2}
          placeholder={gt("e.g. Spamming invites in public servers")}
          className={textareaClass}
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]">{gt("The user can't send messages, create threads or post attachments until it ends. Reactions still work.")}</p>
      <div className="flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 3 || !validHours} className={primaryBtn}>
          {busy ? <Loader size={14} /> : <MessageSquareOff className="h-4 w-4" aria-hidden />}
          {gt("Restrict chat")}
        </button>
      </div>
    </div>
  );
}

function SuspensionControls({ profile, onDone }: { profile: ProfileResponse; onDone: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const ids = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { user } = profile;
  const name = plain(user.displayName || user.username);

  const suspend = async () => {
    if (reason.trim().length < 3) return;
    const ok = await confirm({
      title: gt("Suspend {name}?", { name }),
      description: gt("They are signed out everywhere and can only see their Account Standing and appeal until restored."),
      confirmLabel: gt("Suspend account"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await sendJson(`/api/admin/trust-safety/users/${user.id}/suspend`, { method: "POST", json: { reason: reason.trim() } });
      toast.success(gt("Account suspended"));
      setReason("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not suspend the account"));
    } finally {
      setBusy(false);
    }
  };

  const unsuspend = async () => {
    const ok = await confirm({
      title: gt("Restore {name}?", { name }),
      description: gt("The account can sign in and use SerikaCord again. Its strikes stay on record; revoke them separately if needed."),
      confirmLabel: gt("Unsuspend"),
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await sendJson(`/api/admin/trust-safety/users/${user.id}/unsuspend`, { method: "POST" });
      toast.success(gt("Account restored"));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not restore the account"));
    } finally {
      setBusy(false);
    }
  };

  if (user.isBanned) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">{gt("This account is suspended.")}</p>
        <button type="button" onClick={() => void unsuspend()} disabled={busy} className={secondaryBtn}>
          {busy ? <Loader size={14} /> : <Undo2 className="h-4 w-4" aria-hidden />}
          {gt("Unsuspend")}
        </button>
      </div>
    );
  }
  if (user.isStaff) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <ShieldCheck className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />
        {gt("Staff accounts can't be suspended. Remove their staff roles first.")}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${ids}-reason`} className={labelClass}>{gt("Suspension reason (shown to the user)")}</label>
        <textarea
          id={`${ids}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          rows={2}
          className={textareaClass}
        />
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => void suspend()} disabled={busy || reason.trim().length < 3} className={dangerBtn}>
          {busy ? <Loader size={14} /> : <Ban className="h-4 w-4" aria-hidden />}
          {gt("Suspend account")}
        </button>
      </div>
    </div>
  );
}

function ProfileBody({ data, error, refresh }: { data: ProfileResponse | null; error: string | null; refresh: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const now = useClock();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!data) {
    if (error) return <p className="p-6 text-sm text-[var(--text-secondary)]">{error}</p>;
    return <LoadingBlock />;
  }

  const revoke = async (strike: StandingStrike) => {
    const ok = await confirm({
      title: gt("Remove this strike?"),
      description: gt("It stops counting toward the account's standing. The user isn't notified."),
      confirmLabel: gt("Remove strike"),
    });
    if (!ok) return;
    setBusyId(strike.id);
    try {
      await sendJson(`/api/admin/trust-safety/strikes/${strike.id}/revoke`, { method: "POST", json: { reason: "Removed by Trust & Safety" } });
      toast.success(gt("Strike removed"));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not remove the strike"));
    } finally {
      setBusyId(null);
    }
  };

  const lift = async (restriction: StandingRestriction) => {
    setBusyId(restriction.id);
    try {
      await sendJson(`/api/admin/trust-safety/restrictions/${restriction.id}/lift`, { method: "POST" });
      toast.success(gt("Restriction lifted"));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not lift the restriction"));
    } finally {
      setBusyId(null);
    }
  };

  const { user, standing, incidents } = data;
  const name = plain(user.displayName || user.username);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1 font-mono">
          {user.id}
          <CopyButton value={user.id} label={gt("Copy user ID")} />
        </span>
        {user.createdAt && <span>{gt("Joined {date}", { date: formatDate(user.createdAt) })}</span>}
        {user.isStaff && <span className="rounded-full bg-[var(--app-accent)]/10 px-2 py-0.5 font-semibold text-[var(--app-accent)]">{gt("Staff")}</span>}
      </div>

      <StandingDisplay
        user={{ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }}
        standing={standing}
        variant="staff"
        strikeActions={(s) =>
          s.active && !s.revoked ? (
            <button type="button" onClick={() => void revoke(s)} disabled={busyId === s.id} className={smallBtn}>
              {busyId === s.id ? <Loader size={12} /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              {gt("Remove")}
            </button>
          ) : null
        }
        restrictionActions={(r) =>
          r.active && new Date(r.until).getTime() > now ? (
            <button type="button" onClick={() => void lift(r)} disabled={busyId === r.id} className={smallBtn}>
              {busyId === r.id ? <Loader size={12} /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
              {gt("Lift")}
            </button>
          ) : null
        }
      />

      <Section title={gt("Issue a strike")} icon={<Gavel className="h-4 w-4 text-red-500" aria-hidden />}>
        <IssueStrikeForm userId={user.id} standing={standing} onDone={refresh} />
      </Section>

      <Section title={gt("Restrict chat")} icon={<MessageSquareOff className="h-4 w-4 text-amber-500" aria-hidden />}>
        <RestrictForm userId={user.id} onDone={refresh} />
      </Section>

      <Section title={user.isBanned ? gt("Suspension") : gt("Suspend account")} icon={<Ban className="h-4 w-4 text-red-500" aria-hidden />}>
        <SuspensionControls profile={data} onDone={refresh} />
      </Section>

      <Section title={gt("Incidents")} icon={<Gavel className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />}>
        {incidents.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">{gt("No scanner incidents for {name}.", { name })}</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <KindBadge kind={i.kind} />
                {i.isTest && <TestBadge />}
                <StatusPill status={i.status} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{plain(i.fileName) || gt("Unnamed file")}</span>
                <span className="w-full text-xs text-[var(--text-muted)] sm:w-auto">
                  {formatDateTime(i.createdAt)} · {actionTakenLabel(i.actionTaken, gt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Side sheet (full screen on phones) with one account's standing, incidents and staff actions. */
export function UserSafetyProfile({ userId, onClose, onChanged }: { userId: string | null; onClose: () => void; onChanged: () => void }) {
  const gt = useGT();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error } = useJsonQuery<ProfileResponse>(userId ? `/api/admin/trust-safety/users/${userId}` : null, reloadKey);
  // Never show the previous account's data while another one loads.
  const current = data && userId && data.user.id.toLowerCase() === userId.toLowerCase() ? data : null;
  const user = current?.user;
  const refresh = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };
  const name = user ? plain(user.displayName || user.username) : "";

  return (
    <Dialog open={!!userId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        mobile="none"
        showCloseButton={false}
        className="!fixed !top-0 !right-0 !bottom-0 !left-auto !h-dvh !w-full !max-w-[640px] !translate-x-0 !translate-y-0 !rounded-none !border-y-0 !border-r-0 !p-0 !gap-0 flex flex-col overflow-hidden bg-[var(--bg-app)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 pt-[calc(0.75rem+var(--safe-area-top))] sm:px-5">
          <Avatar className="h-10 w-10">
            <AvatarImage src={cdnImage(user?.avatar)} alt="" />
            <AvatarFallback className="bg-[var(--app-accent)] font-bold text-[var(--text-on-accent)]">{(name || "?").charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold text-[var(--text-primary)]">{name || gt("Account")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-[var(--text-muted)]">
              {user ? `@${plain(user.username)} · ${gt("Safety profile")}` : gt("Safety profile")}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={gt("Close")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--safe-area-bottom)]">
          {userId && <ProfileBody key={userId} data={current} error={current ? null : error} refresh={refresh} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

