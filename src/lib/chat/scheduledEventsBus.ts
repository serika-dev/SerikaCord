/**
 * Client bus for live scheduled-event changes. The app-wide activity stream
 * (UnreadContext) receives `scheduled_event_update` / `scheduled_event_start`
 * and re-emits them here; the events sidebar entry and dialog listen.
 */

export interface ScheduledEventSignal {
  type: "scheduled_event_update" | "scheduled_event_start";
  serverId: string;
  eventId: string;
  serverName?: string;
  serverIcon?: string | null;
  name?: string;
  route?: string;
}

const EVENT = "serika:scheduled-event";

export function emitScheduledEventChange(signal: ScheduledEventSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ScheduledEventSignal>(EVENT, { detail: signal }));
}

/** Subscribe; returns the unsubscribe function. */
export function onScheduledEventChange(cb: (signal: ScheduledEventSignal) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ScheduledEventSignal>).detail;
    if (detail && typeof detail.serverId === "string") cb(detail);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

const OPEN = "serika:open-server-events";

/** Open the events dialog of a server (optionally on one event). */
export function requestOpenServerEvents(serverId: string, eventId?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { serverId, eventId: eventId ?? null } }));
}

export function onOpenServerEvents(cb: (req: { serverId: string; eventId: string | null }) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ serverId: string; eventId: string | null }>).detail;
    if (d && typeof d.serverId === "string") cb(d);
  };
  window.addEventListener(OPEN, handler);
  return () => window.removeEventListener(OPEN, handler);
}
