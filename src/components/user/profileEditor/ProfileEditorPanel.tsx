"use client";

import { useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Camera, Check, ChevronsLeft, ImagePlus, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { NameplateImagePicker } from "@/components/settings/NameplateImagePicker";
import { ServerTagPill } from "@/components/user/ServerTagPill";
import { useAuth } from "@/contexts/AuthContext";
import { useServerOptional } from "@/contexts/ServerContext";
import { NAMEPLATE_PRESETS, getNameplateBackground, type NameplateCustomization } from "@/lib/constants/nameplates";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, type DisplayNameStyle } from "@/lib/userDisplayNameStyle";
import { cn, cdnImage } from "@/lib/utils";
import { useSelfProfileSave } from "@/components/user/profileEditor/useSelfProfileSave";
import { resolveSelfTag } from "@/components/user/profileEditor/selfProfile";
import { ServerProfileEditor } from "@/components/user/profileEditor/ServerProfileEditor";
import { ServerProfilePicker } from "@/components/user/profileEditor/ServerProfilePicker";
import type { ServerProfileDraft } from "@/components/user/profileEditor/useServerProfileDraft";
import { UnsavedChangesBar, useUnsavedShake } from "@/components/ui/unsaved-changes-bar";
import type { ProfileMediaKind } from "@/components/user/profileEditor/useProfileMediaUpload";
import {
  DEFAULT_THEME_PAIR,
  GRADIENT_SWATCHES,
  SOLID_SWATCHES,
  type NameEffect,
  type NameFont,
} from "@/components/user/profileEditor/palettes";

export interface ProfileEditorMedia {
  pick: (target: { kind: ProfileMediaKind; serverId?: string; onDone?: (url: string) => void }) => void;
  uploading: Record<ProfileMediaKind, boolean>;
}

interface ProfileEditorPanelProps {
  onCollapse: () => void;
  /** Server the profile was opened from; listed first in the server picker. */
  serverId?: string;
  media: ProfileEditorMedia;
  /** Profile being edited: null = main profile, else a server id (owned by the dialog, which previews it). */
  target: string | null;
  onTargetChange: (serverId: string | null) => void;
  /** Draft of the server profile in `target`. */
  serverDraft: ServerProfileDraft;
  /** Which servers have a server profile (kept by the dialog, updated on save). */
  profileIndex: { profiles: Record<string, string[]> };
}

const TILE = cn(
  "relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-hover)]",
  "transition-[border-color,box-shadow] duration-150 ease-out",
  "hover:border-[color-mix(in_srgb,var(--app-accent)_60%,var(--border-subtle))]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
);

const ICON_BUTTON = cn(
  "inline-flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors duration-150",
  "hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
);

const ringFor = (on: boolean) => (on ? "0 0 0 2px var(--app-surface), 0 0 0 4px var(--app-accent)" : undefined);

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-1 mb-2 min-h-6">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A round swatch that opens the native colour picker. */
function ColorSwatch({ value, onChange, label, className }: { value: string; onChange: (hex: string) => void; label: string; className?: string }) {
  return (
    <label
      className={cn(
        "relative block size-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/80 shadow-md transition-transform duration-150 hover:scale-110 focus-within:ring-[var(--app-accent)] motion-reduce:transition-none",
        className,
      )}
      style={{ backgroundColor: value }}
      title={label}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0"
      />
    </label>
  );
}

// ─── Main profile ────────────────────────────────────────────────────────────

