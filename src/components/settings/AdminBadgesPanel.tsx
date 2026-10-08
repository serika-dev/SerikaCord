"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Plus, Pencil, Trash2, EyeOff, Lock, Zap, Search, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/ui/Loader";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { BadgeIcon } from "@/components/ui/BadgeIcon";
import { BadgeArt } from "@/components/ui/badges";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refreshBadges } from "@/hooks/useBadges";
import {
  BADGE_ICON_NAMES,
  BADGE_NAME_MAX,
  BADGE_DESCRIPTION_MAX,
  BADGE_PRIORITY_MAX,
  BADGE_PRIORITY_MIN,
  DEFAULT_BADGE_ICON,
  normalizeBadgeColor,
  validateBadgeInput,
  type BadgeDefinition,
} from "@/lib/badges/shared";

// Staff UI for the `badges` table (Settings → Admin → Badge Management).
// Assigning badges to users stays in User Management; this panel only edits
// the definitions. Every write calls refreshBadges() so this client re-renders
// with the new definitions immediately (other clients pick them up on their
// next session / within the API cache TTL).

interface AdminBadge extends BadgeDefinition {
  automatic: boolean;
  hidden: boolean;
  builtin: boolean;
  holders: number;
}

interface BadgeForm {
  id: string;
  name: string;
  description: string;
  iconMode: "icon" | "image";
  icon: string;
  iconUrl: string;
  color: string;
  priority: string;
  hidden: boolean;
}

const EMPTY_FORM: BadgeForm = {
  id: "",
  name: "",
  description: "",
  iconMode: "icon",
  icon: DEFAULT_BADGE_ICON,
  iconUrl: "",
  color: "#8B5CF6",
  priority: "10",
  hidden: false,
};

const inputClass =
  "w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] focus:border-[var(--app-accent)] outline-none disabled:opacity-60";
const labelClass = "block text-xs font-medium text-[var(--text-secondary)] mb-1";

function formFromBadge(b: AdminBadge): BadgeForm {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    iconMode: b.iconUrl ? "image" : "icon",
    icon: b.icon || DEFAULT_BADGE_ICON,
    iconUrl: b.iconUrl || "",
    color: b.color,
    priority: String(b.priority),
    hidden: b.hidden,
  };
}

/** Form → API payload. Exactly one of icon / iconUrl is sent non-null. */
function payloadFromForm(form: BadgeForm, mode: "create" | "update"): Record<string, unknown> {
  const priority = Number(form.priority);
  const out: Record<string, unknown> = {
    name: form.name,
    description: form.description,
    color: form.color,
    priority: Number.isFinite(priority) ? priority : form.priority,
    hidden: form.hidden,
    icon: form.iconMode === "icon" ? form.icon : null,
    iconUrl: form.iconMode === "image" ? form.iconUrl : null,
  };
  if (mode === "create") out.id = form.id;
  return out;
}

