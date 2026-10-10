/**
 * Mobile back navigation, Discord style: the Android back button (and the
 * swipe-right gesture) first closes whatever sheet / drawer / dialog is on
 * top, then walks up the app's screen hierarchy, and only at the root sends
 * the app to the background. Pure logic, no DOM.
 */

export type BackHandler = () => boolean | void;

/** LIFO stack of "close me" handlers registered by open overlays. */
export class BackStack {
  private entries: Array<{ id: number; handler: BackHandler }> = [];
  private nextId = 1;

  /** Register a handler; returns its removal. Newest runs first. */
  push(handler: BackHandler): () => void {
    const id = this.nextId++;
    this.entries.push({ id, handler });
    return () => {
      this.entries = this.entries.filter((e) => e.id !== id);
    };
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
