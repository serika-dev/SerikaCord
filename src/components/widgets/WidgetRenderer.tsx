"use client";

import { Gamepad2 } from "lucide-react";
import { cdnImage } from "@/lib/utils";
import { WIDGET_LAYOUT_BY_KEY } from "@/lib/constants/widgets";

// ── Widget config types (1:1 with the nested Discord surface shape) ──────────
export type WidgetValueType = "data" | "custom_string" | "application_asset";
export type WidgetPresentation = "text" | "number" | "duration";

export interface WidgetField {
  value_type: WidgetValueType;
  presentation_type?: WidgetPresentation;
  value: string; // key (data) or literal (custom_string / application_asset url)
  fallback?: WidgetField | string;
}

export interface WidgetComponent {
  fields: Record<string, WidgetField>;
}

export interface WidgetSurface {
  layout: string;
  components: Record<string, WidgetComponent>;
}

export interface WidgetSurfaces {
  widget_top?: WidgetSurface;
  widget_bottom?: WidgetSurface;
  add_widget_preview?: WidgetSurface;
  mini_profile?: WidgetSurface;
  activity_accessory?: WidgetSurface;
  [k: string]: WidgetSurface | undefined;
}

export interface WidgetDynamicEntry {
  type: number; // 1 = string, 2 = number, 3 = media (Discord convention)
  name: string;
  value: string | number | { url?: string };
}

export interface WidgetUserData {
  dynamic?: WidgetDynamicEntry[];
}

export interface WidgetConfigShape {
  name: string;
  surfaces: WidgetSurfaces;
}

// ── Field resolution ─────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

export function resolveField(field: WidgetField | undefined, data: WidgetUserData | null): string | null {
  if (!field) return null;
  const fallback = () =>
    typeof field.fallback === "string"
      ? field.fallback || null
      : field.fallback
        ? resolveField(field.fallback, data)
        : null;

  if (field.value_type === "custom_string" || field.value_type === "application_asset") {
    return field.value || fallback();
  }
  // data → look up the dynamic entry by name.
  const entry = data?.dynamic?.find((d) => d.name === field.value);
  if (!entry) return fallback();
  const raw = typeof entry.value === "object" ? entry.value?.url ?? null : entry.value;
  if (raw == null || raw === "") return fallback();
  if (field.presentation_type === "number") return String(Number(raw));
  if (field.presentation_type === "duration") return formatDuration(Number(raw));
  return String(raw);
}

function field(surface: WidgetSurface | undefined, comp: string, key: string): WidgetField | undefined {
  return surface?.components?.[comp]?.fields?.[key];
}

function resolve(surface: WidgetSurface | undefined, comp: string, key: string, data: WidgetUserData | null) {
  return resolveField(field(surface, comp, key), data);
}

/** Whether a surface resolves any content (used to hide empty widgets). */
export function surfaceHasContent(surface: WidgetSurface | undefined, data: WidgetUserData | null): boolean {
  if (!surface?.components) return false;
  for (const comp of Object.values(surface.components)) {
    for (const f of Object.values(comp.fields ?? {})) {
      if (resolveField(f, data)) return true;
    }
  }
  return false;
}

/** Whether the whole widget resolves any renderable content. */
export function widgetHasContent(config: WidgetConfigShape | undefined, data: WidgetUserData | null): boolean {
  if (!config?.surfaces) return false;
  return surfaceHasContent(config.surfaces.widget_top, data) || surfaceHasContent(config.surfaces.widget_bottom, data);
}

// ── Sub-renderers ─────────────────────────────────────────────────────────────
function Img({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={cdnImage(src)} alt="" className={className} />;
}

function TopHero({ surface, data, contained }: { surface?: WidgetSurface; data: WidgetUserData | null; contained: boolean }) {
  const image = resolve(surface, "primary", "image", data);
  const title = resolve(surface, "primary", "title", data);
  const desc = resolve(surface, "primary", "description", data);
  if (!image && !title && !desc) return null;

  if (contained) {
    return (
      <div className="flex items-start gap-3 p-3">
        <div className="flex-1 min-w-0">
          {title && <p className="text-base font-bold text-white">{title}</p>}
          {desc && <p className="text-xs text-white/60 mt-1 line-clamp-3">{desc}</p>}
        </div>
        {image && <Img src={image} className="w-16 h-16 rounded-lg object-cover shrink-0" />}
      </div>
    );
  }
  // Hero: full-height image right, fade to the text on the left.
  return (
    <div className="relative min-h-[104px] overflow-hidden">
      {image && (
        <div className="absolute inset-y-0 right-0 w-1/2">
          <Img src={image} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#101013] via-[#101013]/70 to-transparent" />
        </div>
      )}
      <div className="relative p-3 pr-24 max-w-[70%]">
        {title && <p className="text-base font-bold text-white">{title}</p>}
        {desc && <p className="text-xs text-white/60 mt-1 line-clamp-3">{desc}</p>}
      </div>
    </div>
  );
}

function StatsGrid({ surface, data, count }: { surface?: WidgetSurface; data: WidgetUserData | null; count: number }) {
  const items = Array.from({ length: count }, (_, i) => i + 1)
    .map((i) => ({
      label: resolve(surface, `stat${i}`, "label", data),
      value: resolve(surface, `stat${i}`, "value", data),
    }))
    .filter((s) => s.label || s.value);
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {items.map((s, i) => (
        <div key={i} className="min-w-0">
          {s.value && <p className="text-sm font-bold text-white truncate">{s.value}</p>}
          {s.label && <p className="text-[10px] uppercase tracking-wide text-white/40 truncate">{s.label}</p>}
        </div>
      ))}
    </div>
  );
}

