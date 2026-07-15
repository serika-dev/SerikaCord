"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { FlaskConical, Plus, Trash2, Play, Pause, ChevronDown, ChevronRight, UserPlus, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface Experiment {
  id: string;
  name: string;
  key: string;
  description?: string;
  type: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  rolloutPercentage: number;
  createdAt: string;
}

interface ManagedUser {
  id: string;
  username: string;
  displayName?: string | null;
  status: "included" | "excluded";
  variantId: string | null;
}

export function AdminExperimentsPanel() {
  const gt = useGT();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRollout, setNewRollout] = useState(100);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [userAction, setUserAction] = useState<"include" | "exclude">("include");
  const [addingUser, setAddingUser] = useState(false);

  const fetchExperiments = async () => {
    try {
      const res = await fetch("/api/admin/experiments?status=running,paused,draft,archived&limit=100");
      if (!res.ok) throw new Error("Failed to fetch experiments");
      const data = await res.json();
      setExperiments(data.experiments || []);
    } catch (err) {
      console.error("Failed to load experiments", err);
      toast.error(gt("Failed to load experiments"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExperiments();
  }, []);

  const activeExperiments = useMemo(
    () => experiments.filter((e) => e.status === "running" || e.status === "paused"),
    [experiments]
  );
  const inactiveExperiments = useMemo(
    () => experiments.filter((e) => e.status === "draft" || e.status === "archived" || e.status === "completed"),
    [experiments]
  );

  const handleToggleStatus = async (experiment: Experiment) => {
    const next = experiment.status === "running" ? "paused" : "running";
    try {
      const res = await fetch(`/api/admin/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed to update experiment");
      toast.success(gt("Experiment {status}", { status: next }));
      await fetchExperiments();
    } catch (err) {
      toast.error(gt("Failed to update experiment"));
      console.error(err);
    }
  };

  const handleDelete = async (experiment: Experiment) => {
    if (!confirm(gt("Delete experiment \"{name}\"?", { name: experiment.name }))) return;
    try {
      const res = await fetch(`/api/admin/experiments/${experiment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete experiment");
      toast.success(gt("Experiment deleted"));
      await fetchExperiments();
    } catch (err) {
      toast.error(gt("Failed to delete experiment"));
      console.error(err);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newKey.trim()) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          key: newKey.trim(),
          description: newDescription.trim() || undefined,
          type: "feature_flag",
          rolloutPercentage: newRollout,
          variants: [
            { id: "control", name: "Control", weight: 100 - newRollout },
            { id: "enabled", name: "Enabled", weight: newRollout },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create experiment");
      }
      toast.success(gt("Experiment created"));
      setNewName("");
      setNewKey("");
      setNewDescription("");
      setNewRollout(100);
      await fetchExperiments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to create experiment"));
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveInactive = async () => {
    if (!confirm(gt("Delete {count} inactive experiments? This cannot be undone.", { count: inactiveExperiments.length }))) return;
    await Promise.all(
      inactiveExperiments.map((exp) =>
        fetch(`/api/admin/experiments/${exp.id}`, { method: "DELETE" }).catch(console.error)
      )
    );
    toast.success(gt("Inactive experiments removed"));
    await fetchExperiments();
  };

  const fetchManagedUsers = useCallback(async (experimentId: string) => {
    setUsersLoading(true);
    try {
      const res = await fetch(`/api/admin/experiments/${experimentId}/users`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setManagedUsers(data.users || []);
    } catch (err) {
      console.error("Failed to load managed users", err);
      toast.error(gt("Failed to load users"));
      setManagedUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, [gt]);

  const handleToggleExpand = (experimentId: string) => {
    if (expandedId === experimentId) {
      setExpandedId(null);
      setManagedUsers([]);
    } else {
      setExpandedId(experimentId);
      fetchManagedUsers(experimentId);
    }
  };

  const handleAddUser = async (experimentId: string) => {
    if (!userInput.trim()) return;
    setAddingUser(true);
    try {
      const res = await fetch(`/api/admin/experiments/${experimentId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userInput.trim(), action: userAction }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add user");
      }
      toast.success(gt("User {action}", { action: userAction === "include" ? "added to experiment" : "excluded from experiment" }));
      setUserInput("");
      await fetchManagedUsers(experimentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to add user"));
      console.error(err);
    } finally {
      setAddingUser(false);
    }
  };

  const handleRemoveUser = async (experimentId: string, userId: string) => {
    try {
      const res = await fetch(`/api/admin/experiments/${experimentId}/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove user");
      toast.success(gt("User removed from experiment"));
      await fetchManagedUsers(experimentId);
    } catch (err) {
      toast.error(gt("Failed to remove user"));
      console.error(err);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
        <FlaskConical className="w-6 h-6 text-[var(--accent-color)]" />
        {gt("Platform Experiments")}
      </h2>

      {/* Create experiment */}
      <div className="mb-6 p-4 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-[var(--accent-color)]" />
          {gt("Create Experiment")}
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder={gt("Name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-white text-sm"
            />
            <input
              type="text"
              placeholder={gt("Key (e.g. new_feature)")}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-white text-sm"
            />
          </div>
          <input
            type="text"
            placeholder={gt("Description (optional)")}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-white text-sm"
          />
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-secondary)] whitespace-nowrap">{gt("Rollout {percent}%", { percent: newRollout })}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={newRollout}
              onChange={(e) => setNewRollout(Number(e.target.value))}
              className="flex-1 accent-[var(--accent-color)] h-1 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer"
            />
            <button
              onClick={handleCreate}
              disabled={isCreating || !newName.trim() || !newKey.trim()}
              className="px-3 py-1.5 bg-[var(--accent-color)] hover:brightness-110 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-all"
            >
              {isCreating ? <Loader size={16} /> : gt("Create")}
            </button>
          </div>
        </div>
      </div>

      {/* Experiment list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{gt("Database Experiments")}</h3>
          {inactiveExperiments.length > 0 && (
            <button
              onClick={handleRemoveInactive}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              {gt("Remove {count} inactive", { count: inactiveExperiments.length })}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader size={24} />
          </div>
        ) : activeExperiments.length === 0 && inactiveExperiments.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{gt("No database experiments yet.")}</p>
        ) : (
          <div className="space-y-2">
            {[...activeExperiments, ...inactiveExperiments].map((exp) => (
              <div
                key={exp.id}
                className={cn(
                  "rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-hidden",
                  exp.status === "running" && "border-l-4 border-l-[var(--accent-color)]"
                )}
              >
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => handleToggleExpand(exp.id)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                      title={gt("Manage users")}
                    >
                      {expandedId === exp.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white truncate">{exp.name}</p>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold",
                            exp.status === "running" && "bg-[var(--accent-color)]/20 text-[var(--accent-color)]",
                            exp.status === "paused" && "bg-yellow-500/20 text-yellow-400",
                            (exp.status === "draft" || exp.status === "archived" || exp.status === "completed") && "bg-[#555555]/20 text-[#888888]"
                          )}
                        >
                          {exp.status}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate">{exp.key}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => handleToggleStatus(exp)}
                      className="p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                      title={exp.status === "running" ? gt("Pause") : gt("Start")}
                    >
                      {exp.status === "running" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(exp)}
                      className="p-2 rounded-md hover:bg-red-500/10 text-red-400 transition-colors"
                      title={gt("Delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {expandedId === exp.id && (
                  <div className="border-t border-[var(--border-subtle)] p-3 space-y-3">
                    {/* Add user section */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder={gt("User ID")}
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddUser(exp.id);
                          }}
                          className="flex-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 text-white text-sm"
                        />
                        <div className="flex rounded-md overflow-hidden border border-[var(--border-subtle)]">
                          <button
                            onClick={() => setUserAction("include")}
                            className={cn(
                              "px-2 py-1.5 text-xs font-medium transition-colors",
                              userAction === "include"
                                ? "bg-[var(--accent-color)] text-white"
                                : "bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            )}
                          >
                            <UserPlus className="w-3.5 h-3.5 inline mr-1" />
                            {gt("Include")}
                          </button>
                          <button
                            onClick={() => setUserAction("exclude")}
                            className={cn(
                              "px-2 py-1.5 text-xs font-medium transition-colors",
                              userAction === "exclude"
                                ? "bg-red-500 text-white"
                                : "bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            )}
                          >
                            <UserMinus className="w-3.5 h-3.5 inline mr-1" />
                            {gt("Exclude")}
                          </button>
                        </div>
                        <button
                          onClick={() => handleAddUser(exp.id)}
                          disabled={addingUser || !userInput.trim()}
                          className="px-3 py-1.5 bg-[var(--accent-color)] hover:brightness-110 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-all"
                        >
                          {addingUser ? <Loader size={16} /> : gt("Add")}
                        </button>
                      </div>
                    </div>

                    {/* Managed users list */}
                    {usersLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader size={20} />
                      </div>
                    ) : managedUsers.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] py-2">{gt("No users managed. Add a user by ID above to force-include or exclude them.")}</p>
                    ) : (
                      <div className="space-y-1">
                        {managedUsers.map((mu) => (
                          <div
                            key={mu.id}
                            className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full uppercase font-semibold whitespace-nowrap",
                                  mu.status === "included"
                                    ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                                    : "bg-red-500/20 text-red-400"
                                )}
                              >
                                {mu.status}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm text-white truncate">{mu.displayName || mu.username}</p>
                                <p className="text-[10px] text-[var(--text-muted)] truncate">{mu.id}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveUser(exp.id, mu.id)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors"
                              title={gt("Remove")}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
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
