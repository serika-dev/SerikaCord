/**
 * Mobile back navigation, Discord style: the Android back button (and the
 * swipe-right gesture) first closes whatever sheet / drawer / dialog is on
 * top, then walks up the app's screen hierarchy, and only at the root sends
 * the app to the background. The stack and route helpers are pure logic; the
 * browser history bridge at the bottom (mobile web / PWA only) is the one
 * part that touches the DOM.
 */

export type BackHandler = () => boolean | void;

/** LIFO stack of "close me" handlers registered by open overlays. */
export class BackStack {
  private entries: Array<{ id: number; handler: BackHandler }> = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  /** Bumped on every push / removal. */
  version = 0;

  /** Register a handler; returns its removal. Newest runs first. */
  push(handler: BackHandler): () => void {
    const id = this.nextId++;
    this.entries.push({ id, handler });
    this.changed();
    return () => {
      const before = this.entries.length;
      this.entries = this.entries.filter((e) => e.id !== id);
      if (this.entries.length !== before) this.changed();
    };
  }

  /** Called after every push / removal. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a listener must not break registration */
      }
    }
  }

  /**
   * Run the newest handler. A handler returning `false` declines and the next
   * one is tried. Returns whether anything handled the back press.
   */
  handle(): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      let result: boolean | void;
      try {
        result = entry.handler();
      } catch {
        result = false;
      }
      if (result !== false) return true;
    }
    return false;
  }

  get size(): number {
    return this.entries.length;
  }
}

/** The app-wide stack used by overlays (see useBackHandler). */
export const backStack = new BackStack();

const TOP_LEVEL = new Set(["messages", "notifications", "profile", "explore"]);

/**
 * Where "back" goes from a screen, or null at the root (the app should
 * minimize). Mirrors the mobile layout: home (/channels/me) → server channel
 * list → channel chat; tabs (messages / notifications / you) sit next to home.
 */
export function parentRoute(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "dm") return parts.length >= 2 ? "/channels/messages" : "/channels/me";
  if (parts[0] !== "channels") return null;
  if (parts.length === 1) return null;

  const [, first, second] = parts;
  if (first === "me") return parts.length >= 3 ? "/channels/messages" : null;
  if (first === "settings") return parts.length >= 3 ? "/channels/settings" : "/channels/profile";
  if (first === "explore") return parts.length >= 3 ? "/channels/explore" : "/channels/me";
  if (TOP_LEVEL.has(first)) return "/channels/me";
  // /channels/<serverId>/<channelId>[/...] → the server's channel list
  if (second) return `/channels/${first}`;
  return "/channels/me";
}

/** Only in-app paths the router understands (notification launch routes). */
export function isAppRoute(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.length <= 512 &&
    route.startsWith("/") &&
    !route.startsWith("//") &&
    (route.startsWith("/channels") || route.startsWith("/dm/"))
  );
}

/** Horizontal swipe classification for edge-free gesture navigation. */
export function classifySwipe(input: {
  dx: number;
  dy: number;
  /** Duration in ms. */
  dt: number;
  /** Viewport width, to scale the distance threshold. */
  width: number;
}): "left" | "right" | null {
  const { dx, dy, dt, width } = input;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  // Mostly horizontal, and either far enough or a quick flick.
  if (absX < 40 || absX < absY * 1.8) return null;
  const velocity = absX / Math.max(dt, 1); // px/ms
  const far = absX > Math.min(140, width * 0.33);
  if (!far && velocity < 0.5) return null;
  return dx > 0 ? "right" : "left";
}

// ─── Mobile web / PWA back gesture ──────────────────────────────────────────
//
// In the Capacitor app the native backButton event drives `backStack`
// (NativeAppBridge). In a mobile browser or installed PWA the Android back
// gesture is a plain history traversal, so it left the page under an open
// sheet. While an overlay is on the stack we keep one extra history entry
// (same URL, no router navigation) on top; going back off it closes the top
// overlay instead.
//
// Deliberately conservative around the Next router:
// - The entry is pushed without a URL, so Next only copies its internal state
//   into it; returning to the entry below restores the same page.
// - When an overlay closes by other means (X, backdrop, a link inside it) we
//   never call history.back() ourselves: a router.push still in flight would
//   be undone. The entry stays, is re-used by the next overlay opened on it,
//   and where the Navigation API can tell the direction (Chromium, i.e. the
//   Android browsers that have the gesture) a back press off it is completed
//   so it never costs an extra press.
// - Only on touch devices outside the native app; desktop is untouched.

const OVERLAY_STATE_KEY = "__serikaOverlay";
/** Re-arm after a back press the top overlay handled but stayed open for. */
const STAYED_OPEN_CHECK_MS = 700;
const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

