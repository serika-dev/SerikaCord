"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Bug, Trash2, Search, Zap, Eye, Wrench, Gauge, ShieldAlert, Volume2, Wifi, LayoutPanelTop, HelpCircle, CheckCircle2, Clock, XCircle, CircleDot, ArrowUpRight, MessageSquareHeart, Sparkles, Rocket, Heart, MessageCircle
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { VERSION_LABEL } from "@/lib/version";

type ReportKind = "bug" | "feedback";

interface BugReportAttachment {
  url: string;
  type: "image" | "video";
  name: string;
}

interface BugReport {
  id: string;
  kind: ReportKind;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  attachments: BugReportAttachment[];
  browserInfo: string | null;
  osInfo: string | null;
  appVersion: string | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

type CategoryDef = { value: string; label: string; icon: typeof Zap };

const BUG_CATEGORIES: CategoryDef[] = [
  { value: "crash", label: "Crash", icon: Zap },
  { value: "visual", label: "Visual / UI", icon: Eye },
  { value: "functionality", label: "Functionality", icon: Wrench },
  { value: "performance", label: "Performance", icon: Gauge },
  { value: "security", label: "Security", icon: ShieldAlert },
  { value: "audio", label: "Audio", icon: Volume2 },
  { value: "network", label: "Network", icon: Wifi },
  { value: "ui_ux", label: "UI / UX", icon: LayoutPanelTop },
  { value: "other", label: "Other", icon: HelpCircle },
];

const FEEDBACK_CATEGORIES: CategoryDef[] = [
  { value: "feature_request", label: "Feature Request", icon: Sparkles },
  { value: "improvement", label: "Improvement", icon: Rocket },
  { value: "ui_ux", label: "UI / UX", icon: LayoutPanelTop },
  { value: "praise", label: "Praise", icon: Heart },
  { value: "general", label: "General", icon: MessageCircle },
];

const CATEGORY_ICONS: Record<string, typeof Zap> = Object.fromEntries(
  [...BUG_CATEGORIES, ...FEEDBACK_CATEGORIES].map((c) => [c.value, c.icon])
);
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  [...BUG_CATEGORIES, ...FEEDBACK_CATEGORIES].map((c) => [c.value, c.label])
);

const STATUS_META: Record<string, { icon: typeof Clock; text: string; bg: string }> = {
  open: { icon: CircleDot, text: "text-green-300", bg: "bg-green-500/10" },
  acknowledged: { icon: Clock, text: "text-yellow-300", bg: "bg-yellow-500/10" },
  resolved: { icon: CheckCircle2, text: "text-blue-300", bg: "bg-blue-500/10" },
  wont_fix: { icon: XCircle, text: "text-gray-400", bg: "bg-gray-500/10" },
};

