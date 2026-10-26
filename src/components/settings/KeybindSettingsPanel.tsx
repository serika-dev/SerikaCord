"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  HOTKEYS,
  formatHotkey,
  getEffectiveBinding,
  saveKeybindOverride,
  resetKeybindOverrides,
  loadKeybindOverrides,
  bindingsConflict,
  type HotkeyAction,
  type Hotkey,
  type KeybindOverride,
} from "@/lib/keybinds";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { RotateCcw, X, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { useIsClient } from "@/hooks/useIsClient";
import { isDesktopShell } from "@/lib/desktop/bridge";
import { GlobalShortcutSettings } from "@/components/settings/GlobalShortcutSettings";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsKeycaps } from "@/components/settings/blocks/SettingsKeycaps";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";

const CATEGORY_ORDER: Hotkey["category"][] = ["Navigation", "Chat", "Voice", "Application"];

/** Check if a key should be ignored during recording (modifier-only presses). */
function isModifierKey(key: string): boolean {
  return ["control", "shift", "alt", "meta", "ctrl", "tab", "capslock"].includes(key);
}

/** Check if a key is a valid binding key. */
function isValidBindingKey(key: string): boolean {
  if (isModifierKey(key)) return false;
  if (key.length === 0) return false;
  // Allow single chars, arrows, page up/down, enter, escape, etc.
  return true;
}

interface RecordingState {
  action: HotkeyAction;
  label: string;
}

