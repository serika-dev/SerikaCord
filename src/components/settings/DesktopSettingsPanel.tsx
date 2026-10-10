"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  checkDesktopUpdates,
  getDesktopInfo,
  getDesktopSettings,
  getDesktopUpdateState,
  installDesktopUpdate,
  onDesktopSignal,
  setDesktopSetting,
} from "@/lib/desktop/bridge";
import {
  IDLE_TIMEOUT_CHOICES,
  normalizeDesktopSettings,
  normalizeUpdateState,
  type DesktopInfo,
  type DesktopSettingKey,
  type DesktopSettings,
  type DesktopUpdateState,
} from "@/lib/desktop/protocol";

function Row({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-[var(--text-primary)]">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
      <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4">
        {children}
      </div>
    </section>
  );
}

/**
 * Settings that only exist in the desktop app (stored by the shell, per
 * device): tray behaviour, start on login, notifications, global shortcuts,
 * spellcheck, auto-idle, hardware acceleration and updates.
 */
export function DesktopSettingsPanel() {
  const gt = useGT();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getDesktopSettings().then((s) => { if (alive && s) setSettings(s); });
    void getDesktopInfo().then((i) => { if (alive) setInfo(i); });
    void getDesktopUpdateState().then((u) => { if (alive && u) setUpdate(u); });
    const offs = [
      onDesktopSignal("settingsChanged", (raw) => setSettings(normalizeDesktopSettings(raw))),
      onDesktopSignal("updateStateChanged", (raw) => setUpdate(normalizeUpdateState(raw))),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, []);

  const change = useCallback(<K extends DesktopSettingKey>(key: K, value: DesktopSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (key === "hardwareAcceleration") setRestartNeeded(true);
    void setDesktopSetting(key, value).then((ok) => {
      if (!ok) toast.error(gt("Couldn't save that setting"));
    });
  }, [gt]);

  if (!settings) {
    return <p className="text-sm text-[var(--text-secondary)]">{gt("Connecting to the desktop app…")}</p>;
  }

  const updateLabel = (() => {
    switch (update?.state) {
      case "checking": return gt("Checking for updates…");
      case "downloading": return gt("Downloading update… {percent}%", { percent: Math.round(update.percent ?? 0) });
      case "ready": return gt("Version {version} is ready to install.", { version: update.version ?? "" });
      case "uptodate": return gt("You're on the latest version.");
      case "error": return gt("Couldn't check for updates. Try again later.");
      default: return null;
    }
  })();

  return (
    <div className="space-y-6">
      <Section title={gt("Windows & Tray")}>
        <Row title={gt("Open SerikaCord when you log in")}>
          <ToggleSwitch size="sm" checked={settings.startOnLogin} onCheckedChange={(v) => change("startOnLogin", v)} aria-label={gt("Open SerikaCord when you log in")} />
        </Row>
        <Row title={gt("Start minimized")} hint={gt("When opened at login, start in the system tray.")}>
          <ToggleSwitch size="sm" checked={settings.startMinimized} disabled={!settings.startOnLogin} onCheckedChange={(v) => change("startMinimized", v)} aria-label={gt("Start minimized")} />
        </Row>
        <Row title={gt("Close button minimizes to tray")} hint={gt("Keep SerikaCord running for calls and notifications when you close the window.")}>
          <ToggleSwitch size="sm" checked={settings.closeToTray} onCheckedChange={(v) => change("closeToTray", v)} aria-label={gt("Close button minimizes to tray")} />
        </Row>
        <Row title={gt("Minimize to tray")} hint={gt("Hide the window in the tray instead of the taskbar when minimized.")}>
          <ToggleSwitch size="sm" checked={settings.minimizeToTray} onCheckedChange={(v) => change("minimizeToTray", v)} aria-label={gt("Minimize to tray")} />
        </Row>
      </Section>

      <Section title={gt("Notifications & Status")}>
        <Row title={gt("Notifications on this computer")} hint={gt("Show SerikaCord notifications in your system's notification center. Click one to jump to the message.")}>
          <ToggleSwitch size="sm" checked={settings.nativeNotifications} onCheckedChange={(v) => change("nativeNotifications", v)} aria-label={gt("Notifications on this computer")} />
        </Row>
        <Row title={gt("Go idle automatically")} hint={gt("Show as Idle when you haven't used your computer for a while.")}>
          <select
            value={settings.idleTimeoutMinutes}
            onChange={(e) => change("idleTimeoutMinutes", Number(e.target.value))}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-sm text-[var(--text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
            aria-label={gt("Go idle automatically")}
          >
            {IDLE_TIMEOUT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? gt("Never") : gt("After {minutes} minutes", { minutes: m })}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title={gt("Input")}>
        <Row
          title={gt("Global shortcuts")}
          hint={settings.globalShortcutsAvailable === false
            ? gt("Not available on this system. On Linux this needs an X11 session.")
            : gt("Push to talk, mute and deafen work even when SerikaCord isn't focused. Change the keys in Keybinds.")}
        >
          <ToggleSwitch size="sm" checked={settings.globalShortcuts} disabled={settings.globalShortcutsAvailable === false} onCheckedChange={(v) => change("globalShortcuts", v)} aria-label={gt("Global shortcuts")} />
        </Row>
        <Row title={gt("Spellcheck")} hint={gt("Underline misspelled words and suggest fixes when you right-click.")}>
          <ToggleSwitch size="sm" checked={settings.spellcheck} onCheckedChange={(v) => change("spellcheck", v)} aria-label={gt("Spellcheck")} />
        </Row>
      </Section>

      <Section title={gt("Advanced")}>
        <Row
          title={gt("Hardware acceleration")}
          hint={restartNeeded ? gt("Restart SerikaCord to apply this change.") : gt("Use your GPU to make SerikaCord smoother. Turn off if you see glitches.")}
        >
          <ToggleSwitch size="sm" checked={settings.hardwareAcceleration} onCheckedChange={(v) => change("hardwareAcceleration", v)} aria-label={gt("Hardware acceleration")} />
        </Row>
        <Row
          title={gt("Desktop app version")}
          hint={updateLabel ?? (info ? `${info.version} · ${info.platform}${info.qt ? ` · Qt ${info.qt}` : ""}` : null)}
        >
          {update?.state === "ready" ? (
            <button
              type="button"
              onClick={installDesktopUpdate}
              className="rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] hover:opacity-90"
            >
              {gt("Restart to update")}
            </button>
          ) : (
            <button
              type="button"
              onClick={checkDesktopUpdates}
              disabled={update?.state === "checking" || update?.state === "downloading"}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {gt("Check for updates")}
            </button>
          )}
        </Row>
      </Section>
    </div>
  );
}
