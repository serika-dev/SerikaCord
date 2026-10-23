"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { WidgetRenderer, type WidgetSurfaces, type WidgetField } from "@/components/widgets/WidgetRenderer";
import {
  WIDGET_SURFACES,
  WIDGET_SURFACE_BY_KEY,
  WIDGET_LAYOUT_BY_KEY,
  defaultLayoutForSurface,
  type WidgetSurfaceType,
} from "@/lib/constants/widgets";
import { ArrowLeft, Save, Rocket, EyeOff, Plus, Trash2, Code2, Check, Trash, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SampleEntry { name: string; type: number; value: string; }

function emptySurfaces(): WidgetSurfaces {
  const s: WidgetSurfaces = {};
  for (const surf of WIDGET_SURFACES) {
    s[surf.key] = { layout: defaultLayoutForSurface(surf.key), components: {} };
  }
  return s;
}

// Map a surface to the renderer mode used for its live preview.
function previewMode(surface: WidgetSurfaceType): "widget" | "add_preview" | "mini_profile" | "activity_accessory" {
  if (surface === "add_widget_preview") return "add_preview";
  if (surface === "mini_profile") return "mini_profile";
  if (surface === "activity_accessory") return "activity_accessory";
  return "widget";
}

export default function WidgetEditorPage() {
  const gt = useGT();
  const router = useRouter();
  const params = useParams();
  const appId = params.appId as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("Widget");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [surfaces, setSurfaces] = useState<WidgetSurfaces>(emptySurfaces());
  const [sample, setSample] = useState<SampleEntry[]>([]);
  const [activeSurface, setActiveSurface] = useState<WidgetSurfaceType>("widget_top");
  const [tab, setTab] = useState<"design" | "content">("design");
  const [selected, setSelected] = useState<{ comp: string; field: string } | null>(null);
  const [footTab, setFootTab] = useState<"validation" | "sample">("validation");
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/developers/applications/${appId}/widget`);
        const data = await res.json();
        if (data.widget) {
          setName(data.widget.name || "Widget");
          setStatus(data.widget.status || "draft");
          setSurfaces({ ...emptySurfaces(), ...(data.widget.surfaces || {}) });
          const dyn = data.widget.sampleData?.dynamic;
          if (Array.isArray(dyn)) {
            setSample(dyn.map((d: { name: string; type?: number; value: unknown }) => ({
              name: d.name,
              type: d.type ?? 1,
              value: typeof d.value === "object" && d.value ? (d.value as { url?: string }).url ?? "" : String(d.value ?? ""),
            })));
          }
        }
      } catch {
        toast.error(gt("Failed to load widget"));
      } finally {
        setLoading(false);
      }
    })();
  }, [appId, gt]);

  // ── Surface / layout / field helpers ─────────────────────────────────────
  const surfaceDef = WIDGET_SURFACE_BY_KEY[activeSurface];
  const layoutKey = surfaces[activeSurface]?.layout || defaultLayoutForSurface(activeSurface);
  const layoutDef = WIDGET_LAYOUT_BY_KEY[layoutKey];

  const setLayout = (surface: WidgetSurfaceType, key: string) => {
    setSurfaces((prev) => ({ ...prev, [surface]: { layout: key, components: prev[surface]?.components ?? {} } }));
    setSelected(null);
  };

  const getField = (comp: string, fieldKey: string): WidgetField | undefined =>
    surfaces[activeSurface]?.components?.[comp]?.fields?.[fieldKey];

  const setField = useCallback((comp: string, fieldKey: string, patch: Partial<WidgetField>) => {
    setSurfaces((prev) => {
      const surface = prev[activeSurface] ?? { layout: layoutKey, components: {} };
      const components = { ...(surface.components ?? {}) };
      const c = { fields: { ...(components[comp]?.fields ?? {}) } };
      const existing = c.fields[fieldKey] ?? { value_type: "custom_string" as const, value: "" };
      c.fields[fieldKey] = { ...existing, ...patch };
      components[comp] = c;
      return { ...prev, [activeSurface]: { layout: surface.layout || layoutKey, components } };
    });
  }, [activeSurface, layoutKey]);

  const clearField = (comp: string, fieldKey: string) => {
    setSurfaces((prev) => {
      const surface = prev[activeSurface];
      if (!surface?.components?.[comp]?.fields) return prev;
      const components = { ...surface.components };
      const fields = { ...components[comp].fields };
      delete fields[fieldKey];
      components[comp] = { fields };
      return { ...prev, [activeSurface]: { ...surface, components } };
    });
  };

  // ── Auto-add data field keys to sample data ──────────────────────────────
  useEffect(() => {
    const dataKeys = new Set<string>();
    for (const surf of WIDGET_SURFACES) {
      const s = surfaces[surf.key];
      if (!s?.components) continue;
      for (const comp of Object.values(s.components)) {
        for (const f of Object.values(comp.fields ?? {})) {
          if (f.value_type === 'data' && f.value) dataKeys.add(f.value);
        }
      }
    }
    setSample((prev) => {
      const existing = new Set(prev.map((s) => s.name));
      const missing = [...dataKeys].filter((k) => !existing.has(k));
      if (missing.length === 0) return prev;
      return [...prev, ...missing.map((k) => ({ name: k, type: 1, value: '' }))];
    });
  }, [surfaces]);

  // ── Sample data → renderer data ─────────────────────────────────────────
  const rendererData = useMemo(() => ({
    dynamic: sample.map((s) => ({ name: s.name, type: s.type, value: s.type === 3 ? { url: s.value } : s.value })),
  }), [sample]);
  const generatedJson = useMemo(() => JSON.stringify({ data: rendererData }, null, 2), [rendererData]);

  // ── Validation ───────────────────────────────────────────────────────────
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    for (const surf of WIDGET_SURFACES) {
      const sLayoutKey = surfaces[surf.key]?.layout || defaultLayoutForSurface(surf.key);
      const sLayout = WIDGET_LAYOUT_BY_KEY[sLayoutKey];
      if (!sLayout) continue;
      for (const comp of sLayout.components) {
        for (const f of comp.fields) {
          if (!f.required) continue;
          const val = surfaces[surf.key]?.components?.[comp.key]?.fields?.[f.key]?.value;
          if (!val) errors.push(`${surf.label} · ${comp.label} · ${f.label} ${gt("is required")}`);
        }
      }
    }
    return errors;
  }, [surfaces, gt]);

  // ── Save / publish / delete ──────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/widget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, surfaces, sampleData: rendererData }),
      });
      if (!res.ok) throw new Error();
      toast.success(gt("Widget saved"));
    } catch {
      toast.error(gt("Failed to save widget"));
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    const action = status === "published" ? "unpublish" : "publish";
    try {
      if (action === "publish") await save();
      const res = await fetch(`/api/developers/applications/${appId}/widget/${action}`, { method: "POST" });
      if (!res.ok) throw new Error();
      setStatus(action === "publish" ? "published" : "draft");
      toast.success(action === "publish" ? gt("Widget published") : gt("Widget unpublished"));
    } catch {
      toast.error(gt("Action failed"));
    }
  };

  const del = async () => {
    if (!confirm(gt("Delete this widget? This cannot be undone."))) return;
    try {
      await fetch(`/api/developers/applications/${appId}/widget`, { method: "DELETE" });
      toast.success(gt("Widget deleted"));
      router.push(`/developers/applications/${appId}`);
    } catch {
      toast.error(gt("Action failed"));
    }
  };

  const selectedField = selected ? getField(selected.comp, selected.field) : undefined;
  const selectedDef = selected
    ? layoutDef?.components.find((c) => c.key === selected.comp)?.fields.find((f) => f.key === selected.field)
    : undefined;

  if (loading) return <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center"><Loader /></div>;

  const btn = "sw-focus inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-sm font-medium transition-colors disabled:opacity-50";
  const field = "w-full mt-1 bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] px-2.5 py-2 text-sm text-white focus:outline-none focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[var(--sw-accent)]/25 [color-scheme:dark]";
  const label = "text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-faint)]";

  return (
    <div className="fixed inset-0 z-[60] bg-[#0a0a0a] text-white flex flex-col">
      {/* Top bar */}
      <header className="min-h-14 shrink-0 border-b border-[var(--sw-hairline)] flex flex-wrap items-center px-3 sm:px-4 py-2 gap-x-3 gap-y-2 bg-[#0c0c10]">
        <button onClick={() => router.push(`/developers/applications/${appId}`)} aria-label={gt("Back")} className="sw-focus p-1.5 rounded-[8px] hover:bg-white/[0.06] text-white/70">
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={gt("Widget name")}
          className="min-w-0 flex-1 sm:flex-none sm:w-64 bg-transparent font-display text-[17px] font-semibold tracking-[-0.01em] text-white border-b border-transparent hover:border-white/20 focus:border-[var(--sw-accent)] focus:outline-none px-1"
        />
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase font-semibold tracking-[0.08em] px-2 py-1 rounded-[6px] ${status === "published" ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25" : "bg-white/[0.06] text-white/55 ring-1 ring-inset ring-white/10"}`}>
          <span aria-hidden className={`size-1.5 rounded-full ${status === "published" ? "bg-emerald-400" : "bg-white/40"}`} />
          {status === "published" ? gt("Published") : gt("Draft")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={del} className={`${btn} text-red-300 hover:bg-red-500/10`}>
            <Trash className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">{gt("Delete")}</span>
          </button>
          <button onClick={save} disabled={saving} className={`${btn} bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-inset ring-white/10`}>
            <Save className="w-4 h-4" aria-hidden /> {gt("Save changes")}
          </button>
          <button onClick={togglePublish} className={`${btn} bg-[var(--sw-accent)] hover:bg-[#7c4ff0] text-white shadow-[0_8px_24px_-10px_rgba(139,92,246,0.8)]`}>
            {status === "published" ? <><EyeOff className="w-4 h-4" aria-hidden /> {gt("Unpublish")}</> : <><Rocket className="w-4 h-4" aria-hidden /> {gt("Publish")}</>}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Left panel */}
        <aside className="w-full lg:w-[320px] shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--sw-hairline)] flex flex-col lg:min-h-0 bg-[#0c0c10]">
          <div className="p-4 border-b border-[var(--sw-hairline)]">
            <label className={label} htmlFor="widget-surface">{gt("Surface")}</label>
            <select
              id="widget-surface"
              value={activeSurface}
              onChange={(e) => { setActiveSurface(e.target.value as WidgetSurfaceType); setSelected(null); setTab("design"); }}
              className={field}
            >
              {WIDGET_SURFACES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div className="flex border-b border-[var(--sw-hairline)]" role="tablist">
            {(["design", "content"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`sw-focus flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-[var(--sw-accent)] text-white" : "border-transparent text-white/50 hover:text-white"}`}>
                {t === "design" ? gt("Design") : gt("Content")}
              </button>
            ))}
          </div>

          <div className="flex-1 lg:overflow-y-auto p-4 space-y-2">
            {tab === "design" ? (
              <>
                <p className={`${label} mb-2`}>{gt("Select layout")}</p>
                {surfaceDef?.layouts.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setLayout(activeSurface, l.key)}
                    aria-pressed={layoutKey === l.key}
                    className={`sw-focus w-full flex items-start gap-3 text-left p-3 rounded-[10px] border transition-colors ${layoutKey === l.key ? "border-[var(--sw-accent)]/70 bg-[var(--sw-accent)]/[0.09]" : "border-[var(--sw-hairline)] hover:border-[var(--sw-hairline-strong)] hover:bg-white/[0.02]"}`}
                  >
                    <span aria-hidden className={`mt-0.5 grid place-items-center size-4 shrink-0 rounded-full border ${layoutKey === l.key ? "border-[var(--sw-accent)] bg-[var(--sw-accent)]" : "border-white/25"}`}>
                      {layoutKey === l.key && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">{l.label}</span>
                      <span className="block text-[11.5px] text-white/45 mt-0.5 leading-snug">{l.description}</span>
                    </span>
                  </button>
                ))}
              </>
            ) : (
              layoutDef?.components.map((comp) => (
                <div key={comp.key} className="space-y-1">
                  <p className={`${label} mt-3 mb-1`}>{comp.label}</p>
                  {comp.fields.map((f) => {
                    const configured = !!getField(comp.key, f.key)?.value;
                    const isSel = selected?.comp === comp.key && selected?.field === f.key;
                    return (
                      <button
                        key={f.key}
                        onClick={() => setSelected({ comp: comp.key, field: f.key })}
                        aria-pressed={isSel}
                        className={`sw-focus w-full flex items-center justify-between px-3 py-2 rounded-[8px] text-sm text-left transition-colors ${isSel ? "bg-[var(--sw-accent)]/[0.12] text-white ring-1 ring-inset ring-[var(--sw-accent)]/40" : "text-white/65 hover:bg-white/[0.04]"}`}
                      >
                        <span className="truncate">{f.label}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {f.required && <span className="text-[9px] uppercase font-semibold tracking-[0.06em] text-amber-300/85">{gt("Required")}</span>}
                          <span aria-label={configured ? gt("Configured") : gt("Not configured")} className={`w-1.5 h-1.5 rounded-full ${configured ? "bg-emerald-400" : "bg-white/20"}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Center preview — a dotted stage with a soft violet glow, sized like the profile board */}
        <main className="flex-1 min-w-0 min-h-[360px] flex flex-col items-center justify-center gap-4 p-6 bg-[#08080b] [background-image:radial-gradient(circle_at_50%_40%,rgba(139,92,246,0.14),transparent_55%),radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:100%_100%,18px_18px]">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--sw-accent)] animate-pulse motion-reduce:animate-none" />
            {gt("Live preview")}
          </span>
          <div className="w-full max-w-[420px] rounded-[14px] bg-[#0c0c10] p-4 ring-1 ring-white/[0.06] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
            <WidgetRenderer config={{ name, surfaces }} data={rendererData} mode={previewMode(activeSurface)} />
          </div>
        </main>

        {/* Right inspector */}
        <aside className="w-full lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--sw-hairline)] p-4 lg:overflow-y-auto bg-[#0c0c10]">
          {selectedDef ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{selectedDef.label}</h3>
                {selectedField && <button onClick={() => clearField(selected!.comp, selected!.field)} aria-label={gt("Clear field")} title={gt("Clear field")} className="sw-focus p-1 rounded text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" aria-hidden /></button>}
              </div>
              <div>
                <label className={label}>{gt("Value type")}</label>
                <select
                  value={selectedField?.value_type ?? "custom_string"}
                  onChange={(e) => setField(selected!.comp, selected!.field, { value_type: e.target.value as WidgetField["value_type"] })}
                  className={field}
                >
                  <option value="custom_string">{gt("Custom String")}</option>
                  <option value="data">{gt("User Data")}</option>
                  {selectedDef.kind === "image" && <option value="application_asset">{gt("Application Asset")}</option>}
                </select>
              </div>
              {selectedDef.kind === "text" && selectedField?.value_type === "data" && (selectedDef.allowedPresentationTypes?.length ?? 0) > 1 && (
                <div>
                  <label className={label}>{gt("Presentation")}</label>
                  <select
                    value={selectedField?.presentation_type ?? "text"}
                    onChange={(e) => setField(selected!.comp, selected!.field, { presentation_type: e.target.value as WidgetField["presentation_type"] })}
                    className={field}
                  >
                    {selectedDef.allowedPresentationTypes?.map((p) => (
                      <option key={p} value={p}>{p === "text" ? gt("Text") : p === "number" ? gt("Number") : gt("Duration")}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={label}>
                  {selectedField?.value_type === "data" ? gt("Data field (key)") : selectedDef.kind === "image" ? gt("Image URL") : gt("Content")}
                </label>
                <input
                  value={selectedField?.value ?? ""}
                  onChange={(e) => setField(selected!.comp, selected!.field, { value: e.target.value })}
                  placeholder={selectedField?.value_type === "data" ? "TopShowTitle" : selectedDef.kind === "image" ? "https://…" : gt("Enter text")}
                  className={field}
                />
              </div>
              {selectedField?.value_type === "data" && (
                <div>
                  <label className={label}>{gt("Fallback")}</label>
                  <input
                    value={typeof selectedField?.fallback === "string" ? selectedField.fallback : ""}
                    onChange={(e) => setField(selected!.comp, selected!.field, { fallback: e.target.value })}
                    className={field}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-white/30">{tab === "content" ? gt("Select a field from the left to edit its value.") : gt("Switch to the Content tab to configure fields, then click one to edit here.")}</p>
              {tab === "content" && layoutDef && layoutDef.components.length > 0 && (
                <button
                  onClick={() => {
                    const firstComp = layoutDef.components[0];
                    if (firstComp.fields.length > 0) setSelected({ comp: firstComp.key, field: firstComp.fields[0].key });
                  }}
                  className="flex items-center gap-1.5 text-xs text-[var(--sw-accent-soft)] hover:text-white transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" /> {gt("Edit first field")}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Footer: validation / sample data */}
      <footer className="shrink-0 border-t border-[var(--sw-hairline)] max-h-[38%] overflow-y-auto bg-[#0c0c10]">
        <div className="flex items-center gap-4 px-4 pt-2">
          {(["validation", "sample"] as const).map((t) => (
            <button key={t} onClick={() => setFootTab(t)} className={`sw-focus inline-flex items-center gap-1.5 py-2 text-sm font-medium border-b-2 transition-colors ${footTab === t ? "border-[var(--sw-accent)] text-white" : "border-transparent text-white/50 hover:text-white"}`}>
              {t === "validation" ? gt("Validation") : gt("Sample Data")}
              {t === "validation" && validationErrors.length > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-semibold grid place-items-center">{validationErrors.length}</span>
              )}
            </button>
          ))}
          {footTab === "sample" && (
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => setSample((s) => [...s, { name: "", type: 1, value: "" }])} className="sw-focus flex items-center gap-1 text-xs text-[var(--sw-accent-soft)] hover:underline">
                <Plus className="w-3.5 h-3.5" /> {gt("Add field")}
              </button>
              <button onClick={() => setShowJson((v) => !v)} className="flex items-center gap-1 text-xs text-white/60 hover:text-white">
                <Code2 className="w-3.5 h-3.5" /> {gt("Generate JSON")}
              </button>
            </div>
          )}
        </div>
        <div className="p-4">
          {footTab === "validation" ? (
            validationErrors.length === 0 ? (
              <p className="inline-flex items-center gap-2 text-sm text-emerald-300/80"><CheckCircle2 className="size-4" aria-hidden /> {gt("No validation errors.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {validationErrors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-200/90">
                    <AlertTriangle className="size-3.5 mt-px shrink-0 text-amber-300" aria-hidden /> {e}
                  </li>
                ))}
              </ul>
            )
          ) : showJson ? (
            <div className="relative">
              <pre className="text-[11px] text-white/70 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-56">{generatedJson}</pre>
              <button
                onClick={() => { navigator.clipboard.writeText(generatedJson); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white"
              >
                {copied ? <><Check className="w-3 h-3" /> {gt("Copied")}</> : gt("Copy")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {sample.length === 0 && <p className="text-xs text-white/30">{gt("No sample data yet. Fields set to \"User Data\" will auto-appear here, or add them manually.")}</p>}
              {sample.map((entry, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input value={entry.name} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={gt("Key")} aria-label={gt("Key")} className="w-full sm:w-48 bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-[var(--sw-accent)]" />
                  <select value={entry.type} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, type: Number(e.target.value) } : x)))} aria-label={gt("Type")} className="bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] px-2 py-1.5 text-sm text-white [color-scheme:dark] focus:outline-none focus:border-[var(--sw-accent)]">
                    <option value={1}>{gt("String")}</option>
                    <option value={2}>{gt("Number")}</option>
                    <option value={3}>{gt("Media")}</option>
                  </select>
                  <input value={entry.value} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={entry.type === 3 ? gt("Image URL") : gt("Value")} aria-label={gt("Value")} className="flex-1 min-w-0 bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-[var(--sw-accent)]" />
                  <button onClick={() => setSample((s) => s.filter((_, j) => j !== i))} aria-label={gt("Remove field")} title={gt("Remove field")} className="sw-focus p-1 rounded text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" aria-hidden /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
