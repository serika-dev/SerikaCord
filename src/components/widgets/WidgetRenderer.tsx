"use client";

import { Gamepad2 } from "lucide-react";
import { cdnImage } from "@/lib/utils";

// ── Widget config types (mirrors widget_configs.surfaces / docs §3.1) ────────
export type WidgetValueType = "user_data" | "custom_string" | "app_asset";
export type WidgetPresentation = "text" | "number" | "duration";

export interface WidgetField {
  slot: string;
  valueType: WidgetValueType;
  presentationType?: WidgetPresentation;
  value: string;            // key (user_data) or literal (custom_string/app_asset url)
  fallback?: string;
}

export interface WidgetSurface {
  design: string;
  fields: WidgetField[];
}

export interface WidgetSurfaces {
  widget_top?: WidgetSurface;
  widget_bottom?: WidgetSurface;
  [k: string]: WidgetSurface | undefined;
}

export interface WidgetDynamicEntry {
  type: number;   // 1 = string, 3 = media (Discord convention)
  name: string;
  value: string | { url?: string };
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
  const parts = [Math.floor(s / 60), s % 60];
  return `${parts[0]}m ${parts[1]}s`;
}

function resolveField(field: WidgetField | undefined, data: WidgetUserData | null): string | null {
  if (!field) return null;
  if (field.valueType === "custom_string" || field.valueType === "app_asset") {
    return field.value || field.fallback || null;
  }
  // user_data → look up the dynamic entry by name.
  const entry = data?.dynamic?.find((d) => d.name === field.value);
  if (!entry) return field.fallback || null;
  const raw = typeof entry.value === "object" ? entry.value.url ?? null : entry.value;
  if (raw == null) return field.fallback || null;
  if (field.presentationType === "number") return String(Number(raw));
  if (field.presentationType === "duration") return formatDuration(Number(raw));
  return String(raw);
}

function fieldBySlot(surface: WidgetSurface | undefined, slot: string): WidgetField | undefined {
  return surface?.fields?.find((f) => f.slot === slot);
}

// ── Renderer ──────────────────────────────────────────────────────────────────
export function WidgetRenderer({
  config,
  data,
  icon,
}: {
  config: WidgetConfigShape;
  data: WidgetUserData | null;
  icon?: string | null;
}) {
  const top = config.surfaces?.widget_top;
  const bottom = config.surfaces?.widget_bottom;

  const topImage = resolveField(fieldBySlot(top, "image"), data);
  const topTitle = resolveField(fieldBySlot(top, "title"), data);
  const topSub1 = resolveField(fieldBySlot(top, "subtitle1"), data);
  const topSub2 = resolveField(fieldBySlot(top, "subtitle2"), data);

  // Bottom grid: collect (image, title, subtitle) triples by index.
  const bottomItems: Array<{ image: string | null; title: string | null; subtitle: string | null }> = [];
  if (bottom) {
    for (let i = 1; i <= 6; i++) {
      const title = resolveField(fieldBySlot(bottom, `field${i}Title`), data);
      const image = resolveField(fieldBySlot(bottom, `field${i}Image`), data);
      const subtitle = resolveField(fieldBySlot(bottom, `field${i}Value`), data);
      if (title || image || subtitle) bottomItems.push({ image, title, subtitle });
    }
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05]">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cdnImage(icon)} alt="" className="w-4 h-4 rounded" />
        ) : (
          <Gamepad2 className="w-4 h-4 text-white/40" />
        )}
        <span className="text-xs font-semibold text-white/80 truncate">{config.name}</span>
      </div>

      {/* Top surface */}
      {(topTitle || topImage) && (
        <div className="flex items-start gap-3 p-3">
          <div className="flex-1 min-w-0">
            {topTitle && <p className="text-sm font-semibold text-white truncate">{topTitle}</p>}
            {topSub1 && <p className="text-xs text-white/60 mt-0.5 line-clamp-2">{topSub1}</p>}
            {topSub2 && <p className="text-[11px] text-white/40 mt-0.5">{topSub2}</p>}
          </div>
          {topImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnImage(topImage)} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
          )}
        </div>
      )}

      {/* Bottom surface (stat grid) */}
      {bottomItems.length > 0 && (
        <div className="grid grid-cols-2 gap-2 p-3 pt-0">
          {bottomItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cdnImage(item.image)} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-white/[0.05] shrink-0" />
              )}
              <div className="min-w-0">
                {item.title && <p className="text-[11px] font-medium text-white truncate">{item.title}</p>}
                {item.subtitle && <p className="text-[10px] text-white/50 truncate">{item.subtitle}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
