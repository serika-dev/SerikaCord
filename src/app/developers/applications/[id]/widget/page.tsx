"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { WidgetRenderer, type WidgetField, type WidgetSurfaces } from "@/components/widgets/WidgetRenderer";
import { Save, Rocket, EyeOff, Plus, Trash2, Code2, Check } from "lucide-react";

// Default surface scaffold (Discord "Widget Top" + "Widget Bottom" designs).
const TOP_SLOTS = [
  { slot: "image", label: "Image", isImage: true, required: true },
  { slot: "title", label: "Title", required: true },
  { slot: "subtitle1", label: "Subtitle 1" },
  { slot: "subtitle2", label: "Subtitle 2" },
];
const BOTTOM_SLOTS = [1, 2, 3, 4].flatMap((i) => [
  { slot: `field${i}Image`, label: `Field ${i} · Image`, isImage: true },
  { slot: `field${i}Title`, label: `Field ${i} · Title` },
  { slot: `field${i}Value`, label: `Field ${i} · Value` },
]);

type Surfaces = WidgetSurfaces;

function emptySurfaces(): Surfaces {
  return {
    widget_top: { design: "image_title_subtitles", fields: [] },
    widget_bottom: { design: "grid_4_images", fields: [] },
  };
}

interface SampleEntry { name: string; type: number; value: string; }

