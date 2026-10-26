"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { Ban, Check, Palette, Plus, X } from "lucide-react";
import {
  DEFAULT_THEME_GRADIENT,
  THEME_GRADIENT_MAX_STOPS,
  THEME_GRADIENT_MIN_STOPS,
  THEME_SURFACES,
  THEME_TEXT,
  computeSurfaceOverrides,
  normalizeHexColor,
  renderThemeGradient,
  themeGradientCss,
  themeGradientKey,
  type AppThemeName,
  type ThemeGradient,
} from "@/lib/appearance/customization";
import { THEME_GRADIENT_PRESETS, findThemeGradientPreset, type ThemeGradientPreset, type ThemeGradientPresetId } from "@/lib/appearance/themeGradients";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface GradientThemePickerProps {
  /** Current gradient (raw, as stored); null = none / solid. */
  value: ThemeGradient | null;
  /** `debounce` is set while a colour or the angle is being dragged. */
  onChange: (next: ThemeGradient | null, opts?: { debounce?: boolean }) => void;
  /** Theme the preview is rendered for (the viewer's own). */
  previewTheme: AppThemeName;
  /** Accent shown in the preview (defaults to the live --app-accent). */
  previewAccent?: string | null;
  /** Offer the "None" swatch (default true). */
  allowNone?: boolean;
  /** Label for the "None" swatch (translated by the caller). */
  noneLabel?: string;
  /** Caption under the preview (translated by the caller). */
  previewCaption?: string;
}

/**
 * Gradient app theme picker (Discord's Appearance → Color Themes): a live
 * mini preview of the app over the gradient, round preset swatches, an
 * optional "None" (solid) swatch and a "Custom" editor with 2–3 colours and
 * an angle. Shared by user Appearance and Server Settings → Server Theme.
 * Presentation + local UI state only; callers own and save the value.
 */
