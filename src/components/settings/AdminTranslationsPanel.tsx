"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Languages,
  RefreshCw,
  Upload,
  Download,
  Search, 
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface LocaleStat {
  locale: string;
  total: number;
  translated: number;
  completion: number;
}

interface ActivityEntry {
  id: string;
  action: string;
  user?: { username?: string; displayName?: string };
  target?: string;
  createdAt: string;
}

interface KeyEntry {
  key: string;
  sourceText: string;
  description?: string;
}

type SubTab = "overview" | "keys" | "activity";

export function AdminTranslationsPanel() {
  const gt = useGT();
  const [subTab, setSubTab] = useState<SubTab>("overview");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<LocaleStat[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [keySearch, setKeySearch] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/translate/stats`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data.locales || []);
    } catch {
      toast.error(gt("Failed to load translation stats"));
    } finally {
      setLoading(false);
    }
  }, [gt]);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/translate/activity?limit=30`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      const data = await res.json();
      setActivity(data.activity || []);
    } catch {
      toast.error(gt("Failed to load activity log"));
    }
  }, [gt]);

  const fetchKeys = useCallback(
    async (search?: string) => {
      setKeysLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search) params.set("search", search);
        const res = await fetch(`/api/admin/translate/keys?${params}`);
        if (!res.ok) throw new Error("Failed to fetch keys");
        const data = await res.json();
        setKeys(data.keys || []);
      } catch {
        toast.error(gt("Failed to load translation keys"));
      } finally {
        setKeysLoading(false);
      }
    },
    [gt]
  );

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (subTab === "activity" && activity.length === 0) {
      fetchActivity();
    }
    if (subTab === "keys" && keys.length === 0) {
      fetchKeys();
    }
  }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/translate/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sync failed");
      }
      const data = await res.json();
      toast.success(
        gt("Sync complete: {updated} updated, {new} new", {
          updated: data.updated || 0,
          new: data.newLocales || 0,
        })
      );
      await fetchStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Sync failed"));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePush = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/translate/push", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Push failed");
      }
      const data = await res.json();
      toast.success(gt("Pushed {count} source strings", { count: data.pushed || 0 }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Push failed"));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePull = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/translate/pull", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Pull failed");
      }
      const data = await res.json();
      toast.success(
        gt("Pull complete: {updated} updated, {new} new", {
          updated: data.updated || 0,
          new: data.newLocales || 0,
        })
      );
      await fetchStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Pull failed"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleKeySearch = () => {
    fetchKeys(keySearch.trim() || undefined);
  };

  const sortedStats = useMemo(
    () => [...stats].sort((a, b) => b.completion - a.completion),
    [stats]
  );

  const overallCompletion = useMemo(() => {
    if (stats.length === 0) return 0;
    const total = stats.reduce((sum, s) => s.total, 0);
    const translated = stats.reduce((sum, s) => s.translated, 0);
    return total > 0 ? Math.round((translated / total) * 100) : 0;
  }, [stats]);

  const fullyTranslated = stats.filter((s) => s.completion === 100).length;
  const startedLocales = stats.filter((s) => s.completion > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Languages className="w-6 h-6 text-[#8B5CF6]" />
            {gt("Translation Management")}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {gt("Crowd-source translations via translate.serika.dev and sync with GT files.")}
          </p>
        </div>
        <a
          href="https://translate.serika.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-[#8B5CF6] hover:text-[#a78bfa] transition-colors"
        >
          {gt("Open Translate Platform")}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-[var(--bg-app)] rounded-lg w-fit">
        {(
          [
            { id: "overview" as SubTab, label: gt("Overview") },
            { id: "keys" as SubTab, label: gt("Keys") },
            { id: "activity" as SubTab, label: gt("Activity") },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              subTab === tab.id
                ? "bg-[#8B5CF6] text-white"
                : "text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-hover)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {subTab === "overview" && (
        <div className="space-y-6">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSync}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {actionLoading ? <Loader size={16} /> : <RefreshCw className="w-4 h-4" />}
              {gt("Full Sync")}
            </button>
            <button
              onClick={handlePush}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-all border border-[var(--border-color)]"
            >
              {actionLoading ? <Loader size={16} /> : <Upload className="w-4 h-4" />}
              {gt("Push Source")}
            </button>
            <button
              onClick={handlePull}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-all border border-[var(--border-color)]"
            >
              {actionLoading ? <Loader size={16} /> : <Download className="w-4 h-4" />}
              {gt("Pull Translations")}
            </button>
          </div>

          {/* Summary cards */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader size={24} />
            </div>
          ) : stats.length === 0 ? (
            <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
              <AlertCircle className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-secondary)] mb-2">{gt("No translation data yet.")}</p>
              <p className="text-sm text-[var(--text-muted)]">
                {gt("Push source strings to populate the platform, then crowd-source translations.")}
              </p>
            </div>
          ) : (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center border border-[var(--border-subtle)]">
                  <p className="text-2xl font-bold text-white">{stats.length}</p>
                  <p className="text-sm text-[var(--text-muted)]">{gt("Total Locales")}</p>
                </div>
                <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center border border-[var(--border-subtle)]">
                  <p className="text-2xl font-bold text-green-400">{fullyTranslated}</p>
                  <p className="text-sm text-[var(--text-muted)]">{gt("Fully Translated")}</p>
                </div>
                <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center border border-[var(--border-subtle)]">
                  <p className="text-2xl font-bold text-[#8B5CF6]">{startedLocales}</p>
                  <p className="text-sm text-[var(--text-muted)]">{gt("In Progress")}</p>
                </div>
                <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center border border-[var(--border-subtle)]">
                  <p className="text-2xl font-bold text-white">{overallCompletion}%</p>
                  <p className="text-sm text-[var(--text-muted)]">{gt("Overall Completion")}</p>
                </div>
              </div>

              {/* Overall progress bar */}
              <div className="bg-[var(--bg-app)] rounded-lg p-4 border border-[var(--border-subtle)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{gt("Overall Progress")}</span>
                  <span className="text-sm text-[var(--text-muted)]">{overallCompletion}%</span>
                </div>
                <div className="h-2 bg-[var(--bg-card)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#a78bfa] rounded-full transition-all duration-500"
                    style={{ width: `${overallCompletion}%` }}
                  />
                </div>
              </div>

              {/* Locale list */}
              <div className="bg-[var(--bg-app)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
                  <h3 className="text-sm font-semibold text-white">{gt("Per-Locale Progress")}</h3>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  {sortedStats.map((stat) => (
                    <div
                      key={stat.locale}
                      className="px-4 py-3 border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{stat.locale}</span>
                          {stat.completion === 100 && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                          )}
                        </div>
                        <span className="text-xs text-[var(--text-muted)]">
                          {stat.translated}/{stat.total} ({stat.completion}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-card)] rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            stat.completion === 100
                              ? "bg-green-500"
                              : stat.completion > 50
                                ? "bg-[#8B5CF6]"
                                : stat.completion > 0
                                  ? "bg-yellow-500"
                                  : "bg-[var(--border-subtle)]"
                          )}
                          style={{ width: `${stat.completion}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Keys Tab */}
      {subTab === "keys" && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleKeySearch()}
                placeholder={gt("Search translation keys...")}
                className="w-full pl-10 pr-3 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-white text-sm focus:border-[#8B5CF6] outline-none"
              />
            </div>
            <button
              onClick={handleKeySearch}
              disabled={keysLoading}
              className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2"
            >
              {keysLoading ? <Loader size={16} /> : <Search className="w-4 h-4" />}
              {gt("Search")}
            </button>
          </div>

          {/* Keys list */}
          {keysLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader size={24} />
            </div>
          ) : keys.length === 0 ? (
            <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
              <p className="text-[var(--text-muted)]">{gt("No keys found. Try searching or push source strings first.")}</p>
            </div>
          ) : (
            <div className="bg-[var(--bg-app)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {gt("{count} keys", { count: keys.length })}
                </span>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                {keys.map((key) => (
                  <div
                    key={key.key}
                    className="px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <code className="text-xs text-[#8B5CF6] font-mono">{key.key}</code>
                        <p className="text-sm text-white mt-0.5 truncate">
                          {key.sourceText || gt("(empty)")}
                        </p>
                        {key.description && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">{key.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {subTab === "activity" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{gt("Recent Activity")}</h3>
            <button
              onClick={() => fetchActivity()}
              className="text-xs text-[#8B5CF6] hover:text-[#a78bfa] flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              {gt("Refresh")}
            </button>
          </div>

          {activity.length === 0 ? (
            <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
              <p className="text-[var(--text-muted)]">{gt("No recent activity.")}</p>
            </div>
          ) : (
            <div className="bg-[var(--bg-app)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <div className="max-h-[500px] overflow-y-auto">
                {activity.map((entry, i) => (
                  <div
                    key={entry.id || i}
                    className="px-4 py-3 border-b border-[var(--border-subtle)] last:border-0 flex items-start gap-3"
                  >
                    <div className="w-2 h-2 rounded-full bg-[#8B5CF6] mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">
                          {entry.user?.displayName || entry.user?.username || gt("Unknown")}
                        </span>
                        <span className="text-sm text-[var(--text-secondary)]">{entry.action}</span>
                      </div>
                      {entry.target && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{entry.target}</p>
                      )}
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
