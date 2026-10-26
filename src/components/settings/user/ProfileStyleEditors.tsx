"use client";

import { memo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useGT } from "gt-next";
import { Check, Pencil, RotateCcw } from "lucide-react";
import { NAMEPLATE_PRESETS, getNameplateBackground, type NameplateCustomization } from "@/lib/constants/nameplates";
import { NameplateImagePicker } from "@/components/settings/NameplateImagePicker";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { cdnImage, cn } from "@/lib/utils";

/*
 * The colour-heavy parts of Settings → Profiles. They are memoized and only
 * take their own value + setter, so typing in the bio or display name doesn't
 * re-render ~100 swatch buttons on every keystroke.
 */

export interface DisplayNameStyle {
  font?: "default" | "serif" | "mono" | "rounded" | "cursive" | "bold";
  effect?: "solid" | "gradient" | "neon" | "toon" | "pop";
  color?: string;
  gradient?: string[];
}

const SOLID_SWATCHES = [
  "#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6",
  "#D946EF", "#FF1744", "#00E676", "#00B0FF", "#D500F9", "#FF9800", "#9C27B0",
];

const GRADIENT_SWATCHES: string[][] = [
  ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
  ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#F50057", "#FF3366"],
  ["#FF9800", "#FF5722"], ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#3F51B5", "#2196F3"],
  ["#00BCD4", "#009688"], ["#CDDC39", "#FFEB3B"], ["#FFC107", "#FF5722"],
];

const NAMEPLATE_SOLIDS = ["#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6", "#D946EF", "#FF9800", "#9C27B0", "#434343"];

const NAMEPLATE_GRADIENTS: string[][] = [
  ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
  ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#FF9800", "#FF5722"],
  ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#00BCD4", "#009688"], ["#434343", "#000000"],
];

const SELECTED_RING = { boxShadow: "0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)" } as const;

function sameColors(a: string[] | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((c, i) => c === b[i]);
}

