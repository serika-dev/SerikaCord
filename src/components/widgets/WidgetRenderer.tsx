"use client";

import { cn } from "@/lib/utils";
import { WidgetImage } from "@/components/widgets/WidgetShell";
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
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  // Seconds are noise once a duration runs into hours.
  if (!h) parts.push(`${sec}s`);
  return parts.join(" ");
}

function formatNumber(raw: string | number): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  if (field.presentation_type === "number") return formatNumber(raw);
  if (field.presentation_type === "duration") return formatDuration(Number(raw));
  return String(raw);
}

function field(surface: WidgetSurface | undefined, comp: string, key: string): WidgetField | undefined {
  return surface?.components?.[comp]?.fields?.[key];
}

function resolve(surface: WidgetSurface | undefined, comp: string, key: string, data: WidgetUserData | null) {
  return resolveField(field(surface, comp, key), data);
}

/** Whether a surface resolves any real user-provided content (not static custom_string fallbacks). */
export function surfaceHasContent(surface: WidgetSurface | undefined, data: WidgetUserData | null): boolean {
  if (!surface?.components) return false;
  for (const comp of Object.values(surface.components)) {
    for (const f of Object.values(comp.fields ?? {})) {
      // Only count data-type fields as "real content" — custom_string/application_asset
      // are static config values that shouldn't make a widget visible by themselves.
      if (f.value_type === "data") {
        if (resolveField(f, data)) return true;
      }
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
/** Numeric value of a field, ignoring its display presentation (for maths). */
function resolveNumber(surface: WidgetSurface | undefined, comp: string, key: string, data: WidgetUserData | null): number | null {
  const f = field(surface, comp, key);
  if (!f) return null;
  const raw = resolveField({ ...f, presentation_type: "text" }, data);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ImageFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("bg-gradient-to-br from-[var(--sw-accent-deep)]/50 to-[var(--sw-accent-night)] ring-1 ring-inset ring-white/10", className)}
    />
  );
}

function Img({ src, alt = "", className }: { src: string; alt?: string; className: string }) {
  return <WidgetImage src={src} alt={alt} className={className} fallback={<ImageFallback className={className} />} />;
}

function Title({ children }: { children: string }) {
  return (
    <p className="font-display text-[17px] leading-tight font-semibold tracking-[-0.015em] text-[var(--sw-text)] line-clamp-2">
      {children}
    </p>
  );
}

function Description({ children }: { children: string }) {
  return <p className="text-[12.5px] text-[var(--sw-muted)] mt-1 line-clamp-3 leading-relaxed">{children}</p>;
}

function TopHero({ surface, data, contained }: { surface?: WidgetSurface; data: WidgetUserData | null; contained: boolean }) {
  const image = resolve(surface, "primary", "image", data);
  const title = resolve(surface, "primary", "title", data);
  const desc = resolve(surface, "primary", "description", data);
  if (!image && !title && !desc) return null;

  if (contained || !image) {
    return (
      <div className="flex items-start gap-3.5 p-3.5">
        <div className="flex-1 min-w-0 pt-0.5">
          {title && <Title>{title}</Title>}
          {desc && <Description>{desc}</Description>}
        </div>
        {image && <Img src={image} alt={title ?? ""} className="size-16 rounded-[8px] object-cover shrink-0 ring-1 ring-white/10 shadow-lg shadow-black/40" />}
      </div>
    );
  }
  // Hero: the image fills the right side and dissolves into the card (a mask,
  // not a painted gradient, so it works on any profile background).
  return (
    <div className="relative min-h-[124px] overflow-hidden">
      <div className="absolute inset-y-0 right-0 w-1/2 [mask-image:linear-gradient(to_left,black_40%,transparent)]">
        <Img src={image} alt={title ?? ""} className="w-full h-full object-cover" />
      </div>
      <div className="relative p-3.5 pr-4 max-w-[60%]">
        {title && <Title>{title}</Title>}
        {desc && <Description>{desc}</Description>}
      </div>
    </div>
  );
}

function StatTile({ value, label }: { value: string | null; label: string | null }) {
  return (
    <div className="min-w-0 rounded-[var(--sw-radius-inner)] bg-[var(--sw-surface-raised)] ring-1 ring-inset ring-white/[0.05] px-2.5 py-2">
      {value && <p className="font-display text-[15px] font-semibold tabular-nums text-[var(--sw-text)] truncate" title={value}>{value}</p>}
      {label && <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--sw-faint)] truncate mt-0.5" title={label}>{label}</p>}
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
  const cols = items.length === 1 ? "grid-cols-1" : items.length === 2 || items.length === 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={cn("grid gap-1.5 p-3.5", cols)}>
      {items.map((s, i) => <StatTile key={i} value={s.value} label={s.label} />)}
    </div>
  );
}

