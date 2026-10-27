/**
 * Server rail event badge (Discord's green "live event" dot on a server icon):
 * which event a server advertises, and how the badge shows it. Pure, shared by
 * the /@me/servers summary (lib/services/scheduledEvents.ts) and the rail
 * (components/layout/ServerSidebar.tsx). Tested in tests/server-event-badge.test.ts.
 */

import { STARTING_SOON_MS } from "./scheduledEvents";

/** A live or soon-to-start event row the viewer is allowed to see. */
export interface RailEventCandidate {
  id: string;
  name: string;
  status: string;
  startAt: Date | string;
}

/** The per-server summary carried on /@me/servers as `activeEvent`. */
export interface ServerActiveEvent {
  id: string;
  name: string;
  status: "active" | "scheduled";
  /** ISO start time; the client turns it into "Starts in N min". */
  startAt: string;
}

export type EventBadgeState =
  | { kind: "live"; eventId: string; name: string }
  | { kind: "soon"; eventId: string; name: string; minutes: number }
  | null;

/** A scheduled event this far past its start that never went live is stale (no badge). */
const STALE_SCHEDULED_MS = 2 * 60 * 60 * 1000;

const time = (v: Date | string): number => (v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * The event a server's rail icon advertises: a live one (the longest running),
 * else the next scheduled one starting within `windowMs`. Scheduled events
 * already past their start (the sweeper flips them within ~30s) still count.
 */
export function pickServerActiveEvent(
  rows: readonly RailEventCandidate[],
  now: number = Date.now(),
  windowMs: number = STARTING_SOON_MS,
): ServerActiveEvent | null {
  let live: RailEventCandidate | null = null;
  let soon: RailEventCandidate | null = null;
  for (const r of rows) {
    const start = time(r.startAt);
    if (!Number.isFinite(start)) continue;
    if (r.status === "active") {
      if (!live || start < time(live.startAt)) live = r;
    } else if (r.status === "scheduled" && start - now <= windowMs && now - start <= STALE_SCHEDULED_MS) {
      if (!soon || start < time(soon.startAt)) soon = r;
    }
  }
  const pick = live ?? soon;
  if (!pick) return null;
  return {
    id: pick.id,
    name: pick.name,
    status: live ? "active" : "scheduled",
    startAt: new Date(time(pick.startAt)).toISOString(),
  };
}

/** How the rail shows a server's `activeEvent` at `now` (null: no badge). */
export function eventBadgeState(
  event: ServerActiveEvent | null | undefined,
  now: number,
  windowMs: number = STARTING_SOON_MS,
): EventBadgeState {
  if (!event || typeof event.name !== "string") return null;
  if (event.status === "active") return { kind: "live", eventId: event.id, name: event.name };
  if (event.status !== "scheduled") return null;
  const start = Date.parse(event.startAt);
  if (!Number.isFinite(start)) return null;
  const until = start - now;
  if (until > windowMs || -until > STALE_SCHEDULED_MS) return null;
  return { kind: "soon", eventId: event.id, name: event.name, minutes: Math.max(1, Math.ceil(until / 60_000)) };
}
