/**
 * App-wide keyboard shortcut registry (Discord-parity hotkeys).
 *
 * Two kinds of shortcut:
 *  - "navigation" actions are handled directly inside `useAppHotkeys`
 *    (they need the router + server/channel/unread context).
 *  - "action" shortcuts are broadcast on a tiny event bus so whichever
 *    component owns the relevant UI (chat area, composer, voice bar, layout)
 *    can react without prop-drilling.
 *
 * The same list feeds the Ctrl+/ shortcuts help overlay so the docs never
 * drift from the actual bindings.
 */

export type HotkeyAction =
  // Navigation (handled in useAppHotkeys)
  | "nav-server-prev"
  | "nav-server-next"
  | "nav-channel-prev"
  | "nav-channel-next"
  | "nav-unread-prev"
  | "nav-unread-next"
  | "nav-mention-prev"
  | "nav-mention-next"
  | "nav-prev-channel"
  | "nav-back"
  | "nav-forward"
  | "mark-channel-read"
  | "mark-server-read"
  | "goto-dm"
  // Broadcast actions (handled by owning components)
  | "toggle-help"
  | "toggle-pins"
  | "toggle-mentions"
  | "toggle-members"
  | "toggle-emoji"
  | "toggle-gifs"
  | "toggle-stickers"
  | "focus-composer"
  | "scroll-up"
  | "scroll-down"
  | "jump-oldest-unread"
  | "create-server"
  | "create-group-dm"
  | "upload-file"
  | "toggle-mute"
  | "toggle-deafen"
  | "open-help-center"
  | "open-user-settings"
  | "search-channel"
  | "search-all"
  | "answer-call"
  | "decline-call"
  | "start-dm-call"
  | "return-to-voice"
  | "toggle-streamer-mode"
  | "edit-last-message"
  | "toggle-soundboard";

export interface Hotkey {
  action: HotkeyAction;
  /** lowercased KeyboardEvent.key, or a code-independent single char */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Whether this fires even while a text field / composer is focused. */
  worksWhileTyping?: boolean;
  /** Human label for the help overlay. */
  label: string;
  category: "Navigation" | "Chat" | "Voice" | "Application";
  /** If true, the binding cannot be remapped by the user. */
  locked?: boolean;
}

