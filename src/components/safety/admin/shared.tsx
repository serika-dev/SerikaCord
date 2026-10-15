"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Check, Copy, ImageUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { cdnImage, cn } from "@/lib/utils";
import { plain, type GT, type SafetyUserCard } from "../standingShared";

// Building blocks for the staff Trust & Safety panel
// (src/components/settings/AdminTrustSafetyPanel.tsx).

export const inputClass =
  "w-full h-9 px-3 rounded-md bg-[var(--bg-input)] text-[var(--text-primary)] text-sm border border-[var(--border-subtle)] focus:border-[var(--app-accent)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60";
export const textareaClass =
  "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] text-[var(--text-primary)] text-sm border border-[var(--border-subtle)] focus:border-[var(--app-accent)] outline-none placeholder:text-[var(--text-muted)] resize-y disabled:opacity-60";
export const labelClass = "block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1";
export const cardClass = "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]";
export const primaryBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--app-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";
export const dangerBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
export const successBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface Incident {
  id: string;
  userId: string;
  kind: string;
  status: string;
  isTest: boolean;
  details: Record<string, unknown> | null;
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  sha256: string | null;
  uploadCategory: string | null;
  channelId: string | null;
  ip: string | null;
  hashId: string | null;
  actionTaken: string | null;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  ncmecReportedAt: string | null;
  ncmecReportId: string | null;
  createdAt: string;
  user?: SafetyUserCard | null;
  reviewer?: SafetyUserCard | null;
}

export interface StaffAppeal {
  id: string;
  userId: string;
  targetType: string;
  targetId: string | null;
  message: string;
  status: string;
  staffNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: SafetyUserCard | null;
  reviewer: SafetyUserCard | null;
  target: Record<string, unknown> | null;
  activeStrikes: number | null;
}

export interface ScamHash {
  id: string;
  hash: string;
  label: string;
  maxDistance: number;
  addedBy: string | null;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  addedByUser: SafetyUserCard | null;
}

export type OpenUser = (userId: string) => void;

export const INCIDENT_STATUSES = ["open", "actioned", "reviewed", "reported", "dismissed", "test"] as const;

export function incidentStatusLabel(status: string, gt: GT): string {
  switch (status) {
    case "open": return gt("Open");
    case "actioned": return gt("Actioned");
    case "reviewed": return gt("Reviewed");
    case "reported": return gt("Reported to NCMEC");
    case "dismissed": return gt("Dismissed");
    case "test": return gt("Test");
    case "all": return gt("All");
    default: return status;
  }
}

export function actionTakenLabel(action: string | null, gt: GT): string {
  switch (action) {
    case null:
    case "": return gt("None");
    case "blocked_upload_banned": return gt("Upload blocked, account suspended");
    case "blocked_upload_staff_test": return gt("Upload blocked (staff test, no penalty)");
    case "blocked_upload_restricted_strike": return gt("Upload blocked, 24h chat restriction and a strike");
    default: return action;
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Small components ────────────────────────────────────────────────────────

export function UserChip({ user, userId, onOpen, size = "md" }: { user: SafetyUserCard | null | undefined; userId: string; onOpen?: OpenUser; size?: "sm" | "md" }) {
  const gt = useGT();
  const name = plain(user?.displayName || user?.username || "") || gt("Unknown user");
  const body = (
    <>
      <Avatar className={size === "sm" ? "h-6 w-6" : "h-8 w-8"}>
        <AvatarImage src={cdnImage(user?.avatar)} alt="" />
        <AvatarFallback className="bg-[var(--app-accent)] text-xs font-bold text-[var(--text-on-accent)]">
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{name}</span>
        {user?.username && size === "md" && <span className="block truncate text-xs text-[var(--text-muted)]">@{plain(user.username)}</span>}
      </span>
      {user?.isBanned && (
        <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-500">{gt("Suspended")}</span>
      )}
    </>
  );
  if (!onOpen) return <span className="flex min-w-0 items-center gap-2">{body}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(userId)}
      title={gt("Open safety profile")}
      className="-mx-1 flex min-w-0 max-w-full items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
    >
      {body}
    </button>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error(gt("Could not copy"))
        );
      }}
      aria-label={label || gt("Copy")}
      title={label || gt("Copy")}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const gt = useGT();
  if (kind === "csam") {
    return <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{gt("CSAM")}</span>;
  }
  if (kind === "scam_image") {
    return <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">{gt("Scam")}</span>;
  }
  return <span className="rounded-md bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--text-secondary)]">{kind}</span>;
}

export function TestBadge() {
  const gt = useGT();
  return (
    <span className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-500">
      {gt("Test")}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const gt = useGT();
  const tone =
    status === "open"
      ? "bg-red-500/10 text-red-500"
      : status === "reported" || status === "actioned" || status === "approved"
        ? "bg-emerald-500/10 text-emerald-500"
        : status === "denied"
          ? "bg-[var(--bg-app)] text-[var(--text-secondary)]"
          : "bg-[var(--bg-app)] text-[var(--text-muted)]";
  const label =
    status === "approved" ? gt("Approved") : status === "denied" ? gt("Denied") : incidentStatusLabel(status, gt);
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{label}</span>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className={cn(cardClass, "flex flex-col items-center gap-2 px-6 py-10 text-center")}>
      <span className="text-[var(--text-muted)]">{icon}</span>
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      {children && <div className="max-w-md text-sm text-[var(--text-secondary)]">{children}</div>}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-10" aria-busy="true">
      <Loader size={28} />
    </div>
  );
}

/**
 * Drag-and-drop (or click / keyboard) image picker. Never previews the image:
 * staff may be testing material that must not be displayed.
 */
export function ImageDropZone({
  onFile,
  busy,
  title,
  hint,
  compact,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  const gt = useGT();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(gt("That isn't an image"));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error(gt("Images can be at most 20 MB"));
      return;
    }
    onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) take(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "px-4 py-4" : "px-4 py-8",
        dragging ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10" : "border-[var(--border-subtle)] bg-[var(--bg-app)]"
      )}
    >
      {busy ? <Loader size={24} /> : <ImageUp className="h-6 w-6 text-[var(--text-muted)]" aria-hidden />}
      <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        {title}{" "}
        <span className="text-[var(--app-accent)] underline-offset-2 hover:underline">{gt("or browse")}</span>
      </label>
      {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        disabled={busy}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
