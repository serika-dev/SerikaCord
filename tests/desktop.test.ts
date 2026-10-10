import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DESKTOP_SETTINGS,
  buildAccelerator,
  codeToAcceleratorKey,
  formatAccelerator,
  keyToAcceleratorKey,
  keybindToAccelerator,
  mouseButtonToAcceleratorKey,
  normalizeDesktopSettings,
  normalizeUpdateState,
  parseAccelerator,
  parseGlobalKeysStore,
  pttKeyToAccelerator,
  resolveGlobalShortcuts,
  sanitizeAppPath,
  trayStatusFor,
} from "@/lib/desktop/protocol";

describe("accelerator keys", () => {
  test("in-app keybind keys map to accelerator tokens", () => {
    expect(keyToAcceleratorKey("m")).toBe("M");
    expect(keyToAcceleratorKey("7")).toBe("7");
    expect(keyToAcceleratorKey("f13")).toBe("F13");
    expect(keyToAcceleratorKey("arrowup")).toBe("Up");
    expect(keyToAcceleratorKey(" ")).toBe("Space");
    expect(keyToAcceleratorKey("/")).toBe("/");
    expect(keyToAcceleratorKey("f25")).toBeNull();
    expect(keyToAcceleratorKey("dead")).toBeNull();
  });

  test("physical key codes (recording) are layout independent", () => {
    expect(codeToAcceleratorKey("KeyV")).toBe("V");
    expect(codeToAcceleratorKey("Digit3")).toBe("3");
    expect(codeToAcceleratorKey("Numpad5")).toBe("Num5");
    expect(codeToAcceleratorKey("F24")).toBe("F24");
    expect(codeToAcceleratorKey("Backquote")).toBe("`");
    expect(codeToAcceleratorKey("ArrowLeft")).toBe("Left");
    expect(codeToAcceleratorKey("ShiftLeft")).toBeNull();
    expect(codeToAcceleratorKey("")).toBeNull();
  });

  test("mouse side buttons", () => {
    expect(mouseButtonToAcceleratorKey(3)).toBe("Mouse4");
    expect(mouseButtonToAcceleratorKey(4)).toBe("Mouse5");
    expect(mouseButtonToAcceleratorKey(0)).toBeNull();
  });

  test("build / parse round trip", () => {
    const acc = buildAccelerator({ ctrl: true, shift: true, key: "M" });
    expect(acc).toBe("Ctrl+Shift+M");
    expect(parseAccelerator(acc)).toEqual({ ctrl: true, shift: true, key: "M" });
    expect(parseAccelerator("Alt+Mouse4")).toEqual({ alt: true, key: "Mouse4" });
    expect(parseAccelerator("Ctrl+")).toBeNull();
    expect(parseAccelerator("Hyper+M")).toBeNull();
    expect(parseAccelerator("Ctrl+Banana")).toBeNull();
    expect(parseAccelerator("")).toBeNull();
  });

  test("keybinds convert, unmappable ones don't", () => {
    expect(keybindToAccelerator({ key: "m", ctrl: true, shift: true })).toBe("Ctrl+Shift+M");
    expect(keybindToAccelerator({ key: "unidentified" })).toBeNull();
    expect(keybindToAccelerator(null)).toBeNull();
  });

  test("formatting for display", () => {
    expect(formatAccelerator("Ctrl+Shift+M")).toBe("Ctrl + Shift + M");
    expect(formatAccelerator("Ctrl+Shift+M", true)).toBe("⌘ + ⇧ + M");
    expect(formatAccelerator("Mouse4")).toBe("Mouse 4");
    expect(formatAccelerator("nonsense+")).toBe("");
  });

  test("push-to-talk key from voice settings", () => {
    expect(pttKeyToAccelerator("V")).toBe("V");
    expect(pttKeyToAccelerator("`")).toBe("`");
    expect(pttKeyToAccelerator("")).toBeNull();
  });
});

