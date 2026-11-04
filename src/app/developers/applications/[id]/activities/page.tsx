"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { AlertTriangle, ImagePlus, Plus, Rocket, Save, Trash2 } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { cdnImage } from "@/lib/utils";

type Platform = "web" | "desktop" | "ios" | "android";
type Lock = 1 | 2 | 3;

interface Settings {
  enabled: boolean;
  urlMappings: { prefix: string; target: string }[];
  supportedPlatforms: Platform[];
  orientationLockPhone: Lock;
  orientationLockTablet: Lock;
  ageGated: boolean;
  displayName: string | null;
  imageUrl: string | null;
}

interface MappingIssue { index: number | null; field: string | null; message: string }

interface ActivitiesView {
  settings: Settings;
  maxParticipants: number | null;
  entryPointCommand: { id: string; name: string; description: string; handler?: number } | null;
  activitiesDomain: string | null;
  activityOrigin: string | null;
  warnings: MappingIssue[];
  canEdit: boolean;
}

interface Row { key: number; prefix: string; target: string }

let rowSeq = 0;
const toRows = (m: Settings["urlMappings"]): Row[] => m.map((x) => ({ key: ++rowSeq, prefix: x.prefix, target: x.target }));

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? "bg-[#8B5CF6]" : "bg-[#333]"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 bg-white rounded-full transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export default function ActivitiesPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const [view, setView] = useState<ActivitiesView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [maxParticipants, setMaxParticipants] = useState("");
  const [issues, setIssues] = useState<MappingIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyView = useCallback((v: ActivitiesView) => {
    setView(v);
    setDraft(v.settings);
    setRows(toRows(v.settings.urlMappings));
    setMaxParticipants(v.maxParticipants ? String(v.maxParticipants) : "");
    setIssues(v.warnings ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/developers/applications/${appId}/activities`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) applyView(data as ActivitiesView);
        else setLoadError((data as { error?: string }).error || "error");
      })
      .catch(() => { if (!cancelled) setLoadError("error"); });
    return () => { cancelled = true; };
  }, [appId, applyView]);

  const update = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    const mp = maxParticipants.trim();
    // Drop blank rows first so the server's error indices line up with what's shown.
    const kept = rows.filter((r) => r.prefix.trim() || r.target.trim());
    setRows(kept);
    setSaving(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/activities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          urlMappings: kept.map((r) => ({ prefix: r.prefix, target: r.target })),
          supportedPlatforms: draft.supportedPlatforms,
          orientationLockPhone: draft.orientationLockPhone,
          orientationLockTablet: draft.orientationLockTablet,
          ageGated: draft.ageGated,
          displayName: draft.displayName ?? "",
          maxParticipants: mp ? Number(mp) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        applyView(data as ActivitiesView);
        toast.success(gt("Activity settings saved"));
      } else {
        setIssues((data as { mappingErrors?: MappingIssue[] }).mappingErrors ?? []);
        toast.error((data as { error?: string }).error || gt("Failed to save Activity settings"));
      }
    } catch {
      toast.error(gt("Failed to save Activity settings"));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/developers/applications/${appId}/activities/image`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data as { url?: string }).url) {
        update({ imageUrl: (data as { url: string }).url });
        setView((v) => (v ? { ...v, settings: { ...v.settings, imageUrl: (data as { url: string }).url } } : v));
        toast.success(gt("Image uploaded"));
      } else {
        toast.error((data as { error?: string }).error || gt("Failed to upload image"));
      }
    } catch {
      toast.error(gt("Failed to upload image"));
    } finally {
      setUploading(false);
    }
  };

  const clearImage = async () => {
    const res = await fetch(`/api/developers/applications/${appId}/activities`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: null }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      update({ imageUrl: null });
      setView(data as ActivitiesView);
    } else toast.error((data as { error?: string }).error || gt("Failed to save Activity settings"));
  };

  if (loadError) {
    return <p className="text-sm text-red-400 py-10">{gt("Failed to load Activity settings")}</p>;
  }
  if (!view || !draft) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  const readOnly = !view.canEdit;
  const issueFor = (i: number, field: "prefix" | "target") => issues.find((x) => x.index === i && (x.field === field || x.field === null));
  const generalIssues = issues.filter((x) => x.index === null);
  const platformLabels: Record<Platform, string> = {
    web: gt("Web"),
    desktop: gt("Desktop app"),
    ios: gt("iOS"),
    android: gt("Android"),
  };
  const lockOptions: { value: Lock; label: string }[] = [
    { value: 1, label: gt("Unlocked") },
    { value: 2, label: gt("Portrait") },
    { value: 3, label: gt("Landscape") },
  ];
  const sectionLabel = "block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2";
  const input = "bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 disabled:opacity-60";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#6366f1] flex items-center justify-center">
          <Rocket className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{gt("Activities")}</h1>
          <p className="text-sm text-white/50">{gt("Run your web app inside SerikaCord calls and chats with the Embedded App SDK.")}</p>
        </div>
      </div>

      <p className="text-sm text-white/60 leading-relaxed my-5">
        {gt("Activities built for Discord's Embedded App SDK work here too: point your app at SerikaCord's client ID and API, and set up the same URL mappings. SerikaCord serves your Activity from its own domain through a proxy, so it never gets access to anyone's SerikaCord account.")}
      </p>

      {!view.activitiesDomain && (
        <div className="flex items-start gap-3 p-4 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <p>{gt("Activities can't be launched on this server yet. You can set everything up now; it starts working once the Activities domain is configured.")}</p>
        </div>
      )}

      {/* Enable */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 mb-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{gt("Enable Activities")}</h3>
          <p className="text-xs text-[#888] mt-1">
            {gt("Turning this on adds a Launch entry point command to your app and lets people start your Activity. Needs a root (\"/\") URL mapping.")}
          </p>
        </div>
        <Switch on={draft.enabled} disabled={readOnly} onChange={(v) => update({ enabled: v })} label={gt("Enable Activities")} />
      </div>

      {/* URL mappings */}
      <div className="mb-8">
        <label className={sectionLabel}>{gt("URL Mappings")}</label>
        <p className="text-xs text-[#666] mb-3">
          {gt("The root mapping (\"/\") is your Activity's page. Other prefixes forward requests to your APIs, e.g. /api → api.example.com. Leave out https://. {name} in a prefix can be used in the target host. Longer prefixes must come first.")}
        </p>
        {view.activityOrigin && (
          <p className="text-xs text-[#888] mb-3">
            {gt("Your Activity is served at")} <code className="text-[#ccc] font-mono">{view.activityOrigin}</code>
          </p>
        )}
        <div className="space-y-2 mb-3">
          {rows.map((row, i) => {
            const prefixIssue = issueFor(i, "prefix");
            const targetIssue = issueFor(i, "target");
            return (
              <div key={row.key}>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={row.prefix}
                    disabled={readOnly}
                    onChange={(e) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, prefix: e.target.value } : r)))}
                    placeholder="/api"
                    aria-label={gt("Prefix")}
                    className={`${input} sm:w-48 font-mono`}
                  />
                  <input
                    value={row.target}
                    disabled={readOnly}
                    onChange={(e) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, target: e.target.value } : r)))}
                    placeholder="api.example.com"
                    aria-label={gt("Target")}
                    className={`${input} flex-1 font-mono min-w-0`}
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      aria-label={gt("Remove mapping")}
                      className="self-end sm:self-auto p-2 rounded hover:bg-red-500/10 text-[#888] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {(prefixIssue || targetIssue) && (
                  <p className="text-xs text-amber-300 mt-1">{(prefixIssue ?? targetIssue)?.message}</p>
                )}
              </div>
            );
          })}
        </div>
        {generalIssues.map((x) => (
          <p key={x.message} className="text-xs text-amber-300 mb-2">{x.message}</p>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { key: ++rowSeq, prefix: rs.some((r) => r.prefix.trim() === "/") ? "" : "/", target: "" }])}
            className="flex items-center gap-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-lg transition-colors"
          >
            <Plus className="size-4" /> {gt("Add mapping")}
          </button>
        )}
      </div>

      {/* Platforms + orientation */}
      <div className="grid sm:grid-cols-2 gap-6 mb-8">
        <div>
          <label className={sectionLabel}>{gt("Supported Platforms")}</label>
          <div className="space-y-2">
            {(Object.keys(platformLabels) as Platform[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-[#ccc]">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={draft.supportedPlatforms.includes(p)}
                  onChange={(e) => update({
                    supportedPlatforms: e.target.checked
                      ? [...draft.supportedPlatforms, p]
                      : draft.supportedPlatforms.filter((x) => x !== p),
                  })}
                  className="accent-[#8B5CF6]"
                />
                {platformLabels[p]}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className={sectionLabel} htmlFor="lock-phone">{gt("Orientation on phones")}</label>
            <select
              id="lock-phone"
              disabled={readOnly}
              value={draft.orientationLockPhone}
              onChange={(e) => update({ orientationLockPhone: Number(e.target.value) as Lock })}
              className={`${input} w-full`}
            >
              {lockOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={sectionLabel} htmlFor="lock-tablet">{gt("Orientation on tablets")}</label>
            <select
              id="lock-tablet"
              disabled={readOnly}
              value={draft.orientationLockTablet}
              onChange={(e) => update({ orientationLockTablet: Number(e.target.value) as Lock })}
              className={`${input} w-full`}
            >
              {lockOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Shelf name / participants / age gate */}
      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        <div>
          <label className={sectionLabel} htmlFor="activity-name">{gt("Activity Name")}</label>
          <input
            id="activity-name"
            disabled={readOnly}
            value={draft.displayName ?? ""}
            maxLength={64}
            onChange={(e) => update({ displayName: e.target.value })}
            placeholder={gt("Defaults to your app's name")}
            className={`${input} w-full`}
          />
        </div>
        <div>
          <label className={sectionLabel} htmlFor="max-participants">{gt("Max Participants")}</label>
          <input
            id="max-participants"
            disabled={readOnly}
            inputMode="numeric"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={gt("No limit")}
            className={`${input} w-full`}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 mb-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{gt("Age-Restricted (18+)")}</h3>
          <p className="text-xs text-[#888] mt-1">{gt("Only adults can launch or join this Activity.")}</p>
        </div>
        <Switch on={draft.ageGated} disabled={readOnly} onChange={(v) => update({ ageGated: v })} label={gt("Age-Restricted (18+)")} />
      </div>

      {/* Art */}
      <div className="mb-8">
        <label className={sectionLabel}>{gt("Activity Image")}</label>
        <p className="text-xs text-[#666] mb-3">{gt("Shown on the Activity shelf and the Game Invitation card in chat. 16:9 works best.")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-48 aspect-video rounded-lg overflow-hidden bg-[#1a1a1a] border border-white/[0.08] flex items-center justify-center">
            {draft.imageUrl ? (
              <img src={cdnImage(draft.imageUrl)} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus className="size-6 text-[#555]" />
            )}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadImage(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-lg transition-colors"
              >
                {uploading ? <Loader size={24} className="size-4" /> : <ImagePlus className="size-4" />}
                {gt("Upload")}
              </button>
              {draft.imageUrl && (
                <button
                  type="button"
                  onClick={() => void clearImage()}
                  className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition-colors"
                >
                  <Trash2 className="size-4" /> {gt("Remove")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Entry point command */}
      <div className="mb-8">
        <label className={sectionLabel}>{gt("Entry Point Command")}</label>
        {view.entryPointCommand ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="text-sm font-mono text-white">/{view.entryPointCommand.name}</p>
            <p className="text-xs text-[#888] mt-1">{view.entryPointCommand.description}</p>
            <p className="text-xs text-[#888] mt-2">
              {view.entryPointCommand.handler === 1
                ? gt("Your app answers this command (it can reply with LAUNCH_ACTIVITY).")
                : gt("SerikaCord launches your Activity and posts a Game Invitation in the chat.")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-[#666]">{gt("Created automatically when you enable Activities.")}</p>
        )}
        <p className="text-xs text-[#666] mt-2">
          {gt("Change it with the application commands API (type 4, PRIMARY_ENTRY_POINT), exactly like on Discord.")}{" "}
          <Link href="/developers/docs" className="text-[#8B5CF6] hover:underline">{gt("Docs")}</Link>
        </p>
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
            {gt("Save Changes")}
          </button>
        </div>
      )}
    </div>
  );
}
