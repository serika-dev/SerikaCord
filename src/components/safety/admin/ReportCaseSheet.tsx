"use client";

import { useId, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Gavel,
  History,
  Lock,
  MessageSquareOff,
  NotebookPen,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cdnImage, cn } from "@/lib/utils";
import { STRIKE_CATEGORIES } from "@/lib/safety/standing";
import { sendJson, useJsonQuery } from "../useJsonQuery";
import { LEVEL_STYLE, categoryLabel, levelLabel, plain } from "../standingShared";
import {
  LoadingBlock,
  UserChip,
  cardClass,
  dangerBtn,
  inputClass,
  labelClass,
  primaryBtn,
  secondaryBtn,
  successBtn,
  textareaClass,
  type OpenUser,
} from "./shared";
import {
  CategoryChip,
  EncryptedBadge,
  ReportStatusPill,
  reportActionLabel,
  reportReasonLabel,
  reportWhere,
  useReportDate,
  type ReportCaseDetail,
} from "./reportShared";

// Review sheet for one reported message (every report of it): the message as
// reported, who reported it and why, the author's standing, staff actions,
// internal note and the action history. Only the reported message is shown,
// never the rest of the conversation. API: src/lib/api/messageReports.ts.

const smallBtn =
  "inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";

function Section({ title, icon, children, aside }: { title: string; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={cn(cardClass, "p-4")}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function isImage(type: string, url: string): boolean {
  const t = type.toLowerCase();
  if (t.startsWith("image/")) return t !== "image/svg+xml";
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reported image; blurred until revealed when the report is about sexual or self-harm content. */
function ReportImage({ url, name, blur }: { url: string; name: string; blur: boolean }) {
  const gt = useGT();
  const [revealed, setRevealed] = useState(!blur);
  const href = safeHref(url);
  if (!href) return null;
  return (
    <figure className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN attachment, no next/image loader */}
      <img
        src={cdnImage(href, { still: !revealed })}
        alt={name}
        loading="lazy"
        className={cn("block max-h-72 w-full object-contain transition-[filter]", !revealed && "scale-105 blur-2xl")}
      />
      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-sm font-semibold text-white"
        >
          <Eye className="h-5 w-5" aria-hidden />
          {gt("Click to reveal")}
          <span className="text-xs font-normal">{gt("This report may contain sensitive media")}</span>
        </button>
      ) : blur ? (
        <button
          type="button"
          onClick={() => setRevealed(false)}
          aria-label={gt("Hide image")}
          title={gt("Hide image")}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white"
        >
          <EyeOff className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      <figcaption className="truncate px-2 py-1 text-xs text-[var(--text-muted)]">{name}</figcaption>
    </figure>
  );
}

function MessageSection({ detail }: { detail: ReportCaseDetail }) {
  const gt = useGT();
  const formatDate = useReportDate();
  const c = detail.case;
  const images = detail.message.attachments.filter((a) => isImage(a.type, a.url));
  const files = detail.message.attachments.filter((a) => !isImage(a.type, a.url));
  return (
    <Section
      title={gt("Reported message")}
      icon={<FileText className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}
      aside={
        c.messageDeleted === true ? (
          <span className="rounded-full bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{gt("Deleted")}</span>
        ) : c.messageDeleted === false ? (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-500">{gt("Still visible")}</span>
        ) : (
          <span className="rounded-full bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{gt("Not found")}</span>
        )
      }
    >
      <p className="mb-2 text-xs text-[var(--text-secondary)]">
        {reportWhere(c, gt)}
        {c.messageSentAt ? ` · ${gt("Sent {date}", { date: formatDate(c.messageSentAt) })}` : ""}
      </p>
      {c.encrypted && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-[var(--bg-app)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {c.frankingVerified
            ? gt("End-to-end encrypted. The reporter disclosed this message and its key; message franking verified it is exactly what the sender's device signed. Nothing else from this conversation is visible to staff.")
            : gt("End-to-end encrypted. This report could not be verified by message franking.")}
        </p>
      )}
      <div className="whitespace-pre-wrap break-words rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-sm text-[var(--text-primary)]">
        {detail.message.content || <span className="italic text-[var(--text-muted)]">{gt("(no text)")}</span>}
      </div>
      {images.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {images.map((a) => <ReportImage key={a.url} url={a.url} name={a.name} blur={c.blurMedia} />)}
        </div>
      )}
      {files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {files.map((a) => {
            const href = safeHref(a.url);
            return (
              <li key={a.url} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-[var(--app-accent)] hover:underline">{a.name}</a>
                ) : (
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{a.name}</span>
                )}
                <span className="shrink-0 text-xs text-[var(--text-muted)]">{a.type}</span>
              </li>
            );
          })}
        </ul>
      )}
      {detail.message.attachmentNotes.length > 0 && (
        <div className="mt-3">
          <p className={labelClass}>{gt("Encrypted attachments (scanned, not shown)")}</p>
          <ul className="space-y-1">
            {detail.message.attachmentNotes.map((n, i) => (
              <li key={i} className={cn("break-words text-xs", n.includes("MATCHED") ? "font-semibold text-red-500" : "text-[var(--text-secondary)]")}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function ReportsSection({ detail, onOpenUser }: { detail: ReportCaseDetail; onOpenUser: OpenUser | null }) {
  const gt = useGT();
  const formatDate = useReportDate();
  return (
    <Section title={gt("Reports ({count})", { count: detail.reports.length })} icon={<Flag className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}>
      <ul className="space-y-3">
        {detail.reports.map((r) => (
          <li key={r.id} className="space-y-1.5 border-b border-[var(--border-subtle)] pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <UserChip user={r.reporter} userId={r.reporterId} onOpen={onOpenUser ?? undefined} size="sm" />
              <CategoryChip reason={r.category} />
              <ReportStatusPill status={r.status} />
              <span className="ml-auto text-xs text-[var(--text-muted)]">{formatDate(r.createdAt)}</span>
            </div>
            {r.details ? (
              <p className="whitespace-pre-wrap break-words border-l-2 border-[var(--border-subtle)] pl-3 text-sm text-[var(--text-primary)]">{r.details}</p>
            ) : (
              <p className="text-xs italic text-[var(--text-muted)]">{gt("No details given")}</p>
            )}
            {r.otherVersion !== null && (
              <details className="text-xs text-[var(--text-secondary)]">
                <summary className="cursor-pointer">{gt("This reporter saw a different version of the message")}</summary>
                <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-[var(--bg-app)] px-2 py-1 text-sm text-[var(--text-primary)]">
                  {r.otherVersion || gt("(no text)")}
                </p>
              </details>
            )}
            {r.legacy && <p className="text-[11px] text-[var(--text-muted)]">{gt("Filed before the report queue existed")}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--text-muted)]">{gt("Reporters are never shown to the reported user.")}</p>
    </Section>
  );
}

function AccountSection({ detail, onOpenUser }: { detail: ReportCaseDetail; onOpenUser: OpenUser | null }) {
  const gt = useGT();
  const formatDate = useReportDate();
  const u = detail.reportedUser;
  const s = u.standing;
  return (
    <Section
      title={gt("Reported account")}
      icon={<UserRound className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}
      aside={onOpenUser ? (
        <button type="button" className={smallBtn} onClick={() => onOpenUser(u.id)}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {gt("Open safety profile")}
        </button>
      ) : null}
    >
      <div className="flex flex-wrap items-center gap-3">
        <UserChip user={u.card} userId={u.id} onOpen={onOpenUser ?? undefined} />
        {u.isStaff && <span className="rounded-full bg-[var(--app-accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">{gt("Staff")}</span>}
      </div>
      {s ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className={labelClass}>{gt("Standing")}</dt>
            <dd className={cn("flex items-center gap-1.5 font-medium", LEVEL_STYLE[s.level].text)}>
              <span className={cn("h-2 w-2 rounded-full", LEVEL_STYLE[s.level].dot)} aria-hidden />
              {levelLabel(s.level, gt)}
            </dd>
          </div>
          <div>
            <dt className={labelClass}>{gt("Active strikes")}</dt>
            <dd className="font-medium text-[var(--text-primary)]">{gt("{count} of {max}", { count: s.activeStrikes, max: s.maxStrikes })}</dd>
          </div>
          <div>
            <dt className={labelClass}>{gt("Chat restriction")}</dt>
            <dd className="text-[var(--text-primary)]">
              {s.activeRestriction ? gt("Until {date}", { date: formatDate(s.activeRestriction.until) }) : gt("None")}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-muted)]">{gt("Standing unavailable")}</p>
      )}
      {u.createdAt && <p className="mt-2 text-xs text-[var(--text-muted)]">{gt("Account created {date}", { date: formatDate(u.createdAt) })}</p>}
    </Section>
  );
}

type Enforcement = "strike" | "restrict" | "suspend";

const RESTRICTION_HOURS = [1, 24, 24 * 7] as const;
const EXPIRY_DAYS = ["30", "90", "180", "365", "0"] as const;

function ActionsSection({ detail, reportId, onDone }: { detail: ReportCaseDetail; reportId: string; onDone: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const ids = useId();
  const c = detail.case;
  const { canActOnAccount, ownMessage } = detail.permissions;
  const [busy, setBusy] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [kind, setKind] = useState<Enforcement>("strike");
  const [reason, setReason] = useState(c.suggested.reason);
  const [category, setCategory] = useState(c.suggested.strikeCategory);
  const [expiry, setExpiry] = useState(String(c.suggested.strikeExpiryDays));
  const [hours, setHours] = useState<number>(24);
  const [alsoDelete, setAlsoDelete] = useState(c.messageDeleted === false);
  const isOpen = c.openCount > 0;
  const accountName = plain(detail.reportedUser.card?.displayName || detail.reportedUser.card?.username || "") || gt("this account");

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const result = await sendJson<{ notified: number; suspended: boolean }>(`/api/admin/trust-safety/message-reports/${reportId}/actions`, {
        method: "POST",
        json: { action, ...extra },
      });
      if (action === "dismiss") toast.success(gt("Report dismissed"));
      else if (action === "resolve") toast.success(gt("Report resolved"));
      else if (action === "reopen") toast.success(gt("Report reopened"));
      else if (result.suspended) toast.success(gt("Action taken — the account is suspended"));
      else toast.success(gt("Action taken"));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not complete the action"));
    } finally {
      setBusy(null);
    }
  };

  const deleteMessage = async () => {
    const ok = await confirm({
      title: gt("Delete this message?"),
      description: gt("It disappears for everyone in the conversation right away. The report keeps its copy for review."),
      confirmLabel: gt("Delete message"),
    });
    if (ok) await run("delete_message", { notifyReporters: notify });
  };

  const enforce = async () => {
    if (reason.trim().length < 3) return;
    const days = Number(expiry);
    const title =
      kind === "strike" ? gt("Issue a strike to {name}?", { name: accountName })
        : kind === "restrict" ? gt("Restrict {name} from chatting?", { name: accountName })
          : gt("Suspend {name}?", { name: accountName });
    const ok = await confirm({
      title,
      description: gt("The reason is shown to the user in Account Standing. The reporters are never named."),
      confirmLabel: kind === "strike" ? gt("Issue strike") : kind === "restrict" ? gt("Restrict chat") : gt("Suspend account"),
    });
    if (!ok) return;
    await run(kind, {
      reason: reason.trim(),
      ...(kind === "strike" ? { category, expiresInDays: days } : {}),
      ...(kind === "restrict" ? { hours } : {}),
      deleteMessage: alsoDelete,
      notifyReporters: notify,
    });
  };

  if (ownMessage) {
    return (
      <Section title={gt("Actions")} icon={<Gavel className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}>
        <p className="text-sm text-[var(--text-secondary)]">{gt("This report is about your own message. Another staff member has to review it.")}</p>
      </Section>
    );
  }

  const hoursLabel = (h: number) => (h === 1 ? gt("1 hour") : h === 24 ? gt("24 hours") : gt("7 days"));

  return (
    <Section title={gt("Actions")} icon={<Gavel className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}>
      <div className="flex flex-wrap gap-2">
        {isOpen ? (
          <>
            <button type="button" className={secondaryBtn} disabled={!!busy} onClick={() => void run("dismiss")}>
              {busy === "dismiss" ? <Loader size={14} /> : <XCircle className="h-4 w-4" aria-hidden />}
              {gt("Dismiss")}
            </button>
            <button type="button" className={successBtn} disabled={!!busy} onClick={() => void run("resolve")}>
              {busy === "resolve" ? <Loader size={14} /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {gt("Resolve (no action)")}
            </button>
          </>
        ) : (
          <button type="button" className={secondaryBtn} disabled={!!busy} onClick={() => void run("reopen")}>
            {busy === "reopen" ? <Loader size={14} /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            {gt("Reopen")}
          </button>
        )}
        {c.messageDeleted === false && (
          <button type="button" className={dangerBtn} disabled={!!busy} onClick={() => void deleteMessage()}>
            {busy === "delete_message" ? <Loader size={14} /> : <Trash2 className="h-4 w-4" aria-hidden />}
            {gt("Delete message")}
          </button>
        )}
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-[var(--text-primary)]">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 accent-[var(--app-accent)]" />
        <span>
          {gt("Let the reporters know we took action")}
          <span className="block text-xs text-[var(--text-muted)]">{gt("Sent when you delete the message or act on the account. It never says what was done.")}</span>
        </span>
      </label>

      <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
        <p className={labelClass}>{gt("Act on the account")}</p>
        {!canActOnAccount ? (
          <p className="text-xs text-[var(--text-muted)]">{gt("Strikes, restrictions and suspensions need the Trust & Safety permission.")}</p>
        ) : !isOpen ? (
          <p className="text-xs text-[var(--text-muted)]">{gt("Reopen these reports to take an account action.")}</p>
        ) : (
          <div className="space-y-3">
            <div role="radiogroup" aria-label={gt("Account action")} className="flex flex-wrap gap-2">
              {(["strike", "restrict", "suspend"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                    kind === k
                      ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10 text-[var(--text-primary)]"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  )}
                >
                  {k === "strike" ? <Gavel className="h-3.5 w-3.5" aria-hidden /> : k === "restrict" ? <MessageSquareOff className="h-3.5 w-3.5" aria-hidden /> : <Ban className="h-3.5 w-3.5" aria-hidden />}
                  {k === "strike" ? gt("Strike") : k === "restrict" ? gt("Restrict chat") : gt("Suspend")}
                </button>
              ))}
            </div>
            {kind === "strike" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${ids}-cat`} className={labelClass}>{gt("Category")}</label>
                  <select id={`${ids}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                    {STRIKE_CATEGORIES.map((sc) => <option key={sc} value={sc}>{categoryLabel(sc, gt)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${ids}-exp`} className={labelClass}>{gt("Expires after")}</label>
                  <select id={`${ids}-exp`} value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputClass}>
                    {EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d === "0" ? gt("Never") : gt("{days} days", { days: d })}</option>)}
                  </select>
                </div>
              </div>
            )}
            {kind === "restrict" && (
              <div>
                <span className={labelClass} id={`${ids}-dur`}>{gt("Duration")}</span>
                <div role="radiogroup" aria-labelledby={`${ids}-dur`} className="flex flex-wrap gap-2">
                  {RESTRICTION_HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="radio"
                      aria-checked={hours === h}
                      onClick={() => setHours(h)}
                      className={cn(
                        "h-8 rounded-full border px-3 text-sm font-medium transition-colors",
                        hours === h
                          ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10 text-[var(--text-primary)]"
                          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      )}
                    >
                      {hoursLabel(h)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label htmlFor={`${ids}-reason`} className={labelClass}>{gt("Reason (shown to the user)")}</label>
              <textarea
                id={`${ids}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                rows={2}
                className={textareaClass}
              />
            </div>
            {c.messageDeleted === false && (
              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} className="accent-[var(--app-accent)]" />
                {gt("Also delete the message")}
              </label>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className={kind === "suspend" ? dangerBtn : primaryBtn}
                disabled={!!busy || reason.trim().length < 3}
                onClick={() => void enforce()}
              >
                {busy === kind ? <Loader size={14} /> : kind === "suspend" ? <Ban className="h-4 w-4" aria-hidden /> : <Gavel className="h-4 w-4" aria-hidden />}
                {kind === "strike" ? gt("Issue strike") : kind === "restrict" ? gt("Restrict chat") : gt("Suspend account")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function NoteSection({ initial, reportId, onDone }: { initial: string; reportId: string; onDone: () => void }) {
  const gt = useGT();
  const ids = useId();
  const [note, setNote] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await sendJson(`/api/admin/trust-safety/message-reports/${reportId}`, { method: "PATCH", json: { note: note.trim() || null } });
      toast.success(gt("Note saved"));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not save the note"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title={gt("Staff note")} icon={<NotebookPen className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}>
      <label htmlFor={`${ids}-note`} className="sr-only">{gt("Staff note")}</label>
      <textarea
        id={`${ids}-note`}
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 2000))}
        rows={3}
        placeholder={gt("Internal notes (staff only)")}
        className={textareaClass}
      />
      <div className="mt-2 flex justify-end">
        <button type="button" className={primaryBtn} disabled={saving || note.trim() === initial.trim()} onClick={() => void save()}>
          {saving && <Loader size={14} />}
          {gt("Save note")}
        </button>
      </div>
    </Section>
  );
}

function HistorySection({ detail }: { detail: ReportCaseDetail }) {
  const gt = useGT();
  const formatDate = useReportDate();
  const actions = [...detail.case.actions].reverse();
  return (
    <Section title={gt("History")} icon={<History className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />}>
      {actions.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{gt("No staff actions yet.")}</p>
      ) : (
        <ol className="space-y-1.5">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-[var(--text-primary)]">{reportActionLabel(a.type, gt)}</span>
              <span className="text-xs text-[var(--text-secondary)]">
                {plain(a.staff?.displayName || a.staff?.username || "") || gt("Unknown staff member")}
              </span>
              <span className="ml-auto text-xs text-[var(--text-muted)]">{formatDate(a.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export default function ReportCaseSheet({
  reportId,
  onClose,
  onChanged,
  onOpenUser,
}: {
  reportId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenUser: OpenUser | null;
}) {
  const gt = useGT();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error } = useJsonQuery<ReportCaseDetail>(reportId ? `/api/admin/trust-safety/message-reports/${reportId}` : null, reloadKey);
  // Never show another case's data while this one loads.
  const detail = data && reportId && data.reports.some((r) => r.id.toLowerCase() === reportId.toLowerCase()) ? data : null;
  const refresh = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };
  const openUser: OpenUser | null = onOpenUser
    ? (userId) => {
      onClose();
      onOpenUser(userId);
    }
    : null;
  // Remount the editable parts when the case changes underneath them.
  const caseKey = detail ? `${detail.case.messageId}:${detail.case.status}:${detail.case.actions.length}:${detail.case.messageDeleted}` : "";

  return (
    <Dialog open={!!reportId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        mobile="none"
        showCloseButton={false}
        className="!fixed !top-0 !right-0 !bottom-0 !left-auto !h-dvh !w-full !max-w-[680px] !translate-x-0 !translate-y-0 !rounded-none !border-y-0 !border-r-0 !p-0 !gap-0 flex flex-col overflow-hidden bg-[var(--bg-app)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 pt-[calc(0.75rem+var(--safe-area-top))] sm:px-5">
          <Flag className="h-5 w-5 shrink-0 text-[var(--app-accent)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold text-[var(--text-primary)]">{gt("Message report")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-[var(--text-muted)]">
              {detail ? reportWhere(detail.case, gt) : gt("Loading…")}
            </DialogDescription>
          </div>
          {detail && <ReportStatusPill status={detail.case.status} />}
          <button
            type="button"
            onClick={onClose}
            aria-label={gt("Close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:px-5">
          {!detail ? (
            error ? (
              <p className="flex items-center gap-2 text-sm text-red-500">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {error}
              </p>
            ) : (
              <LoadingBlock />
            )
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {detail.case.categories.map((cat) => <CategoryChip key={cat} reason={cat} />)}
                {detail.case.encrypted && <EncryptedBadge verified={detail.case.frankingVerified} />}
                {detail.case.count > 1 && (
                  <span className="rounded-full bg-[var(--app-accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">
                    {gt("{count} reports", { count: detail.case.count })}
                  </span>
                )}
              </div>
              {detail.case.urgent && detail.case.status === "open" && (
                <p className="flex items-start gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--text-primary)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                  {gt("Reported as {reason}. Review this report first.", {
                    reason: reportReasonLabel(detail.case.categories.find((cat) => cat === "self_harm" || cat === "illegal") ?? "other", gt),
                  })}
                </p>
              )}
              <MessageSection detail={detail} />
              <ReportsSection detail={detail} onOpenUser={openUser} />
              <AccountSection detail={detail} onOpenUser={openUser} />
              <ActionsSection key={`actions:${caseKey}`} detail={detail} reportId={detail.case.id} onDone={refresh} />
              <NoteSection key={`note:${detail.case.messageId}:${detail.case.staffNote ?? ""}`} initial={plain(detail.case.staffNote)} reportId={detail.case.id} onDone={refresh} />
              <HistorySection detail={detail} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