describe("resolveGlobalShortcuts", () => {
  const base = {
    store: {},
    muteBinding: { key: "m", ctrl: true, shift: true },
    deafenBinding: { key: "d", ctrl: true, shift: true },
    pttEnabled: false,
    pttKey: "V",
  };

  test("defaults follow the in-app bindings and stay quiet while focused", () => {
    expect(resolveGlobalShortcuts(base)).toEqual([
      { action: "toggle-mute", accelerator: "Ctrl+Shift+M", hold: false, whileFocused: false },
      { action: "toggle-deafen", accelerator: "Ctrl+Shift+D", hold: false, whileFocused: false },
    ]);
  });

  test("push-to-talk only when the mode is on; hold semantics", () => {
    const specs = resolveGlobalShortcuts({ ...base, pttEnabled: true });
    expect(specs[0]).toEqual({ action: "push-to-talk", accelerator: "V", hold: true, whileFocused: false });
  });

  test("custom keys replace defaults and also work while focused", () => {
    const specs = resolveGlobalShortcuts({
      ...base,
      pttEnabled: true,
      store: { pushToTalk: "Mouse4", toggleMute: "F13" },
    });
    expect(specs.find((s) => s.action === "push-to-talk")).toEqual({ action: "push-to-talk", accelerator: "Mouse4", hold: true, whileFocused: true });
    expect(specs.find((s) => s.action === "toggle-mute")).toEqual({ action: "toggle-mute", accelerator: "F13", hold: false, whileFocused: true });
  });

  test("invalid overrides fall back to defaults", () => {
    const specs = resolveGlobalShortcuts({ ...base, store: { toggleMute: "Ctrl+" } });
    expect(specs.find((s) => s.action === "toggle-mute")?.accelerator).toBe("Ctrl+Shift+M");
  });

  test("stored overrides are validated when loaded", () => {
    expect(parseGlobalKeysStore('{"pushToTalk":"F13","toggleMute":"bogus+","x":1}')).toEqual({ pushToTalk: "F13" });
    expect(parseGlobalKeysStore("not json")).toEqual({});
    expect(parseGlobalKeysStore(null)).toEqual({});
  });
});

describe("desktop settings and state", () => {
  test("settings normalise over defaults", () => {
    expect(normalizeDesktopSettings(null)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    const s = normalizeDesktopSettings({ closeToTray: false, idleTimeoutMinutes: 999, spellcheck: "yes", globalShortcutsAvailable: false });
    expect(s.closeToTray).toBe(false);
    expect(s.idleTimeoutMinutes).toBe(240);
    expect(s.spellcheck).toBe(true);
    expect(s.globalShortcutsAvailable).toBe(false);
  });

  test("update state", () => {
    expect(normalizeUpdateState({ state: "ready", version: "2.1.0" })).toEqual({ state: "ready", version: "2.1.0" });
    expect(normalizeUpdateState({ state: "weird", percent: 140 })).toEqual({ state: "idle", percent: 100 });
  });

  test("tray status mapping", () => {
    expect(trayStatusFor("invisible")).toBe("offline");
    expect(trayStatusFor("dnd")).toBe("dnd");
    expect(trayStatusFor(undefined)).toBe("");
  });
});

describe("sanitizeAppPath", () => {
  test("accepts in-app paths", () => {
    expect(sanitizeAppPath("/channels/1/2?jump=3")).toBe("/channels/1/2?jump=3");
    expect(sanitizeAppPath("/invite/abc")).toBe("/invite/abc");
  });

  test("rejects anything that could leave the app", () => {
    expect(sanitizeAppPath("//evil.example/x")).toBeNull();
    expect(sanitizeAppPath("/\\evil.example")).toBeNull();
    expect(sanitizeAppPath("https://evil.example")).toBeNull();
    expect(sanitizeAppPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeAppPath("/a\nb")).toBeNull();
    expect(sanitizeAppPath(42)).toBeNull();
  });
});