/** Uppercase field label with an optional reset button (Discord's profile editor). */
function FieldLabel({ children, onReset, resetLabel }: { children: ReactNode; onReset?: () => void; resetLabel?: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{children}</span>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          title={resetLabel}
          aria-label={resetLabel}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Round colour input with a pencil, opening the native picker. */
function CustomColorDot({ value, onChange, size = "md", label }: { value: string; onChange: (v: string) => void; size?: "sm" | "md"; label: string }) {
  return (
    <label
      className={cn(
        "relative shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 ring-transparent transition-shadow hover:ring-[var(--border-strong)]",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
      )}
      style={{ backgroundColor: value }}
      title={label}
    >
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0" />
      <Pencil className={cn("pointer-events-none absolute inset-0 m-auto text-white drop-shadow-md", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
    </label>
  );
}

/** Two native colour pickers on a gradient bar. */
function GradientBar({ from, to, onChange, angle = 90, label }: { from: string; to: string; onChange: (next: [string, string]) => void; angle?: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">{label}</span>
      <div className="flex h-10 flex-1 items-center justify-between rounded-lg px-2.5" style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }}>
        {([from, to] as const).map((value, i) => (
          <label key={i} className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full shadow ring-2 ring-white/70" style={{ backgroundColor: value }}>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(i === 0 ? [e.target.value, to] : [from, e.target.value])}
              className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Swatch({ background, selected, onClick, shape = "circle", label }: { background: string; selected: boolean; onClick: () => void; shape?: "circle" | "pill"; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn("relative shrink-0 transition-transform duration-(--motion-fast) hover:scale-110", shape === "circle" ? "h-8 w-8 rounded-full" : "h-7 w-9 rounded-md")}
      style={{ background, ...(selected ? SELECTED_RING : null) }}
    >
      {selected && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow-md" />}
    </button>
  );
}

export const DisplayNameStyleEditor = memo(function DisplayNameStyleEditor({
  value,
  onChange,
}: {
  value: DisplayNameStyle;
  onChange: Dispatch<SetStateAction<DisplayNameStyle>>;
}) {
  const gt = useGT();
  const fonts = [
    { value: "default", label: gt("Default") },
    { value: "serif", label: gt("Serif") },
    { value: "mono", label: gt("Mono") },
    { value: "rounded", label: gt("Rounded") },
    { value: "cursive", label: gt("Cursive") },
    { value: "bold", label: gt("Bold") },
  ] as const;
  const effects = [
    { value: "solid", label: gt("Solid") },
    { value: "gradient", label: gt("Gradient") },
    { value: "neon", label: gt("Neon") },
    { value: "toon", label: gt("Toon") },
    { value: "pop", label: gt("Pop") },
  ] as const;
  const g0 = value.gradient?.[0] || "#8B5CF6";
  const g1 = value.gradient?.[1] || "#EC4899";

  return (
    <div className="space-y-6">
      <div>
        <FieldLabel onReset={() => onChange((s) => ({ ...s, font: "default" }))} resetLabel={gt("Reset Font")}>{gt("Choose Font")}</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          {fonts.map((font) => {
            const selected = value.font === font.value;
            return (
              <button
                key={font.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange((s) => ({ ...s, font: font.value }))}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 transition-colors duration-(--motion-fast)",
                  selected
                    ? "border-[var(--app-accent)] bg-[var(--bg-active)] text-[var(--text-primary)]"
                    : "border-transparent bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <span className={cn("text-[18px] leading-none", getDisplayNameStyleClasses({ font: font.value }))} style={getDisplayNameStyleInline({ font: font.value })}>
                  {font.label}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Aa</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel onReset={() => onChange((s) => ({ ...s, effect: "solid" }))} resetLabel={gt("Reset Effect")}>{gt("Choose Effect")}</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          {effects.map((effect) => {
            const selected = value.effect === effect.value;
            return (
              <button
                key={effect.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange((s) => ({ ...s, effect: effect.value }))}
                className={cn(
                  "flex h-[52px] items-center justify-center rounded-lg border-2 text-[15px] font-medium transition-colors duration-(--motion-fast)",
                  selected
                    ? "border-[var(--app-accent)] bg-[var(--bg-active)]"
                    : "border-transparent bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <span
                  className={cn(
                    "truncate px-2",
                    getDisplayNameStyleClasses({
                      effect: effect.value,
                      color: effect.value !== "gradient" ? value.color : undefined,
                      gradient: effect.value === "gradient" ? value.gradient : undefined,
                    }),
                  )}
                  style={getDisplayNameStyleInline({
                    effect: effect.value,
                    color: value.color || "#fff",
                    gradient: value.gradient?.length ? value.gradient : ["#8B5CF6", "#3B82F6"],
                  })}
                >
                  {effect.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel onReset={() => onChange((s) => ({ ...s, color: "", gradient: [] }))} resetLabel={gt("Reset Colour")}>{gt("Choose Colour")}</FieldLabel>
        {value.effect === "gradient" ? (
          <div className="space-y-3">
            <GradientBar
              from={g0}
              to={g1}
              label={gt("Custom")}
              onChange={([from, to]) => onChange((s) => ({ ...s, gradient: [from, to] }))}
            />
            <div className="flex flex-wrap gap-2.5">
              {GRADIENT_SWATCHES.map((grad, i) => (
                <Swatch
                  key={i}
                  background={`linear-gradient(135deg, ${grad.join(", ")})`}
                  selected={sameColors(value.gradient, grad)}
                  onClick={() => onChange((s) => ({ ...s, gradient: grad }))}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <CustomColorDot value={value.color || "#8B5CF6"} onChange={(c) => onChange((s) => ({ ...s, color: c }))} label={gt("Custom")} />
            <span aria-hidden className="mx-1 h-8 w-px bg-[var(--border-subtle)]" />
            {SOLID_SWATCHES.map((col) => (
              <Swatch key={col} background={col} selected={value.color === col} onClick={() => onChange((s) => ({ ...s, color: col }))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export const NameplateEditor = memo(function NameplateEditor({
  nameplate,
  onChange,
  displayName,
  displayNameStyle,
  avatar,
}: {
  nameplate: NameplateCustomization;
  onChange: Dispatch<SetStateAction<NameplateCustomization>>;
  displayName: string;
  displayNameStyle: DisplayNameStyle;
  avatar?: string;
}) {
  const gt = useGT();
  const background = getNameplateBackground({ nameplate });
  const types = [
    { id: "none", label: gt("None") },
    { id: "color", label: gt("Solid") },
    { id: "gradient", label: gt("Gradient") },
    { id: "preset", label: gt("Presets") },
    { id: "image", label: gt("Image") },
  ] as const;
  const g0 = nameplate.gradient?.[0] || "#8B5CF6";
  const g1 = nameplate.gradient?.[1] || "#EC4899";

  return (
    <div className="space-y-3">
      {/* Live preview — mirrors the sidebar user panel */}
      <div className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
        {background && (
          <div
            className="absolute inset-0"
            style={{
              background,
              opacity: 0.55,
              WebkitMaskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)",
              maskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)",
            }}
          />
        )}
        <div className="relative flex items-center gap-2 px-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cdnImage(avatar || undefined)} alt="" className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-sidebar-elevated)] object-cover" />
          <span className={cn("truncate text-sm font-bold text-[var(--text-primary)]", getDisplayNameStyleClasses(displayNameStyle))} style={getDisplayNameStyleInline(displayNameStyle)}>
            {displayName || gt("Your name")}
          </span>
        </div>
      </div>

      <div role="radiogroup" aria-label={gt("Nameplate")} className="flex gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5">
        {types.map((opt) => {
          const selected = (nameplate.type || "none") === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange((n) => ({ ...n, type: opt.id }))}
              className={cn(
                "h-7 flex-1 rounded-md px-2 text-xs font-semibold transition-colors duration-(--motion-fast)",
                selected ? "bg-[var(--app-accent)] text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {nameplate.type === "color" && (
        <div className="flex flex-wrap items-center gap-2">
          {NAMEPLATE_SOLIDS.map((col) => (
            <Swatch key={col} background={col} selected={nameplate.color === col} onClick={() => onChange((n) => ({ ...n, type: "color", color: col }))} />
          ))}
          <CustomColorDot
            value={nameplate.color || "#8B5CF6"}
            onChange={(c) => onChange((n) => ({ ...n, type: "color", color: c }))}
            label={gt("Custom")}
          />
        </div>
      )}

      {nameplate.type === "gradient" && (
        <div className="space-y-2.5">
          <GradientBar
            from={g0}
            to={g1}
            label={gt("Custom")}
            onChange={([from, to]) => onChange((n) => ({ ...n, type: "gradient", gradient: [from, to] }))}
          />
          <div className="flex flex-wrap gap-2">
            {NAMEPLATE_GRADIENTS.map((grad, i) => (
              <Swatch
                key={i}
                shape="pill"
                background={`linear-gradient(90deg, ${grad.join(", ")})`}
                selected={sameColors(nameplate.gradient, grad)}
                onClick={() => onChange((n) => ({ ...n, type: "gradient", gradient: grad }))}
              />
            ))}
          </div>
        </div>
      )}

      {nameplate.type === "image" && (
        <NameplateImagePicker hasImage={Boolean(nameplate.imageUrl)} onUploaded={(url) => onChange({ type: "image", imageUrl: url })} />
      )}

      {nameplate.type === "preset" && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {NAMEPLATE_PRESETS.map((preset) => {
            const on = nameplate.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange((n) => ({ ...n, type: "preset", presetId: preset.id }))}
                className={cn(
                  "relative flex h-9 items-center overflow-hidden rounded-md border px-2.5 transition-colors",
                  on ? "border-[var(--app-accent)] ring-2 ring-[var(--app-accent)]" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]",
                )}
              >
                <div className="absolute inset-0" style={{ background: preset.css, opacity: 0.55 }} />
                <span className="relative truncate text-[11px] font-semibold text-white drop-shadow-md">{preset.name}</span>
                {on && <Check className="absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white drop-shadow-md" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export const ProfileColourEditor = memo(function ProfileColourEditor({
  profileColor,
  setProfileColor,
  profileGradient,
  setProfileGradient,
}: {
  profileColor: string;
  setProfileColor: Dispatch<SetStateAction<string>>;
  profileGradient: string[];
  setProfileGradient: Dispatch<SetStateAction<string[]>>;
}) {
  const gt = useGT();
  const g0 = profileGradient?.[0] || "#8B5CF6";
  const g1 = profileGradient?.[1] || "#EC4899";
  return (
    <div className="space-y-6">
      <div>
        <FieldLabel onReset={() => setProfileColor("")} resetLabel={gt("Reset Colour")}>{gt("Choose Colour")}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2.5">
          <CustomColorDot value={profileColor || "#8B5CF6"} onChange={setProfileColor} label={gt("Custom")} />
          <span aria-hidden className="mx-1 h-8 w-px bg-[var(--border-subtle)]" />
          {SOLID_SWATCHES.map((col) => (
            <Swatch key={col} background={col} selected={profileColor === col} onClick={() => setProfileColor(col)} />
          ))}
        </div>
      </div>
      <div>
        <FieldLabel onReset={() => setProfileGradient([])} resetLabel={gt("Reset Gradient")}>{gt("Gradient Background (Optional)")}</FieldLabel>
        <div className="mb-4 flex flex-wrap gap-2.5">
          {GRADIENT_SWATCHES.map((grad, i) => (
            <Swatch
              key={i}
              background={`linear-gradient(135deg, ${grad.join(", ")})`}
              selected={sameColors(profileGradient, grad)}
              onClick={() => setProfileGradient(grad)}
            />
          ))}
        </div>
        <GradientBar from={g0} to={g1} angle={135} label={gt("Custom")} onChange={([from, to]) => setProfileGradient([from, to])} />
      </div>
    </div>
  );
});