export default function WidgetEditorPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("Widget");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [surfaces, setSurfaces] = useState<Surfaces>(emptySurfaces());
  const [sample, setSample] = useState<SampleEntry[]>([]);
  const [activeSurface, setActiveSurface] = useState<"widget_top" | "widget_bottom">("widget_top");
  const [selectedSlot, setSelectedSlot] = useState<string | null>("image");
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
            setSample(dyn.map((d: any) => ({ name: d.name, type: d.type ?? 1, value: typeof d.value === "object" ? d.value.url ?? "" : String(d.value ?? "") })));
          }
        }
      } catch {
        toast.error(gt("Failed to load widget"));
      } finally {
        setLoading(false);
      }
    })();
  }, [appId, gt]);

  // ── Field helpers ──────────────────────────────────────────────────────────
  const currentFields = surfaces[activeSurface]?.fields ?? [];
  const getField = (slot: string): WidgetField | undefined => currentFields.find((f) => f.slot === slot);

  const setField = useCallback((slot: string, patch: Partial<WidgetField>) => {
    setSurfaces((prev) => {
      const surface = prev[activeSurface] ?? { design: "", fields: [] };
      const existing = surface.fields.find((f) => f.slot === slot);
      const nextFields = existing
        ? surface.fields.map((f) => (f.slot === slot ? { ...f, ...patch } : f))
        : [...surface.fields, { slot, valueType: "custom_string", value: "", ...patch } as WidgetField];
      return { ...prev, [activeSurface]: { ...surface, fields: nextFields } };
    });
  }, [activeSurface]);

  const clearField = (slot: string) => {
    setSurfaces((prev) => {
      const surface = prev[activeSurface];
      if (!surface) return prev;
      return { ...prev, [activeSurface]: { ...surface, fields: surface.fields.filter((f) => f.slot !== slot) } };
    });
  };

  // ── Sample data → renderer data ─────────────────────────────────────────────
  const rendererData = useMemo(() => ({
    dynamic: sample.map((s) => ({ name: s.name, type: s.type, value: s.type === 3 ? { url: s.value } : s.value })),
  }), [sample]);

  const generatedJson = useMemo(() => JSON.stringify({ data: rendererData }, null, 2), [rendererData]);

  // ── Save / publish ──────────────────────────────────────────────────────────
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

  const slots = activeSurface === "widget_top" ? TOP_SLOTS : BOTTOM_SLOTS;
  const selected = selectedSlot ? slots.find((s) => s.slot === selectedSlot) : null;
  const selectedField = selectedSlot ? getField(selectedSlot) : undefined;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader /></div>;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent text-xl font-bold text-white border-b border-transparent hover:border-white/20 focus:border-[#8B5CF6] focus:outline-none px-1"
          />
          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${status === "published" ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/50"}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm text-white disabled:opacity-50">
            <Save className="w-4 h-4" /> {gt("Save")}
          </button>
          <button onClick={togglePublish} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7c4ff0] text-sm text-white">
            {status === "published" ? <><EyeOff className="w-4 h-4" /> {gt("Unpublish")}</> : <><Rocket className="w-4 h-4" /> {gt("Publish")}</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_260px] gap-4">
        {/* Left: surface + field list */}
        <div className="space-y-4">
          <div className="flex gap-1 p-1 rounded-lg bg-white/[0.03]">
            {(["widget_top", "widget_bottom"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setActiveSurface(s); setSelectedSlot((s === "widget_top" ? TOP_SLOTS : BOTTOM_SLOTS)[0].slot); }}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${activeSurface === s ? "bg-[#8B5CF6] text-white" : "text-white/50 hover:text-white"}`}
              >
                {s === "widget_top" ? gt("Top") : gt("Bottom")}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {slots.map((s) => {
              const configured = !!getField(s.slot)?.value;
              return (
                <button
                  key={s.slot}
                  onClick={() => setSelectedSlot(s.slot)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${selectedSlot === s.slot ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04]"}`}
                >
                  <span className="truncate">{s.label}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {Boolean((s as { required?: boolean }).required) && <span className="text-[9px] uppercase text-amber-300/80">{gt("req")}</span>}
                    <span className={`w-1.5 h-1.5 rounded-full ${configured ? "bg-green-400" : "bg-white/20"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: live preview */}
        <div className="flex flex-col items-center justify-start gap-3 p-6 rounded-xl bg-[#111116] border border-white/[0.05] min-h-[320px]">
          <span className="text-[10px] uppercase tracking-wide text-white/30">{gt("Live preview")}</span>
          <div className="w-full max-w-sm">
            <WidgetRenderer config={{ name, surfaces }} data={rendererData} />
          </div>
        </div>

        {/* Right: field inspector */}
        <div className="space-y-3">
          {selected ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{selected.label}</h3>
                {selectedField && <button onClick={() => clearField(selected.slot)} className="text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div>
                <label className="text-[11px] text-white/50 uppercase">{gt("Value type")}</label>
                <select
                  value={selectedField?.valueType ?? "custom_string"}
                  onChange={(e) => setField(selected.slot, { valueType: e.target.value as WidgetField["valueType"] })}
                  className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                >
                  <option value="custom_string">{gt("Custom String")}</option>
                  <option value="user_data">{gt("User Data")}</option>
                  {selected.isImage && <option value="app_asset">{gt("Application Asset")}</option>}
                </select>
              </div>
              {!selected.isImage && selectedField?.valueType === "user_data" && (
                <div>
                  <label className="text-[11px] text-white/50 uppercase">{gt("Presentation")}</label>
                  <select
                    value={selectedField?.presentationType ?? "text"}
                    onChange={(e) => setField(selected.slot, { presentationType: e.target.value as WidgetField["presentationType"] })}
                    className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                  >
                    <option value="text">{gt("Text")}</option>
                    <option value="number">{gt("Number")}</option>
                    <option value="duration">{gt("Duration")}</option>
                  </select>
                </div>
              )}
              <div>
                <label className="text-[11px] text-white/50 uppercase">
                  {selectedField?.valueType === "user_data" ? gt("Data field (key)") : selected.isImage ? gt("Image URL") : gt("Content")}
                </label>
                <input
                  value={selectedField?.value ?? ""}
                  onChange={(e) => setField(selected.slot, { value: e.target.value })}
                  placeholder={selectedField?.valueType === "user_data" ? "TopShowTitle" : selected.isImage ? "https://…" : gt("Enter text")}
                  className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              {selectedField?.valueType === "user_data" && (
                <div>
                  <label className="text-[11px] text-white/50 uppercase">{gt("Fallback")}</label>
                  <input
                    value={selectedField?.fallback ?? ""}
                    onChange={(e) => setField(selected.slot, { fallback: e.target.value })}
                    className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-white/30">{gt("Select a field to edit")}</p>
          )}
        </div>
      </div>

      {/* Bottom: sample data / JSON */}
      <div className="mt-6 rounded-xl bg-white/[0.02] border border-white/[0.05] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">{gt("Sample data")}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setSample((s) => [...s, { name: "", type: 1, value: "" }])} className="flex items-center gap-1 text-xs text-[#8B5CF6] hover:underline">
              <Plus className="w-3.5 h-3.5" /> {gt("Add field")}
            </button>
            <button onClick={() => setShowJson((v) => !v)} className="flex items-center gap-1 text-xs text-white/60 hover:text-white">
              <Code2 className="w-3.5 h-3.5" /> {gt("Generate JSON")}
            </button>
          </div>
        </div>
        {showJson ? (
          <div className="relative">
            <pre className="text-[11px] text-white/70 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-64">{generatedJson}</pre>
            <button
              onClick={() => { navigator.clipboard.writeText(generatedJson); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white"
            >
              {copied ? <><Check className="w-3 h-3" /> {gt("Copied")}</> : gt("Copy")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {sample.length === 0 && <p className="text-xs text-white/30">{gt("No sample data. Add fields matching your User Data keys.")}</p>}
            {sample.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={entry.name}
                  onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder={gt("Key")}
                  className="w-40 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
                <select
                  value={entry.type}
                  onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, type: Number(e.target.value) } : x)))}
                  className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white"
                >
                  <option value={1}>{gt("String")}</option>
                  <option value={3}>{gt("Media")}</option>
                </select>
                <input
                  value={entry.value}
                  onChange={(e) => setSample((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder={entry.type === 3 ? gt("Image URL") : gt("Value")}
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
                <button onClick={() => setSample((s) => s.filter((_, j) => j !== i))} className="text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