/** Shape stored in localStorage for user overrides. */
export interface KeybindOverride {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * The full binding table. `key` matches `KeyboardEvent.key` (lowercased).
 * `ctrl` matches ctrlKey OR metaKey so macOS ⌘ and Windows Ctrl both work.
 */
export const HOTKEYS: Hotkey[] = [
  // ---- Navigation ----
  { action: "nav-server-prev", key: "arrowup", ctrl: true, alt: true, worksWhileTyping: true, label: "Navigate to previous server", category: "Navigation" },
  { action: "nav-server-next", key: "arrowdown", ctrl: true, alt: true, worksWhileTyping: true, label: "Navigate to next server", category: "Navigation" },
  { action: "nav-mention-prev", key: "arrowup", ctrl: true, shift: true, alt: true, worksWhileTyping: true, label: "Previous unread channel with mentions", category: "Navigation" },
  { action: "nav-mention-next", key: "arrowdown", ctrl: true, shift: true, alt: true, worksWhileTyping: true, label: "Next unread channel with mentions", category: "Navigation" },
  { action: "nav-unread-prev", key: "arrowup", shift: true, alt: true, worksWhileTyping: true, label: "Previous unread channel", category: "Navigation" },
  { action: "nav-unread-next", key: "arrowdown", shift: true, alt: true, worksWhileTyping: true, label: "Next unread channel", category: "Navigation" },
  { action: "nav-channel-prev", key: "arrowup", alt: true, worksWhileTyping: true, label: "Navigate to previous channel", category: "Navigation" },
  { action: "nav-channel-next", key: "arrowdown", alt: true, worksWhileTyping: true, label: "Navigate to next channel", category: "Navigation" },
  { action: "nav-prev-channel", key: "b", ctrl: true, worksWhileTyping: true, label: "Return to previous text channel", category: "Navigation" },
  { action: "nav-back", key: "arrowleft", alt: true, worksWhileTyping: true, label: "Navigate back", category: "Navigation" },
  { action: "nav-forward", key: "arrowright", alt: true, worksWhileTyping: true, label: "Navigate forward", category: "Navigation" },
  { action: "goto-dm", key: "k", ctrl: true, worksWhileTyping: true, label: "Find or start a direct message", category: "Navigation" },
  { action: "mark-server-read", key: "escape", shift: true, worksWhileTyping: true, label: "Mark server as read", category: "Navigation" },
  { action: "mark-channel-read", key: "escape", worksWhileTyping: false, label: "Mark channel as read", category: "Navigation", locked: true },

  // ---- Chat ----
  { action: "toggle-pins", key: "p", ctrl: true, worksWhileTyping: true, label: "Toggle pinned messages", category: "Chat" },
  { action: "toggle-mentions", key: "i", ctrl: true, worksWhileTyping: true, label: "Toggle mentions popout", category: "Chat" },
  { action: "toggle-members", key: "u", ctrl: true, worksWhileTyping: true, label: "Toggle member list", category: "Chat" },
  { action: "toggle-emoji", key: "e", ctrl: true, worksWhileTyping: true, label: "Toggle emoji picker", category: "Chat" },
  { action: "toggle-gifs", key: "g", ctrl: true, worksWhileTyping: true, label: "Open GIF picker", category: "Chat" },
  { action: "toggle-stickers", key: "s", ctrl: true, worksWhileTyping: true, label: "Open sticker picker", category: "Chat" },
  { action: "upload-file", key: "u", ctrl: true, shift: true, worksWhileTyping: true, label: "Upload a file", category: "Chat" },
  { action: "focus-composer", key: "tab", worksWhileTyping: false, label: "Focus the text area", category: "Chat", locked: true },
  { action: "jump-oldest-unread", key: "pageup", shift: true, worksWhileTyping: true, label: "Jump to oldest unread message", category: "Chat" },
  { action: "scroll-up", key: "pageup", worksWhileTyping: true, label: "Scroll chat up", category: "Chat" },
  { action: "scroll-down", key: "pagedown", worksWhileTyping: true, label: "Scroll chat down", category: "Chat" },
  { action: "search-channel", key: "f", ctrl: true, worksWhileTyping: true, label: "Search within current channel", category: "Chat" },
  { action: "search-all", key: "f", ctrl: true, shift: true, worksWhileTyping: true, label: "Search across all channels", category: "Chat" },
  { action: "edit-last-message", key: "arrowup", shift: true, worksWhileTyping: false, label: "Edit your last message", category: "Chat" },

  // ---- Voice ----
  { action: "toggle-mute", key: "m", ctrl: true, shift: true, worksWhileTyping: true, label: "Toggle mute", category: "Voice" },
  { action: "toggle-deafen", key: "d", ctrl: true, shift: true, worksWhileTyping: true, label: "Toggle deafen", category: "Voice" },
  { action: "answer-call", key: "enter", ctrl: true, worksWhileTyping: true, label: "Answer incoming call", category: "Voice" },
  { action: "decline-call", key: "escape", worksWhileTyping: true, label: "Decline incoming call", category: "Voice" },
  { action: "start-dm-call", key: "[", ctrl: true, worksWhileTyping: true, label: "Start call in current DM", category: "Voice" },
  { action: "return-to-voice", key: "v", ctrl: true, shift: true, alt: true, worksWhileTyping: true, label: "Return to voice channel", category: "Voice" },
  { action: "toggle-soundboard", key: "b", ctrl: true, shift: true, worksWhileTyping: true, label: "Open soundboard", category: "Voice" },

  // ---- Application ----
  { action: "create-server", key: "n", ctrl: true, shift: true, worksWhileTyping: true, label: "Create or join a server", category: "Application" },
  { action: "create-group-dm", key: "t", ctrl: true, shift: true, worksWhileTyping: true, label: "Create a private group", category: "Application" },
  { action: "toggle-help", key: "/", ctrl: true, worksWhileTyping: true, label: "Toggle keyboard shortcuts", category: "Application" },
  { action: "open-help-center", key: "h", ctrl: true, shift: true, worksWhileTyping: true, label: "Open help center", category: "Application" },
  { action: "open-user-settings", key: ",", ctrl: true, worksWhileTyping: true, label: "Open user settings", category: "Application" },
  { action: "toggle-streamer-mode", key: "s", ctrl: true, shift: true, alt: true, worksWhileTyping: true, label: "Toggle streamer mode", category: "Application" },
];

/** Match a keyboard event against the binding table (most-specific first).
 *  Applies user overrides from localStorage on top of the defaults. */
export function matchHotkey(e: KeyboardEvent): Hotkey | null {
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const overrides = loadKeybindOverrides();
  // Build the effective binding list: defaults patched with user overrides.
  const effective = HOTKEYS.map((hk) => {
    const ov = overrides[hk.action];
    if (!ov || hk.locked) return hk;
    return { ...hk, key: ov.key, ctrl: ov.ctrl, shift: ov.shift, alt: ov.alt };
  });
  // Sort so bindings with more modifiers win (e.g. Ctrl+Alt+↑ before Alt+↑).
  for (const hk of [...effective].sort((a, b) => modifierCount(b) - modifierCount(a))) {
    if (hk.key !== key) continue;
    if (!!hk.ctrl !== ctrl) continue;
    if (!!hk.shift !== e.shiftKey) continue;
    if (!!hk.alt !== e.altKey) continue;
    return hk;
  }
  return null;
}

function modifierCount(hk: Hotkey): number {
  return (hk.ctrl ? 1 : 0) + (hk.shift ? 1 : 0) + (hk.alt ? 1 : 0);
}

/** Pretty key-combo string for the help overlay, platform-aware. */
export function formatHotkey(hk: Hotkey): string {
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const parts: string[] = [];
  if (hk.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
  if (hk.shift) parts.push("Shift");
  if (hk.alt) parts.push(isMac ? "⌥" : "Alt");
  parts.push(prettyKey(hk.key));
  return parts.join(" + ");
}

function prettyKey(key: string): string {
  const map: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    pageup: "Page Up",
    pagedown: "Page Down",
    escape: "Esc",
    tab: "Tab",
    enter: "Enter",
    "/": "/",
    ",": ",",
    "[": "[",
  };
  return map[key] ?? key.toUpperCase();
}

// ---------------------------------------------------------------------------
// Tiny synchronous event bus for broadcast ("action") hotkeys.
// ---------------------------------------------------------------------------

const HOTKEY_EVENT = "serika:hotkey";

/** Fire a broadcast hotkey action. */
export function emitHotkey(action: HotkeyAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HotkeyAction>(HOTKEY_EVENT, { detail: action }));
}

