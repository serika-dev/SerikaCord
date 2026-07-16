"use client";

import { useState, useEffect } from "react";
import { cdnImage } from "@/lib/utils";
import { Plus, Users, Trash2, Crown, Shield, User,  Search } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface Team {
  id: string;
  name: string;
  icon?: string;
  ownerUsername: string;
  memberCount: number;
  appCount: number;
  createdAt: string;
}

interface TeamMember {
  id: string;
  username: string;
  avatar?: string;
  role: "owner" | "admin" | "developer" | "viewer";
}

export default function TeamsPage() {
  const gt = useGT();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    try {
      const res = await fetch("/api/developers/teams");
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
      }
    } catch {
      // Demo mode
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTeamName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/developers/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setTeams([...teams, data.team]);
        setNewTeamName("");
        setShowCreate(false);
        toast.success(gt("Team created!"));
      } else {
        toast.error(gt("Failed to create team"));
      }
    } catch {
      toast.error(gt("Failed to create team"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(gt("Are you sure you want to delete team \"{name}\"? This cannot be undone.", { name }))) return;
    try {
      const res = await fetch(`/api/developers/teams/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTeams(teams.filter((t) => t.id !== id));
        toast.success(gt("Team deleted"));
      }
    } catch {
      toast.error(gt("Failed to delete team"));
    }
  };

  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{gt("Teams")}</h1>
            <p className="text-sm text-[#949ba4] mt-1">
              {gt("Teams let apps be managed by a group of people working together.")}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-lg transition-colors shrink-0"
          >
            <Plus className="size-4" /> {gt("New Team")}
          </button>
        </div>

        {/* Create Team */}
        {showCreate && (
          <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
            <h2 className="text-base font-semibold mb-1">{gt("Create a New Team")}</h2>
            <p className="text-sm text-[#949ba4] mb-4">
              {gt("Teams allow multiple developers to share access to applications.")}
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder={gt("Team Name")}
                maxLength={100}
                className="flex-1 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
                autoFocus
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTeamName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creating ? <Loader size={24} className="size-4" /> : <Plus className="size-4" />}
                {gt("Create")}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewTeamName(""); }}
                className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-sm font-medium rounded-lg transition-colors"
              >
                {gt("Cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        {teams.length > 0 && (
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#555]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search teams...")}
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
            />
          </div>
        )}

        {/* Teams List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader size={24} className="size-6" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="size-16 rounded-2xl bg-gradient-to-br from-[#5865F2]/20 to-[#8B5CF6]/20 flex items-center justify-center mx-auto mb-4">
              <Users className="size-8 text-[#5865F2]" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {teams.length === 0 ? gt("No teams yet") : gt("No results found")}
            </h3>
            <p className="text-sm text-[#777] max-w-sm mx-auto">
              {teams.length === 0
                ? gt("Create a team to collaboratively manage applications with other developers.")
                : gt("Try a different search term.")}
            </p>
            {teams.length === 0 && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="size-4" /> {gt("Create Team")}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((team) => (
              <div
                key={team.id}
                className="group flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-4 transition-all"
              >
                <div className="size-12 rounded-xl bg-gradient-to-br from-[#5865F2] to-[#8B5CF6] flex items-center justify-center shrink-0 overflow-hidden">
                  {team.icon ? (
                    <img src={cdnImage(team.icon)} alt="" className="size-12 rounded-xl object-cover" />
                  ) : (
                    <Users className="size-6 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">{team.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-[#777] mt-0.5">
                    <span className="flex items-center gap-1">
                      <Crown className="size-3" /> {team.ownerUsername}
                    </span>
                    <span>{gt("{count} members", { count: team.memberCount })}</span>
                    <span>{gt("{count} apps", { count: team.appCount })}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(team.id, team.name)}
                  className="p-2 rounded-md hover:bg-red-500/10 text-[#888] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Info Box */}
        <div className="mt-8 rounded-xl border border-[#8B5CF6]/15 bg-[#8B5CF6]/[0.04] p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="size-4 text-[#8B5CF6]" /> {gt("About Developer Teams")}
          </h3>
          <ul className="text-[13px] text-[#949ba4] space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-[#8B5CF6] mt-0.5">•</span>
              {gt("Teams let multiple developers collaboratively manage applications")}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#8B5CF6] mt-0.5">•</span>
              {gt("Team owners can invite members with different roles (Admin, Developer, Viewer)")}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#8B5CF6] mt-0.5">•</span>
              {gt("Applications can be transferred between personal accounts and teams")}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#8B5CF6] mt-0.5">•</span>
              {gt("Verified bots in 100+ servers must be owned by a verified team or individual")}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
