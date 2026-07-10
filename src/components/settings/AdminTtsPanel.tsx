"use client";

import { useEffect, useMemo, useState } from "react";
import { Volume2, Plus, Trash2, Loader2, Play, Power, Star, Mic2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface TtsSound {
  id: string;
  triggerWord: string;
  path: string;
  label?: string | null;
  enabled?: boolean;
  createdAt?: string;
}

interface TtsVoice {
  id: string;
  name: string;
  provider: string;
  referenceId: string;
  description?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

// ─── Sounds Page ─────────────────────────────────────────────────────────────

export function AdminTtsSoundsPanel() {
  const gt = useGT();
  const [sounds, setSounds] = useState<TtsSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const fetchSounds = async () => {
    try {
      const res = await fetch("/api/admin/tts-sounds");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setSounds(data.sounds || []);
    } catch (err) {
      console.error("Failed to load TTS sounds", err);
      toast.error(gt("Failed to load TTS sounds"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSounds();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, TtsSound[]>();
    for (const s of sounds) {
      if (!map.has(s.triggerWord)) map.set(s.triggerWord, []);
      map.get(s.triggerWord)!.push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sounds]);

  const handleCreate = async () => {
    const trigger = newTrigger.trim().toLowerCase();
    const path = newPath.trim();
    if (!trigger || !path) {
      toast.error(gt("Trigger word and path are required"));
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/tts-sounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerWord: trigger, path, label: newLabel.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create");
      }
      toast.success(gt("Sound trigger added"));
      setNewTrigger("");
      setNewPath("");
      setNewLabel("");
      await fetchSounds();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to create"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (sound: TtsSound) => {
    try {
      const res = await fetch(`/api/admin/tts-sounds/${sound.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !sound.enabled }),
      });
      if (!res.ok) throw new Error();
      await fetchSounds();
    } catch {
      toast.error(gt("Failed to update"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/tts-sounds/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(gt("Deleted"));
      await fetchSounds();
    } catch {
      toast.error(gt("Failed to delete"));
    }
  };

  const preview = (path: string) => {
    try {
      const audio = new Audio(path);
      audio.play().catch(() => toast.error(gt("Could not play — check the path")));
    } catch {
      toast.error(gt("Could not play — check the path"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-[#8B5CF6]" />
          {gt("TTS Sound Triggers")}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          When a TTS message contains a trigger word, every listener plays a random sound from that
          group. Add several sounds with the same trigger word (e.g. three <code>meow</code> sounds)
          for variety. Paths point at files in <code>/public</code>, e.g.{" "}
          <code>/tts-sounds/meow1.mp3</code>.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Trigger word")}</label>
            <input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              placeholder="meow"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Public path")}</label>
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/tts-sounds/meow1.mp3"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Label (optional)")}</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Cat meow #1"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 shrink-0"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {gt("Add")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-8 text-sm">
          {gt("No sound triggers configured yet.")}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([trigger, group]) => (
            <div key={trigger} className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg-secondary)] flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                  <code className="text-[#8B5CF6]">{trigger}</code>
                  <span className="text-[var(--text-secondary)] font-normal ml-2">
                    {group.length} sound{group.length !== 1 ? "s" : ""} (random)
                  </span>
                </span>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {group.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5",
                      !s.enabled && "opacity-50"
                    )}
                  >
                    <button
                      onClick={() => preview(s.path)}
                      title={gt("Preview")}
                      className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-white"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{s.label || s.path}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate">{s.path}</div>
                    </div>
                    <button
                      onClick={() => handleToggle(s)}
                      title={s.enabled ? gt("Disable") : gt("Enable")}
                      className={cn(
                        "p-1.5 rounded-md hover:bg-[var(--bg-hover)]",
                        s.enabled ? "text-green-400" : "text-[var(--text-muted)]"
                      )}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      title={gt("Delete")}
                      className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Voices Page ─────────────────────────────────────────────────────────────

export function AdminTtsVoicesPanel() {
  const gt = useGT();
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRefId, setNewRefId] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const fetchVoices = async () => {
    try {
      const res = await fetch("/api/admin/tts-voices");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setVoices(data.voices || []);
    } catch (err) {
      console.error("Failed to load TTS voices", err);
      toast.error(gt("Failed to load TTS voices"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVoices();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim().toLowerCase();
    const refId = newRefId.trim();
    if (!name || !refId) {
      toast.error(gt("Name and reference ID are required"));
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/tts-voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          provider: "fish",
          referenceId: refId,
          description: newDesc.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create");
      }
      toast.success(gt("Voice added"));
      setNewName("");
      setNewRefId("");
      setNewDesc("");
      await fetchVoices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to create"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (voice: TtsVoice) => {
    try {
      const res = await fetch(`/api/admin/tts-voices/${voice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !voice.enabled }),
      });
      if (!res.ok) throw new Error();
      await fetchVoices();
    } catch {
      toast.error(gt("Failed to update"));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/tts-voices/${id}/default`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      toast.success(gt("Default voice set"));
      await fetchVoices();
    } catch {
      toast.error(gt("Failed to set default"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/tts-voices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(gt("Deleted"));
      await fetchVoices();
    } catch {
      toast.error(gt("Failed to delete"));
    }
  };

  const previewVoice = async (voice: TtsVoice) => {
    try {
      const res = await fetch("/api/tts/fish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello, this is a voice preview.", reference_id: voice.referenceId }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => toast.error(gt("Could not play preview")));
    } catch {
      toast.error(gt("Could not play preview"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Mic2 className="w-5 h-5 text-[#8B5CF6]" />
          {gt("TTS Custom Voices")}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Add custom Fish Audio AI voices that users can reference with{" "}
          <code className="text-[#8B5CF6]">[fish:name]</code> in TTS messages.
          The default voice is used as the Firefox fallback (replacing broken Web Speech).
        </p>
      </div>

      {/* Create form */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Preset name")}</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="miku"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Fish Audio model ID")}</label>
            <input
              value={newRefId}
              onChange={(e) => setNewRefId(e.target.value)}
              placeholder="model-uuid-from-fish-audio"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{gt("Description (optional)")}</label>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Hatsune Miku voice"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[#8B5CF6] outline-none"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 shrink-0"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {gt("Add")}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : voices.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-8 text-sm">
          {gt("No custom voices configured yet.")}
        </div>
      ) : (
        <div className="space-y-2">
          {voices.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)]",
                !v.enabled && "opacity-50"
              )}
            >
              <button
                onClick={() => previewVoice(v)}
                title={gt("Preview")}
                className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-white"
              >
                <Play className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    <code className="text-[#8B5CF6]">{v.name}</code>
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-cyan-400 bg-cyan-500/10">
                    {gt("Fish Audio")}
                  </span>
                  {v.isDefault && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {gt("Default")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  {v.description || v.referenceId}
                </div>
              </div>
              {!v.isDefault && (
                <button
                  onClick={() => handleSetDefault(v.id)}
                  title={gt("Set as default")}
                  className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-amber-400"
                >
                  <Star className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => handleToggle(v)}
                title={v.enabled ? gt("Disable") : gt("Enable")}
                className={cn(
                  "p-1.5 rounded-md hover:bg-[var(--bg-hover)]",
                  v.enabled ? "text-green-400" : "text-[var(--text-muted)]"
                )}
              >
                <Power className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDelete(v.id)}
                title={gt("Delete")}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