export function AdminBadgesPanel() {
  const gt = useGT();
  const [badges, setBadges] = useState<AdminBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [authoritative, setAuthoritative] = useState(true);
  const [query, setQuery] = useState("");

  // Editor dialog: `editing` null + open = create; otherwise edit that badge.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBadge | null>(null);
  const [form, setForm] = useState<BadgeForm>(EMPTY_FORM);
  const [iconSearch, setIconSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminBadge | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchBadges = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/badges", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load badges");
      setBadges(Array.isArray(data?.badges) ? data.badges : []);
      setAuthoritative(data?.authoritative !== false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to load badges"));
    } finally {
      setLoading(false);
    }
  }, [gt]);

  useEffect(() => {
    void fetchBadges();
  }, [fetchBadges]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return badges;
    return badges.filter((b) => b.id.includes(q) || b.name.toLowerCase().includes(q));
  }, [badges, query]);

  const filteredIcons = useMemo(() => {
    const q = iconSearch.trim().toLowerCase();
    return q ? BADGE_ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : BADGE_ICON_NAMES;
  }, [iconSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIconSearch("");
    setEditorOpen(true);
  };

  const openEdit = (badge: AdminBadge) => {
    setEditing(badge);
    setForm(formFromBadge(badge));
    setIconSearch("");
    setEditorOpen(true);
  };

  const patchForm = (patch: Partial<BadgeForm>) => setForm((f) => ({ ...f, ...patch }));

  // What the preview renders: the form as a badge definition.
  const previewColor = normalizeBadgeColor(form.color) || "#8B5CF6";
  const preview: BadgeDefinition = {
    id: form.id || "preview",
    name: form.name || gt("New badge"),
    description: form.description,
    icon: form.iconMode === "icon" ? form.icon : null,
    iconUrl: form.iconMode === "image" && form.iconUrl.trim() ? form.iconUrl.trim() : null,
    color: previewColor,
    priority: 0,
  };

  const handleSave = async () => {
    const mode = editing ? "update" : "create";
    const payload = payloadFromForm(form, mode);
    // Same validator the API uses, for instant feedback.
    const check = validateBadgeInput(payload, mode);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    if (form.iconMode === "image" && !form.iconUrl.trim()) {
      toast.error(gt("Enter an image URL or switch to an icon"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/admin/badges/${encodeURIComponent(editing.id)}` : "/api/admin/badges", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to save badge");
      toast.success(editing ? gt("Badge updated") : gt("Badge created"));
      setEditorOpen(false);
      await Promise.all([fetchBadges(), refreshBadges()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to save badge"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/badges/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to delete badge");
      toast.success(gt("Badge deleted"));
      setDeleteTarget(null);
      await Promise.all([fetchBadges(), refreshBadges()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to delete badge"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gt("Search badges")}
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <button
          onClick={openCreate}
          disabled={!authoritative}
          className="px-4 py-2 bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          {gt("New badge")}
        </button>
      </div>

      {!authoritative && (
        <div className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-sm text-[var(--text-secondary)]">
          {gt("The badge database could not be reached, so these are the built-in defaults. Editing is disabled until it is back.")}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--text-secondary)]">
          <Loader size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-8 text-sm">
          {query ? gt("No badges match your search.") : gt("No badges yet.")}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-color)] overflow-hidden divide-y divide-[var(--border-color)]">
          {filtered.map((badge) => (
            <div key={badge.id} className={cn("flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-[var(--bg-card)]", badge.hidden && "opacity-60")}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${badge.color}20` }}
              >
                <BadgeArt badge={badge} size="md" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">{badge.name}</span>
                  {badge.builtin && (
                    <span title={gt("Built-in: can be edited or hidden, not deleted")} className="inline-flex items-center gap-0.5 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
                      <Lock className="w-2.5 h-2.5" />
                      {gt("Built-in")}
                    </span>
                  )}
                  {badge.automatic && (
                    <span title={gt("Assigned automatically from account state")} className="inline-flex items-center gap-0.5 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
                      <Zap className="w-2.5 h-2.5" />
                      {gt("Automatic")}
                    </span>
                  )}
                  {badge.hidden && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
                      <EyeOff className="w-2.5 h-2.5" />
                      {gt("Hidden")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  <code>{badge.id}</code>
                  {" · "}
                  {gt("Priority {priority}", { priority: badge.priority })}
                  {" · "}
                  {gt("{count} holders", { count: badge.holders })}
                </div>
              </div>
              <button
                onClick={() => openEdit(badge)}
                disabled={!authoritative}
                title={gt("Edit")}
                aria-label={gt("Edit")}
                className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDeleteTarget(badge)}
                disabled={!authoritative || badge.builtin}
                title={badge.builtin ? gt("Built-in badges cannot be deleted") : gt("Delete")}
                aria-label={gt("Delete")}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Dialog open={editorOpen} onOpenChange={(o) => !saving && setEditorOpen(o)}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5" />
              {editing ? gt("Edit badge") : gt("New badge")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? gt("Changes show up for everyone within a couple of minutes.")
                : gt("Create the badge here, then assign it to users from User Management.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Live preview */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${previewColor}20` }}
              >
                <BadgeArt badge={preview} size="lg" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{preview.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{form.description || gt("No description")}</p>
              </div>
              <span
                className="px-2 py-1 rounded-full flex items-center gap-1.5 text-xs shrink-0"
                style={{ backgroundColor: `${previewColor}20`, color: previewColor }}
              >
                <BadgeIcon badge={preview} className="w-3.5 h-3.5" />
                <span className="max-w-[8rem] truncate">{preview.name}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{gt("Badge ID")}</label>
                <input
                  value={form.id}
                  onChange={(e) => patchForm({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  disabled={!!editing}
                  maxLength={40}
                  placeholder="event_winner_2026"
                  className={cn(inputClass, "font-mono")}
                />
                {!editing && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{gt("Lowercase letters, numbers and _. Cannot be changed later.")}</p>
                )}
              </div>
              <div>
                <label className={labelClass}>{gt("Name")}</label>
                <input
                  value={form.name}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  maxLength={BADGE_NAME_MAX}
                  placeholder={gt("Event Winner")}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>{gt("Description")}</label>
              <input
                value={form.description}
                onChange={(e) => patchForm({ description: e.target.value })}
                maxLength={BADGE_DESCRIPTION_MAX}
                placeholder={gt("Shown in the badge tooltip")}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{gt("Color")}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={previewColor}
                    onChange={(e) => patchForm({ color: e.target.value })}
                    aria-label={gt("Pick color")}
                    className="w-10 h-9 shrink-0 rounded-lg border border-[var(--border-color)] bg-transparent cursor-pointer p-0.5"
                  />
                  <input
                    value={form.color}
                    onChange={(e) => patchForm({ color: e.target.value })}
                    maxLength={7}
                    placeholder="#8B5CF6"
                    className={cn(inputClass, "font-mono")}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>{gt("Priority")}</label>
                <input
                  type="number"
                  min={BADGE_PRIORITY_MIN}
                  max={BADGE_PRIORITY_MAX}
                  step={1}
                  value={form.priority}
                  onChange={(e) => patchForm({ priority: e.target.value })}
                  className={inputClass}
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">{gt("Higher shows first.")}</p>
              </div>
            </div>

            {/* Icon or image */}
            <div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] w-fit mb-2">
                <button
                  type="button"
                  onClick={() => patchForm({ iconMode: "icon" })}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5",
                    form.iconMode === "icon" ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <Award className="w-3.5 h-3.5" />
                  {gt("Icon")}
                </button>
                <button
                  type="button"
                  onClick={() => patchForm({ iconMode: "image" })}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5",
                    form.iconMode === "image" ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  {gt("Image")}
                </button>
              </div>

              {form.iconMode === "icon" ? (
                <div className="space-y-2">
                  <input
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    placeholder={gt("Search icons")}
                    className={inputClass}
                  />
                  <div className="grid grid-cols-8 sm:grid-cols-10 gap-1 max-h-40 overflow-y-auto p-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                    {filteredIcons.map((name) => (
                      <button
                        key={name}
                        type="button"
                        title={name}
                        aria-label={name}
                        aria-pressed={form.icon === name}
                        onClick={() => patchForm({ icon: name })}
                        className={cn(
                          "aspect-square rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)]",
                          form.icon === name && "ring-2 ring-[var(--app-accent)] bg-[var(--bg-active)]"
                        )}
                      >
                        <BadgeIcon badge={{ icon: name, iconUrl: null, color: previewColor }} className="w-4 h-4" />
                      </button>
                    ))}
                    {filteredIcons.length === 0 && (
                      <p className="col-span-full text-center text-xs text-[var(--text-muted)] py-3">{gt("No icons match.")}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    value={form.iconUrl}
                    onChange={(e) => patchForm({ iconUrl: e.target.value })}
                    placeholder="https://cdn.serika.chat/badges/winner.png"
                    className={cn(inputClass, "font-mono")}
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {gt("An https:// image URL, or a /path on the Serika CDN. Square images look best.")}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Hidden")}</p>
                <p className="text-xs text-[var(--text-muted)]">{gt("Hidden badges stay assigned but render nowhere.")}</p>
              </div>
              <ToggleSwitch size="sm" checked={form.hidden} onCheckedChange={(v) => patchForm({ hidden: v })} aria-label={gt("Hidden")} />
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setEditorOpen(false)}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {gt("Cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2"
            >
              {saving && <Loader size={16} />}
              {editing ? gt("Save changes") : gt("Create badge")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{gt("Delete badge?")}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? gt("\"{name}\" will be deleted and removed from {count} users. This cannot be undone.", {
                    name: deleteTarget.name,
                    count: deleteTarget.holders,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {gt("Cancel")}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2"
            >
              {deleting && <Loader size={16} />}
              {gt("Delete badge")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
