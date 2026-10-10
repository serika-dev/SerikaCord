"use client";

import { useCallback, useEffect, useState } from "react";
import { useGT } from "gt-next";
import { Globe, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getEffectiveBinding } from "@/lib/keybinds";
import { voiceService } from "@/lib/services/voiceService";
import { GLOBAL_KEYS_EVENT, getDesktopSettings, loadGlobalKeys, saveGlobalKey } from "@/lib/desktop/bridge";
import {
  buildAccelerator,
  codeToAcceleratorKey,
  formatAccelerator,
  keybindToAccelerator,
  mouseButtonToAcceleratorKey,
  pttKeyToAccelerator,
  type GlobalKeysStore,
} from "@/lib/desktop/protocol";

type Slot = keyof GlobalKeysStore;

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight",
]);

function useDefaults() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("serika:keybinds-changed", bump);
    window.addEventListener(GLOBAL_KEYS_EVENT, bump);
    const unsub = voiceService.subscribe((e) => { if (e.type === "push_to_talk_changed") bump(); });
    return () => {
      window.removeEventListener("serika:keybinds-changed", bump);
      window.removeEventListener(GLOBAL_KEYS_EVENT, bump);
      unsub();
    };
  }, []);
  // Read fresh on every render (cheap); `tick` re-renders when any source changes.
  return {
    tick,
    store: loadGlobalKeys(),
    pushToTalk: pttKeyToAccelerator(voiceService.pushToTalkKey),
    toggleMute: keybindToAccelerator(getEffectiveBinding("toggle-mute")),
    toggleDeafen: keybindToAccelerator(getEffectiveBinding("toggle-deafen")),
    pttEnabled: voiceService.pushToTalkEnabled,
  };
}

/**
 * Desktop app only: the system-wide shortcuts (work while SerikaCord is in
 * the background). By default they follow the in-app bindings; each can be
 * set to any key, F13-F24 or a mouse side button on this device.
 */
export function GlobalShortcutSettings() {
  const gt = useGT();
  const state = useDefaults();
  const [recording, setRecording] = useState<Slot | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  useEffect(() => {
    let alive = true;
    void getDesktopSettings().then((s) => {
      if (alive && s) setEnabled(s.globalShortcuts && s.globalShortcutsAvailable !== false);
    });
    return () => { alive = false; };
  }, []);

  const finish = useCallback((slot: Slot, accelerator: string) => {
    saveGlobalKey(slot, accelerator);
    setRecording(null);
    toast.success(gt("Global shortcut updated"));
  }, [gt]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        setRecording(null);
        return;
      }
      if (MODIFIER_CODES.has(e.code)) return;
      const key = codeToAcceleratorKey(e.code);
      if (!key) return;
      finish(recording, buildAccelerator({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key }));
    };
    const onMouse = (e: MouseEvent) => {
      const key = mouseButtonToAcceleratorKey(e.button);
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      finish(recording, buildAccelerator({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key }));
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onMouse, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
      window.removeEventListener("mousedown", onMouse, { capture: true } as EventListenerOptions);
    };
  }, [recording, finish]);

  const rows: Array<{ slot: Slot; label: string; hint: string; fallback: string | null }> = [
    {
      slot: "pushToTalk",
      label: gt("Push to talk"),
      hint: state.pttEnabled
        ? gt("Hold to talk while in a call.")
        : gt("Turn on Push to Talk in Voice & Video to use this."),
      fallback: state.pushToTalk,
    },
    { slot: "toggleMute", label: gt("Toggle mute"), hint: gt("Mute or unmute your microphone."), fallback: state.toggleMute },
    { slot: "toggleDeafen", label: gt("Toggle deafen"), hint: gt("Deafen or undeafen yourself."), fallback: state.toggleDeafen },
  ];

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        <Globe className="h-3 w-3" />
        {gt("Global (desktop app)")}
      </h3>
      {enabled === false && (
        <p className="mb-2 px-1 text-xs text-[var(--text-secondary)]">
          {gt("Global shortcuts are off. Turn them on in Desktop settings.")}
        </p>
      )}
      <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        {rows.map((row) => {
          const custom = state.store[row.slot] ?? null;
          const current = custom ?? row.fallback;
          const isRecording = recording === row.slot;
          return (
            <div key={row.slot} className="flex items-center justify-between gap-3 bg-[var(--bg-card)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[var(--text-primary)]">{row.label}</span>
                  {custom && (
                    <span className="shrink-0 rounded bg-[var(--app-accent)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--app-accent)]">
                      {gt("Custom")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{row.hint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isRecording ? (
                  <>
                    <span className="animate-pulse text-xs text-[var(--app-accent)]">{gt("Press a key or mouse button...")}</span>
                    <button
                      type="button"
                      onClick={() => setRecording(null)}
                      className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      aria-label={gt("Cancel")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <kbd
                      className={cn(
                        "whitespace-nowrap rounded-md border px-2 py-1 font-mono text-xs",
                        "border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-secondary)]",
                      )}
                    >
                      {current ? formatAccelerator(current, isMac) : gt("Not set")}
                    </kbd>
                    <button
                      type="button"
                      onClick={() => setRecording(row.slot)}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--text-primary)]"
                    >
                      {gt("Edit")}
                    </button>
                    {custom && (
                      <button
                        type="button"
                        onClick={() => saveGlobalKey(row.slot, null)}
                        className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        title={gt("Reset to default")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
        {gt("These work even when SerikaCord isn't focused. By default they use the same keys as in the app.")}
      </p>
    </div>
  );
}
