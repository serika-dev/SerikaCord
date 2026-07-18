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
import { ArrowLeft, Save, Rocket, EyeOff, Plus, Trash2, Code2, Check, Trash, Sparkles } from "lucide-react";

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

  return (
    <div className="fixed inset-0 z-[60] bg-[#0a0a0a] text-white flex flex-col">
      {/* Top bar */}
      <header className="h-14 shrink-0 border-b border-white/[0.06] flex items-center px-4 gap-3">
        <button onClick={() => router.push(`/developers/applications/${appId}`)} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/70">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-base font-bold text-white border-b border-transparent hover:border-white/20 focus:border-[#8B5CF6] focus:outline-none px-1"
        />
        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${status === "published" ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/50"}`}>
          {status === "published" ? gt("Published") : gt("Draft")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {gt("Save changes")}
          </button>
          <button onClick={togglePublish} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7c4ff0] text-sm">
            {status === "published" ? <><EyeOff className="w-4 h-4" /> {gt("Unpublish")}</> : <><Rocket className="w-4 h-4" /> {gt("Publish")}</>}
          </button>
          <button onClick={del} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/90 hover:bg-red-500 text-sm">
            <Trash className="w-4 h-4" /> {gt("Delete")}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Left panel */}
        <aside className="w-[340px] shrink-0 border-r border-white/[0.06] flex flex-col">
          <div className="p-4 border-b border-white/[0.06]">
            <select
              value={activeSurface}
              onChange={(e) => { setActiveSurface(e.target.value as WidgetSurfaceType); setSelected(null); setTab("design"); }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6] [color-scheme:dark]"
            >
              {WIDGET_SURFACES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div className="flex border-b border-white/[0.06]">
            {(["design", "content"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 text-sm border-b-2 transition-colors ${tab === t ? "border-[#8B5CF6] text-[#8B5CF6]" : "border-transparent text-white/50 hover:text-white"}`}>
                {t === "design" ? gt("Design") : gt("Content")}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {tab === "design" ? (
              <>
                <p className="text-[11px] uppercase tracking-wide text-white/40 mb-2">{gt("Select layout")}</p>
                {surfaceDef?.layouts.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setLayout(activeSurface, l.key)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${layoutKey === l.key ? "border-[#8B5CF6] bg-[#8B5CF6]/[0.08]" : "border-white/[0.06] hover:border-white/20"}`}
                  >
                    <p className="text-sm font-medium text-white">{l.label}</p>
                    <p className="text-[11px] text-white/40 mt-0.5">{l.description}</p>
                  </button>
                ))}
              </>
            ) : (
              layoutDef?.components.map((comp) => (
                <div key={comp.key} className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-white/40 mt-2">{comp.label}</p>
                  {comp.fields.map((f) => {
                    const configured = !!getField(comp.key, f.key)?.value;
                    const isSel = selected?.comp === comp.key && selected?.field === f.key;
                    return (
                      <button
                        key={f.key}
                        onClick={() => setSelected({ comp: comp.key, field: f.key })}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${isSel ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04]"}`}
                      >
                        <span className="truncate">{f.label}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {f.required && <span className="text-[9px] uppercase font-bold text-amber-300/80">{gt("Required")}</span>}
                          <span className={`w-1.5 h-1.5 rounded-full ${configured ? "bg-green-400" : "bg-white/20"}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Center preview — a lighter "stage" so the dark widget card stands out */}
        <main className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 bg-[#232428] p-6 [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_70%)]">
          <span className="text-[10px] uppercase tracking-wide text-white/40">{gt("Live preview")}</span>
          <div className="w-full max-w-sm shadow-2xl shadow-black/50">
            <WidgetRenderer config={{ name, surfaces }} data={rendererData} mode={previewMode(activeSurface)} />
          </div>
        </main>

        {/* Right inspector */}
        <aside className="w-[300px] shrink-0 border-l border-white/[0.06] p-4 overflow-y-auto">
          {selectedDef ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{selectedDef.label}</h3>
                {selectedField && <button onClick={() => clearField(selected!.comp, selected!.field)} className="text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div>
                <label className="text-[11px] text-white/50 uppercase">{gt("Value type")}</label>
                <select
                  value={selectedField?.value_type ?? "custom_string"}
                  onChange={(e) => setField(selected!.comp, selected!.field, { value_type: e.target.value as WidgetField["value_type"] })}
                  className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6] [color-scheme:dark]"
                >
                  <option value="custom_string">{gt("Custom String")}</option>
                  <option value="data">{gt("User Data")}</option>
                  {selectedDef.kind === "image" && <option value="application_asset">{gt("Application Asset")}</option>}
                </select>
              </div>
              {selectedDef.kind === "text" && selectedField?.value_type === "data" && (selectedDef.allowedPresentationTypes?.length ?? 0) > 1 && (
                <div>
                  <label className="text-[11px] text-white/50 uppercase">{gt("Presentation")}</label>
                  <select
                    value={selectedField?.presentation_type ?? "text"}
                    onChange={(e) => setField(selected!.comp, selected!.field, { presentation_type: e.target.value as WidgetField["presentation_type"] })}
                    className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                  >
                    {selectedDef.allowedPresentationTypes?.map((p) => (
                      <option key={p} value={p}>{p === "text" ? gt("Text") : p === "number" ? gt("Number") : gt("Duration")}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[11px] text-white/50 uppercase">
                  {selectedField?.value_type === "data" ? gt("Data field (key)") : selectedDef.kind === "image" ? gt("Image URL") : gt("Content")}
                </label>
                <input
                  value={selectedField?.value ?? ""}
                  onChange={(e) => setField(selected!.comp, selected!.field, { value: e.target.value })}
                  placeholder={selectedField?.value_type === "data" ? "TopShowTitle" : selectedDef.kind === "image" ? "https://…" : gt("Enter text")}
                  className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              {selectedField?.value_type === "data" && (
                <div>
                  <label className="text-[11px] text-white/50 uppercase">{gt("Fallback")}</label>
                  <input
                    value={typeof selectedField?.fallback === "string" ? selectedField.fallback : ""}
                    onChange={(e) => setField(selected!.comp, selected!.field, { fallback: e.target.value })}
                    className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
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
                  className="flex items-center gap-1.5 text-xs text-[#8B5CF6] hover:text-[#a78bfa] transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" /> {gt("Edit first field")}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Footer: validation / sample data */}
      <footer className="shrink-0 border-t border-white/[0.06] max-h-[38%] overflow-y-auto">
        <div className="flex items-center gap-4 px-4 pt-2">
          {(["validation", "sample"] as const).map((t) => (
            <button key={t} onClick={() => setFootTab(t)} className={`py-2 text-sm border-b-2 transition-colors ${footTab === t ? "border-[#8B5CF6] text-[#8B5CF6]" : "border-transparent text-white/50 hover:text-white"}`}>
              {t === "validation" ? gt("Validation") : gt("Sample Data")}
            </button>
          ))}
          {footTab === "sample" && (
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => setSample((s) => [...s, { name: "", type: 1, value: "" }])} className="flex items-center gap-1 text-xs text-[#8B5CF6] hover:underline">
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
              <p className="text-sm text-white/40">{gt("No validation errors.")}</p>
            ) : (
              <ul className="space-y-1">
                {validationErrors.map((e, i) => <li key={i} className="text-xs text-amber-300/80">• {e}</li>)}
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
                <div key={i} className="flex items-center gap-2">
                  <input value={entry.name} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={gt("Key")} className="w-48 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]" />
                  <select value={entry.type} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, type: Number(e.target.value) } : x)))} className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white [color-scheme:dark]">
                    <option value={1}>{gt("String")}</option>
                    <option value={2}>{gt("Number")}</option>
                    <option value={3}>{gt("Media")}</option>
                  </select>
                  <input value={entry.value} onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={entry.type === 3 ? gt("Image URL") : gt("Value")} className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]" />
                  <button onClick={() => setSample((s) => s.filter((_, j) => j !== i))} className="text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
