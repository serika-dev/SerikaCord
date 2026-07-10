"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Loader2, Users, Plus, Crown, Shield, User, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";

interface TeamMember {
  id: string;
  username: string;
  avatar?: string;
  role: "owner" | "admin" | "developer" | "viewer";
}

export default function TeamPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading } = useApplication(appId);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("developer");

  useEffect(() => {
    fetchMembers();
  }, [appId]);

  const fetchMembers = async () => {
    try {
      const res = await fetch(`/api/developers/applications/${appId}/team`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch {
      // ignore
    }
  };

  const handleInvite = async () => {
    if (!inviteUsername.trim()) return;
    try {
      const res = await fetch(`/api/developers/applications/${appId}/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim(), role: inviteRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setMembers([...members, data.member]);
        setInviteUsername("");
        setShowInvite(false);
        toast.success(gt("Team member invited!"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to invite member"));
      }
    } catch {
      toast.error(gt("Failed to invite member"));
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(gt("Remove this team member?"))) return;
    try {
      const res = await fetch(`/api/developers/applications/${appId}/team/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMembers(members.filter((m) => m.id !== id));
        toast.success(gt("Member removed"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to remove member"));
      }
    } catch {
      toast.error(gt("Failed to remove member"));
    }
  };

  const roleIcons = {
    owner: Crown,
    admin: Shield,
    developer: User,
    viewer: User,
  };

  const roleColors = {
    owner: "text-yellow-400",
    admin: "text-red-400",
    developer: "text-blue-400",
    viewer: "text-[#888]",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{gt("Team")}</h1>
          <p className="text-sm text-[#888] mt-1">
            {gt("Manage who has access to this application.")}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus className="size-4" /> {gt("Add Member")}
        </button>
      </div>

      {showInvite && (
        <div className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
              {gt("Username")}
            </label>
            <input
              type="text"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="username"
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
              {gt("Role")}
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamMember["role"])}
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50"
            >
              <option value="developer">{gt("Developer")}</option>
              <option value="admin">{gt("Admin")}</option>
              <option value="viewer">{gt("Viewer")}</option>
            </select>
          </div>
          <button
            onClick={handleInvite}
            disabled={!inviteUsername.trim()}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-md transition-colors"
          >
            {gt("Send Invite")}
          </button>
        </div>
      )}

      {members.length === 0 ? (
        <div className="text-center py-20">
          <Users className="size-12 text-[#333] mx-auto mb-4" />
          <p className="text-[#888] text-sm">{gt("No team members yet. Invite someone to collaborate.")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const RoleIcon = roleIcons[member.role];
            return (
              <div
                key={member.id}
                className="group flex items-center gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="size-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#6366f1] flex items-center justify-center shrink-0">
                  {member.avatar ? (
                    <img src={member.avatar} alt="" className="size-10 rounded-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-white">
                      {member.username[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm">{member.username}</h3>
                  <div className={`flex items-center gap-1.5 text-xs ${roleColors[member.role]}`}>
                    <RoleIcon className="size-3" />
                    <span className="capitalize">{member.role === 'owner' ? gt('Owner') : member.role === 'admin' ? gt('Admin') : member.role === 'developer' ? gt('Developer') : member.role}</span>
                  </div>
                </div>
                {member.role !== "owner" && (
                  <button
                    onClick={() => handleRemove(member.id)}
                    className="p-2 rounded-md hover:bg-red-500/10 text-[#888] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
