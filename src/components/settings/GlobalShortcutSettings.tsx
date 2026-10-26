"use client";

import { useCallback, useEffect, useState } from "react";
import { useGT } from "gt-next";
import { Globe, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsKeycaps } from "@/components/settings/blocks/SettingsKeycaps";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
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
    <section className="space-y-3">
      <div className="px-0.5">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--text-primary)]">
          <Globe className="h-4 w-4 text-[var(--text-secondary)]" />
          {gt("Global (desktop app)")}
        </h3>
        <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
          {enabled === false
            ? gt("Global shortcuts are off. Turn them on in Desktop settings.")
            : gt("These work even when SerikaCord isn't focused. By default they use the same keys as in the app.")}
        </p>
      </div>
      <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
        {rows.map((row) => {
          const custom = state.store[row.slot] ?? null;
          const current = custom ?? row.fallback;
          const isRecording = recording === row.slot;
          return (
            <div
              key={row.slot}
              data-settings-row
              className={cn(
                "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 transition-colors duration-(--motion-fast) [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/50",
                isRecording && "bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{row.label}</span>
                  {custom && <SettingsStatusPill tone="accent">{gt("Custom")}</SettingsStatusPill>}
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{row.hint}</p>
              </div>
              <div className="flex items-center justify-end gap-1.5">
                {isRecording ? (
                  <>
                    <span className="animate-pulse text-xs font-medium text-[var(--app-accent)]">{gt("Press a key or mouse button...")}</span>
                    <SettingsButton variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => setRecording(null)} aria-label={gt("Cancel")}>
                      <X />
                    </SettingsButton>
                  </>
                ) : (
                  <>
                    {current ? (
                      <SettingsKeycaps combo={formatAccelerator(current, isMac)} />
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">{gt("Not set")}</span>
                    )}
                    <SettingsButton variant="ghost" size="sm" onClick={() => setRecording(row.slot)}>
                      {gt("Edit")}
                    </SettingsButton>
                    {custom && (
                      <SettingsButton
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 px-0"
                        onClick={() => saveGlobalKey(row.slot, null)}
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
    </section>
  );
}