function Progress({ surface, data }: { surface?: WidgetSurface; data: WidgetUserData | null }) {
  const image = resolve(surface, "progress", "image", data);
  const label = resolve(surface, "progress", "label", data);
  const current = Number(resolve(surface, "progress", "current", data) ?? 0);
  const maxRaw = resolve(surface, "progress", "max", data);
  const max = maxRaw != null ? Number(maxRaw) : null;
  const pct = max ? Math.min(100, (current / max) * 100) : Math.min(100, current * 100);
  const stats = [1, 2, 3]
    .map((i) => ({ label: resolve(surface, `stat${i}`, "label", data), value: resolve(surface, `stat${i}`, "value", data) }))
    .filter((s) => s.label || s.value);
  if (!image && !label && !stats.length && !current) return null;
  return (
    <div className="flex items-center gap-3 p-3">
      {image && <Img src={image} className="w-16 h-16 rounded-lg object-cover shrink-0" />}
      <div className="flex-1 min-w-0 space-y-2">
        {label && <p className="text-sm font-semibold text-white truncate">{label}</p>}
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[#8B5CF6]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-white/40">{max ? `${current} / ${max}` : `${Math.round(pct)}%`}</p>
        {stats.length > 0 && (
          <div className="flex gap-4">
            {stats.map((s, i) => (
              <div key={i}>
                {s.value && <p className="text-xs font-bold text-white">{s.value}</p>}
                {s.label && <p className="text-[9px] uppercase text-white/40">{s.label}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Collection({ surface, data }: { surface?: WidgetSurface; data: WidgetUserData | null }) {
  const items = [1, 2, 3, 4]
    .map((i) => ({
      image: resolve(surface, `item${i}`, "image", data),
      title: resolve(surface, `item${i}`, "title", data),
      subtitle: resolve(surface, `item${i}`, "subtitle", data),
    }))
    .filter((it) => it.image || it.title || it.subtitle);
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0">
          {it.image ? <Img src={it.image} className="w-9 h-9 rounded object-cover shrink-0" /> : <div className="w-9 h-9 rounded bg-white/[0.05] shrink-0" />}
          <div className="min-w-0">
            {it.title && <p className="text-[11px] font-medium text-white truncate">{it.title}</p>}
            {it.subtitle && <p className="text-[10px] text-white/50 truncate">{it.subtitle}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BottomSurface({ surface, data }: { surface?: WidgetSurface; data: WidgetUserData | null }) {
  if (!surface) return null;
  const layout = surface.layout || WIDGET_LAYOUT_BY_KEY[surface.layout]?.key;
  if (layout === "widget_bottom_progress") return <Progress surface={surface} data={data} />;
  if (layout === "widget_bottom_collection") return <Collection surface={surface} data={data} />;
  return <StatsGrid surface={surface} data={data} count={6} />;
}

// ── Renderer ──────────────────────────────────────────────────────────────────
export function WidgetRenderer({
  config,
  data,
  icon,
  mode = "widget",
}: {
  config: WidgetConfigShape;
  data: WidgetUserData | null;
  icon?: string | null;
  /** Which surface family to render. Defaults to the full profile widget. */
  mode?: "widget" | "add_preview" | "mini_profile" | "activity_accessory";
}) {
  const s = config.surfaces ?? {};

  if (mode === "mini_profile") {
    const surface = s.mini_profile;
    const image = resolve(surface, "primary", "image", data);
    const value = resolve(surface, "primary", "value", data);
    const label = resolve(surface, "primary", "label", data);
    const contained = surface?.layout === "mini_profile_contained_stat";
    if (!image && !value) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] p-2">
        {image && <Img src={image} className={contained ? "w-10 h-10 rounded-lg object-cover" : "w-12 h-12 rounded-full object-cover"} />}
        <div className="min-w-0">
          {value && <p className="text-sm font-bold text-white truncate">{value}</p>}
          {label && <p className="text-[10px] uppercase text-white/40 truncate">{label}</p>}
        </div>
      </div>
    );
  }

  if (mode === "activity_accessory") {
    const surface = s.activity_accessory;
    const value = resolve(surface, "primary", "value", data);
    const label = resolve(surface, "primary", "label", data);
    if (!value && !label) return null;
    return (
      <p className="text-[11px] text-white/50">
        {label ? `${label} ` : ""}
        <span className="text-white/80 font-medium">{value}</span>
      </p>
    );
  }

  const topSurface = mode === "add_preview" ? s.add_widget_preview ?? s.widget_top : s.widget_top;
  const contained = (topSurface?.layout || "").includes("contained");
  const bottomSurface = mode === "add_preview" ? s.add_widget_preview ?? s.widget_bottom : s.widget_bottom;

  return (
    <div className="rounded-2xl bg-[#101013] border border-white/[0.07] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05]">
        {icon ? <Img src={icon} className="w-4 h-4 rounded" /> : <Gamepad2 className="w-4 h-4 text-white/40" />}
        <span className="text-xs font-semibold text-white/80 truncate">{config.name}</span>
      </div>
      <TopHero surface={topSurface} data={data} contained={contained} />
      <BottomSurface surface={bottomSurface} data={data} />
    </div>
  );
}
