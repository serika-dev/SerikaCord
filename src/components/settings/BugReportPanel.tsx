"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Bug, Send, Trash2, ChevronDown, X, Video, Loader2,
  Search, Zap, Eye, Wrench, Gauge, ShieldAlert, Volume2,
  Wifi, LayoutPanelTop, HelpCircle, CheckCircle2, Clock, XCircle,
  CircleDot, UploadCloud, SlidersHorizontal, Monitor, Cpu, Tag,
  ArrowUpRight, MessageSquareHeart, Sparkles, Rocket, Heart, MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

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
    "Feature Request": gt("Feature Request"),
    "Improvement": gt("Improvement"),
    "Praise": gt("Praise"),
    "General": gt("General"),
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
  const [kindFilter, setKindFilter] = useState<"all" | "bug" | "feedback">("all");
  const [search, setSearch] = useState("");

  // Form state
  const [kind, setKind] = useState<ReportKind>("feedback");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [actualBehavior, setActualBehavior] = useState("");
  const [attachments, setAttachments] = useState<BugReportAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [browserInfo, setBrowserInfo] = useState("");
  const [osInfo, setOsInfo] = useState("");
  const [appVersion, setAppVersion] = useState("");

  const isBug = kind === "bug";
  const activeCategories = isBug ? BUG_CATEGORIES : FEEDBACK_CATEGORIES;

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

  const openForm = (nextKind: ReportKind) => {
    setKind(nextKind);
    setCategory(nextKind === "bug" ? "other" : "general");
    setShowForm(true);
    setExpandedId(null);
  };

  const switchKind = (nextKind: ReportKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    setCategory(nextKind === "bug" ? "other" : "general");
    if (nextKind === "feedback") setShowAdvanced(false);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategory("general");
    setKind("feedback");
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
          kind,
          title: title.trim(),
          description: description.trim(),
          category,
          stepsToReproduce: isBug ? (stepsToReproduce.trim() || undefined) : undefined,
          expectedBehavior: isBug ? (expectedBehavior.trim() || undefined) : undefined,
          actualBehavior: isBug ? (actualBehavior.trim() || undefined) : undefined,
          attachments,
          browserInfo,
          osInfo,
          appVersion,
        }),
      });

      if (res.ok) {
        toast.success(isBug ? gt("Bug report submitted! Thank you.") : gt("Feedback submitted! Thank you."));
        resetForm();
        fetchReports();
      } else {
        const data = await res.json();
        toast.error(data.error || gt("Failed to submit"));
      }
    } catch {
      toast.error(gt("Failed to submit"));
    } finally {
      setSubmitting(false);
    }
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

  const inputCls =
    "w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-3.5 py-3 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/30";
  const labelCls = "text-sm font-medium text-[var(--text-secondary)]";

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
      {/* Hero header */}
      <div className="mb-7 rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--app-accent)]/12 via-[var(--bg-app)] to-[var(--bg-app)]">
        <div className="p-6 flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/30 flex items-center justify-center">
              <MessageSquareHeart className="w-7 h-7 text-[var(--app-accent)]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{gt("Feedback & Bug Reports")}</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                {gt("Share an idea, tell us what you love, or report something broken — every message helps make SerikaCord better.")}
              </p>
            </div>
          </div>
          {!showForm && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => openForm("feedback")}
                className="flex-1 px-5 py-3 rounded-xl bg-[var(--app-accent)] hover:brightness-110 active:scale-[0.98] text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--app-accent)]/20"
              >
                <Sparkles className="w-4 h-4" />
                {gt("Share Feedback")}
              </button>
              <button
                onClick={() => openForm("bug")}
                className="flex-1 px-5 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)]/50 hover:text-[var(--text-primary)] text-[var(--text-secondary)] active:scale-[0.98] text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                <Bug className="w-4 h-4" />
                {gt("Report a Bug")}
              </button>
            </div>
          )}
        </div>
        {/* Stat strip */}
        <div className="grid grid-cols-4 border-t border-[var(--border-subtle)] divide-x divide-[var(--border-subtle)]">
          {[
            { label: gt("Total"), value: stats.total, cls: "text-[var(--text-primary)]" },
            { label: gt("Feedback"), value: stats.feedback, cls: "text-[var(--app-accent)]" },
            { label: gt("Bugs"), value: stats.bugs, cls: "text-orange-300" },
            { label: gt("Resolved"), value: stats.resolved, cls: "text-blue-300" },
          ].map((s, i) => (
            <div key={i} className="px-3 py-3.5 text-center">
              <p className={cn("text-2xl font-bold tabular-nums leading-none", s.cls)}>{s.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-7 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/40">
            <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              {isBug ? <Bug className="w-4 h-4 text-orange-300" /> : <Sparkles className="w-4 h-4 text-[var(--app-accent)]" />}
              {isBug ? gt("New Bug Report") : gt("Share Your Feedback")}
            </h3>
            <button
              onClick={resetForm}
              className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-7">
            {/* Kind switcher */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => switchKind("feedback")}
                className={cn(
                  "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all",
                  !isBug ? "bg-[var(--app-accent)] text-white shadow-md shadow-[var(--app-accent)]/20" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                <Sparkles className="w-4 h-4" /> {gt("Feedback")}
              </button>
              <button
                type="button"
                onClick={() => switchKind("bug")}
                className={cn(
                  "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all",
                  isBug ? "bg-orange-500 text-white shadow-md shadow-orange-500/20" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                <Bug className="w-4 h-4" /> {gt("Bug Report")}
              </button>
            </div>

            {/* Category chips */}
            <div>
              <label className={cn(labelCls, "mb-2.5 flex items-center gap-1.5")}>
                <Tag className="w-4 h-4" /> {gt("Category")}
              </label>
              <div className="flex flex-wrap gap-2">
                {activeCategories.map((c) => {
                  const Icon = c.icon;
                  const active = category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all",
                        active
                          ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-white shadow-md shadow-[var(--app-accent)]/20"
                          : "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--app-accent)]/50 hover:text-[var(--text-primary)]"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {categoryLabelMap[c.label] ?? c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls}>
                  {gt("Title")} <span className="text-red-400">*</span>
                </label>
                <span className={cn("text-[11px] tabular-nums", title.length > 180 ? "text-orange-400" : "text-[var(--text-muted)]")}>{title.length}/200</span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={isBug ? gt("Brief summary of the bug") : gt("Brief summary of your idea or feedback")}
                className={inputCls}
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls}>
                  {gt("Description")} <span className="text-red-400">*</span>
                </label>
                <span className={cn("text-[11px] tabular-nums", description.length > 4800 ? "text-orange-400" : "text-[var(--text-muted)]")}>{description.length}/5000</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                rows={5}
                placeholder={isBug
                  ? gt("Detailed description of the bug. What happened? When did it happen?")
                  : gt("Tell us more. What would you like to see, or what's working well for you?")}
                className={cn(inputCls, "resize-y leading-relaxed")}
              />
            </div>

            {/* Attachments — drag & drop */}
            <div>
              <label className={cn(labelCls, "mb-2.5 block")}>
                {isBug ? gt("Attachments (Screenshots / Videos)") : gt("Attachments (Screenshots / Mockups)")}
              </label>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2.5 mb-3">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative group rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                      {att.type === "image" ? (
                        <img src={att.url} alt={att.name} className="w-24 h-24 object-cover" />
                      ) : (
                        <div className="w-24 h-24 flex items-center justify-center bg-[var(--bg-card)]">
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
                  "flex flex-col items-center justify-center gap-2 w-full py-8 rounded-xl border-2 border-dashed cursor-pointer transition-all",
                  dragActive
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10"
                    : "border-[var(--border-subtle)] hover:border-[var(--app-accent)]/60 hover:bg-[var(--bg-card)]/40"
                )}
              >
                {uploadingFile ? (
                  <><Loader2 className="w-6 h-6 animate-spin text-[var(--app-accent)]" /><span className="text-sm text-[var(--text-secondary)]">{gt("Uploading...")}</span></>
                ) : (
                  <>
                    <UploadCloud className="w-7 h-7 text-[var(--text-muted)]" />
                    <span className="text-sm text-[var(--text-secondary)]">{gt("Drag & drop or click to attach")}</span>
                    <span className="text-xs text-[var(--text-muted)]">{gt("Images or videos, max 25MB")}</span>
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

            {/* Advanced details toggle — bug reports only */}
            {isBug && (
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card)]/40 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4" />
                    {gt("Advanced details (steps, expected/actual, environment)")}
                  </span>
                  <ChevronDown className={cn("w-4 h-4 transition-transform", showAdvanced && "rotate-180")} />
                </button>
                {showAdvanced && (
                  <div className="p-4 space-y-5 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/20">
                    <div>
                      <label className={cn(labelCls, "mb-1.5 block")}>{gt("Steps to Reproduce")}</label>
                      <textarea
                        value={stepsToReproduce}
                        onChange={(e) => setStepsToReproduce(e.target.value)}
                        rows={3}
                        placeholder={"1. Go to...\n2. Click on...\n3. See error..."}
                        className={cn(inputCls, "resize-y font-mono")}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={cn(labelCls, "mb-1.5 block")}>{gt("Expected Behavior")}</label>
                        <textarea
                          value={expectedBehavior}
                          onChange={(e) => setExpectedBehavior(e.target.value)}
                          rows={2}
                          placeholder={gt("What should have happened?")}
                          className={cn(inputCls, "resize-y")}
                        />
                      </div>
                      <div>
                        <label className={cn(labelCls, "mb-1.5 block")}>{gt("Actual Behavior")}</label>
                        <textarea
                          value={actualBehavior}
                          onChange={(e) => setActualBehavior(e.target.value)}
                          rows={2}
                          placeholder={gt("What actually happened?")}
                          className={cn(inputCls, "resize-y")}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className={cn(labelCls, "mb-1.5 block")}>{gt("Browser")}</label>
                        <input type="text" value={browserInfo} onChange={(e) => setBrowserInfo(e.target.value)} placeholder={gt("Auto-detected")} className={inputCls} />
                      </div>
                      <div>
                        <label className={cn(labelCls, "mb-1.5 block")}>{gt("OS")}</label>
                        <input type="text" value={osInfo} onChange={(e) => setOsInfo(e.target.value)} placeholder={gt("Auto-detected")} className={inputCls} />
                      </div>
                      <div>
                        <label className={cn(labelCls, "mb-1.5 block")}>{gt("App Version")}</label>
                        <input type="text" value={appVersion} onChange={(e) => setAppVersion(e.target.value)} placeholder={gt("Version")} className={inputCls} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/40">
            <p className="text-xs text-[var(--text-muted)] hidden sm:block">
              {isBug ? gt("Priority is set to Low by default. Admins may adjust it.") : gt("Thanks for helping shape SerikaCord.")}
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={resetForm}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                {gt("Cancel")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  "px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 text-white active:scale-95 disabled:opacity-50 disabled:active:scale-100",
                  isBug ? "bg-orange-500 hover:brightness-110" : "bg-[var(--app-accent)] hover:brightness-110"
                )}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isBug ? gt("Submit Report") : gt("Send Feedback")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List controls */}
      {reports.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
              {KIND_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setKindFilter(t.key)}
                  className={cn(
                    "px-3.5 py-2 rounded-lg text-sm font-medium transition-all",
                    kindFilter === t.key
                      ? "bg-[var(--app-accent)] text-white"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={gt("Search your reports...")}
                className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)] transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] w-fit">
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
                  filter === t.key
                    ? "bg-[var(--app-accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                {t.label}
                <span className={cn("text-[11px] px-1.5 rounded-full tabular-nums", filter === t.key ? "bg-white/20" : "bg-[var(--bg-card)]")}>{t.count}</span>
              </button>
            ))}
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
          visibleReports.map((report) => {
            const pri = PRIORITY_META[report.priority] ?? PRIORITY_META.low;
            const st = STATUS_META[report.status] ?? STATUS_META.open;
            const StatusIcon = st.icon;
            const CatIcon = CATEGORY_ICONS[report.category] ?? HelpCircle;
            const expanded = expandedId === report.id;
            const reportIsBug = report.kind === "bug";
            return (
              <div
                key={report.id}
                className={cn(
                  "relative rounded-2xl bg-[var(--bg-app)] border overflow-hidden transition-colors",
                  expanded ? "border-[var(--app-accent)]/40" : "border-[var(--border-subtle)] hover:border-[var(--border-subtle)]/80"
                )}
              >
                {/* accent stripe — priority for bugs, accent for feedback */}
                <div className={cn("absolute left-0 top-0 bottom-0 w-1", reportIsBug ? pri.stripe : "bg-[var(--app-accent)]")} />

                <button
                  onClick={() => setExpandedId(expanded ? null : report.id)}
                  className="w-full text-left flex items-center gap-3.5 p-4 pl-5 hover:bg-[var(--bg-hover)]/40 transition-colors"
                >
                  <div className={cn(
                    "shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center",
                    reportIsBug ? "bg-orange-500/10 border-orange-500/20" : "bg-[var(--app-accent)]/10 border-[var(--app-accent)]/20"
                  )}>
                    <CatIcon className={cn("w-5 h-5", reportIsBug ? "text-orange-300" : "text-[var(--app-accent)]")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[15px] text-[var(--text-primary)] truncate">{report.title}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={cn(
                        "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold",
                        reportIsBug ? "bg-orange-500/10 text-orange-300" : "bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
                      )}>
                        {reportIsBug ? <Bug className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                        {reportIsBug ? gt("Bug") : gt("Feedback")}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {categoryLabelMap[CATEGORY_LABELS[report.category]] ?? CATEGORY_LABELS[report.category] ?? report.category}
                      </span>
                      <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium", st.bg, st.text)}>
                        <StatusIcon className="w-3 h-3" />
                        {report.status.replace("_", " ")}
                      </span>
                      {reportIsBug && (
                        <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium capitalize", pri.bg, pri.text)}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", pri.dot)} />
                          {pri.label}
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={cn("shrink-0 w-4 h-4 text-[var(--text-muted)] transition-transform", expanded && "rotate-180")} />
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-subtle)] p-5 pl-5 space-y-5 animate-in fade-in duration-150">
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
                          {report.attachments.map((att, i) => (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="relative group block rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                              {att.type === "image" ? (
                                <img src={att.url} alt={att.name} className="w-28 h-28 object-cover" />
                              ) : (
                                <div className="w-28 h-28 flex items-center justify-center bg-[var(--bg-card)]">
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
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Monitor className="w-3 h-3 text-[var(--text-muted)]" /> {report.browserInfo}
                          </span>
                        )}
                        {report.osInfo && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Cpu className="w-3 h-3 text-[var(--text-muted)]" /> {report.osInfo}
                          </span>
                        )}
                        {report.appVersion && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <Tag className="w-3 h-3 text-[var(--text-muted)]" /> v{report.appVersion}
                          </span>
                        )}
                      </div>
                    )}

                    {report.adminNotes && (
                      <div className="p-3.5 rounded-lg bg-[var(--app-accent)]/8 border border-[var(--app-accent)]/25">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-accent)] mb-1.5 flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" /> {gt("Response from the team")}
                        </p>
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{report.adminNotes}</p>
                      </div>
                    )}

                    {(report.status === "open" || report.status === "acknowledged") && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => handleDelete(report.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          {gt("Delete")}
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
