"use client";

import { useState, useCallback, useEffect } from "react";
import { Bug, Trash2, ChevronDown, ChevronRight, Loader2, Filter, Image as ImageIcon, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface BugReportAttachment {
  url: string;
  type: "image" | "video";
  name: string;
}

interface ReporterInfo {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  email?: string | null;
}

interface BugReport {
  id: string;
  reporterId: string;
  kind?: "bug" | "feedback";
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
  assignedTo: string | null;
  adminNotes: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  reporter?: ReporterInfo | null;
}

interface BugReportStats {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  wontFix: number;
  byPriority: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-500/20 text-green-400",
  acknowledged: "bg-yellow-500/20 text-yellow-400",
  resolved: "bg-blue-500/20 text-blue-400",
  wont_fix: "bg-gray-500/20 text-gray-400",
};

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "crash", label: "Crash" },
  { value: "visual", label: "Visual / UI" },
  { value: "functionality", label: "Functionality" },
  { value: "performance", label: "Performance" },
  { value: "security", label: "Security" },
  { value: "audio", label: "Audio" },
  { value: "network", label: "Network" },
  { value: "ui_ux", label: "UI / UX" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "all", label: "All Priorities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "all", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "wont_fix", label: "Won't Fix" },
];

export function AdminBugReportsPanel() {
  const gt = useGT();
  // gt-next compiler requires static string literals, so build a lookup map
  // with literal gt() calls instead of calling gt() with a variable.
  const labelMap: Record<string, string> = {
    "All Categories": gt("All Categories"),
    "Crash": gt("Crash"),
    "Visual / UI": gt("Visual / UI"),
    "Functionality": gt("Functionality"),
    "Performance": gt("Performance"),
    "Security": gt("Security"),
    "Audio": gt("Audio"),
    "Network": gt("Network"),
    "UI / UX": gt("UI / UX"),
    "Other": gt("Other"),
    "All Priorities": gt("All Priorities"),
    "Low": gt("Low"),
    "Medium": gt("Medium"),
    "High": gt("High"),
    "Critical": gt("Critical"),
    "Active": gt("Active"),
    "All Statuses": gt("All Statuses"),
    "Open": gt("Open"),
    "Acknowledged": gt("Acknowledged"),
    "Resolved": gt("Resolved"),
    "Won't Fix": gt("Won't Fix"),
  };
  const tLabel = (label: string) => labelMap[label] ?? label;
  const [reports, setReports] = useState<BugReport[]>([]);
  const [stats, setStats] = useState<BugReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  // Default to the active working set — resolved / won't-fix are hidden until
  // an admin explicitly selects them (or "All Statuses").
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPriority, setEditPriority] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editAdminNotes, setEditAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchReports = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterPriority !== "all") params.set("priority", filterPriority);
      if (filterCategory !== "all") params.set("category", filterCategory);

      const res = await fetch(`/api/admin/bug-reports?${params}`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
        setTotal(data.pagination?.total || 0);
        setTotalPages(data.pagination?.pages || 1);
        setPage(data.pagination?.page || 1);
      }
    } catch {
      toast.error(gt("Failed to load bug reports"));
    } finally {
      setLoading(false);
    }
  }, [gt, filterStatus, filterPriority, filterCategory]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bug-reports/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchReports(1);
    fetchStats();
  }, [fetchReports, fetchStats]);

  const handleFilterChange = () => {
    fetchReports(1);
  };

  const startEdit = (report: BugReport) => {
    setEditingId(report.id);
    setEditPriority(report.priority);
    setEditStatus(report.status);
    setEditAdminNotes(report.adminNotes || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPriority("");
    setEditStatus("");
    setEditAdminNotes("");
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editPriority) updates.priority = editPriority;
      if (editStatus) updates.status = editStatus;
      updates.adminNotes = editAdminNotes;

      const res = await fetch(`/api/admin/bug-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        toast.success(gt("Bug report updated"));
        cancelEdit();
        fetchReports(page);
        fetchStats();
      } else {
        const data = await res.json();
        toast.error(data.error || gt("Failed to update bug report"));
      }
    } catch {
      toast.error(gt("Failed to update bug report"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(gt("Are you sure you want to delete this bug report?"))) return;
    try {
      const res = await fetch(`/api/admin/bug-reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(gt("Bug report deleted"));
        fetchReports(page);
        fetchStats();
      } else {
        toast.error(gt("Failed to delete bug report"));
      }
    } catch {
      toast.error(gt("Failed to delete bug report"));
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1 flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-[var(--app-accent)]" />
        {gt("Bug Reports Management")}
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        {gt("Review, prioritize, and resolve user-submitted bug reports.")}
      </p>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="text-2xl font-bold text-[var(--text-primary)]">{stats.total}</p>
            <p className="text-xs text-[var(--text-muted)]">{gt("Total")}</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="text-2xl font-bold text-green-400">{stats.open}</p>
            <p className="text-xs text-[var(--text-muted)]">{gt("Open")}</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="text-2xl font-bold text-yellow-400">{stats.acknowledged}</p>
            <p className="text-xs text-[var(--text-muted)]">{gt("Acknowledged")}</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="text-2xl font-bold text-blue-400">{stats.resolved}</p>
            <p className="text-xs text-[var(--text-muted)]">{gt("Resolved")}</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="text-2xl font-bold text-red-400">{stats.byPriority.critical}</p>
            <p className="text-xs text-[var(--text-muted)]">{gt("Critical")}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
        <Filter className="w-4 h-4 text-[var(--text-muted)]" />
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); }}
          className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-[var(--text-primary)] text-xs"
        >
          {STATUSES.map(s => <option key={s.value} value={s.value}>{tLabel(s.label)}</option>)}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => { setFilterPriority(e.target.value); }}
          className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-[var(--text-primary)] text-xs"
        >
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{tLabel(p.label)}</option>)}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); }}
          className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-[var(--text-primary)] text-xs"
        >
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{tLabel(c.label)}</option>)}
        </select>
        <button
          onClick={handleFilterChange}
          className="px-3 py-1.5 bg-[var(--app-accent)] hover:brightness-110 text-white rounded-md text-xs font-medium transition-all"
        >
          {gt("Apply")}
        </button>
        <span className="text-xs text-[var(--text-muted)] ml-auto">{total} {gt("reports")}</span>
      </div>

      {/* Reports list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader size={24} />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-8 text-[var(--text-muted)] text-sm">
          <Bug className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {gt("No bug reports found.")}
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => (
            <div
              key={report.id}
              className={cn(
                "rounded-lg bg-[var(--bg-app)] border overflow-hidden",
                report.priority === "critical" ? "border-red-500/40" : "border-[var(--border-subtle)]"
              )}
            >
              {/* Header row */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                  >
                    {expandedId === report.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-[var(--text-primary)] truncate">{report.title}</p>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold",
                        report.kind === "feedback" ? "bg-[var(--app-accent)]/15 text-[var(--app-accent)]" : "bg-orange-500/15 text-orange-300"
                      )}>
                        {report.kind === "feedback" ? gt("Feedback") : gt("Bug")}
                      </span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold border", PRIORITY_COLORS[report.priority])}>
                        {report.priority}
                      </span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold", STATUS_COLORS[report.status])}>
                        {report.status.replace("_", " ")}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold bg-[var(--bg-card)] text-[var(--text-muted)]">
                        {report.category.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {report.reporter && (
                        <p className="text-xs text-[var(--text-muted)]">
                          {gt("by")} {report.reporter.displayName || report.reporter.username}
                        </p>
                      )}
                      <p className="text-xs text-[var(--text-muted)]">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </p>
                      {report.attachments && report.attachments.length > 0 && (
                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-0.5">
                          <ImageIcon className="w-3 h-3" /> {report.attachments.length}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  {editingId !== report.id && (
                    <button
                      onClick={() => startEdit(report)}
                      className="px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-medium transition-colors"
                    >
                      {gt("Manage")}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(report.id)}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors"
                    title={gt("Delete")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded view */}
              {expandedId === report.id && (
                <div className="border-t border-[var(--border-subtle)] p-3 space-y-3">
                  {/* Reporter info */}
                  {report.reporter && (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                      {report.reporter.avatar && (
                        <img src={cdnImage(report.reporter.avatar)} alt="" className="w-8 h-8 rounded-full" />
                      )}
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{report.reporter.displayName || report.reporter.username}</p>
                        <p className="text-xs text-[var(--text-muted)]">{report.reporter.email}</p>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Description")}</p>
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{report.description}</p>
                  </div>

                  {report.stepsToReproduce && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Steps to Reproduce")}</p>
                      <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-mono bg-[var(--bg-card)] rounded-md p-2 border border-[var(--border-subtle)]">{report.stepsToReproduce}</pre>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {report.expectedBehavior && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Expected")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{report.expectedBehavior}</p>
                      </div>
                    )}
                    {report.actualBehavior && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Actual")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{report.actualBehavior}</p>
                      </div>
                    )}
                  </div>

                  {report.attachments && report.attachments.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Attachments")}</p>
                      <div className="flex flex-wrap gap-2">
                        {report.attachments.map((att, i) =>
                          att.type === "image" ? (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                              <img src={att.url} alt={att.name} className="w-24 h-24 object-cover rounded-md border border-[var(--border-subtle)]" />
                            </a>
                          ) : (
                            <video
                              key={i}
                              src={att.url}
                              controls
                              preload="metadata"
                              className="w-40 h-24 object-cover rounded-md border border-[var(--border-subtle)] bg-black"
                            />
                          )
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {report.browserInfo && <div><span className="text-[var(--text-muted)]">{gt("Browser")}: </span><span className="text-[var(--text-secondary)]">{report.browserInfo}</span></div>}
                    {report.osInfo && <div><span className="text-[var(--text-muted)]">{gt("OS")}: </span><span className="text-[var(--text-secondary)]">{report.osInfo}</span></div>}
                    {report.appVersion && <div><span className="text-[var(--text-muted)]">{gt("Version")}: </span><span className="text-[var(--text-secondary)]">{report.appVersion}</span></div>}
                  </div>

                  {/* Admin management panel */}
                  {editingId === report.id ? (
                    <div className="space-y-3 p-3 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                      <p className="text-xs font-semibold text-[var(--text-primary)] uppercase">{gt("Manage Bug Report")}</p>

                      {/* Priority selector */}
                      <div>
                        <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Priority")}</label>
                        <div className="flex gap-1">
                          {["low", "medium", "high", "critical"].map(p => (
                            <button
                              key={p}
                              onClick={() => setEditPriority(p)}
                              className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-medium uppercase transition-all border",
                                editPriority === p
                                  ? PRIORITY_COLORS[p] + " ring-1 ring-offset-0"
                                  : "bg-[var(--bg-app)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Status selector */}
                      <div>
                        <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Status")}</label>
                        <div className="flex gap-1 flex-wrap">
                          {[
                            { value: "open", label: "Open" },
                            { value: "acknowledged", label: "Acknowledged" },
                            { value: "resolved", label: "Resolved" },
                            { value: "wont_fix", label: "Won't Fix" },
                          ].map(s => (
                            <button
                              key={s.value}
                              onClick={() => setEditStatus(s.value)}
                              className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                                editStatus === s.value
                                  ? "bg-[var(--app-accent)] text-white"
                                  : "bg-[var(--bg-app)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                              )}
                            >
                              {tLabel(s.label)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Admin notes */}
                      <div>
                        <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Admin Notes")}</label>
                        <textarea
                          value={editAdminNotes}
                          onChange={(e) => setEditAdminNotes(e.target.value)}
                          rows={3}
                          placeholder={gt("Internal notes about this bug report (visible to user)...")}
                          className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] resize-y"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          {gt("Cancel")}
                        </button>
                        <button
                          onClick={() => handleSave(report.id)}
                          disabled={saving}
                          className="px-4 py-1.5 bg-[var(--app-accent)] hover:brightness-110 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-all flex items-center gap-2"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {gt("Save Changes")}
                        </button>
                      </div>
                    </div>
                  ) : report.adminNotes && (
                    <div className="p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Admin Notes")}</p>
                      <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.adminNotes}</p>
                    </div>
                  )}

                  {/* Resolution info */}
                  {report.resolvedAt && (
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <span>{gt("Resolved on")} {new Date(report.resolvedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => fetchReports(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-50 text-sm"
              >
                {gt("Previous")}
              </button>
              <span className="text-sm text-[var(--text-muted)]">{page} / {totalPages}</span>
              <button
                onClick={() => fetchReports(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-50 text-sm"
              >
                {gt("Next")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
