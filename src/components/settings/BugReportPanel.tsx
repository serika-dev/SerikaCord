"use client";

import { useState, useCallback, useEffect } from "react";
import { Bug, Send, Trash2, ChevronDown, ChevronRight, Paperclip, X, Image as ImageIcon, Video, Loader2 } from "lucide-react";
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

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-blue-500/20 text-blue-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  high: "bg-orange-500/20 text-orange-400",
  critical: "bg-red-500/20 text-red-400",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-500/20 text-green-400",
  acknowledged: "bg-yellow-500/20 text-yellow-400",
  resolved: "bg-blue-500/20 text-blue-400",
  wont_fix: "bg-gray-500/20 text-gray-400",
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

  const handleFileUpload = async (files: FileList) => {
    setUploadingFile(true);
    try {
      for (const file of Array.from(files)) {
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
          setAttachments(prev => [...prev, {
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
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategory("other");
    setStepsToReproduce("");
    setExpectedBehavior("");
    setActualBehavior("");
    setAttachments([]);
    setShowForm(false);
  };

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

  return (
    <div>
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1 flex items-center gap-2">
        <Bug className="w-6 h-6 text-[var(--app-accent)]" />
        {gt("Bug Reports")}
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        {gt("Report bugs you've encountered. Help us improve SerikaCord.")}
      </p>

      {/* Submit button / form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full mb-6 p-4 rounded-lg bg-[var(--bg-app)] border border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all flex items-center justify-center gap-2 text-sm font-medium"
        >
          <Bug className="w-5 h-5" />
          {gt("Report a Bug")}
        </button>
      ) : (
        <div className="mb-6 p-4 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Bug className="w-4 h-4 text-[var(--app-accent)]" />
              {gt("New Bug Report")}
            </h3>
            <button
              onClick={resetForm}
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              {gt("Title")} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={gt("Brief summary of the bug")}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{title.length}/200</p>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              {gt("Category")}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm"
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{categoryLabelMap[c.label] ?? c.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              {gt("Description")} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={4}
              placeholder={gt("Detailed description of the bug. What happened? When did it happen?")}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] resize-y"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{description.length}/5000</p>
          </div>

          {/* Steps to Reproduce */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              {gt("Steps to Reproduce")}
            </label>
            <textarea
              value={stepsToReproduce}
              onChange={(e) => setStepsToReproduce(e.target.value)}
              rows={4}
              placeholder={"1. Go to...\n2. Click on...\n3. See error..."}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] resize-y font-mono"
            />
          </div>

          {/* Expected vs Actual */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                {gt("Expected Behavior")}
              </label>
              <textarea
                value={expectedBehavior}
                onChange={(e) => setExpectedBehavior(e.target.value)}
                rows={2}
                placeholder={gt("What should have happened?")}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                {gt("Actual Behavior")}
              </label>
              <textarea
                value={actualBehavior}
                onChange={(e) => setActualBehavior(e.target.value)}
                rows={2}
                placeholder={gt("What actually happened?")}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] resize-y"
              />
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              {gt("Attachments (Screenshots / Videos)")}
            </label>
            <div className="space-y-2">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative group rounded-md overflow-hidden border border-[var(--border-subtle)]">
                      {att.type === "image" ? (
                        <img src={att.url} alt={att.name} className="w-20 h-20 object-cover" />
                      ) : (
                        <div className="w-20 h-20 flex items-center justify-center bg-[var(--bg-card)]">
                          <Video className="w-8 h-8 text-[var(--text-secondary)]" />
                        </div>
                      )}
                      <button
                        onClick={() => handleRemoveAttachment(i)}
                        className="absolute top-0 right-0 p-1 bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <p className="text-[9px] text-[var(--text-muted)] truncate px-1 bg-[var(--bg-app)]">{att.name}</p>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 w-full p-3 rounded-md border border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                {uploadingFile ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {gt("Uploading...")}</>
                ) : (
                  <><Paperclip className="w-4 h-4" /> {gt("Attach image or video (max 25MB)")}</>
                )}
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  disabled={uploadingFile}
                />
              </label>
            </div>
          </div>

          {/* Environment info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                {gt("Browser")}
              </label>
              <input
                type="text"
                value={browserInfo}
                onChange={(e) => setBrowserInfo(e.target.value)}
                placeholder={gt("Auto-detected")}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                {gt("OS")}
              </label>
              <input
                type="text"
                value={osInfo}
                onChange={(e) => setOsInfo(e.target.value)}
                placeholder={gt("Auto-detected")}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                {gt("App Version")}
              </label>
              <input
                type="text"
                value={appVersion}
                onChange={(e) => setAppVersion(e.target.value)}
                placeholder={gt("Version")}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-[var(--text-muted)]">
              {gt("Priority is set to Low by default. Admins may adjust it.")}
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !description.trim()}
              className="px-4 py-2 bg-[var(--app-accent)] hover:brightness-110 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-all flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {gt("Submit Report")}
            </button>
          </div>
        </div>
      )}

      {/* Reports list */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{gt("Your Bug Reports")}</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader size={24} />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)] text-sm">
            <Bug className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {gt("No bug reports yet. Click \"Report a Bug\" to submit one.")}
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <div
                key={report.id}
                className="rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-hidden"
              >
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
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold", PRIORITY_COLORS[report.priority])}>
                          {report.priority}
                        </span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold", STATUS_COLORS[report.status])}>
                          {report.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {new Date(report.createdAt).toLocaleDateString()} · {report.category.replace("_", " ")}
                      </p>
                    </div>
                  </div>
                  {(report.status === "open" || report.status === "acknowledged") && (
                    <button
                      onClick={() => handleDelete(report.id)}
                      className="p-2 rounded-md hover:bg-red-500/10 text-red-400 transition-colors ml-2"
                      title={gt("Delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {expandedId === report.id && (
                  <div className="border-t border-[var(--border-subtle)] p-3 space-y-3">
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

                    {report.attachments && report.attachments.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Attachments")}</p>
                        <div className="flex flex-wrap gap-2">
                          {report.attachments.map((att, i) => (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                              {att.type === "image" ? (
                                <img src={att.url} alt={att.name} className="w-24 h-24 object-cover rounded-md border border-[var(--border-subtle)]" />
                              ) : (
                                <div className="w-24 h-24 flex items-center justify-center bg-[var(--bg-card)] rounded-md border border-[var(--border-subtle)]">
                                  <Video className="w-8 h-8 text-[var(--text-secondary)]" />
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {report.browserInfo && (
                        <div>
                          <span className="text-[var(--text-muted)]">{gt("Browser")}: </span>
                          <span className="text-[var(--text-secondary)]">{report.browserInfo}</span>
                        </div>
                      )}
                      {report.osInfo && (
                        <div>
                          <span className="text-[var(--text-muted)]">{gt("OS")}: </span>
                          <span className="text-[var(--text-secondary)]">{report.osInfo}</span>
                        </div>
                      )}
                      {report.appVersion && (
                        <div>
                          <span className="text-[var(--text-muted)]">{gt("Version")}: </span>
                          <span className="text-[var(--text-secondary)]">{report.appVersion}</span>
                        </div>
                      )}
                    </div>

                    {report.adminNotes && (
                      <div className="p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                        <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">{gt("Admin Notes")}</p>
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{report.adminNotes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
