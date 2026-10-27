"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  Bot,
  Copy,
  LayoutGrid,
  List,
  LogIn,
  Plus,
  Search,
  Server,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { DevAppAvatar, DevAppStatus } from "@/components/apps/DevAppAvatar";

interface App {
  id: string;
  name: string;
  description?: string;
  icon?: string | null;
  botPublic?: boolean;
  botId?: string | null;
  botAvatar?: string | null;
  botUsername?: string | null;
  createdAt: string;
  serverCount?: number;
  verified?: boolean;
  official?: boolean;
  verificationStatus?: string | null;
}

type Sort = "recent" | "name" | "servers";
type View = "grid" | "list";

export default function ApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <Applications />
    </Suspense>
  );
}

function Applications() {
  const gt = useGT();
  const router = useRouter();
  const params = useSearchParams();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<View>("grid");
  const [creating, setCreating] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(() => params.get("new") === "1");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/developers/applications")
      .then((res) => {
        if (res.status === 401 && !cancelled) setSignedOut(true);
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!cancelled && data) setApps(data.applications || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const closeCreate = () => {
    setShowCreateModal(false);
    setNewAppName("");
    if (params.get("new")) router.replace("/developers/applications");
  };

  const handleCreate = async () => {
    if (!newAppName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/developers/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newAppName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.application?.id) {
        toast.success(gt("Application created successfully!"));
        router.push(`/developers/applications/${data.application.id}/information`);
      } else {
        toast.error(data.error || gt("Failed to create application"));
      }
    } catch {
      toast.error(gt("Failed to create application"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(gt("Are you sure you want to delete \"{name}\"? This action cannot be undone.", { name }))) return;
    try {
      const res = await fetch(`/api/developers/applications/${id}`, { method: "DELETE" });
      if (res.ok) {
        setApps((prev) => prev.filter((a) => a.id !== id));
        toast.success(gt("Application deleted successfully"));
      } else {
        toast.error(gt("Failed to delete application"));
      }
    } catch {
      toast.error(gt("Failed to delete application"));
    }
  };

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(
      () => toast.success(gt("Application ID copied")),
      () => toast.error(gt("Couldn't copy")),
    );
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.botUsername ?? "").toLowerCase().includes(q))
      : [...apps];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "servers") list.sort((a, b) => (b.serverCount ?? 0) - (a.serverCount ?? 0));
    else list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [apps, search, sort]);

  return (
    <div className="flex-1 min-h-[calc(100vh-3.5rem)] overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2.5">
              {gt("Applications")}
              {!loading && apps.length > 0 && (
                <span className="text-xs font-semibold text-[#a1a1aa] bg-white/[0.06] rounded-md px-1.5 py-0.5 tabular-nums">{apps.length}</span>
              )}
            </h1>
            <p className="text-sm text-[#949ba4] mt-1.5">
              {gt("Bots, OAuth2 apps and integrations you own. Open one to manage its bot, commands and listing.")}
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors shrink-0"
          >
            <Plus className="size-4" /> {gt("New Application")}
          </button>
        </div>

        {/* Social SDK note */}
        <Link
          href="/developers/docs/social-sdk/overview"
          className="group flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-[#8B5CF6]/20 bg-gradient-to-r from-[#8B5CF6]/[0.08] to-transparent hover:border-[#8B5CF6]/40 transition-colors"
        >
          <Sparkles className="size-4 text-[#a78bfa] shrink-0" />
          <p className="text-xs text-[#d4d4d8] flex-1 min-w-0">
            <span className="font-semibold text-white">{gt("Serika Social SDK")}</span>{" "}
            <span className="text-[#a1a1aa]">{gt("Relationships, live presence and profile widgets over the native /api/v1 API.")}</span>
          </p>
          <span className="text-xs font-medium text-[#a78bfa] shrink-0 hidden sm:inline">{gt("Learn more →")}</span>
        </Link>

        {/* Toolbar */}
        {apps.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#71717a]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={gt("Search by name, bot username or ID")}
                className="w-full h-9 bg-white/[0.03] border border-white/[0.08] rounded-lg pl-9 pr-8 text-sm text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/30 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label={gt("Clear search")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#71717a] hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <label className="relative flex items-center">
                <ArrowUpDown className="absolute left-2.5 size-3.5 text-[#71717a] pointer-events-none" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  aria-label={gt("Sort")}
                  className="h-9 appearance-none bg-white/[0.03] border border-white/[0.08] rounded-lg pl-8 pr-3 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50"
                >
                  <option value="recent">{gt("Newest first")}</option>
                  <option value="name">{gt("Name")}</option>
                  <option value="servers">{gt("Most servers")}</option>
                </select>
              </label>
              <div className="flex h-9 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5" role="group" aria-label={gt("View")}>
                {([["grid", LayoutGrid, gt("Grid view")], ["list", List, gt("List view")]] as const).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-label={label}
                    aria-pressed={view === v}
                    className={cn(
                      "px-2 rounded-md transition-colors",
                      view === v ? "bg-white/[0.1] text-white" : "text-[#71717a] hover:text-white",
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3">
            <Loader size={24} className="size-7" />
            <p className="text-xs text-[#949ba4]">{gt("Loading developer applications...")}</p>
          </div>
        ) : signedOut ? (
          <div className="text-center py-16 px-6 rounded-xl border border-dashed border-white/[0.08]">
            <div className="size-12 rounded-xl bg-[#8B5CF6]/10 text-[#a78bfa] flex items-center justify-center mx-auto mb-4">
              <LogIn className="size-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">{gt("Sign in to see your applications")}</h3>
            <p className="text-sm text-[#949ba4] max-w-sm mx-auto mb-5">
              {gt("Use your SerikaCord account to create bots and manage your apps.")}
            </p>
            <Link
              href={`/login?redirect=${encodeURIComponent("/developers/applications")}`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
            >
              <LogIn className="size-4" /> {gt("Sign in")}
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 px-6 rounded-xl border border-dashed border-white/[0.08]">
            <div className="size-12 rounded-xl bg-[#8B5CF6]/10 text-[#a78bfa] flex items-center justify-center mx-auto mb-4">
              <Bot className="size-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {apps.length === 0 ? gt("No applications yet") : gt("No results found")}
            </h3>
            <p className="text-sm text-[#949ba4] max-w-sm mx-auto mb-5">
              {apps.length === 0
                ? gt("Create your first application to get a bot user, OAuth2 credentials and slash commands.")
                : gt("No applications matched your search terms. Try searching with another name.")}
            </p>
            {apps.length === 0 && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
              >
                <Plus className="size-4" /> {gt("Create Application")}
              </button>
            )}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shown.map((app) => (
              <div
                key={app.id}
                className="group relative flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.035] hover:border-white/[0.12] transition-colors"
              >
                <Link href={`/developers/applications/${app.id}/information`} className="flex-1 p-4 rounded-t-xl">
                  <div className="flex items-start gap-3">
                    <DevAppAvatar name={app.name} icon={app.icon} botAvatar={app.botAvatar} className="size-12 text-lg" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold truncate group-hover:text-[#c4b5fd] transition-colors">{app.name}</h3>
                      <p className="text-xs text-[#71717a] truncate mt-0.5">
                        {app.botUsername ? `@${app.botUsername}` : gt("No bot user yet")}
                      </p>
                      <DevAppStatus app={app} className="mt-2" />
                    </div>
                  </div>
                  <p className="text-xs text-[#a1a1aa] line-clamp-2 mt-3 min-h-8 leading-relaxed">
                    {app.description || gt("No description provided.")}
                  </p>
                </Link>
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-white/[0.05]">
                  <span className="inline-flex items-center gap-1.5 text-xs text-[#a1a1aa] tabular-nums">
                    <Server className="size-3.5" />
                    {gt("{count} servers", { count: (app.serverCount ?? 0).toLocaleString() })}
                  </span>
                  <RowActions app={app} onCopy={copyId} onDelete={handleDelete} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_160px_100px_120px] gap-4 px-4 py-2.5 bg-white/[0.02] border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
              <span>{gt("Application")}</span>
              <span>{gt("Status")}</span>
              <span className="text-right">{gt("Servers")}</span>
              <span />
            </div>
            <ul className="divide-y divide-white/[0.05]">
              {shown.map((app) => (
                <li key={app.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_160px_100px_120px] items-center gap-4 px-4 py-3 hover:bg-white/[0.025] transition-colors">
                  <Link href={`/developers/applications/${app.id}/information`} className="flex items-center gap-3 min-w-0">
                    <DevAppAvatar name={app.name} icon={app.icon} botAvatar={app.botAvatar} className="size-9 text-sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate hover:text-[#c4b5fd] transition-colors">{app.name}</p>
                      <p className="text-xs text-[#71717a] truncate">
                        {app.botUsername ? `@${app.botUsername}` : gt("No bot user yet")}
                      </p>
                    </div>
                  </Link>
                  <DevAppStatus app={app} className="hidden md:flex" />
                  <span className="hidden md:block text-sm text-right tabular-nums">{(app.serverCount ?? 0).toLocaleString()}</span>
                  <RowActions app={app} onCopy={copyId} onDelete={handleDelete} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeCreate(); }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="create-app-title" className="w-full max-w-md bg-[#111113] border border-white/[0.08] rounded-2xl shadow-2xl">
            <div className="flex items-start justify-between gap-3 p-5 pb-0">
              <div>
                <h2 id="create-app-title" className="text-lg font-bold text-white">{gt("Create Application")}</h2>
                <p className="text-xs text-[#949ba4] mt-1">
                  {gt("Name your application. You can change it, add an icon and create its bot user next.")}
                </p>
              </div>
              <button onClick={closeCreate} aria-label={gt("Close")} className="p-1 rounded-md text-[#71717a] hover:text-white hover:bg-white/[0.06]">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label htmlFor="new-app-name" className="block text-xs font-semibold text-[#d4d4d8] mb-1.5">{gt("Name")}</label>
                <input
                  id="new-app-name"
                  type="text"
                  value={newAppName}
                  maxLength={32}
                  onChange={(e) => setNewAppName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") closeCreate();
                  }}
                  placeholder={gt("My Awesome Bot")}
                  className="w-full h-10 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 text-sm text-white placeholder:text-[#52525b] focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/30 transition-colors"
                  autoFocus
                />
                <p className="text-[11px] text-[#71717a] mt-1.5 text-right tabular-nums">{newAppName.length}/32</p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={closeCreate}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-sm font-medium text-white transition-colors"
                >
                  {gt("Cancel")}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newAppName.trim()}
                  className="h-9 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-sm font-semibold text-white transition-colors inline-flex items-center gap-2"
                >
                  {creating ? <Loader size={24} className="size-3.5" /> : <Plus className="size-3.5" />}
                  {gt("Create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowActions({
  app,
  onCopy,
  onDelete,
}: {
  app: App;
  onCopy: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const gt = useGT();
  const btn = "p-1.5 rounded-md text-[#71717a] hover:text-white hover:bg-white/[0.07] transition-colors";
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button onClick={() => onCopy(app.id)} className={btn} title={gt("Copy application ID")} aria-label={gt("Copy application ID")}>
        <Copy className="size-4" />
      </button>
      <Link href={`/developers/applications/${app.id}/information`} className={btn} title={gt("Settings")} aria-label={gt("Settings")}>
        <Settings className="size-4" />
      </Link>
      <button
        onClick={() => onDelete(app.id, app.name)}
        className={cn(btn, "hover:text-red-400 hover:bg-red-500/10")}
        title={gt("Delete Application")}
        aria-label={gt("Delete Application")}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