export function KeybindSettingsPanel() {
  const gt = useGT();
  // Read on mount (the panel only renders client-side, inside the open dialog).
  const [overrides, setOverrides] = useState<Record<string, KeybindOverride>>(() =>
    typeof window === "undefined" ? {} : loadKeybindOverrides(),
  );
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [conflictAction, setConflictAction] = useState<HotkeyAction | null>(null);
  const isClient = useIsClient();
  const desktop = isClient && isDesktopShell();

  // Load overrides on mount and when keybinds change.
  const refresh = useCallback(() => {
    setOverrides(loadKeybindOverrides());
  }, []);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("serika:keybinds-changed", handler);
    return () => window.removeEventListener("serika:keybinds-changed", handler);
  }, [refresh]);

  // Recording: capture the next key press as the new binding.
  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording.
      if (e.key === "Escape") {
        setRecording(null);
        setConflictAction(null);
        return;
      }

      const key = e.key.toLowerCase();
      if (isModifierKey(key)) return; // Wait for a real key.

      if (!isValidBindingKey(key)) {
        setRecording(null);
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      const newOverride: KeybindOverride = { key, ctrl, shift, alt };

      // Check for conflicts with other bindings.
      const conflicting = HOTKEYS.find((h) => {
        if (h.action === recording.action) return false;
        if (h.locked) return false;
        const effective = getEffectiveBinding(h.action);
        return bindingsConflict(newOverride, effective);
      });

      if (conflicting) {
        setConflictAction(conflicting.action);
        setRecording(null);
        toast.error(
          gt("Conflict: {combo} is already used by \"{label}\"", {
            combo: formatHotkey({ ...newOverride, action: recording.action, label: "", category: "Chat" }),
            label: conflicting.label,
          })
        );
        return;
      }

      saveKeybindOverride(recording.action, newOverride);
      setRecording(null);
      setConflictAction(null);
      toast.success(gt("Keybind updated"));
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
  }, [recording, gt]);

  const handleReset = useCallback((action: HotkeyAction) => {
    saveKeybindOverride(action, null);
    toast.success(gt("Keybind reset to default"));
  }, [gt]);

  const handleResetAll = useCallback(() => {
    resetKeybindOverrides();
    toast.success(gt("All keybinds reset to defaults"));
  }, [gt]);

  const filteredHotkeys = useMemo(() => {
    if (!searchQuery.trim()) return HOTKEYS;
    const q = searchQuery.toLowerCase();
    return HOTKEYS.filter((h) => h.label.toLowerCase().includes(q));
  }, [searchQuery]);

  const categoryLabel = (category: Hotkey["category"]) => {
    switch (category) {
      case "Navigation": return gt("Navigation");
      case "Chat": return gt("Chat");
      case "Voice": return gt("Voice");
      case "Application": return gt("Application");
      default: return category;
    }
  };

  return (
    <div className="space-y-6">
      {/* Search + reset all */}
      <SettingsToolbar>
        <SettingsSearchInput
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={gt("Search keybinds...")}
          clearLabel={gt("Clear")}
          className="flex-1 sm:max-w-xs"
        />
        <SettingsButton variant="secondary" size="sm" onClick={handleResetAll} className="ml-auto">
          <RotateCcw />
          {gt("Reset All")}
        </SettingsButton>
      </SettingsToolbar>

      {/* Recording help text */}
      {recording && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
          <p className="text-[13px] text-[var(--text-secondary)]">
            {gt("Press the key combination you want to bind to \"{label}\". Press Escape to cancel.", { label: recording.label })}
          </p>
        </div>
      )}

      {/* Desktop app: system-wide push to talk / mute / deafen */}
      {desktop && !searchQuery.trim() && <GlobalShortcutSettings />}

      {filteredHotkeys.length === 0 && (
        <SettingsEmptyState icon={Search} title={gt("No keybinds match your search.")} compact />
      )}

      {/* Discord-style table: action on the left, keycaps on the right */}
      {CATEGORY_ORDER.map((category) => {
        const rows = filteredHotkeys.filter((h) => h.category === category);
        if (rows.length === 0) return null;

        return (
          <section key={category} className="space-y-3">
            <h3 className="px-0.5 text-[15px] font-semibold text-[var(--text-primary)]">{categoryLabel(category)}</h3>
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
              <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                <span>{gt("Action")}</span>
                <span>{gt("Keybind")}</span>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {rows.map((hk) => {
                  const effective = getEffectiveBinding(hk.action);
                  const isCustom = !!overrides[hk.action];
                  const isLocked = hk.locked;
                  const isRecording = recording?.action === hk.action;
                  const hasConflict = conflictAction === hk.action;

                  return (
                    <div
                      key={hk.action}
                      data-settings-row
                      className={cn(
                        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 transition-colors duration-(--motion-fast) [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/50",
                        hasConflict && "bg-red-500/10",
                        isRecording && "bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]" data-settings-label={hk.label}>{hk.label}</span>
                        {isCustom && <SettingsStatusPill tone="accent">{gt("Custom")}</SettingsStatusPill>}
                        {isLocked && <SettingsStatusPill tone="neutral">{gt("Locked")}</SettingsStatusPill>}
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        {isRecording ? (
                          <>
                            <span className="animate-pulse text-xs font-medium text-[var(--app-accent)]">{gt("Press keys...")}</span>
                            <SettingsButton
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 px-0"
                              aria-label={gt("Cancel")}
                              onClick={() => { setRecording(null); setConflictAction(null); }}
                            >
                              <X />
                            </SettingsButton>
                          </>
                        ) : (
                          <>
                            {isLocked ? (
                              <SettingsKeycaps combo={formatHotkey(effective)} tone={hasConflict ? "danger" : "neutral"} />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setRecording({ action: hk.action, label: hk.label })}
                                title={gt("Edit")}
                                className="rounded-md p-0.5 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40 hover:ring-1 hover:ring-[var(--border-strong)]"
                              >
                                <SettingsKeycaps combo={formatHotkey(effective)} tone={hasConflict ? "danger" : "neutral"} />
                              </button>
                            )}
                            {!isLocked && (
                              <SettingsButton
                                variant="ghost"
                                size="sm"
                                className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                                onClick={() => setRecording({ action: hk.action, label: hk.label })}
                              >
                                {gt("Edit")}
                              </SettingsButton>
                            )}
                            {isCustom && !isLocked && (
                              <SettingsButton
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 px-0"
                                onClick={() => handleReset(hk.action)}
                                title={gt("Reset to default")}
                                aria-label={gt("Reset to default")}
                              >
                                <RotateCcw />
                              </SettingsButton>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      <p className="px-0.5 text-xs text-[var(--text-muted)]">
        {gt("Click \"Edit\" to record a new key combination. Changes are saved automatically and persist across sessions.")}
      </p>
    </div>
  );
}
