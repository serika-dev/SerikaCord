"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Bug, Send, Trash2, ChevronDown, X, Video, Loader2,
  Search, Zap, Eye, Palette, Wrench, Gauge, ShieldAlert, Volume2,
  Wifi, LayoutPanelTop, HelpCircle, CheckCircle2, Clock, XCircle,
  CircleDot, UploadCloud, SlidersHorizontal, Monitor, Cpu, Tag,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface BugReportAttachment {
  url: string;
  type: "image" | "video";
  name: string;
}

interface BugReport {
  id: string;
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

const CATEGORIES = [
  { value: "crash", label: "Crash", icon: Zap },
  { value: "visual", label: "Visual / UI", icon: Eye },
  { value: "functionality", label: "Functionality", icon: Wrench },
  { value: "performance", label: "Performance", icon: Gauge },
  { value: "security", label: "Security", icon: ShieldAlert },
  { value: "audio", label: "Audio", icon: Volume2 },
  { value: "network", label: "Network", icon: Wifi },
  { value: "ui_ux", label: "UI / UX", icon: LayoutPanelTop },
  { value: "other", label: "Other", icon: HelpCircle },
] as const;

const CATEGORY_ICONS: Record<string, typeof Zap> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.icon])
);

const PRIORITY_META: Record<string, { label: string; dot: string; text: string; bg: string; stripe: string }> = {
  low: { label: "low", dot: "bg-blue-400", text: "text-blue-300", bg: "bg-blue-500/10", stripe: "bg-blue-400" },
  medium: { label: "medium", dot: "bg-yellow-400", text: "text-yellow-300", bg: "bg-yellow-500/10", stripe: "bg-yellow-400" },
  high: { label: "high", dot: "bg-orange-400", text: "text-orange-300", bg: "bg-orange-500/10", stripe: "bg-orange-400" },
  critical: { label: "critical", dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10", stripe: "bg-red-400" },
};

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
  };
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // List controls
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [search, setSearch] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [actualBehavior, setActualBehavior] = useState("");
  const [attachments, setAttachments] = useState<BugReportAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [browserInfo, setBrowserInfo] = useState("");
  const [osInfo, setOsInfo] = useState("");
  const [appVersion, setAppVersion] = useState("");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bug-reports/me");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch {
      toast.error(gt("Failed to load bug reports"));
    } finally {
      setLoading(false);
    }
  }, [gt]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Auto-detect browser/OS info
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      let browser = "Unknown";
      let os = "Unknown";

      if (ua.includes("Firefox")) browser = "Firefox";
      else if (ua.includes("Chrome")) browser = "Chrome";
      else if (ua.includes("Safari")) browser = "Safari";
      else if (ua.includes("Edge")) browser = "Edge";

      if (ua.includes("Windows")) os = "Windows";
      else if (ua.includes("Mac")) os = "macOS";
      else if (ua.includes("Linux")) os = "Linux";
      else if (ua.includes("Android")) os = "Android";
      else if (ua.includes("iOS") || ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

      setBrowserInfo(`${browser} ${ua.match(/(Firefox|Chrome|Safari|Edge)\/([\d.]+)/)?.[2] || ""}`.trim());
      setOsInfo(os);
      setAppVersion("1.0.0");
    }
  }, []);

  const stats = useMemo(() => {
    const open = reports.filter((r) => r.status === "open" || r.status === "acknowledged").length;
    const resolved = reports.filter((r) => r.status === "resolved").length;
    return { total: reports.length, open, resolved };
  }, [reports]);

  const visibleReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (filter === "open" && !(r.status === "open" || r.status === "acknowledged")) return false;
      if (filter === "resolved" && r.status !== "resolved") return false;
      if (q && !(`${r.title} ${r.description}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [reports, filter, search]);

  const uploadFiles = useCallback(async (files: File[]) => {
    setUploadingFile(true);
    try {
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) {
          toast.error(gt("Only images and videos are supported"));
          continue;
        }
        if (file.size > 25 * 1024 * 1024) {
          toast.error(gt("File size must be under 25MB"));
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload/attachment", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          setAttachments((prev) => [...prev, {
            url: data.url,
            type: isImage ? "image" : "video",
            name: file.name,
          }]);
        } else {
          toast.error(gt("Failed to upload file: {name}", { name: file.name }));
        }
      }
    } catch {
      toast.error(gt("Failed to upload files"));
    } finally {
      setUploadingFile(false);
    }
  }, [gt]);

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategory("other");
    setStepsToReproduce("");
    setExpectedBehavior("");
    setActualBehavior("");
    setAttachments([]);
    setShowAdvanced(false);
    setShowForm(false);
  };

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error(gt("Title and description are required"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          stepsToReproduce: stepsToReproduce.trim() || undefined,
          expectedBehavior: expectedBehavior.trim() || undefined,
          actualBehavior: actualBehavior.trim() || undefined,
          attachments,
          browserInfo,
          osInfo,
          appVersion,
        }),
      });

      if (res.ok) {
        toast.success(gt("Bug report submitted! Thank you."));
        resetForm();
        fetchReports();
      } else {
        const data = await res.json();
        toast.error(data.error || gt("Failed to submit bug report"));
      }
    } catch {
      toast.error(gt("Failed to submit bug report"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/bug-reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(gt("Bug report deleted"));
        fetchReports();
      } else {
        const data = await res.json();
        toast.error(data.error || gt("Failed to delete bug report"));
      }
    } catch {
      toast.error(gt("Failed to delete bug report"));
    }
  };

  const inputCls =
    "w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)]/40";

  const FILTER_TABS: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: gt("All"), count: stats.total },
    { key: "open", label: gt("Open"), count: stats.open },
    { key: "resolved", label: gt("Resolved"), count: stats.resolved },
  ];

  return (
    <div>
      {/* Hero header */}
      <div className="mb-6 rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--app-accent)]/12 via-[var(--bg-app)] to-[var(--bg-app)]">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/30 flex items-center justify-center">
              <Bug className="w-6 h-6 text-[var(--app-accent)]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[var(--text-primary)] leading-tight">{gt("Bug Reports")}</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {gt("Spotted something broken? Help us make SerikaCord better.")}
              </p>
            </div>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="shrink-0 px-4 py-2.5 rounded-lg bg-[var(--app-accent)] hover:brightness-110 active:scale-95 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--app-accent)]/20"
            >
              <Bug className="w-4 h-4" />
              {gt("Report a Bug")}
            </button>
          )}
        </div>
        {/* Stat strip */}
        <div className="grid grid-cols-3 border-t border-[var(--border-subtle)] divide-x divide-[var(--border-subtle)]">
          {[
            { label: gt("Total"), value: stats.total, cls: "text-[var(--text-primary)]" },
            { label: gt("Active"), value: stats.open, cls: "text-green-300" },
            { label: gt("Resolved"), value: stats.resolved, cls: "text-blue-300" },
          ].map((s, i) => (
            <div key={i} className="px-4 py-2.5 text-center">
              <p className={cn("text-xl font-bold tabular-nums leading-none", s.cls)}>{s.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-6 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/40">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Bug className="w-4 h-4 text-[var(--app-accent)]" />
              {gt("New Bug Report")}
            </h3>
            <button
              onClick={resetForm}
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {/* Category chips */}
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> {gt("Category")}
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const active = category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                        active
                          ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-white shadow-md shadow-[var(--app-accent)]/20"
                          : "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--app-accent)]/50 hover:text-[var(--text-primary)]"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {categoryLabelMap[c.label] ?? c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  {gt("Title")} <span className="text-red-400">*</span>
                </label>
                <span className={cn("text-[10px] tabular-nums", title.length > 180 ? "text-orange-400" : "text-[var(--text-muted)]")}>{title.length}/200</span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={gt("Brief summary of the bug")}
                className={inputCls}
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  {gt("Description")} <span className="text-red-400">*</span>
                </label>
                <span className={cn("text-[10px] tabular-nums", description.length > 4800 ? "text-orange-400" : "text-[var(--text-muted)]")}>{description.length}/5000</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                rows={4}
                placeholder={gt("Detailed description of the bug. What happened? When did it happen?")}
                className={cn(inputCls, "resize-y")}
              />
            </div>

            {/* Attachments — drag & drop */}
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
                {gt("Attachments (Screenshots / Videos)")}
              </label>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative group rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                      {att.type === "image" ? (
                        <img src={att.url} alt={att.name} className="w-20 h-20 object-cover" />
                      ) : (
                        <div className="w-20 h-20 flex items-center justify-center bg-[var(--bg-card)]">
                          <Video className="w-8 h-8 text-[var(--text-secondary)]" />
                        </div>
                      )}
                      <button
                        onClick={() => handleRemoveAttachment(i)}
                        className="absolute top-1 right-1 p-1 rounded-md bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <p className="absolute bottom-0 inset-x-0 text-[9px] text-white/90 truncate px-1 py-0.5 bg-black/50">{att.name}</p>
                    </div>
                  ))}
                </div>
              )}
              <label
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files?.length) uploadFiles(Array.from(e.dataTransfer.files));
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 w-full py-6 rounded-lg border-2 border-dashed cursor-pointer transition-all",
                  dragActive
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10"
                    : "border-[var(--border-subtle)] hover:border-[var(--app-accent)]/60 hover:bg-[var(--bg-card)]/40"
                )}
              >
                {uploadingFile ? (
                  <><Loader2 className="w-6 h-6 animate-spin text-[var(--app-accent)]" /><span className="text-xs text-[var(--text-secondary)]">{gt("Uploading...")}</span></>
                ) : (
                  <>
                    <UploadCloud className="w-6 h-6 text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-secondary)]">{gt("Drag & drop or click to attach")}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{gt("Images or videos, max 25MB")}</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && uploadFiles(Array.from(e.target.files))}
                  disabled={uploadingFile}
                />
              </label>
            </div>

            {/* Advanced details toggle */}
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card)]/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {gt("Advanced details (steps, expected/actual, environment)")}
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", showAdvanced && "rotate-180")} />
              </button>
              {showAdvanced && (
                <div className="p-3 space-y-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/20">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Steps to Reproduce")}</label>
                    <textarea
                      value={stepsToReproduce}
                      onChange={(e) => setStepsToReproduce(e.target.value)}
                      rows={3}
                      placeholder={"1. Go to...\n2. Click on...\n3. See error..."}
                      className={cn(inputCls, "resize-y font-mono")}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Expected Behavior")}</label>
                      <textarea
                        value={expectedBehavior}
                        onChange={(e) => setExpectedBehavior(e.target.value)}
                        rows={2}
                        placeholder={gt("What should have happened?")}
                        className={cn(inputCls, "resize-y")}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Actual Behavior")}</label>
                      <textarea
                        value={actualBehavior}
                        onChange={(e) => setActualBehavior(e.target.value)}
                        rows={2}
                        placeholder={gt("What actually happened?")}
                        className={cn(inputCls, "resize-y")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("Browser")}</label>
                      <input type="text" value={browserInfo} onChange={(e) => setBrowserInfo(e.target.value)} placeholder={gt("Auto-detected")} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("OS")}</label>
                      <input type="text" value={osInfo} onChange={(e) => setOsInfo(e.target.value)} placeholder={gt("Auto-detected")} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{gt("App Version")}</label>
                      <input type="text" value={appVersion} onChange={(e) => setAppVersion(e.target.value)} placeholder={gt("Version")} className={inputCls} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky footer */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/40">
            <p className="text-[11px] text-[var(--text-muted)] hidden sm:block">
              {gt("Priority is set to Low by default. Admins may adjust it.")}
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={resetForm}
                className="px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                {gt("Cancel")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-2 bg-[var(--app-accent)] hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {gt("Submit Report")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List controls */}
      {reports.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                  filter === t.key
                    ? "bg-[var(--app-accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                {t.label}
                <span className={cn("text-[10px] px-1.5 rounded-full tabular-nums", filter === t.key ? "bg-white/20" : "bg-[var(--bg-card)]")}>{t.count}</span>
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search your reports...")}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)] transition-colors"
            />
          </div>
        </div>
      )}

      {/* Reports list */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={24} />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-14 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-[var(--app-accent)]/10 flex items-center justify-center">
              <Bug className="w-7 h-7 text-[var(--app-accent)] opacity-70" />
            </div>
            <p className="text-sm font-medium text-[var(--text-secondary)]">{gt("No bug reports yet")}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{gt("When something breaks, let us know here.")}</p>
          </div>
        ) : visibleReports.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--text-muted)]">
            {gt("No reports match your filters.")}
          </div>
        ) : (
          visibleReports.map((report) => {
            const pri = PRIORITY_META[report.priority] ?? PRIORITY_META.low;
            const st = STATUS_META[report.status] ?? STATUS_META.open;
            const StatusIcon = st.icon;
            const CatIcon = CATEGORY_ICONS[report.category] ?? HelpCircle;
            const expanded = expandedId === report.id;
            return (
              <div
                key={report.id}
                className={cn(
                  "relative rounded-xl bg-[var(--bg-app)] border overflow-hidden transition-colors",
                  expanded ? "border-[var(--app-accent)]/40" : "border-[var(--border-subtle)] hover:border-[var(--border-subtle)]/80"
                )}
              >
                {/* priority stripe */}
                <div className={cn("absolute left-0 top-0 bottom-0 w-1", pri.stripe)} />

                <button
                  onClick={() => setExpandedId(expanded ? null : report.id)}
                  className="w-full text-left flex items-center gap-3 p-3 pl-4 hover:bg-[var(--bg-hover)]/40 transition-colors"
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
                    <CatIcon className="w-4 h-4 text-[var(--text-secondary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-[var(--text-primary)] truncate">{report.title}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium", st.bg, st.text)}>
                        <StatusIcon className="w-3 h-3" />
                        {report.status.replace("_", " ")}
                      </span>
                      <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize", pri.bg, pri.text)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", pri.dot)} />
                        {pri.label}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={cn("shrink-0 w-4 h-4 text-[var(--text-muted)] transition-transform", expanded && "rotate-180")} />
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-subtle)] p-4 pl-4 space-y-4 animate-in fade-in duration-150">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{gt("Description")}</p>
                      <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{report.description}</p>
                    </div>

                    {report.stepsToReproduce && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{gt("Steps to Reproduce")}</p>
                        <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-mono bg-[var(--bg-card)] rounded-lg p-2.5 border border-[var(--border-subtle)]">{report.stepsToReproduce}</pre>
                      </div>
                    )}

                    {(report.expectedBehavior || report.actualBehavior) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {report.expectedBehavior && (
                          <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-green-300 mb-1">{gt("Expected")}</p>
                            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.expectedBehavior}</p>
                          </div>
                        )}
                        {report.actualBehavior && (
                          <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-red-300 mb-1">{gt("Actual")}</p>
                            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.actualBehavior}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {report.attachments && report.attachments.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{gt("Attachments")}</p>
                        <div className="flex flex-wrap gap-2">
                          {report.attachments.map((att, i) => (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="relative group block rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                              {att.type === "image" ? (
                                <img src={att.url} alt={att.name} className="w-24 h-24 object-cover" />
                              ) : (
                                <div className="w-24 h-24 flex items-center justify-center bg-[var(--bg-card)]">
                                  <Video className="w-8 h-8 text-[var(--text-secondary)]" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <ArrowUpRight className="w-5 h-5 text-white" />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {(report.browserInfo || report.osInfo || report.appVersion) && (
                      <div className="flex flex-wrap gap-2">
                        {report.browserInfo && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Monitor className="w-3 h-3 text-[var(--text-muted)]" /> {report.browserInfo}
                          </span>
                        )}
                        {report.osInfo && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Cpu className="w-3 h-3 text-[var(--text-muted)]" /> {report.osInfo}
                          </span>
                        )}
                        {report.appVersion && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Tag className="w-3 h-3 text-[var(--text-muted)]" /> v{report.appVersion}
                          </span>
                        )}
                      </div>
                    )}

                    {report.adminNotes && (
                      <div className="p-3 rounded-lg bg-[var(--app-accent)]/8 border border-[var(--app-accent)]/25">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-accent)] mb-1 flex items-center gap-1">
                          <Palette className="w-3 h-3" /> {gt("Admin Notes")}
                        </p>
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.adminNotes}</p>
                      </div>
                    )}

                    {(report.status === "open" || report.status === "acknowledged") && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => handleDelete(report.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {gt("Delete Report")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
