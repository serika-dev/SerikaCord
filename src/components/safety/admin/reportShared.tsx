"use client";

import { useGT, useLocale } from "gt-next";
import { AlertTriangle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { plain, type GT, type SafetyUserCard, type StandingLevel } from "../standingShared";

// Message report queue (Trust & Safety → Reports) shapes and small pieces.
// API: src/lib/api/messageReports.ts.

export interface ReportCaseSummary {
  id: string;
  messageId: string;
  channelId: string;
  serverId: string | null;
  serverName: string | null;
  channelType: string | null;
  channelName: string | null;
  status: string;
  count: number;
  openCount: number;
  reporterCount: number;
  categories: string[];
  urgent: boolean;
  latestAt: string;
  earliestAt: string;
  excerpt: string;
  attachmentCount: number;
  encrypted: boolean;
  frankingVerified: boolean;
  reportedUser: SafetyUserCard | null;
  reportedUserId: string;
  reporter: SafetyUserCard | null;
}

export interface ReportCaseList {
  cases: ReportCaseSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReportActionLogEntry {
  id: string;
  type: string;
  by: string;
  at: string;
  detail?: Record<string, string | number | boolean | null>;
  staff: SafetyUserCard | null;
}

export interface ReportCaseDetail {
  case: {
    id: string;
    messageId: string;
    channelId: string;
    serverId: string | null;
    serverName: string | null;
    channelType: string | null;
    channelName: string | null;
    messageSentAt: string | null;
    status: string;
    count: number;
    openCount: number;
    categories: string[];
    urgent: boolean;
    encrypted: boolean;
    frankingVerified: boolean;
    blurMedia: boolean;
    messageDeleted: boolean | null;
    staffNote: string | null;
    reviewer: SafetyUserCard | null;
    reviewedAt: string | null;
    actions: ReportActionLogEntry[];
    suggested: { strikeCategory: string; reason: string; strikeExpiryDays: number };
  };
  message: {
    content: string;
    attachments: { url: string; type: string; name: string }[];
    attachmentNotes: string[];
  };
  reports: {
    id: string;
    reporterId: string;
    reporter: SafetyUserCard | null;
    category: string;
    details: string | null;
    status: string;
    createdAt: string;
    encrypted: boolean;
    frankingVerified: boolean;
    legacy: boolean;
    otherVersion: string | null;
  }[];
  reportedUser: {
    id: string;
    card: SafetyUserCard | null;
    createdAt: string | null;
    isStaff: boolean;
    standing: {
      level: StandingLevel;
      banned: boolean;
      activeStrikes: number;
      maxStrikes: number;
      totalStrikes: number;
      activeRestriction: { until: string; reason: string } | null;
    } | null;
  };
  permissions: { canActOnAccount: boolean; ownMessage: boolean };
}

export const REPORT_CATEGORY_IDS = ["spam", "harassment", "hate", "nsfw", "self_harm", "illegal", "impersonation", "other"] as const;

/** Same wording as the reporter's "Report Message" dialog. */
export function reportReasonLabel(reason: string, gt: GT): string {
  switch (reason) {
    case "spam": return gt("Spam or scam");
    case "harassment": return gt("Harassment or bullying");
    case "hate": return gt("Hate speech");
    case "nsfw": return gt("Sexual or graphic content");
    case "self_harm": return gt("Self-harm or suicide");
    case "illegal": return gt("Illegal activity");
    case "impersonation": return gt("Impersonation");
    case "other": return gt("Something else");
    default: return reason;
  }
}

export function reportStatusLabel(status: string, gt: GT): string {
  switch (status) {
    case "open": return gt("Open");
    case "resolved": return gt("Resolved");
    case "dismissed": return gt("Dismissed");
    case "all": return gt("All");
    default: return status;
  }
}

export function reportActionLabel(type: string, gt: GT): string {
  switch (type) {
    case "dismiss": return gt("Dismissed");
    case "resolve": return gt("Resolved without action");
    case "reopen": return gt("Reopened");
    case "delete_message": return gt("Deleted the message");
    case "strike": return gt("Issued a strike");
    case "restrict": return gt("Restricted chat");
    case "suspend": return gt("Suspended the account");
    case "note": return gt("Updated the staff note");
    default: return type;
  }
}

/** "Server · #channel", "Direct message" or "Group DM". */
export function reportWhere(c: { serverName: string | null; serverId: string | null; channelType: string | null; channelName: string | null }, gt: GT): string {
  if (c.channelType === "dm") return gt("Direct message");
  const channel = plain(c.channelName);
  if (c.channelType === "group_dm") return channel ? gt("Group DM · {name}", { name: channel }) : gt("Group DM");
  const server = plain(c.serverName) || gt("Unknown server");
  return channel ? `${server} · #${channel}` : server;
}

export function useReportDate() {
  const locale = useLocale();
  return (value: string | null | undefined): string => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
}

export function ReportStatusPill({ status }: { status: string }) {
  const gt = useGT();
  const tone =
    status === "open"
      ? "bg-red-500/10 text-red-500"
      : status === "resolved"
        ? "bg-emerald-500/10 text-emerald-500"
        : "bg-[var(--bg-app)] text-[var(--text-muted)]";
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{reportStatusLabel(status, gt)}</span>;
}

export function CategoryChip({ reason }: { reason: string }) {
  const gt = useGT();
  const urgent = reason === "self_harm" || reason === "illegal";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
        urgent ? "bg-red-500/10 text-red-500" : "bg-[var(--bg-app)] text-[var(--text-secondary)]"
      )}
    >
      {urgent && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {reportReasonLabel(reason, gt)}
    </span>
  );
}

/** Encrypted message whose report carried a valid franking proof (or not). */
export function EncryptedBadge({ verified }: { verified: boolean }) {
  const gt = useGT();
  return (
    <span
      title={verified ? gt("The reporter's disclosure was verified by message franking: this is exactly what the sender sent.") : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
        verified ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
      )}
    >
      <Lock className="h-3 w-3" aria-hidden />
      {verified ? gt("Encrypted (verified)") : gt("Encrypted (unverified)")}
    </span>
  );
}
