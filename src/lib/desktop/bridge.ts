"use client";

/**
 * Client for the Qt desktop shell's bridge (`window.qt.webBridge`, a
 * QWebChannel object; native side: desktop-QT/src/WebBridge.cpp).
 *
 * Everything here feature-detects: in a browser `isDesktopShell()` is false
 * and the helpers are no-ops, so the web app works unchanged.
 */

import {
  type DesktopInfo,
  type DesktopMarker,
  type DesktopSettingKey,
  type DesktopSettings,
  type DesktopUpdateState,
  type GlobalKeysStore,
  type GlobalShortcutSpec,
  normalizeDesktopSettings,
  normalizeUpdateState,
  parseGlobalKeysStore,
} from "./protocol";

type Callback<T> = (value: T) => void;

interface QtSignal<Args extends unknown[]> {
  connect(fn: (...args: Args) => void): void;
  disconnect(fn: (...args: Args) => void): void;
}

/** Shape of the QWebChannel object. Methods take a trailing result callback. */
export interface RawDesktopBridge {
  getInfo(cb: Callback<DesktopInfo>): void;
  webReady(): void;
  setZoom(delta: number): void;
  toggleFullscreen(): void;
  toggleDevTools(): void;
  setBadgeCount(count: number): void;
  openExternal(url: string): void;
  focusWindow(): void;
  showNotification(n: Record<string, unknown>): void;
  closeNotification(tag: string): void;
  setVoiceState(state: { connected: boolean; muted: boolean; deafened: boolean }): void;
  setUserStatus(status: string): void;
  setGlobalShortcuts(list: GlobalShortcutSpec[], cb?: Callback<string[]>): void;
  getSettings(cb: Callback<unknown>): void;
  setSetting(key: string, value: unknown, cb?: Callback<boolean>): void;
  getIdleSeconds(cb: Callback<number>): void;
  checkForUpdates(): void;
  installUpdate(): void;
  getUpdateState(cb: Callback<unknown>): void;

  notificationClicked: QtSignal<[string, string]>;
  navigateRequested: QtSignal<[string]>;
  trayAction: QtSignal<[string, string]>;
  globalShortcut: QtSignal<[string, boolean]>;
  idleChanged: QtSignal<[boolean]>;
  updateStateChanged: QtSignal<[unknown]>;
  settingsChanged: QtSignal<[unknown]>;
}

declare global {
  interface Window {
    __serikaDesktop?: DesktopMarker;
    qt?: { webBridge?: RawDesktopBridge; webChannelTransport?: unknown };
  }
}

/** True inside the SerikaCord desktop app (set before any page script runs). */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && window.__serikaDesktop?.shell === "qt";
}

export function getDesktopMarker(): DesktopMarker | null {
  return isDesktopShell() ? window.__serikaDesktop! : null;
}

let bridgePromise: Promise<RawDesktopBridge | null> | null = null;

/** The bridge once QWebChannel has connected (null outside the shell). */
export function getDesktopBridge(): Promise<RawDesktopBridge | null> {
  if (!isDesktopShell()) return Promise.resolve(null);
  if (window.qt?.webBridge) return Promise.resolve(window.qt.webBridge);
  if (!bridgePromise) {
    bridgePromise = new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("serika-desktop-bridge", done);
        clearTimeout(timer);
        resolve(window.qt?.webBridge ?? null);
      };
      const timer = setTimeout(done, 15000);
      window.addEventListener("serika-desktop-bridge", done);
    });
    // A failed wait (very old shell) may succeed on a later call.
    void bridgePromise.then((b) => { if (!b) bridgePromise = null; });
  }
  return bridgePromise;
}

/** Synchronous handle when the channel is already up (for hot paths). */
export function desktopBridgeNow(): RawDesktopBridge | null {
  return isDesktopShell() ? window.qt?.webBridge ?? null : null;
}

function callWithResult<T>(fn: (b: RawDesktopBridge, cb: Callback<T>) => void, fallback: T): Promise<T> {
  return getDesktopBridge().then((b) => {
    if (!b) return fallback;
    return new Promise<T>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, 5000);
      try {
        fn(b, (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(v);
        });
      } catch {
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    });
  });
}