/** Subscribe to a specific broadcast hotkey action. Returns an unsubscribe fn. */
export function onHotkey(action: HotkeyAction, handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    if ((e as CustomEvent<HotkeyAction>).detail === action) handler();
  };
  window.addEventListener(HOTKEY_EVENT, listener);
  return () => window.removeEventListener(HOTKEY_EVENT, listener);
}

// ---------------------------------------------------------------------------
// User-configurable keybind overrides (persisted in localStorage)
// ---------------------------------------------------------------------------

const OVERRIDES_KEY = "serika-keybind-overrides";

/** Load all user keybind overrides from localStorage. */
export function loadKeybindOverrides(): Record<string, KeybindOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, KeybindOverride>) : {};
  } catch {
    return {};
  }
}

/** Save a single keybind override (or remove it if `override` is null). */
export function saveKeybindOverride(action: HotkeyAction, override: KeybindOverride | null): void {
  if (typeof window === "undefined") return;
  const all = loadKeybindOverrides();
  if (override === null) {
    delete all[action];
  } else {
    all[action] = override;
  }
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  } catch { /* storage full or unavailable */ }
  // Notify listeners that keybinds changed.
  window.dispatchEvent(new CustomEvent("serika:keybinds-changed"));
}

/** Reset all keybind overrides to defaults. */
export function resetKeybindOverrides(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(OVERRIDES_KEY);
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent("serika:keybinds-changed"));
}

/** Get the effective binding for an action (user override or default). */
export function getEffectiveBinding(action: HotkeyAction): Hotkey {
  const def = HOTKEYS.find((h) => h.action === action)!;
  const ov = loadKeybindOverrides()[action];
  if (ov && !def.locked) {
    return { ...def, key: ov.key, ctrl: ov.ctrl, shift: ov.shift, alt: ov.alt };
  }
  return def;
}

/** Check whether two bindings conflict (same key + same modifiers). */
export function bindingsConflict(a: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }, b: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): boolean {
  return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}
