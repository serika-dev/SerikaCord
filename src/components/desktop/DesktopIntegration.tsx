"use client";

/**
 * Wires the web app to the desktop shell: notification clicks and serika://
 * links route in-app, the tray mirrors mute/deafen/status and drives them,
 * global push-to-talk / mute / deafen work while unfocused, the OS idle timer
 * sets Idle, and the update banner appears when a new version is downloaded.
 */

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getEffectiveBinding } from "@/lib/keybinds";
import { voiceService } from "@/lib/services/voiceService";
import { navigateInApp } from "@/lib/services/notificationService";
import {
  GLOBAL_KEYS_EVENT,
  getDesktopBridge,
  loadGlobalKeys,
  onDesktopSignal,
  runDesktopNotificationClick,
} from "@/lib/desktop/bridge";
import { resolveGlobalShortcuts, sanitizeAppPath, trayStatusFor } from "@/lib/desktop/protocol";
import { setExternalIdle } from "@/lib/presence/idleTracker";
import { DesktopUpdateBanner } from "./DesktopUpdateBanner";

type Status = "online" | "idle" | "dnd" | "offline";

export default function DesktopIntegration() {
  const { user, setOnlineStatus } = useAuth();

  const status = user ? trayStatusFor(user.status) : "";
  useEffect(() => {
    void getDesktopBridge().then((b) => b?.setUserStatus(status));
  }, [status]);

  // Signals from the shell.
  useEffect(() => {
    const open = (raw: unknown) => {
      const path = sanitizeAppPath(raw);
      if (path) navigateInApp(path);
    };
    const toggleMute = () => { if (voiceService.connected) voiceService.toggleMute(); };
    const toggleDeafen = () => { if (voiceService.connected) voiceService.toggleDeafen(); };

    const offs = [
      onDesktopSignal("notificationClicked", (id, url) => {
        if (!runDesktopNotificationClick(id)) open(url);
      }),
      onDesktopSignal("navigateRequested", (path) => open(path)),
      onDesktopSignal("trayAction", (action, value) => {
        if (action === "toggle-mute") toggleMute();
        else if (action === "toggle-deafen") toggleDeafen();
        else if (action === "set-status" && ["online", "idle", "dnd", "offline"].includes(value)) {
          void setOnlineStatus(value as Status);
        } else if (action === "open-settings") {
          window.dispatchEvent(new CustomEvent("openUserSettings", { detail: { tab: value || "desktop" } }));
        }
      }),
      onDesktopSignal("globalShortcut", (action, pressed) => {
        if (action === "push-to-talk") voiceService.setExternalPushToTalk(pressed);
        else if (!pressed) return;
        else if (action === "toggle-mute") toggleMute();
        else if (action === "toggle-deafen") toggleDeafen();
      }),
      // System-wide idle replaces in-app input tracking; the presence
      // heartbeat reports it and the server flips online <-> idle (never DND
      // / Invisible / a manual Idle).
      onDesktopSignal("idleChanged", (idle) => setExternalIdle(Boolean(idle))),
    ];
    // The shell tracks system idle: the window sitting in the tray without
    // in-app input must not count as idle by itself.
    setExternalIdle(false);
    // Signals are connected in the same promise chain, so the shell only
    // starts routing deep links here once they're listened to.
    void getDesktopBridge().then((b) => b?.webReady());
    return () => offs.forEach((off) => off());
  }, [setOnlineStatus]);

  // Voice state -> tray, and global shortcut registration.
  useEffect(() => {
    let lastVoice = "";
    let lastShortcuts = "";
    const pushVoice = () => {
      const state = { connected: voiceService.connected, muted: voiceService.muted, deafened: voiceService.deafened };
      const key = JSON.stringify(state);
      if (key === lastVoice) return;
      lastVoice = key;
      void getDesktopBridge().then((b) => b?.setVoiceState(state));
    };
    const syncShortcuts = () => {
      const specs = resolveGlobalShortcuts({
        store: loadGlobalKeys(),
        muteBinding: getEffectiveBinding("toggle-mute"),
        deafenBinding: getEffectiveBinding("toggle-deafen"),
        pttEnabled: voiceService.pushToTalkEnabled,
        pttKey: voiceService.pushToTalkKey,
      });
      const key = JSON.stringify(specs);
      if (key === lastShortcuts) return;
      lastShortcuts = key;
      void getDesktopBridge().then((b) => b?.setGlobalShortcuts(specs));
    };
    pushVoice();
    syncShortcuts();
    const unsub = voiceService.subscribe((e) => {
      if (e.type === "speaking" || e.type === "participants_changed") return;
      pushVoice();
      if (e.type === "push_to_talk_changed" || e.type === "connected" || e.type === "disconnected") syncShortcuts();
    });
    window.addEventListener("serika:keybinds-changed", syncShortcuts);
    window.addEventListener(GLOBAL_KEYS_EVENT, syncShortcuts);
    return () => {
      unsub();
      window.removeEventListener("serika:keybinds-changed", syncShortcuts);
      window.removeEventListener(GLOBAL_KEYS_EVENT, syncShortcuts);
    };
  }, []);

  return <DesktopUpdateBanner />;
}