/** Subscribe to a bridge signal; returns an unsubscribe function. */
export function onDesktopSignal<K extends keyof RawDesktopBridge>(
  name: K,
  handler: RawDesktopBridge[K] extends QtSignal<infer A> ? (...args: A) => void : never,
): () => void {
  let disposed = false;
  let attached: RawDesktopBridge | null = null;
  void getDesktopBridge().then((b) => {
    if (!b || disposed) return;
    const signal = b[name] as unknown as QtSignal<unknown[]> | undefined;
    if (!signal || typeof signal.connect !== "function") return;
    signal.connect(handler as (...args: unknown[]) => void);
    attached = b;
  });
  return () => {
    disposed = true;
    const signal = attached?.[name] as unknown as QtSignal<unknown[]> | undefined;
    try { signal?.disconnect(handler as (...args: unknown[]) => void); } catch { /* channel gone */ }
  };
}

// ── Info / settings / updates ───────────────────────────────────────────────

export function getDesktopInfo(): Promise<DesktopInfo | null> {
  return callWithResult<DesktopInfo | null>((b, cb) => b.getInfo(cb as Callback<DesktopInfo>), null);
}

export async function getDesktopSettings(): Promise<DesktopSettings | null> {
  const raw = await callWithResult<unknown>((b, cb) => b.getSettings(cb), null);
  return raw ? normalizeDesktopSettings(raw) : null;
}

export function setDesktopSetting<K extends DesktopSettingKey>(key: K, value: DesktopSettings[K]): Promise<boolean> {
  return callWithResult<boolean>((b, cb) => b.setSetting(key, value, cb), false);
}

export async function getDesktopUpdateState(): Promise<DesktopUpdateState | null> {
  const raw = await callWithResult<unknown>((b, cb) => b.getUpdateState(cb), null);
  return raw ? normalizeUpdateState(raw) : null;
}

export function checkDesktopUpdates(): void {
  void getDesktopBridge().then((b) => b?.checkForUpdates());
}

export function installDesktopUpdate(): void {
  void getDesktopBridge().then((b) => b?.installUpdate());
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface DesktopNotificationOptions {
  tag?: string;
  icon?: string;
  url?: string | null;
  requireInteraction?: boolean;
  onClick?: () => void;
}

// Click handlers by notification id (most recent per tag wins).
const clickHandlers = new Map<string, () => void>();
let notificationSeq = 0;

function absoluteUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, window.location.href).toString();
  } catch {
    return undefined;
  }
}

/** Show a native notification through the shell. Returns false outside it. */
export function showDesktopNotification(title: string, body: string, options: DesktopNotificationOptions = {}): boolean {
  if (!isDesktopShell()) return false;
  const id = `n${Date.now().toString(36)}-${++notificationSeq}`;
  if (options.onClick) {
    clickHandlers.set(id, options.onClick);
    // Bounded: old notifications can't be clicked forever.
    if (clickHandlers.size > 100) clickHandlers.delete(clickHandlers.keys().next().value as string);
  }
  const payload = {
    id,
    title,
    body,
    tag: options.tag || id,
    icon: absoluteUrl(options.icon),
    url: options.url || "",
    requireInteraction: Boolean(options.requireInteraction),
  };
  void getDesktopBridge().then((b) => b?.showNotification(payload));
  return true;
}

export function closeDesktopNotification(tag: string): void {
  if (!isDesktopShell() || !tag) return;
  void getDesktopBridge().then((b) => b?.closeNotification(tag));
}

/**
 * Run the click handler registered for a notification. Returns false when
 * there's none (the caller falls back to the notification's URL).
 */
export function runDesktopNotificationClick(id: string): boolean {
  const fn = clickHandlers.get(id);
  if (!fn) return false;
  clickHandlers.delete(id);
  try { fn(); } catch { /* handler errors shouldn't break routing */ }
  return true;
}

// ── Global shortcut overrides (per device) ──────────────────────────────────

const GLOBAL_KEYS_STORAGE = "serika-desktop-global-keys";
export const GLOBAL_KEYS_EVENT = "serika:desktop-global-keys-changed";

export function loadGlobalKeys(): GlobalKeysStore {
  if (typeof window === "undefined") return {};
  try {
    return parseGlobalKeysStore(localStorage.getItem(GLOBAL_KEYS_STORAGE));
  } catch {
    return {};
  }
}

export function saveGlobalKey(key: keyof GlobalKeysStore, accelerator: string | null): void {
  if (typeof window === "undefined") return;
  const all = loadGlobalKeys();
  if (accelerator) all[key] = accelerator;
  else delete all[key];
  try {
    localStorage.setItem(GLOBAL_KEYS_STORAGE, JSON.stringify(all));
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(GLOBAL_KEYS_EVENT));
}
