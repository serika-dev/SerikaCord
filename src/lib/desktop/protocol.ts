// Pure helpers and types for the desktop (Qt) shell bridge. No DOM access, so
// they're unit-tested in tests/desktop.test.ts. The native side lives in
// desktop-QT/src (WebBridge, GlobalShortcuts); keep accelerator names in step
// with KeyState.cpp.

/** Bumped by the shell (WebBridge::PROTOCOL_VERSION) on incompatible changes. */
export const DESKTOP_PROTOCOL_VERSION = 2;

export interface DesktopMarker {
  shell: "qt";
  protocol: number;
  version: string;
  platform: "windows" | "macos" | "linux";
}

export interface DesktopInfo {
  version: string;
  protocol: number;
  platform: string;
  arch?: string;
  qt?: string;
  windowSystem?: string;
  capabilities?: {
    globalShortcuts?: boolean;
    nativeNotifications?: boolean;
    screenPicker?: boolean;
    tray?: boolean;
  };
}

/** Preferences stored by the shell (AppSettings.cpp). */
export interface DesktopSettings {
  closeToTray: boolean;
  minimizeToTray: boolean;
  startOnLogin: boolean;
  startMinimized: boolean;
  spellcheck: boolean;
  nativeNotifications: boolean;
  globalShortcuts: boolean;
  hardwareAcceleration: boolean;
  /** 0 = never go idle automatically. */
  idleTimeoutMinutes: number;
  /** Read-only: whether this OS/session can watch keys system-wide. */
  globalShortcutsAvailable?: boolean;
}

export type DesktopSettingKey = Exclude<keyof DesktopSettings, "globalShortcutsAvailable">;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  closeToTray: true,
  minimizeToTray: false,
  startOnLogin: false,
  startMinimized: false,
  spellcheck: true,
  nativeNotifications: true,
  globalShortcuts: true,
  hardwareAcceleration: true,
  idleTimeoutMinutes: 10,
};

export const IDLE_TIMEOUT_CHOICES = [0, 5, 10, 15, 30, 60] as const;

export type UpdateStateName = "idle" | "checking" | "downloading" | "ready" | "uptodate" | "error";
export interface DesktopUpdateState {
  state: UpdateStateName;
  version?: string;
  percent?: number;
}

/** Merge whatever the shell returned over the defaults, dropping junk. */
export function normalizeDesktopSettings(raw: unknown): DesktopSettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS };
  for (const key of Object.keys(DEFAULT_DESKTOP_SETTINGS) as DesktopSettingKey[]) {
    const v = src[key];
    if (key === "idleTimeoutMinutes") {
      if (typeof v === "number" && Number.isFinite(v)) out.idleTimeoutMinutes = Math.min(240, Math.max(0, Math.round(v)));
    } else if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  if (typeof src.globalShortcutsAvailable === "boolean") out.globalShortcutsAvailable = src.globalShortcutsAvailable;
  return out;
}

export function normalizeUpdateState(raw: unknown): DesktopUpdateState {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const states: UpdateStateName[] = ["idle", "checking", "downloading", "ready", "uptodate", "error"];
  const state = states.includes(src.state as UpdateStateName) ? (src.state as UpdateStateName) : "idle";
  const out: DesktopUpdateState = { state };
  if (typeof src.version === "string" && src.version) out.version = src.version;
  if (typeof src.percent === "number" && Number.isFinite(src.percent)) out.percent = Math.min(100, Math.max(0, src.percent));
  return out;
}

// ── Accelerators ────────────────────────────────────────────────────────────
// "Ctrl+Shift+M", "F13", "Alt+Mouse4". "Ctrl" means Ctrl on Windows/Linux and
// ⌘ on macOS, like the in-app keybinds.

const NAMED_FROM_KEY: Record<string, string> = {
  " ": "Space",
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  insert: "Insert",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  capslock: "CapsLock",
  pause: "Pause",
  scrolllock: "ScrollLock",
};

const PUNCTUATION = "`-=[]\\;',./";

