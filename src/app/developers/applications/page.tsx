"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Settings, Trash2, Bot, Loader2, Code, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface App {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  botPublic?: boolean;
  botId?: string;
  createdAt: string;
  serverCount?: number;
  verified?: boolean;
}

export default function ApplicationsPage() {
  const gt = useGT();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchApps();
  }, []);

  const fetchApps = async () => {
    try {
      const res = await fetch("/api/developers/applications");
      if (res.ok) {
        const data = await res.json();
        setApps(data.applications || []);
      }
    } catch {
      // Demo mode
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newAppName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/developers/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newAppName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(gt("Application created successfully!"));
        setApps([...apps, data.application]);
        setNewAppName("");
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        toast.error(err.error || gt("Failed to create application"));
      }
    } catch {
      toast.error(gt("Failed to create application"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(gt("Are you sure you want to delete \"{name}\"? This action cannot be undone.", { name })))
      return;
    try {
      const res = await fetch(`/api/developers/applications/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setApps(apps.filter((a) => a.id !== id));
        toast.success(gt("Application deleted successfully"));
      } else {
        toast.error(gt("Failed to delete application"));
      }
    } catch {
      toast.error(gt("Failed to delete application"));
    }
  };

  const filtered = apps.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 min-h-[calc(100vh-3.5rem)] bg-[#070708] relative overflow-y-auto">
      {/* Background Decorative Orbs */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-pink-600/5 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10 pb-6 border-b border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#8b5cf6]/80">{gt("Developer Portal")}</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-[#e3e5e8] to-[#949ba4] bg-clip-text text-transparent">
              {gt("Applications")}
            </h1>
            <p className="text-xs md:text-sm text-[#949ba4] mt-1 font-medium max-w-xl">
              {gt("Develop powerful bots, manage rich activities, and integrate tools with SerikaCord's API.")}
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#6D28D9] text-white text-sm font-semibold rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all hover:scale-[1.01] active:scale-[0.99] shrink-0"
          >
            <Plus className="size-4" /> {gt("New Application")}
          </button>
        </div>

        {/* Search */}
        {apps.length > 0 && (
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-[#888888]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search applications by name...")}
              className="w-full bg-[#0d0d0e]/60 backdrop-blur-md border border-white/[0.08] rounded-xl pl-11 pr-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/20 transition-all shadow-inner"
            />
          </div>
        )}

        {/* Applications List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Loader2 className="size-8 animate-spin text-[#8B5CF6]" />
            <p className="text-xs text-[#888] font-medium animate-pulse">{gt("Loading developer applications...")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 rounded-2xl border border-white/[0.04] bg-white/[0.01] backdrop-blur-sm p-8 animate-fade-in">
            <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/10 to-[#6366f1]/10 border border-white/[0.06] flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(139,92,246,0.1)]">
              <Bot className="size-8 text-[#8B5CF6]" />
            </div>
            <h3 className="text-lg font-bold text-white/95 mb-1.5">
              {apps.length === 0 ? gt("No applications yet") : gt("No results found")}
            </h3>
            <p className="text-xs md:text-sm text-[#777] max-w-sm mx-auto mb-6 leading-relaxed">
              {apps.length === 0
                ? gt("Create your first application to gain access to bot users, oauth2 credentials, and activity SDK configurations.")
                : gt("No applications matched your search terms. Try searching with another name.")}
            </p>
            {apps.length === 0 && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.2)] transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                <Plus className="size-4" /> {gt("Create Application")}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
            {filtered.map((app) => (
              <div
                key={app.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-[#0d0d0e]/60 backdrop-blur-md hover:bg-white/[0.03] hover:border-purple-500/30 hover:shadow-[0_0_30px_rgba(139,92,246,0.08)] transition-all duration-300 p-5 hover:-translate-y-0.5 overflow-hidden"
              >
                {/* Accent glow on top-right card corner */}
                <div className="absolute -top-10 -right-10 w-20 h-20 bg-purple-500/10 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />

                <div>
                  <div className="flex items-start gap-4 mb-4">
                    <div className="size-12 rounded-2xl bg-gradient-to-tr from-[#8B5CF6]/10 to-[#6366f1]/10 border border-white/[0.08] flex items-center justify-center shrink-0 overflow-hidden shadow-md">
                      {app.icon ? (
                        <img src={app.icon} alt="" className="size-full object-cover" />
                      ) : (
                        <img 
                          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(app.name)}`} 
                          alt="" 
                          className="size-full object-cover" 
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-white group-hover:text-[#8B5CF6] transition-colors truncate">
                          {app.name}
                        </h3>
                        {app.verified && (
                          <span className="text-[8px] bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-1 py-0.5 rounded font-extrabold shrink-0 tracking-wider">
                            ✓ VERIFIED
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[#555] truncate mt-1">ID: {app.id}</p>
                    </div>
                  </div>

                  <p className="text-xs text-[#888888] line-clamp-2 mb-4 leading-relaxed h-8">
                    {app.description || gt("No description provided.")}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/[0.04] mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555] bg-white/[0.03] border border-white/[0.04] px-2.5 py-1 rounded-lg">
                    {app.serverCount !== undefined ? gt("{count} Servers", { count: app.serverCount }) : gt("0 Servers")}
                  </span>
                  
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/developers/applications/${app.id}/information`}
                      className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.08] text-[#888] hover:text-white transition-all shadow-sm"
                      title={gt("Settings")}
                    >
                      <Settings className="size-4" />
                    </Link>
                    <button
                      onClick={() => handleDelete(app.id, app.name)}
                      className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-red-500/10 hover:border-red-500/20 text-[#888] hover:text-red-400 transition-all shadow-sm"
                      title={gt("Delete Application")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#0d0d0e] border border-white/[0.08] rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-500/10 rounded-full blur-2xl" />
            
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#8B5CF6]">
                <Code className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{gt("Create Application")}</h2>
                <p className="text-xs text-[#888]">{gt("Initialize a new developer client")}</p>
              </div>
            </div>

            <p className="text-xs text-[#888] mb-5 leading-relaxed">
              {gt("Give your new application a name. This name will represent your bot and presence activities across the platform. You can customize descriptions and avatars later.")}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold tracking-wider text-[#555] mb-2">{gt("Name *")}</label>
                <input
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="My Awesome Bot"
                  className="w-full bg-[#151517] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#444] focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/20 transition-all shadow-inner"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowCreateModal(false); setNewAppName(""); }}
                  className="flex-1 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white text-xs font-semibold rounded-xl transition-all"
                >
                  {gt("Cancel")}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newAppName.trim()}
                  className="flex-1 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-xs font-semibold rounded-xl shadow-lg shadow-[#8B5CF6]/20 transition-all flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
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