function Progress({ surface, data }: { surface?: WidgetSurface; data: WidgetUserData | null }) {
  const image = resolve(surface, "progress", "image", data);
  const label = resolve(surface, "progress", "label", data);
  const current = resolveNumber(surface, "progress", "current", data) ?? 0;
  const max = resolveNumber(surface, "progress", "max", data);
  const ratio = max && max > 0 ? current / max : current;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const stats = [1, 2, 3]
    .map((i) => ({ label: resolve(surface, `stat${i}`, "label", data), value: resolve(surface, `stat${i}`, "value", data) }))
    .filter((s) => s.label || s.value);
  if (!image && !label && !stats.length && !current) return null;
  const caption = max && max > 0 ? `${formatNumber(current)} / ${formatNumber(max)}` : `${Math.round(pct)}%`;
  return (
    <div className="flex items-center gap-3.5 p-3.5">
      {image && <Img src={image} alt={label ?? ""} className="size-16 rounded-[8px] object-cover shrink-0 ring-1 ring-white/10" />}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          {label && <p className="text-[13px] font-semibold text-[var(--sw-text)] truncate">{label}</p>}
          <span className="ml-auto text-[11px] font-medium tabular-nums text-[var(--sw-muted)] shrink-0">{caption}</span>
        </div>
        <div
          className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label={label ?? undefined}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--sw-accent-deep)] to-[var(--sw-accent)] shadow-[0_0_12px_rgba(139,92,246,0.6)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {stats.length > 0 && (
          <div className="flex gap-4 pt-0.5">
            {stats.map((s, i) => (
              <div key={i} className="min-w-0">
                {s.value && <p className="text-[12px] font-semibold tabular-nums text-[var(--sw-text)] truncate">{s.value}</p>}
                {s.label && <p className="text-[9.5px] uppercase tracking-[0.06em] text-[var(--sw-faint)] truncate">{s.label}</p>}
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
    <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-1.5 p-3.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2.5 min-w-0 rounded-[var(--sw-radius-inner)] bg-[var(--sw-surface-raised)] ring-1 ring-inset ring-white/[0.05] p-1.5 pr-2.5">
          {it.image ? (
            <Img src={it.image} alt={it.title ?? ""} className="size-10 rounded-[5px] object-cover shrink-0" />
          ) : (
            <ImageFallback className="size-10 rounded-[5px] shrink-0" />
          )}
          <div className="min-w-0">
            {it.title && <p className="text-[12px] font-medium text-[var(--sw-text)] truncate" title={it.title}>{it.title}</p>}
            {it.subtitle && <p className="text-[11px] text-[var(--sw-muted)] truncate" title={it.subtitle}>{it.subtitle}</p>}
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
  appName,
  mode = "widget",
}: {
  config: WidgetConfigShape;
  data: WidgetUserData | null;
  /** Application icon, shown in the widget's source strip. */
  icon?: string | null;
  /** Application name, shown in the widget's source strip. */
  appName?: string | null;
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
      <div className="sw-card flex items-center gap-2.5 p-2 pr-3">
        {image && (
          <Img
            src={image}
            alt={label ?? ""}
            className={contained ? "size-10 rounded-[6px] object-cover shrink-0" : "size-11 rounded-full object-cover shrink-0 ring-2 ring-[var(--sw-accent)]/40"}
          />
        )}
        <div className="min-w-0">
          {value && <p className="font-display text-[15px] font-semibold tabular-nums text-[var(--sw-text)] truncate">{value}</p>}
          {label && <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--sw-faint)] truncate">{label}</p>}
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
      <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--sw-muted)]">
        <span aria-hidden className="size-1.5 rounded-full bg-[var(--sw-accent)]" />
        {label ? `${label} ` : ""}
        <span className="text-[var(--sw-text)] font-medium tabular-nums">{value}</span>
      </p>
    );
  }

  const topSurface = mode === "add_preview" ? s.add_widget_preview ?? s.widget_top : s.widget_top;
  const contained = (topSurface?.layout || "").includes("contained");
  const bottomSurface = mode === "add_preview" ? s.add_widget_preview ?? s.widget_bottom : s.widget_bottom;
  const hasTop = surfaceHasAnything(topSurface, data, ["primary"]);
  const sourceLabel = appName || config.name;

  return (
    <div className="sw-card overflow-hidden">
      {(icon || sourceLabel) && (
        <div className="flex items-center gap-2 px-3.5 pt-3 -mb-1.5 min-w-0">
          {icon && <Img src={icon} alt="" className="size-4 rounded-[4px] object-cover shrink-0" />}
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-faint)] truncate">{sourceLabel}</span>
        </div>
      )}
      <TopHero surface={topSurface} data={data} contained={contained} />
      <div className={cn("empty:hidden", hasTop && "border-t border-[var(--sw-hairline)]")}>
        <BottomSurface surface={bottomSurface} data={data} />
      </div>
    </div>
  );
}

/** Whether any of the given components on a surface resolve to a value. */
function surfaceHasAnything(surface: WidgetSurface | undefined, data: WidgetUserData | null, comps: string[]): boolean {
  if (!surface?.components) return false;
  return comps.some((c) => Object.keys(surface.components[c]?.fields ?? {}).some((k) => resolve(surface, c, k, data)));
}