/** Accelerator key token for a lowercased KeyboardEvent.key (in-app keybinds). */
export function keyToAcceleratorKey(key: string): string | null {
  if (!key) return null;
  const k = key.length === 1 ? key : key.toLowerCase();
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return k.toUpperCase();
  if (k.length === 1 && PUNCTUATION.includes(k)) return k;
  return NAMED_FROM_KEY[k] ?? null;
}

const CODE_PUNCT: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/**
 * Accelerator key token for a KeyboardEvent.code (layout-independent, used
 * when recording a global shortcut). Null for modifiers and unsupported keys.
 */
export function codeToAcceleratorKey(code: string): string | null {
  if (!code) return null;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num${m[1]}`;
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (m) return `F${m[1]}`;
  if (CODE_PUNCT[code]) return CODE_PUNCT[code];
  switch (code) {
    case "Space": return "Space";
    case "Tab": return "Tab";
    case "Enter":
    case "NumpadEnter": return "Enter";
    case "Escape": return "Escape";
    case "Backspace": return "Backspace";
    case "Insert": return "Insert";
    case "Delete": return "Delete";
    case "Home": return "Home";
    case "End": return "End";
    case "PageUp": return "PageUp";
    case "PageDown": return "PageDown";
    case "ArrowUp": return "Up";
    case "ArrowDown": return "Down";
    case "ArrowLeft": return "Left";
    case "ArrowRight": return "Right";
    case "CapsLock": return "CapsLock";
    case "Pause": return "Pause";
    case "ScrollLock": return "ScrollLock";
    default: return null;
  }
}

/** MouseEvent.button for the side buttons: 3 = back (Mouse4), 4 = forward (Mouse5). */
export function mouseButtonToAcceleratorKey(button: number): string | null {
  if (button === 3) return "Mouse4";
  if (button === 4) return "Mouse5";
  return null;
}

export interface AcceleratorParts {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  key: string;
}

export function buildAccelerator(parts: AcceleratorParts): string {
  const out: string[] = [];
  if (parts.ctrl) out.push("Ctrl");
  if (parts.shift) out.push("Shift");
  if (parts.alt) out.push("Alt");
  if (parts.meta) out.push("Meta");
  out.push(parts.key);
  return out.join("+");
}

export function parseAccelerator(accelerator: string | null | undefined): AcceleratorParts | null {
  if (!accelerator || typeof accelerator !== "string") return null;
  const tokens = accelerator.split("+").map((t) => t.trim());
  if (tokens.some((t) => !t)) return null;
  const key = tokens.pop()!;
  const parts: AcceleratorParts = { key };
  for (const t of tokens) {
    const l = t.toLowerCase();
    if (l === "ctrl" || l === "control" || l === "cmd" || l === "command" || l === "cmdorctrl") parts.ctrl = true;
    else if (l === "shift") parts.shift = true;
    else if (l === "alt" || l === "option") parts.alt = true;
    else if (l === "meta" || l === "super" || l === "win") parts.meta = true;
    else return null;
  }
  const valid = /^[A-Z0-9]$/.test(key)
    || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
    || /^Num[0-9]$/.test(key)
    || key === "Mouse4" || key === "Mouse5"
    || (key.length === 1 && PUNCTUATION.includes(key))
    || Object.values(NAMED_FROM_KEY).includes(key);
  return valid ? parts : null;
}

/** Accelerator for an in-app keybind ({ key: KeyboardEvent.key lowercased, ctrl, shift, alt }). */
export function keybindToAccelerator(binding: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean } | null | undefined): string | null {
  if (!binding) return null;
  const key = keyToAcceleratorKey(binding.key);
  if (!key) return null;
  return buildAccelerator({ ctrl: binding.ctrl, shift: binding.shift, alt: binding.alt, key });
}

/** Human-readable accelerator ("Ctrl + Shift + M", "⌘ + ⇧ + M" on macOS). */
export function formatAccelerator(accelerator: string | null | undefined, isMac = false): string {
  const p = parseAccelerator(accelerator);
  if (!p) return "";
  const out: string[] = [];
  if (p.ctrl) out.push(isMac ? "⌘" : "Ctrl");
  if (p.shift) out.push(isMac ? "⇧" : "Shift");
  if (p.alt) out.push(isMac ? "⌥" : "Alt");
  if (p.meta) out.push(isMac ? "⌃" : "Win");
  const pretty: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→", PageUp: "Page Up", PageDown: "Page Down", Escape: "Esc", Mouse4: "Mouse 4", Mouse5: "Mouse 5" };
  out.push(pretty[p.key] ?? p.key);
  return out.join(" + ");
}

// ── Global shortcuts ────────────────────────────────────────────────────────

export type GlobalShortcutAction = "push-to-talk" | "toggle-mute" | "toggle-deafen";

/** Per-device overrides for the global shortcuts (localStorage). null = use the default. */
export interface GlobalKeysStore {
  pushToTalk?: string | null;
  toggleMute?: string | null;
  toggleDeafen?: string | null;
}

export interface GlobalShortcutSpec {
  action: GlobalShortcutAction;
  accelerator: string;
  /** Push-to-talk reports press and release. */
  hold: boolean;
  /** Also fire while the SerikaCord window is focused (the page has no equivalent binding). */
  whileFocused: boolean;
}

export interface GlobalShortcutInputs {
  store: GlobalKeysStore;
  /** In-app bindings for the toggles (keybinds.ts effective bindings). */
  muteBinding: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean } | null;
  deafenBinding: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean } | null;
  /** Voice settings: push-to-talk mode and its key ("V"). */
  pttEnabled: boolean;
  pttKey: string;
}

/** Accelerator for the voice settings' single-character push-to-talk key. */
export function pttKeyToAccelerator(pttKey: string): string | null {
  const k = (pttKey || "").trim().slice(0, 1);
  return k ? keyToAcceleratorKey(k.toLowerCase()) : null;
}

/**
 * The shortcuts the shell should watch. Defaults follow the in-app bindings
 * (so Ctrl+Shift+M mutes whether or not SerikaCord is focused); a per-device
 * override replaces them. While focused, the page's own handlers already
 * cover a binding equal to the in-app one, so those don't fire twice.
 */
export function resolveGlobalShortcuts(input: GlobalShortcutInputs): GlobalShortcutSpec[] {
  const specs: GlobalShortcutSpec[] = [];
  const muteDefault = keybindToAccelerator(input.muteBinding);
  const deafenDefault = keybindToAccelerator(input.deafenBinding);
  const pttDefault = pttKeyToAccelerator(input.pttKey);

  const pick = (override: string | null | undefined, fallback: string | null) => {
    if (override && parseAccelerator(override)) return override;
    return fallback;
  };

  if (input.pttEnabled) {
    const acc = pick(input.store.pushToTalk, pttDefault);
    if (acc) specs.push({ action: "push-to-talk", accelerator: acc, hold: true, whileFocused: acc !== pttDefault });
  }
  const mute = pick(input.store.toggleMute, muteDefault);
  if (mute) specs.push({ action: "toggle-mute", accelerator: mute, hold: false, whileFocused: mute !== muteDefault });
  const deafen = pick(input.store.toggleDeafen, deafenDefault);
  if (deafen) specs.push({ action: "toggle-deafen", accelerator: deafen, hold: false, whileFocused: deafen !== deafenDefault });
  return specs;
}

export function parseGlobalKeysStore(raw: string | null | undefined): GlobalKeysStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: GlobalKeysStore = {};
    for (const k of ["pushToTalk", "toggleMute", "toggleDeafen"] as const) {
      const val = v?.[k];
      if (typeof val === "string" && parseAccelerator(val)) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

// ── Navigation ──────────────────────────────────────────────────────────────

/**
 * An in-app path the shell asked us to open (deep link, notification click,
 * in-app link from a popup). Only same-origin paths; never protocol-relative
 * or script URLs.
 */
export function sanitizeAppPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const p = path.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\s]/.test(p)) return null;
  return p.length > 2048 ? null : p;
}

/** User status as the tray menu understands it (Invisible is "offline" in the UI). */
export function trayStatusFor(status: string | null | undefined): "" | "online" | "idle" | "dnd" | "offline" {
  switch (status) {
    case "online":
    case "idle":
    case "dnd":
    case "offline":
      return status;
    case "invisible":
      return "offline";
    default:
      return "";
  }
}
