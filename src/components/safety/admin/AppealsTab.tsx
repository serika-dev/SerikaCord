"use client";

import { useId, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Ban, Check, Gavel, MessageSquareOff, Scale, X } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { MAX_STRIKES } from "@/lib/safety/standing";
import { sendJson, useJsonQuery } from "../useJsonQuery";
import { categoryLabel, formatDate, formatDateTime, plain } from "../standingShared";
import {
  EmptyState,
  LoadingBlock,
  StatusPill,
  UserChip,
  cardClass,
  dangerBtn,
  labelClass,
  successBtn,
  textareaClass,
  type OpenUser,
  type StaffAppeal,
} from "./shared";

type AppealFilter = "open" | "approved" | "denied";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One line on what is being appealed, from the target the API attaches. */
function AppealTarget({ appeal }: { appeal: StaffAppeal }) {
  const gt = useGT();
  const t = appeal.target ?? {};
  if (appeal.targetType === "ban") {
    return (
      <div className="flex items-start gap-2">
        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{gt("Account suspension")}</p>
          <p className="break-words text-sm text-[var(--text-secondary)]">{str(t.banReason) ? plain(str(t.banReason)) : gt("No reason recorded (the account may already be restored)")}</p>
        </div>
      </div>
    );
  }
  if (appeal.targetType === "restriction") {
    return (
      <div className="flex items-start gap-2">
        <MessageSquareOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {gt("Chat restriction")}
            {str(t.until) ? <span className="font-normal text-[var(--text-muted)]"> · {gt("until {date}", { date: formatDateTime(str(t.until)) })}</span> : null}
          </p>
          <p className="break-words text-sm text-[var(--text-secondary)]">{str(t.reason) ? plain(str(t.reason)) : gt("Restriction not found")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {gt("Strike")}
          {str(t.category) ? ` · ${categoryLabel(str(t.category), gt)}` : ""}
          {str(t.createdAt) ? <span className="font-normal text-[var(--text-muted)]"> · {formatDate(str(t.createdAt))}</span> : null}
          {t.revoked === true ? <span className="font-normal text-emerald-500"> · {gt("already removed")}</span> : null}
        </p>
        <p className="break-words text-sm text-[var(--text-secondary)]">{str(t.reason) ? plain(str(t.reason)) : gt("Strike not found")}</p>
      </div>
    </div>
  );
}

function AppealCard({ appeal, onOpenUser, onChanged }: { appeal: StaffAppeal; onOpenUser: OpenUser; onChanged: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const open = appeal.status === "open";

  const decide = async (approve: boolean) => {
    if (approve && appeal.targetType === "ban") {
      const ok = await confirm({
        title: gt("Restore this account?"),
        description: gt("Approving unsuspends the account and removes all of its active strikes."),
        confirmLabel: gt("Approve and restore"),
        destructive: false,
      });
      if (!ok) return;
    }
    setBusy(approve ? "approve" : "deny");
    try {
      await sendJson(`/api/admin/trust-safety/appeals/${appeal.id}/decision`, {
        method: "POST",
        json: { approve, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      toast.success(approve ? gt("Appeal approved") : gt("Appeal denied"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not record the decision"));
      setBusy(null);
    }
  };

  return (
    <li className={cn(cardClass, "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <UserChip user={appeal.user} userId={appeal.userId} onOpen={onOpenUser} />
        <div className="flex items-center gap-2">
          {appeal.activeStrikes != null && (
            <span className="rounded-full bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
              {gt("{count} of {max} active strikes", { count: appeal.activeStrikes, max: MAX_STRIKES })}
            </span>
          )}
          <StatusPill status={appeal.status} />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-[var(--bg-app)] p-3">
        <AppealTarget appeal={appeal} />
      </div>

      <div className="mt-3">
        <p className={labelClass}>{gt("User's appeal")} · <span className="normal-case tracking-normal">{formatDateTime(appeal.createdAt)}</span></p>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-[var(--app-accent)] pl-3 text-sm text-[var(--text-primary)]">
          {plain(appeal.message)}
        </blockquote>
      </div>

      {open ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={noteId} className={labelClass}>{gt("Note to the user (optional)")}</label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            rows={2}
            placeholder={gt("Sent with the decision and shown on their Account Standing")}
            className={textareaClass}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => void decide(false)} disabled={busy !== null} className={dangerBtn}>
              {busy === "deny" ? <Loader size={14} /> : <X className="h-4 w-4" aria-hidden />}
              {gt("Deny")}
            </button>
            <button type="button" onClick={() => void decide(true)} disabled={busy !== null} className={successBtn}>
              {busy === "approve" ? <Loader size={14} /> : <Check className="h-4 w-4" aria-hidden />}
              {gt("Approve")}
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {appeal.targetType === "strike"
              ? gt("Approving removes the strike.")
              : appeal.targetType === "restriction"
                ? gt("Approving lifts the restriction.")
                : gt("Approving restores the account and removes its active strikes.")}
          </p>
        </div>
      ) : (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-sm">
          <p className="text-xs text-[var(--text-muted)]">
            {appeal.reviewer
              ? gt("Decided by {name}", { name: plain(appeal.reviewer.displayName || appeal.reviewer.username) })
              : gt("Decided")}
            {appeal.reviewedAt ? ` · ${formatDateTime(appeal.reviewedAt)}` : ""}
          </p>
          {appeal.staffNote && <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{plain(appeal.staffNote)}</p>}
        </div>
      )}
    </li>
  );
}

export function AppealsTab({ onOpenUser, onChanged, reloadKey }: { onOpenUser: OpenUser; onChanged: () => void; reloadKey: number }) {
  const gt = useGT();
  const [filter, setFilter] = useState<AppealFilter>("open");
  const { data, error, loading } = useJsonQuery<{ appeals: StaffAppeal[] }>(`/api/admin/trust-safety/appeals?status=${filter}`, reloadKey);
  const appeals = data?.appeals ?? [];
  const filters: Array<{ id: AppealFilter; label: string }> = [
    { id: "open", label: gt("Open") },
    { id: "approved", label: gt("Approved") },
    { id: "denied", label: gt("Denied") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label={gt("Appeal status")} className="inline-flex rounded-lg bg-[var(--bg-app)] p-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                filter === f.id ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {loading && data && <Loader size={18} />}
      </div>

      {!data && loading ? (
        <LoadingBlock />
      ) : error && !data ? (
        <EmptyState icon={<Scale className="h-8 w-8" />} title={gt("Could not load appeals")}>{error}</EmptyState>
      ) : appeals.length === 0 ? (
        <EmptyState icon={<Scale className="h-8 w-8" />} title={filter === "open" ? gt("No appeals waiting") : gt("Nothing here yet")} />
      ) : (
        <ul className="space-y-3">
          {appeals.map((a) => (
            <AppealCard key={`${a.id}:${a.status}`} appeal={a} onOpenUser={onOpenUser} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}