export function GradientThemePicker({
  value,
  onChange,
  previewTheme,
  previewAccent,
  allowNone = true,
  noneLabel,
  previewCaption,
}: GradientThemePickerProps) {
  const gt = useGT();
  const [customOpen, setCustomOpen] = useState(false);
  const preset = findThemeGradientPreset(value);
  const isCustom = Boolean(value && !preset);
  const showEditor = isCustom || (customOpen && Boolean(value));
  const selectedKey = themeGradientKey(value);

  const presetName = (id: ThemeGradientPresetId) => {
    switch (id) {
      case "serika": return gt("Serika");
      case "midnight-blue": return gt("Midnight Blue");
      case "midnight-violet": return gt("Midnight Violet");
      case "twilight": return gt("Twilight");
      case "crimson-moon": return gt("Crimson Moon");
      case "mars": return gt("Mars");
      case "ember": return gt("Ember");
      case "forest": return gt("Forest");
      case "matcha": return gt("Matcha");
      case "under-the-sea": return gt("Under the Sea");
      case "ocean": return gt("Ocean");
      case "retro-storm": return gt("Retro Storm");
      case "sepia": return gt("Sepia");
      case "dusk": return gt("Dusk");
      case "sunset": return gt("Sunset");
      case "aurora": return gt("Aurora");
      case "chroma-glow": return gt("Chroma Glow");
      case "neon-nights": return gt("Neon Nights");
      case "cyberpunk": return gt("Cyberpunk");
      case "sakura-night": return gt("Sakura Night");
      case "glacier": return gt("Glacier");
      case "hanami": return gt("Hanami");
      case "mint-apple": return gt("Mint Apple");
      case "citrus-sherbert": return gt("Citrus Sherbert");
      case "retro-raincloud": return gt("Retro Raincloud");
      case "sunrise": return gt("Sunrise");
      case "cotton-candy": return gt("Cotton Candy");
      case "lofi-vibes": return gt("Lofi Vibes");
      case "desert-khaki": return gt("Desert Khaki");
      case "strawberry-lemonade": return gt("Strawberry Lemonade");
      case "lavender-haze": return gt("Lavender Haze");
      default: return gt("Easter Egg");
    }
  };

  // Hovering a swatch shows it in the preview before it's picked.
  const [hovered, setHovered] = useState<ThemeGradient | null | undefined>(undefined);
  const previewGradient = hovered !== undefined ? hovered : value;

  const pickPreset = (gradient: ThemeGradient) => {
    setCustomOpen(false);
    onChange(gradient);
  };

  const openCustom = () => {
    setCustomOpen(true);
    if (!value) onChange(DEFAULT_THEME_GRADIENT);
  };

  const editStop = (index: number, color: string, debounce: boolean) => {
    if (!value) return;
    const hex = normalizeHexColor(color);
    if (!hex) return;
    const stops = value.stops.map((s, i) => (i === index ? hex : s));
    setCustomOpen(true);
    onChange({ ...value, stops }, { debounce });
  };

  const addStop = () => {
    if (!value || value.stops.length >= THEME_GRADIENT_MAX_STOPS) return;
    setCustomOpen(true);
    onChange({ ...value, stops: [...value.stops, value.stops[value.stops.length - 1]] });
  };

  const removeStop = (index: number) => {
    if (!value || value.stops.length <= THEME_GRADIENT_MIN_STOPS) return;
    setCustomOpen(true);
    onChange({ ...value, stops: value.stops.filter((_, i) => i !== index) });
  };

  const setAngle = (angle: number) => {
    if (!value) return;
    setCustomOpen(true);
    onChange({ ...value, angle }, { debounce: true });
  };

  const renderPreset = (p: ThemeGradientPreset) => (
    <Swatch
      key={p.id}
      label={presetName(p.id)}
      selected={!showEditor && themeGradientKey(p.gradient) === selectedKey}
      onPick={() => pickPreset(p.gradient)}
      onHover={() => setHovered(p.gradient)}
      style={{ backgroundImage: themeGradientCss(p.gradient) }}
    />
  );

  return (
    <div className="space-y-4">
      <GradientThemePreview gradient={previewGradient} theme={previewTheme} accent={previewAccent} caption={previewCaption} />

      <div role="radiogroup" aria-label={gt("App theme")} className="space-y-5" onMouseLeave={() => setHovered(undefined)}>
        <SwatchGroup title={gt("Default")}>
          {allowNone && (
            <Swatch
              label={noneLabel || gt("None")}
              selected={!value}
              onPick={() => { setCustomOpen(false); onChange(null); }}
              onHover={() => setHovered(null)}
              style={{ backgroundColor: THEME_SURFACES[previewTheme].surface }}
            >
              <Ban className="absolute inset-0 m-auto h-5 w-5 text-[var(--text-muted)]" />
            </Swatch>
          )}
          <Swatch
            label={gt("Custom")}
            selected={showEditor}
            onPick={openCustom}
            onHover={() => setHovered(undefined)}
            dashed={!showEditor}
            style={showEditor && value ? { backgroundImage: themeGradientCss(value) } : undefined}
          >
            <Palette className={cn("absolute inset-0 m-auto h-5 w-5", showEditor ? "text-white drop-shadow" : "text-[var(--text-secondary)]")} />
          </Swatch>
        </SwatchGroup>
        <SwatchGroup title={gt("Deep colours")}>
          {THEME_GRADIENT_PRESETS.filter((p) => p.tone === "deep").map((p) => renderPreset(p))}
        </SwatchGroup>
        <SwatchGroup title={gt("Soft colours")}>
          {THEME_GRADIENT_PRESETS.filter((p) => p.tone === "soft").map((p) => renderPreset(p))}
        </SwatchGroup>
      </div>

      {showEditor && value && (
        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">{gt("Colours")}</p>
            <div className="flex flex-wrap items-center gap-3">
              {value.stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-1">
                  <label
                    className="relative h-10 w-14 cursor-pointer overflow-hidden rounded-lg border border-[var(--border-subtle)]"
                    style={{ backgroundColor: stop }}
                  >
                    <input
                      type="color"
                      aria-label={gt("Colour {number}", { number: i + 1 })}
                      value={stop}
                      onChange={(e) => editStop(i, e.target.value, true)}
                      className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0"
                    />
                  </label>
                  {value.stops.length > THEME_GRADIENT_MIN_STOPS && (
                    <button
                      type="button"
                      onClick={() => removeStop(i)}
                      aria-label={gt("Remove colour {number}", { number: i + 1 })}
                      title={gt("Remove colour")}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {value.stops.length < THEME_GRADIENT_MAX_STOPS && (
                <button
                  type="button"
                  onClick={addStop}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] px-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Plus className="h-4 w-4" />
                  {gt("Add colour")}
                </button>
              )}
            </div>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Angle")}</span>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={359}
                value={value.angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="flex-1 cursor-pointer accent-[var(--app-accent)]"
              />
              <span className="w-12 text-right text-xs tabular-nums text-[var(--text-secondary)]">{value.angle}°</span>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

function SwatchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">{title}</p>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

/** One round theme swatch (Discord's colour themes): name tooltip, check badge when picked. */
function Swatch({
  label,
  selected,
  onPick,
  onHover,
  style,
  dashed,
  children,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
  onHover: () => void;
  style?: React.CSSProperties;
  dashed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={label}
          onClick={onPick}
          onMouseEnter={onHover}
          onFocus={onHover}
          className={cn(
            "relative h-12 w-12 shrink-0 rounded-full transition-[transform,box-shadow] duration-(--motion-fast) hover:scale-[1.08] active:scale-95",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]",
            "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_2px_8px_-2px_rgba(0,0,0,0.45)]",
            selected && "ring-2 ring-[var(--app-accent)] ring-offset-[3px] ring-offset-[var(--bg-card)]",
            dashed && "border-2 border-dashed border-[var(--border-strong)] shadow-none",
          )}
          style={style}
        >
          {children}
          {selected && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent)] ring-2 ring-[var(--bg-card)]"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A small mock of the app (server rail, channel list, chat with a message
 * and the composer) painted exactly like the real shell: the rendered
 * gradient behind see-through surfaces from computeSurfaceOverrides.
 */
export function GradientThemePreview({
  gradient,
  theme,
  accent,
  caption,
}: {
  gradient: ThemeGradient | null;
  theme: AppThemeName;
  accent?: string | null;
  caption?: string;
}) {
  const gt = useGT();
  const rendered = gradient ? renderThemeGradient(gradient, theme) : null;
  const base = THEME_SURFACES[theme];
  const text = THEME_TEXT[theme];
  const surfaces = rendered ? computeSurfaceOverrides({ theme, gradient: rendered }) : null;
  const bg = surfaces?.["--app-bg"] ?? base.bg;
  const sidebar = surfaces?.["--bg-sidebar"] ?? base.sidebar;
  const surface = surfaces?.["--app-surface"] ?? base.surface;
  const surfaceAlt = surfaces?.["--app-surface-alt"] ?? base.surfaceAlt;
  const accentColor = normalizeHexColor(accent) ?? "var(--app-accent)";

  return (
    <figure className="space-y-2">
      <div
        aria-hidden
        className="relative h-36 overflow-hidden rounded-xl border border-[var(--border-subtle)] sm:h-40"
        style={{ background: rendered ? themeGradientCss(rendered) : base.bg }}
      >
        <div className="absolute inset-0 flex" style={{ backgroundColor: bg }}>
          {/* Server rail */}
          <div className="flex w-[11%] min-w-[34px] flex-col items-center gap-1.5 py-2" style={{ backgroundColor: bg }}>
            <span className="h-6 w-6 rounded-[35%]" style={{ backgroundColor: accentColor }} />
            <span className="h-6 w-6 rounded-full" style={{ backgroundColor: surfaceAlt }} />
            <span className="h-6 w-6 rounded-full" style={{ backgroundColor: surfaceAlt }} />
          </div>
          {/* Channel list */}
          <div className="flex w-[27%] flex-col gap-1.5 px-2 py-2.5" style={{ backgroundColor: sidebar }}>
            <span className="mb-1 block h-2 w-3/4 rounded-full" style={{ backgroundColor: text.primary, opacity: 0.85 }} />
            {[0.8, 0.6, 0.7, 0.5].map((w, i) => (
              <span
                key={i}
                className="block h-1.5 rounded-full"
                style={{ width: `${w * 100}%`, backgroundColor: i === 1 ? text.primary : text.secondary, opacity: i === 1 ? 0.9 : 0.7 }}
              />
            ))}
          </div>
          {/* Chat */}
          <div className="flex min-w-0 flex-1 flex-col" style={{ backgroundColor: bg }}>
            <div className="h-6 shrink-0 border-b px-2" style={{ backgroundColor: surface, borderColor: "rgba(127,127,127,0.18)" }}>
              <span className="mt-2 block h-1.5 w-1/3 rounded-full" style={{ backgroundColor: text.primary, opacity: 0.8 }} />
            </div>
            <div className="flex flex-1 flex-col justify-end gap-2 px-2.5 pb-1.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold leading-tight" style={{ color: text.primary }}>Serika</p>
                  <p className="truncate text-[11px] leading-snug" style={{ color: text.primary }}>
                    {gt("This is how chat looks with this theme.")}
                  </p>
                </div>
              </div>
              <div className="h-5 rounded-md" style={{ backgroundColor: surfaceAlt }} />
            </div>
          </div>
        </div>
      </div>
      {caption && <figcaption className="text-xs text-[var(--text-secondary)]">{caption}</figcaption>}
    </figure>
  );
}
