"use client";

import { useState } from "react";
import { T, useGT } from "gt-next";
import { ArrowLeft, ArrowLeftRight, ArrowRight } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingRow } from "./bits";
import type { BridgeDirection, BridgeLinkOptions } from "./types";

const AFFIX_MAX = 64;

/**
 * The bridge options shared by a single link (Options dialog of a mapping
 * row) and the server-wide defaults (Options tab). Every control saves on
 * change; the prefix/suffix fields save on blur or Enter.
 */
export function LinkOptionsForm({
  value,
  inherited,
  onChange,
  showPause,
  disabled,
}: {
  value: BridgeLinkOptions;
  /** What the link would use without its own overrides (marks changed rows). */
  inherited?: BridgeLinkOptions;
  onChange: (patch: Partial<BridgeLinkOptions>) => void;
  showPause?: boolean;
  disabled?: boolean;
}) {
  const gt = useGT();
  const changed = (key: keyof BridgeLinkOptions) => inherited !== undefined && inherited[key] !== value[key];
  const marker = (k: keyof BridgeLinkOptions) =>
    changed(k) ? (
      <span className="ml-1.5 align-middle rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide bg-[var(--app-accent)]/15 text-[var(--app-accent)]">
        <T>Custom</T>
      </span>
    ) : null;

  const directions: Array<{ id: BridgeDirection; label: string; icon: typeof ArrowLeftRight }> = [
    { id: "both", label: gt("Both ways"), icon: ArrowLeftRight },
    { id: "to_serika", label: gt("Discord → SerikaCord"), icon: ArrowRight },
    { id: "to_discord", label: gt("SerikaCord → Discord"), icon: ArrowLeft },
  ];
  const directionHelp: Record<BridgeDirection, string> = {
    both: gt("Messages flow in both directions."),
    to_serika: gt("Discord messages appear here; messages sent here stay on SerikaCord."),
    to_discord: gt("Messages sent here appear on Discord; Discord messages are not copied."),
  };

  return (
    <div className={cn("space-y-1", disabled && "opacity-60 pointer-events-none")}>
      <div className="pb-3 border-b border-[var(--border-subtle)]">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          <T>Direction</T>
          {marker("direction")}
        </p>
        <div role="radiogroup" aria-label={gt("Direction")} className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5 rounded-xl bg-[var(--bg-app)] p-1 border border-[var(--border-subtle)]">
          {directions.map(({ id, label, icon: Icon }) => {
            const active = value.direction === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => !active && onChange({ direction: id })}
                className={cn(
                  "flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]",
                  active
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{directionHelp[value.direction]}</p>
      </div>

      <SettingRow label={<><T>Mirror edits</T>{marker("mirrorEdits")}</>} description={<T>When a message is edited on one side, update its copy on the other.</T>}>
        <ToggleSwitch checked={value.mirrorEdits} onCheckedChange={(v) => onChange({ mirrorEdits: v })} aria-label={gt("Mirror edits")} />
      </SettingRow>
      <SettingRow label={<><T>Mirror deletes</T>{marker("mirrorDeletes")}</>} description={<T>When a message is deleted on one side, delete its copy on the other.</T>}>
        <ToggleSwitch checked={value.mirrorDeletes} onCheckedChange={(v) => onChange({ mirrorDeletes: v })} aria-label={gt("Mirror deletes")} />
      </SettingRow>
      <SettingRow label={<><T>Attachments</T>{marker("attachments")}</>} description={<T>Carry images, files and stickers across. When off, only the text is mirrored.</T>}>
        <ToggleSwitch checked={value.attachments} onCheckedChange={(v) => onChange({ attachments: v })} aria-label={gt("Attachments")} />
      </SettingRow>
      <SettingRow
        label={<><T>Show SerikaCord names and avatars on Discord</T>{marker("showIdentity")}</>}
        description={<T>Messages from SerikaCord appear on Discord under the author&apos;s name and avatar. When off, they are posted by the bridge with the name in bold.</T>}
      >
        <ToggleSwitch checked={value.showIdentity} onCheckedChange={(v) => onChange({ showIdentity: v })} aria-label={gt("Show SerikaCord names and avatars on Discord")} />
      </SettingRow>
      <SettingRow label={<><T>Messages from Discord bots</T>{marker("includeBots")}</>} description={<T>Mirror messages written by bots on Discord.</T>}>
        <ToggleSwitch checked={value.includeBots} onCheckedChange={(v) => onChange({ includeBots: v })} aria-label={gt("Messages from Discord bots")} />
      </SettingRow>

      <div className="py-3 border-b border-[var(--border-subtle)]">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          <T>Prefix and suffix</T>
          {marker("prefix") ?? marker("suffix")}
        </p>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]"><T>Optional text added before and after every mirrored message, in both directions. Up to 64 characters.</T></p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <AffixInput label={gt("Prefix")} placeholder={gt("e.g. [Discord]")} value={value.prefix} onCommit={(v) => onChange({ prefix: v })} />
          <AffixInput label={gt("Suffix")} placeholder={gt("e.g. (bridged)")} value={value.suffix} onCommit={(v) => onChange({ suffix: v })} />
        </div>
      </div>

      {showPause && (
        <SettingRow label={<T>Pause this link</T>} description={<T>Stop mirroring in both directions without removing the link.</T>}>
          <ToggleSwitch checked={value.paused} onCheckedChange={(v) => onChange({ paused: v })} aria-label={gt("Pause this link")} />
        </SettingRow>
      )}
    </div>
  );
}

function AffixInput({ label, placeholder, value, onCommit }: { label: string; placeholder: string; value: string; onCommit: (v: string) => void }) {
  // Keyed by the saved value so a server-side cleanup (trim, cap) shows up.
  return <AffixField key={value} label={label} placeholder={placeholder} initial={value} onCommit={onCommit} />;
}

function AffixField({ label, placeholder, initial, onCommit }: { label: string; placeholder: string; initial: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const commit = () => {
    const next = draft.trim();
    if (next !== initial) onCommit(next);
  };
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <Input
        value={draft}
        maxLength={AFFIX_MAX}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-9 bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)] text-sm"
      />
    </label>
  );
}
