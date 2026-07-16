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
  const [overrides, setOverrides] = useState<Record<string, KeybindOverride>>({});
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [conflictAction, setConflictAction] = useState<HotkeyAction | null>(null);

  // Load overrides on mount and when keybinds change.
  const refresh = useCallback(() => {
    setOverrides(loadKeybindOverrides());
  }, []);

  useEffect(() => {
    refresh();
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

  return (
    <div className="space-y-4">
      {/* Header with search and reset all */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={gt("Search keybinds...")}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
          />
        </div>
        <button
          onClick={handleResetAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {gt("Reset All")}
        </button>
      </div>

      {/* Keybind categories */}
      {CATEGORY_ORDER.map((category) => {
        const rows = filteredHotkeys.filter((h) => h.category === category);
        if (rows.length === 0) return null;

        return (
          <div key={category}>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">
              {category}
            </h3>
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {rows.map((hk) => {
                const effective = getEffectiveBinding(hk.action);
                const isCustom = !!overrides[hk.action];
                const isLocked = hk.locked;
                const isRecording = recording?.action === hk.action;
                const hasConflict = conflictAction === hk.action;

                return (
                  <div
                    key={hk.action}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 py-2.5 bg-[var(--bg-card)] transition-colors",
                      hasConflict && "bg-red-500/10"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-[var(--text-primary)] truncate">{hk.label}</span>
                      {isCustom && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-[var(--app-accent)]/15 text-[var(--app-accent)]">
                          {gt("Custom")}
                        </span>
                      )}
                      {isLocked && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-[var(--bg-app)] text-[var(--text-muted)]">
                          {gt("Locked")}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isRecording ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--app-accent)] animate-pulse">
                            {gt("Press keys...")}
                          </span>
                          <button
                            onClick={() => { setRecording(null); setConflictAction(null); }}
                            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-white transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <kbd
                            className={cn(
                              "px-2 py-1 rounded-md text-xs font-mono whitespace-nowrap border",
                              hasConflict
                                ? "bg-red-500/15 border-red-500/30 text-red-400"
                                : "bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                            )}
                          >
                            {formatHotkey(effective)}
                          </kbd>
                          {!isLocked && (
                            <button
                              onClick={() => setRecording({ action: hk.action, label: hk.label })}
                              className="px-2 py-1 text-xs rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors"
                            >
                              {gt("Edit")}
                            </button>
                          )}
                          {isCustom && !isLocked && (
                            <button
                              onClick={() => handleReset(hk.action)}
                              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-white transition-colors"
                              title={gt("Reset to default")}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Recording help text */}
      {recording && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/20">
          <AlertTriangle className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
          <p className="text-xs text-[var(--text-secondary)]">
            {gt("Press the key combination you want to bind to \"{label}\". Press Escape to cancel.", { label: recording.label })}
          </p>
        </div>
      )}

      {/* Info notice */}
      <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
        <p className="text-xs text-[var(--text-muted)]">
          {gt("Click \"Edit\" to record a new key combination. Changes are saved automatically and persist across sessions.")}
        </p>
      </div>
    </div>
  );
}
