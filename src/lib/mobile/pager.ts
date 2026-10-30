/**
 * Pure model of the phone shell's three-panel pager (Discord mobile):
 * [channel / DM list | chat | members]. Routes map to a family and a panel;
 * a horizontal drag follows the finger 1:1, rubber-bands past the ends and
 * snaps to a panel from its position and release velocity. No DOM here, so
 * it is unit tested (tests/mobile-pager.test.ts).
 */

export type PagerPanel = "list" | "chat" | "members";
export type ShellFamily = "server" | "dm";

/** How much of the chat stays visible beside an open side panel. */
export const PAGER_PEEK = 56;
/** Side panels never get wider than this (split view, iPad mini, phones held sideways). */
export const PAGER_MAX_SIDE = 440;
/** Touches starting this close to the left edge belong to the browser's back swipe (Safari). */
export const PAGER_EDGE_DEAD_ZONE = 16;
/** Release speed (px/ms) above which a flick moves one panel even when short. */
export const PAGER_FLICK_VELOCITY = 0.35;
/** How far (ms) a release velocity carries the panel when picking the target. */
export const PAGER_MOMENTUM_MS = 160;

/** /channels/<x> segments that are app pages, not servers. */
const RESERVED = new Set(["me", "messages", "notifications", "profile", "settings", "explore"]);
/** /channels/<server>/<x> segments that are server pages, not channels. */
const SERVER_PAGES = new Set(["members", "guide", "customize", "onboarding"]);

export interface ShellRoute {
  family: ShellFamily;
  /** Panel the route stands for at rest. */
  panel: "list" | "chat";
  /** Server id (server family). */
  serverId?: string;
  /** Conversation href ("/channels/s/c", "/dm/x", "/dm/group/g") when the route is a conversation. */
  conversation?: string;
}

function cleanPath(pathname: string | null | undefined): string {
  if (!pathname) return "";
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return path || "/";
}

/** The pager route a pathname belongs to, or null for every other screen. */
export function parseShellRoute(pathname: string | null | undefined): ShellRoute | null {
  const path = cleanPath(pathname);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "dm") {
    if (parts[1] === "group") return parts.length === 3 ? { family: "dm", panel: "chat", conversation: path } : null;
    return parts.length === 2 ? { family: "dm", panel: "chat", conversation: path } : null;
  }
  if (parts[0] !== "channels") return null;
  if (parts.length === 2 && parts[1] === "messages") return { family: "dm", panel: "list" };
  if (parts.length < 2 || parts.length > 3 || RESERVED.has(parts[1])) return null;
  const serverId = parts[1];
  if (parts.length === 2) return { family: "server", panel: "list", serverId };
  if (SERVER_PAGES.has(parts[2])) return null;
  return { family: "server", panel: "chat", serverId, conversation: path };
}

/** The list URL of a family (where "back" from a conversation lands). */
export function shellListHref(route: Pick<ShellRoute, "family" | "serverId">): string {
  return route.family === "server" && route.serverId ? `/channels/${route.serverId}` : "/channels/messages";
}

/** Route params a conversation page reads (instead of the router's segment params). */
export function conversationParams(href: string | null | undefined): Record<string, string> | null {
  const route = parseShellRoute(href);
  if (!route?.conversation) return null;
  const parts = cleanPath(href).split("/").filter(Boolean);
  if (route.family === "server") return { serverId: parts[1], channelId: parts[2] };
  if (parts[1] === "group") return { channelId: parts[2] };
  return { recipientId: parts[1] };
}

/** The useChatSession REST base of a conversation href, for cache warming. */
export function conversationApiBase(href: string | null | undefined): string | null {
  const params = conversationParams(href);
  if (!params) return null;
  if (params.serverId) return `/api/channels/${params.channelId}`;
  if (params.recipientId) return `/api/dms/${params.recipientId}`;
  return `/api/group-dms/${params.channelId}`;
}

export interface PagerLayout {
  /** Panels present, left to right. */
  panels: PagerPanel[];
  /** translateX of the strip for each panel (same order). */
  positions: number[];
  /** Width of the side panels. */
  sideWidth: number;
}

/**
 * Strip geometry for a viewport `width`. Without a conversation the list is
 * the only panel and fills the screen; with one, side panels leave at least
 * `peek` px of the chat visible and are capped at `maxSide` on wide screens.
 */
export function pagerLayout(width: number, opts: { hasChat: boolean; hasMembers: boolean; peek?: number; maxSide?: number }): PagerLayout {
  const peek = Math.min(opts.peek ?? PAGER_PEEK, Math.max(0, width * 0.3));
  if (!opts.hasChat) return { panels: ["list"], positions: [0], sideWidth: width };
  const side = Math.max(0, Math.min(width - peek, opts.maxSide ?? PAGER_MAX_SIDE));
  const panels: PagerPanel[] = ["list", "chat"];
  const positions = [0, -side];
  if (opts.hasMembers) {
    panels.push("members");
    positions.push(-2 * side);
  }
  return { panels, positions, sideWidth: side };
}

/** Elastic overscroll: tracks the finger, then resists more the further it goes. */
export function rubberBand(overshoot: number, limit = 80): number {
  if (overshoot <= 0) return 0;
  return limit * (1 - 1 / ((overshoot * 0.55) / limit + 1));
}

/** Strip offset for a drag of `dx` from `base`, rubber-banded outside [min, max]. */
export function dragOffset(base: number, dx: number, min: number, max: number): number {
  const raw = base + dx;
  if (raw > max) return max + rubberBand(raw - max);
  if (raw < min) return min - rubberBand(min - raw);
  return raw;
}

/**
 * Where a released drag settles: the panel nearest the offset projected by the
 * release velocity, at most one panel away from where the drag started. A
 * flick (fast enough, in a direction) always moves one panel that way.
 */
export function snapIndex(positions: number[], baseIndex: number, offset: number, velocity: number): number {
  if (positions.length === 0) return 0;
  const from = Math.min(Math.max(baseIndex, 0), positions.length - 1);
  const projected = offset + velocity * PAGER_MOMENTUM_MS;
  let best = 0;
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i] - projected) < Math.abs(positions[best] - projected)) best = i;
  }
  if (Math.abs(velocity) >= PAGER_FLICK_VELOCITY) {
    // Positions decrease to the right of the strip: a rightward flick (v > 0) goes to a lower index.
    const moved = offset - positions[from];
    if (velocity > 0 && moved > 0) best = Math.min(best, from - 1);
    if (velocity < 0 && moved < 0) best = Math.max(best, from + 1);
  }
  return Math.min(Math.max(best, from - 1, 0), from + 1, positions.length - 1);
}

/** Snap duration (ms): short hops are quicker, long ones still finish in ~250 ms. */
export function snapDuration(distance: number, velocity = 0): number {
  const d = Math.abs(distance);
  if (d < 1) return 0;
  // A fast release covers the rest quicker (the finger already "threw" it).
  const base = 150 + d * 0.3;
  const boost = Math.min(60, Math.abs(velocity) * 60);
  return Math.round(Math.min(260, Math.max(140, base - boost)));
}

/** Velocity (px/ms) from recent samples, ignoring ones older than `windowMs`. */
export function releaseVelocity(samples: Array<{ x: number; t: number }>, now: number, windowMs = 90): number {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}
