"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { ChevronLeft, ChevronRight, Flag, Paperclip, Search, Users } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { cn } from "@/lib/utils";
import { useJsonQuery } from "../useJsonQuery";
import { plain } from "../standingShared";
import { EmptyState, LoadingBlock, cardClass, inputClass, labelClass, secondaryBtn, type OpenUser } from "./shared";
import {
  CategoryChip,
  EncryptedBadge,
  REPORT_CATEGORY_IDS,
  ReportStatusPill,
  reportReasonLabel,
  reportStatusLabel,
  reportWhere,
  useReportDate,
  type ReportCaseList,
  type ReportCaseSummary,
} from "./reportShared";

// Trust & Safety → Reports: reported messages, one entry per message
// (duplicate reports grouped). Opens ReportCaseSheet for review and actions.

const ReportCaseSheet = dynamic(() => import("./ReportCaseSheet"));

const STATUS_FILTERS = ["open", "resolved", "dismissed", "all"] as const;

function CaseRow({ item, onOpen }: { item: ReportCaseSummary; onOpen: () => void }) {
  const gt = useGT();
  const formatDate = useReportDate();
  const reportedName = plain(item.reportedUser?.displayName || item.reportedUser?.username || "") || gt("Unknown user");
  const reporterName = plain(item.reporter?.displayName || item.reporter?.username || "") || gt("Unknown user");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          cardClass,
          "block w-full px-4 py-3 text-left transition-colors hover:border-[var(--app-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]",
          item.urgent && item.status === "open" && "border-red-500/50"
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {item.categories.slice(0, 3).map((c) => <CategoryChip key={c} reason={c} />)}
          {item.encrypted && <EncryptedBadge verified={item.frankingVerified} />}
          <ReportStatusPill status={item.status} />
          {item.count > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">
              <Users className="h-3 w-3" aria-hidden />
              {gt("{count} reports", { count: item.count })}
            </span>
          )}
          <span className="ml-auto text-xs text-[var(--text-muted)]">{formatDate(item.latestAt)}</span>
        </span>
        <span className="mt-2 block truncate text-sm text-[var(--text-primary)]">
          {item.excerpt || <span className="italic text-[var(--text-muted)]">{gt("(no text)")}</span>}
          {item.attachmentCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-[var(--text-muted)]">
              <Paperclip className="h-3 w-3" aria-hidden />
              {item.attachmentCount}
            </span>
          )}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
          <span className="min-w-0 truncate">{gt("Reported user: {name}", { name: reportedName })}</span>
          <span className="min-w-0 truncate">
            {item.reporterCount > 1
              ? gt("Reported by {name} and {count} more", { name: reporterName, count: item.reporterCount - 1 })
              : gt("Reported by {name}", { name: reporterName })}
          </span>
          <span className="min-w-0 truncate text-[var(--text-muted)]">{reportWhere(item, gt)}</span>
        </span>
      </button>
    </li>
  );
}

export default function ReportsTab({
  onOpenUser,
  onChanged,
  reloadKey,
}: {
  /** Opens the staff safety profile; null when the viewer lacks Trust & Safety. */
  onOpenUser: OpenUser | null;
  onChanged: () => void;
  reloadKey: number;
}) {
  const gt = useGT();
  const ids = useId();
  const [status, setStatus] = useState<string>("open");
  const [category, setCategory] = useState<string>("all");
  const [scope, setScope] = useState<string>("all");
  const [encrypted, setEncrypted] = useState<string>("any");
  const [sort, setSort] = useState<string>("newest");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const params = new URLSearchParams({ status, category, scope, encrypted, sort, page: String(page) });
  if (q) params.set("q", q);
  const { data, error, loading } = useJsonQuery<ReportCaseList>(`/api/admin/trust-safety/message-reports?${params}`, reloadKey);
  const cases = data?.cases ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Any filter change starts again at page 1.
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const selectClass = cn(inputClass, "pr-8");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label htmlFor={`${ids}-status`} className={labelClass}>{gt("Status")}</label>
          <select id={`${ids}-status`} value={status} onChange={(e) => filter(setStatus)(e.target.value)} className={selectClass}>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{reportStatusLabel(s, gt)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-category`} className={labelClass}>{gt("Category")}</label>
          <select id={`${ids}-category`} value={category} onChange={(e) => filter(setCategory)(e.target.value)} className={selectClass}>
            <option value="all">{gt("All categories")}</option>
            {REPORT_CATEGORY_IDS.map((c) => <option key={c} value={c}>{reportReasonLabel(c, gt)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-scope`} className={labelClass}>{gt("Where")}</label>
          <select id={`${ids}-scope`} value={scope} onChange={(e) => filter(setScope)(e.target.value)} className={selectClass}>
            <option value="all">{gt("Servers and DMs")}</option>
            <option value="server">{gt("Servers")}</option>
            <option value="dm">{gt("DMs")}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-encrypted`} className={labelClass}>{gt("Encryption")}</label>
          <select id={`${ids}-encrypted`} value={encrypted} onChange={(e) => filter(setEncrypted)(e.target.value)} className={selectClass}>
            <option value="any">{gt("Any")}</option>
            <option value="yes">{gt("End-to-end encrypted")}</option>
            <option value="no">{gt("Not encrypted")}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-sort`} className={labelClass}>{gt("Sort")}</label>
          <select id={`${ids}-sort`} value={sort} onChange={(e) => filter(setSort)(e.target.value)} className={selectClass}>
            <option value="newest">{gt("Newest first")}</option>
            <option value="oldest">{gt("Oldest first")}</option>
          </select>
        </div>
      </div>

      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
          setPage(1);
        }}
      >
        <label htmlFor={`${ids}-q`} className="sr-only">{gt("Search by reporter or reported user")}</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            id={`${ids}-q`}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 100))}
            placeholder={gt("Username or user ID (reporter or reported user)")}
            autoComplete="off"
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <button type="submit" className={secondaryBtn}>{gt("Search")}</button>
        {q && (
          <button type="button" className={secondaryBtn} onClick={() => { setDraft(""); setQ(""); setPage(1); }}>
            {gt("Clear")}
          </button>
        )}
      </form>

      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        {data && <span>{gt("{count} reported messages", { count: data.total })}</span>}
        {loading && data && <Loader size={14} />}
      </div>

      {!data && loading ? (
        <LoadingBlock />
      ) : error && !data ? (
        <EmptyState icon={<Flag className="h-8 w-8" />} title={gt("Could not load reports")}>{error}</EmptyState>
      ) : cases.length === 0 ? (
        <EmptyState icon={<Flag className="h-8 w-8" />} title={status === "open" && category === "all" && !q ? gt("No open reports") : gt("No reports match these filters")} />
      ) : (
        <ul className="space-y-2">
          {cases.map((item) => <CaseRow key={`${item.messageId}:${item.status}:${item.count}`} item={item} onOpen={() => setOpenId(item.id)} />)}
        </ul>
      )}

      {data && pages > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label={gt("Pages")}>
          <button type="button" className={secondaryBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {gt("Previous")}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">{gt("Page {page} of {pages}", { page, pages })}</span>
          <button type="button" className={secondaryBtn} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            {gt("Next")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      )}

      {cases.length > 0 && !onOpenUser && (
        <p className="text-xs text-[var(--text-muted)]">{gt("Strikes, restrictions and suspensions need the Trust & Safety permission.")}</p>
      )}

      <MountWhenOpened open={openId !== null}>
        <ReportCaseSheet
          reportId={openId}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onOpenUser={onOpenUser}
        />
      </MountWhenOpened>
    </div>
  );
}