interface NavHistoryEntryLike {
  key: string;
  index: number;
}
interface NavigationLike {
  currentEntry: NavHistoryEntryLike | null;
  addEventListener(
    type: "currententrychange",
    listener: (event: { from: NavHistoryEntryLike; navigationType: string | null }) => void,
  ): void;
}

interface OverlayEntry {
  token: string;
  href: string;
  /** Navigation API key of the entry (stable across replaceState). */
  navKey: string | null;
}

function webBackEnabled(): boolean {
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  // The native app has a real back button event (NativeAppBridge).
  if (w.Capacitor?.isNativePlatform?.()) return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function currentOverlayToken(): string | null {
  const state = window.history.state as Record<string, unknown> | null;
  const token = state?.[OVERLAY_STATE_KEY];
  return typeof token === "string" ? token : null;
}

let webBackInstalled = false;

/** Bridge browser history to `stack` (see above). Safe to call once. */
export function installWebBackHistory(stack: BackStack): void {
  if (webBackInstalled || typeof window === "undefined" || typeof history === "undefined") return;
  webBackInstalled = true;

  const nav = (window as Window & { navigation?: NavigationLike }).navigation ?? null;
  /** The entry guarding the open overlays. */
  let armed: OverlayEntry | null = null;
  /** An entry whose overlay already closed in-app. */
  let spent: OverlayEntry | null = null;
  /** Set when a back press was passed on: wait for the stack to change. */
  let passed = false;
  let stayedOpenTimer: ReturnType<typeof setTimeout> | null = null;

  const arm = () => {
    if (armed || passed || stack.size === 0 || !webBackEnabled()) return;
    // Still on the entry an earlier overlay left behind: re-use it.
    if (spent && currentOverlayToken() === spent.token && window.location.href === spent.href) {
      armed = spent;
      spent = null;
      return;
    }
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      const base = (window.history.state as Record<string, unknown> | null) ?? {};
      // No URL: Next's patched pushState copies its tree and doesn't navigate.
      window.history.pushState({ ...base, [OVERLAY_STATE_KEY]: token }, "");
    } catch {
      return;
    }
    armed = { token, href: window.location.href, navKey: nav?.currentEntry?.key ?? null };
    spent = null;
  };

  const sync = () => {
    if (stack.size > 0) {
      arm();
    } else if (armed) {
      // Closed in-app: leave the entry (see the notes above).
      spent = armed;
      armed = null;
    }
  };

  stack.subscribe(() => {
    passed = false;
    sync();
  });

  /** The user (or the app) went back off our entry. */
  const onBackFromOverlay = () => {
    armed = null;
    const version = stack.version;
    if (!stack.handle()) {
      // No overlay took it. A nested Radix layer (menu, dialog) closes on
      // Escape, like the native back button does; otherwise pass the press on.
      if (document.querySelector(OPEN_LAYER_SELECTOR)) {
        const target = (document.activeElement as HTMLElement | null) ?? document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      } else {
        passed = true;
        window.history.back();
        return;
      }
    }
    // Overlays still open afterwards (several stacked: the removal re-arms;
    // one that only stepped back inside itself: re-arm once it's clear it
    // stayed open, not while a closing animation is still running).
    if (stayedOpenTimer) clearTimeout(stayedOpenTimer);
    stayedOpenTimer = setTimeout(() => {
      stayedOpenTimer = null;
      if (stack.version === version) sync();
    }, STAYED_OPEN_CHECK_MS);
  };

  if (nav && typeof nav.addEventListener === "function") {
    // Exact: entry keys and indexes tell which entry we left and which way.
    nav.addEventListener("currententrychange", (event) => {
      if (event.navigationType !== "traverse" || !event.from) return;
      const to = nav.currentEntry;
      if (!to || to.index >= event.from.index) return;
      if (armed?.navKey && event.from.key === armed.navKey) {
        onBackFromOverlay();
        return;
      }
      if (!armed && spent?.navKey && event.from.key === spent.navKey) {
        // Back off an entry whose overlay is already gone: it was invisible,
        // so finish the press the user meant.
        spent = null;
        window.history.back();
      }
    });
    return;
  }

  // No Navigation API: back from our entry lands on the same URL without
  // our marker.
  window.addEventListener("popstate", () => {
    if (!armed) return;
    if (currentOverlayToken() === armed.token || window.location.href !== armed.href) return;
    onBackFromOverlay();
  });
}

// Mobile web / PWA: route the browser's back gesture into the app-wide stack.
// (Last in the module: the bridge's constants must be initialised first.)
if (typeof window !== "undefined") installWebBackHistory(backStack);