export function BugReportPanel() {
  const gt = useGT();
  // gt-next compiler requires static string literals, so build a lookup map
  // with literal gt() calls instead of calling gt() with a variable.
  const categoryLabelMap: Record<string, string> = {
    "Crash": gt("Crash"),
    "Visual / UI": gt("Visual / UI"),
    "Functionality": gt("Functionality"),
    "Performance": gt("Performance"),
    "Security": gt("Security"),
    "Audio": gt("Audio"),
    "Network": gt("Network"),
    "UI / UX": gt("UI / UX"),
    "Other": gt("Other"),
    "Feature Request": gt("Feature Request"),
    "Improvement": gt("Improvement"),
    "Praise": gt("Praise"),
    "General": gt("General"),
  };
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // List controls
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "bug" | "feedback">("all");
  const [search, setSearch] = useState("");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bug-reports/me");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch {
      toast.error(gt("Failed to load reports"));
    } finally {
      setLoading(false);
    }
  }, [gt]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const stats = useMemo(() => {
    const open = reports.filter((r) => r.status === "open" || r.status === "acknowledged").length;
    const resolved = reports.filter((r) => r.status === "resolved").length;
    const bugs = reports.filter((r) => r.kind === "bug").length;
    const feedback = reports.filter((r) => r.kind === "feedback").length;
    return { total: reports.length, open, resolved, bugs, feedback };
  }, [reports]);

  const visibleReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (filter === "open" && !(r.status === "open" || r.status === "acknowledged")) return false;
      if (filter === "resolved" && r.status !== "resolved") return false;
      if (q && !(`${r.title} ${r.description}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [reports, filter, kindFilter, search]);

  const openForm = (nextKind: ReportKind) => {
    window.open(`https://issues.serika.dev/issues/new?project=serikacord&kind=${nextKind === "bug" ? "bug" : "improvement"}`, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/bug-reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(gt("Report deleted"));
        fetchReports();
      } else {
        const data = await res.json();
        toast.error(data.error || gt("Failed to delete report"));
      }
    } catch {
      toast.error(gt("Failed to delete report"));
    }
  };

  const FILTER_TABS: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: gt("All"), count: stats.total },
    { key: "open", label: gt("Open"), count: stats.open },
    { key: "resolved", label: gt("Resolved"), count: stats.resolved },
  ];

  const KIND_TABS: { key: typeof kindFilter; label: string }[] = [
    { key: "all", label: gt("Everything") },
    { key: "feedback", label: gt("Feedback") },
    { key: "bug", label: gt("Bugs") },
  ];

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)]">{gt("Feedback & Bug Reports")}</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {gt("New reports and feedback are tracked in Serika Issues. Your previous reports remain below.")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openForm("feedback")}
            className="px-4 py-2 rounded-lg bg-[var(--app-accent)] hover:brightness-110 active:scale-[0.98] text-white text-sm font-semibold transition-all flex items-center justify-center"
          >
            {gt("Share Feedback")}
          </button>
          <button
            onClick={() => openForm("bug")}
            className="px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)]/50 hover:text-[var(--text-primary)] text-[var(--text-secondary)] active:scale-[0.98] text-sm font-semibold transition-all flex items-center justify-center"
          >
            {gt("Report Bug")}
          </button>
        </div>
      </div>

      <a href="https://issues.serika.dev/projects/serikacord" target="_blank" rel="noopener noreferrer" className="inline-block mb-6 text-[var(--app-accent)] underline">{gt("View reports in Serika Issues")}</a>
      <p className="mb-6 text-sm text-[var(--text-secondary)]"><a href="mailto:security@serika.dev" className="underline">{gt("Security")}: security@serika.dev</a></p>
      {/* List controls */}
      {reports.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search your reports...")}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)] transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as "all" | "bug" | "feedback")}
              className="px-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              {KIND_TABS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as "all" | "open" | "resolved")}
              className="px-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              {FILTER_TABS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Reports list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader size={24} />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--app-accent)]/10 flex items-center justify-center">
              <MessageSquareHeart className="w-8 h-8 text-[var(--app-accent)] opacity-70" />
            </div>
            <p className="text-base font-medium text-[var(--text-secondary)]">{gt("Nothing here yet")}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1.5">{gt("Share an idea or report a bug — we read everything.")}</p>
          </div>
        ) : visibleReports.length === 0 ? (
          <div className="text-center py-12 text-sm text-[var(--text-muted)]">
            {gt("No reports match your filters.")}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleReports.map((report) => {
              const st = STATUS_META[report.status] ?? STATUS_META.open;
              const StatusIcon = st.icon;
              const expanded = expandedId === report.id;
              const reportIsBug = report.kind === "bug";
              
              return (
                <div
                  key={report.id}
                  className="border-b border-[var(--border-subtle)] last:border-0"
                >
                  <button
                    onClick={() => setExpandedId(expanded ? null : report.id)}
                    className="w-full text-left py-3 px-2 flex items-center gap-4 hover:bg-[var(--bg-hover)]/30 rounded-lg transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-medium text-[15px] text-[var(--text-primary)] truncate">
                          {reportIsBug ? <Bug className="w-3.5 h-3.5 inline-block mr-1.5 text-orange-400" /> : <Sparkles className="w-3.5 h-3.5 inline-block mr-1.5 text-[var(--app-accent)]" />}
                          {report.title}
                        </p>
                        <span className="text-[11px] text-[var(--text-muted)] shrink-0">{new Date(report.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1.5 capitalize">
                          <StatusIcon className="w-3.5 h-3.5" />
                          {report.status.replace("_", " ")}
                        </span>
                        <span>•</span>
                        <span>{categoryLabelMap[CATEGORY_LABELS[report.category]] ?? CATEGORY_LABELS[report.category] ?? report.category}</span>
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-2 pb-4 pt-1 space-y-4 animate-in fade-in duration-150">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Description")}</p>
                        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{report.description}</p>
                      </div>

                      {report.stepsToReproduce && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Steps to Reproduce")}</p>
                          <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-mono bg-[var(--bg-card)] rounded-lg p-3 border border-[var(--border-subtle)]">{report.stepsToReproduce}</pre>
                        </div>
                      )}

                      {(report.expectedBehavior || report.actualBehavior) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {report.expectedBehavior && (
                            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-green-300 mb-1.5">{gt("Expected")}</p>
                              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.expectedBehavior}</p>
                            </div>
                          )}
                          {report.actualBehavior && (
                            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300 mb-1.5">{gt("Actual")}</p>
                              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.actualBehavior}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {report.attachments && report.attachments.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Attachments")}</p>
                          <div className="flex flex-wrap gap-2.5">
                            {report.attachments.map((att, i) =>
                              att.type === "image" ? (
                                <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="relative group block rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                                  <img src={att.url} alt={att.name} className="w-20 h-20 object-cover" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <ArrowUpRight className="w-4 h-4 text-white" />
                                  </div>
                                </a>
                              ) : (
                                <video
                                  key={i}
                                  src={att.url}
                                  controls
                                  preload="metadata"
                                  className="w-32 h-20 object-cover rounded-xl border border-[var(--border-subtle)] bg-black"
                                />
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {report.adminNotes && (
                        <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-accent)] mb-1.5 flex items-center gap-1">
                            <MessageCircle className="w-3 h-3" /> {gt("Admin Response")}
                          </p>
                          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{report.adminNotes}</p>
                        </div>
                      )}

                      {(report.status === "open" || report.status === "acknowledged") && (
                        <div className="pt-1 flex justify-end">
                          <button
                            onClick={() => handleDelete(report.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {gt("Delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