function NameplateEditor() {
  const gt = useGT();
  const { user } = useAuth();
  const { save, saveDebounced } = useSelfProfileSave();
  const nameplate = (user?.customization?.nameplate || { type: "none" }) as NameplateCustomization;
  const [tab, setTab] = useState<NonNullable<NameplateCustomization["type"]>>(nameplate.type || "none");

  const choose = (next: NameplateCustomization) => void save({ customization: { nameplate: next } });

  const selectTab = (id: NonNullable<NameplateCustomization["type"]>) => {
    setTab(id);
    if (id === "none") choose({ type: "none" });
    else if (id === "color" && nameplate.type !== "color") choose({ type: "color", color: SOLID_SWATCHES[7] });
    else if (id === "gradient" && nameplate.type !== "gradient") choose({ type: "gradient", gradient: [...GRADIENT_SWATCHES[0]] });
    else if (id === "preset" && nameplate.type !== "preset") choose({ type: "preset", presetId: NAMEPLATE_PRESETS[0]?.id });
    // "image" waits for an upload.
  };

  const tabs = [
    { id: "none", label: gt("None") },
    { id: "color", label: gt("Solid") },
    { id: "gradient", label: gt("Gradient") },
    { id: "preset", label: gt("Presets") },
    { id: "image", label: gt("Image") },
  ] as const;

  return (
    <div className="mt-2 space-y-2.5 rounded-xl border border-[var(--border-subtle)] p-2.5">
      <div role="tablist" aria-label={gt("Nameplate type")} className="flex gap-0.5 p-0.5 rounded-lg bg-[var(--bg-hover)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex-1 px-1 py-1 rounded-md text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
              tab === t.id ? "bg-[var(--app-accent)] text-[var(--text-on-accent,#fff)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "color" && (
        <div className="flex flex-wrap gap-1.5">
          {SOLID_SWATCHES.slice(0, 11).map((col) => (
            <button
              key={col}
              type="button"
              aria-label={col}
              onClick={() => choose({ type: "color", color: col })}
              className="size-6 rounded-full relative transition-transform duration-150 hover:scale-110 motion-reduce:transition-none"
              style={{ backgroundColor: col, boxShadow: ringFor(nameplate.type === "color" && nameplate.color === col) }}
            />
          ))}
          <ColorSwatch
            value={nameplate.color || SOLID_SWATCHES[7]}
            onChange={(hex) => saveDebounced({ nameplate: { type: "color", color: hex } })}
            label={gt("Custom colour")}
            className="size-6 ring-1"
          />
        </div>
      )}

      {tab === "gradient" && (
        <div className="flex flex-wrap gap-1.5">
          {GRADIENT_SWATCHES.map((grad) => (
            <button
              key={grad.join("-")}
              type="button"
              aria-label={grad.join(" → ")}
              onClick={() => choose({ type: "gradient", gradient: [...grad] })}
              className="w-8 h-6 rounded-md transition-transform duration-150 hover:scale-105 motion-reduce:transition-none"
              style={{
                background: `linear-gradient(90deg, ${grad.join(", ")})`,
                boxShadow: ringFor(nameplate.type === "gradient" && JSON.stringify(nameplate.gradient) === JSON.stringify(grad)),
              }}
            />
          ))}
        </div>
      )}

      {tab === "preset" && (
        <div className="grid grid-cols-2 gap-1.5">
          {NAMEPLATE_PRESETS.map((preset) => {
            const on = nameplate.type === "preset" && nameplate.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => choose({ type: "preset", presetId: preset.id })}
                className={cn(
                  "relative h-8 rounded-md overflow-hidden border flex items-center px-2 transition-colors duration-150",
                  on ? "border-[var(--app-accent)]" : "border-[var(--border-subtle)] hover:border-[var(--text-muted)]",
                )}
              >
                <span className="absolute inset-0" style={{ background: preset.css, opacity: 0.6 }} aria-hidden />
                <span className="relative text-[11px] font-semibold text-white drop-shadow truncate">{preset.name}</span>
                {on && <Check className="relative ml-auto w-3.5 h-3.5 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      )}

      {tab === "image" && (
        <NameplateImagePicker
          hasImage={nameplate.type === "image" && Boolean(nameplate.imageUrl)}
          onUploaded={(url) => choose({ type: "image", imageUrl: url })}
        />
      )}
    </div>
  );
}

function NameStyleEditor({ style }: { style: DisplayNameStyle }) {
  const gt = useGT();
  const { save, saveDebounced } = useSelfProfileSave();
  const set = (patch: Partial<DisplayNameStyle>) => void save({ customization: { displayNameStyle: { ...style, ...patch } } });

  const fonts: Array<{ value: NameFont; label: string }> = [
    { value: "default", label: gt("Default") },
    { value: "serif", label: gt("Serif") },
    { value: "mono", label: gt("Mono") },
    { value: "rounded", label: gt("Rounded") },
    { value: "cursive", label: gt("Cursive") },
    { value: "bold", label: gt("Bold") },
  ];
  const effects: Array<{ value: NameEffect; label: string }> = [
    { value: "solid", label: gt("Solid") },
    { value: "gradient", label: gt("Gradient") },
    { value: "neon", label: gt("Neon") },
    { value: "toon", label: gt("Toon") },
    { value: "pop", label: gt("Pop") },
  ];
  const optionClass = (on: boolean) => cn(
    "h-9 rounded-lg border text-[12px] font-medium truncate px-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
    on ? "border-[var(--app-accent)] bg-[var(--bg-hover)] text-[var(--text-primary)]" : "border-transparent bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  );
  const g0 = style.gradient?.[0] || GRADIENT_SWATCHES[0][0];
  const g1 = style.gradient?.[1] || GRADIENT_SWATCHES[0][1];

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-[var(--border-subtle)] p-2.5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Font")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {fonts.map((f) => (
            <button key={f.value} type="button" onClick={() => set({ font: f.value })} className={optionClass((style.font || "default") === f.value)}>
              <span className={getDisplayNameStyleClasses({ font: f.value })} style={getDisplayNameStyleInline({ font: f.value })}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Effect")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {effects.map((e) => (
            <button key={e.value} type="button" onClick={() => set({ effect: e.value })} className={optionClass((style.effect || "solid") === e.value)}>
              <span
                className={getDisplayNameStyleClasses({ effect: e.value })}
                style={getDisplayNameStyleInline({ effect: e.value, color: style.color || undefined, gradient: [g0, g1] })}
              >
                {e.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{gt("Colour")}</p>
        {style.effect === "gradient" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between h-9 rounded-lg px-1.5" style={{ background: `linear-gradient(90deg, ${g0}, ${g1})` }}>
              <ColorSwatch value={g0} onChange={(hex) => saveDebounced({ displayNameStyle: { ...style, gradient: [hex, g1] } })} label={gt("Gradient start")} className="size-6" />
              <ColorSwatch value={g1} onChange={(hex) => saveDebounced({ displayNameStyle: { ...style, gradient: [g0, hex] } })} label={gt("Gradient end")} className="size-6" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GRADIENT_SWATCHES.map((grad) => (
                <button
                  key={grad.join("-")}
                  type="button"
                  aria-label={grad.join(" → ")}
                  onClick={() => set({ gradient: [...grad] })}
                  className="size-6 rounded-full transition-transform duration-150 hover:scale-110 motion-reduce:transition-none"
                  style={{ background: `linear-gradient(135deg, ${grad.join(", ")})`, boxShadow: ringFor(JSON.stringify(style.gradient) === JSON.stringify(grad)) }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <ColorSwatch
              value={style.color || SOLID_SWATCHES[7]}
              onChange={(hex) => saveDebounced({ displayNameStyle: { ...style, color: hex } })}
              label={gt("Custom colour")}
              className="size-6 ring-1"
            />
            {SOLID_SWATCHES.slice(0, 11).map((col) => (
              <button
                key={col}
                type="button"
                aria-label={col}
                onClick={() => set({ color: col })}
                className="size-6 rounded-full transition-transform duration-150 hover:scale-110 motion-reduce:transition-none"
                style={{ backgroundColor: col, boxShadow: ringFor(style.color === col) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MainProfileSections({ media }: { media: ProfileEditorMedia }) {
  const gt = useGT();
  const { user } = useAuth();
  const servers = useServerOptional()?.servers;
  const { save, saveDebounced } = useSelfProfileSave();
  const [expanded, setExpanded] = useState<"nameplate" | "name" | null>(null);
  if (!user) return null;

  const customization = user.customization || {};
  const nameplate = (customization.nameplate || { type: "none" }) as NameplateCustomization;
  const nameplateBg = getNameplateBackground({ nameplate });
  const style = (customization.displayNameStyle || {}) as DisplayNameStyle;
  const hasStyle = Boolean(style.font && style.font !== "default") || Boolean(style.effect && style.effect !== "solid") || Boolean(style.color) || Boolean(style.gradient?.length);
  const name = user.displayName || user.username;
  const tag = resolveSelfTag(customization, null, servers ?? []);
  const gradient = Array.isArray(customization.profileGradient) ? (customization.profileGradient as string[]) : [];
  const theme: [string, string] = gradient.length >= 2
    ? [gradient[0], gradient[1]]
    : [customization.profileColor || DEFAULT_THEME_PAIR[0], DEFAULT_THEME_PAIR[1]];
  const hasTheme = gradient.length >= 2 || Boolean(customization.profileColor);
  const toggle = (id: "nameplate" | "name") => setExpanded((cur) => (cur === id ? null : id));

  return (
    <>
      <Section title={gt("Nameplate")}>
        <div className="relative">
          <button
            type="button"
            onClick={() => toggle("nameplate")}
            aria-expanded={expanded === "nameplate"}
            aria-label={gt("Edit nameplate")}
            className={cn(TILE, "w-full h-14 flex items-center gap-2 px-2.5 text-left", !nameplateBg && "border-dashed")}
          >
            {nameplateBg && (
              <span
                aria-hidden
                className="absolute inset-0"
                style={{ background: nameplateBg, opacity: 0.6, WebkitMaskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)", maskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)" }}
              />
            )}
            {nameplateBg ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cdnImage(user.avatar || undefined)} alt="" className="relative size-8 rounded-full object-cover shrink-0 bg-[var(--bg-hover)]" />
                <span className={cn("relative min-w-0 truncate text-sm font-bold text-[var(--text-primary)]", getDisplayNameStyleClasses(style))} style={getDisplayNameStyleInline(style)}>
                  {name}
                </span>
                {tag && <ServerTagPill tag={tag} interactive={false} className="relative" />}
              </>
            ) : (
              <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                <Plus className="w-4 h-4" />
                {gt("Add a nameplate")}
              </span>
            )}
          </button>
          {nameplateBg && (
            <button
              type="button"
              onClick={() => void save({ customization: { nameplate: { type: "none" } } })}
              aria-label={gt("Remove nameplate")}
              title={gt("Remove nameplate")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex size-7 items-center justify-center rounded-md bg-black/50 text-white/90 hover:bg-black/70 hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {expanded === "nameplate" && <NameplateEditor />}
      </Section>

      <Section title={gt("Avatar")}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => media.pick({ kind: "avatar" })}
            aria-label={gt("Change Avatar")}
            className={cn(TILE, "group aspect-square flex items-center justify-center")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cdnImage(user.avatar || undefined)} alt="" className="size-[72%] rounded-full object-cover bg-[var(--bg-card)]" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white text-[11px] font-semibold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:bg-black/30 transition-opacity duration-150">
              {media.uploading.avatar ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              {gt("Change Avatar")}
            </span>
          </button>
        </div>
      </Section>

      <Section
        title={gt("Display Name Style")}
        action={hasStyle ? (
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={gt("Reset display name style")}
            title={gt("Reset display name style")}
            onClick={() => void save({ customization: { displayNameStyle: { font: "default", effect: "solid", color: "", gradient: [] } } })}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        ) : undefined}
      >
        <button
          type="button"
          onClick={() => toggle("name")}
          aria-expanded={expanded === "name"}
          aria-label={gt("Edit display name style")}
          className={cn(TILE, "w-full h-14 flex items-center justify-center px-3")}
        >
          <span className={cn("truncate text-lg font-bold text-[var(--text-primary)]", getDisplayNameStyleClasses(style))} style={getDisplayNameStyleInline(style)}>
            {name}
          </span>
        </button>
        {expanded === "name" && <NameStyleEditor style={style} />}
      </Section>

      <Section
        title={gt("Theme & Banner")}
        action={hasTheme ? (
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={gt("Reset profile theme")}
            title={gt("Reset profile theme")}
            onClick={() => void save({ customization: { profileGradient: [], profileColor: "" } })}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        ) : undefined}
      >
        <div className="grid grid-cols-2 gap-2">
          <div
            className="relative aspect-square rounded-xl border border-[var(--border-subtle)] overflow-hidden flex flex-col items-center justify-between py-3"
            style={{ background: `linear-gradient(180deg, ${theme[0]}, ${theme[1]})` }}
          >
            <ColorSwatch value={theme[0]} onChange={(hex) => saveDebounced({ profileGradient: [hex, theme[1]] })} label={gt("Primary profile colour")} />
            <ColorSwatch value={theme[1]} onChange={(hex) => saveDebounced({ profileGradient: [theme[0], hex] })} label={gt("Accent profile colour")} />
          </div>
          <button
            type="button"
            onClick={() => media.pick({ kind: "banner" })}
            aria-label={gt("Change Banner")}
            className={cn(TILE, "group aspect-square flex items-center justify-center", !user.banner && "border-dashed")}
          >
            {user.banner ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cdnImage(user.banner)} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <ImagePlus className="w-6 h-6 text-[var(--text-muted)]" />
            )}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white text-[11px] font-semibold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
              {media.uploading.banner ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              {gt("Change Banner")}
            </span>
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={gt("Theme presets")} role="group">
          {GRADIENT_SWATCHES.slice(0, 10).map((grad) => (
            <button
              key={grad.join("-")}
              type="button"
              aria-label={grad.join(" → ")}
              onClick={() => void save({ customization: { profileGradient: [...grad] } })}
              className="size-5 rounded-full transition-transform duration-150 hover:scale-110 motion-reduce:transition-none"
              style={{ background: `linear-gradient(135deg, ${grad.join(", ")})`, boxShadow: ringFor(JSON.stringify(gradient) === JSON.stringify(grad)) }}
            />
          ))}
        </div>
      </Section>
    </>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * The editor that slides out of the left edge of your own full profile
 * (Discord-style): main profile tiles (saved as you go), or a per-server
 * profile picked from the header (edited as a draft with its own save bar,
 * previewed live by the profile next to it).
 */
export default function ProfileEditorPanel({ onCollapse, serverId, media, target, onTargetChange, serverDraft, profileIndex }: ProfileEditorPanelProps) {
  const gt = useGT();
  const servers = useServerOptional()?.servers ?? [];
  const server = target ? servers.find((s) => s.id === target) : undefined;
  const [shakeSignal, shake] = useUnsavedShake();
  const blockSwitch = () => {
    if (!serverDraft.dirty) return true;
    shake();
    toast.error(gt("Save or reset your changes before switching servers."));
    return false;
  };

  return (
    <div className="flex h-full flex-col bg-[var(--app-surface)] text-[var(--text-primary)]">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 max-md:mt-3">
        <ServerProfilePicker
          variant="header"
          includeMain
          servers={servers}
          value={server ? server.id : null}
          onChange={onTargetChange}
          profiled={profileIndex.profiles}
          preferredId={serverId}
          canChange={blockSwitch}
        />
        <button
          type="button"
          onClick={() => {
            if (serverDraft.dirty) shake();
            onCollapse();
          }}
          aria-label={gt("Close profile editor")}
          title={gt("Close profile editor")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-5 pb-[calc(1rem+var(--safe-area-bottom,0px))]">
        {server ? (
          <ServerProfileEditor key={server.id} layout="panel" draft={serverDraft} serverName={server.name} media={media} picker={null} />
        ) : (
          <MainProfileSections media={media} />
        )}
      </div>
      {server && (
        <div className="shrink-0 px-2 pb-[calc(0.5rem+var(--safe-area-bottom,0px))] empty:hidden">
          <UnsavedChangesBar
            visible={serverDraft.dirty}
            isSaving={serverDraft.saving}
            onSave={() => void serverDraft.save()}
            onDiscard={serverDraft.discard}
            changeCount={serverDraft.dirtyFields.length}
            shakeSignal={shakeSignal}
            className="mt-2"
          />
        </div>
      )}
    </div>
  );
}
