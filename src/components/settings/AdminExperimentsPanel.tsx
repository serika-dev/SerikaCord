"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, Trash2, Loader2, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface Experiment {
  _id: string;
  name: string;
  key: string;
  description?: string;
  type: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  rolloutPercentage: number;
  createdAt: string;
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
      const res = await fetch(`/api/admin/experiments/${experiment._id}`, {
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
      const res = await fetch(`/api/admin/experiments/${experiment._id}`, { method: "DELETE" });
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
        fetch(`/api/admin/experiments/${exp._id}`, { method: "DELETE" }).catch(console.error)
      )
    );
    toast.success(gt("Inactive experiments removed"));
    await fetchExperiments();
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
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : gt("Create")}
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
            <Loader2 className="w-6 h-6 text-[var(--accent-color)] animate-spin" />
          </div>
        ) : activeExperiments.length === 0 && inactiveExperiments.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{gt("No database experiments yet.")}</p>
        ) : (
          <div className="space-y-2">
            {[...activeExperiments, ...inactiveExperiments].map((exp) => (
              <div
                key={exp._id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]",
                  exp.status === "running" && "border-l-4 border-l-[var(--accent-color)]"
                )}
              >
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
