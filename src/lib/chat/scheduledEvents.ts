/**
 * Server scheduled events (Discord "Events"): pure rules shared by the API
 * (lib/api/scheduledEvents.ts), the status sweeper (lib/services/scheduledEvents.ts)
 * and the UI (components/events). Tested in tests/scheduled-events.test.ts.
 *
 *   scheduled ──start time / "Start Now"──▶ active ──end time / "End Event"──▶ completed
 *       └────────────── "Cancel Event" ──────────────▶ canceled
 */

export type EventEntityType = "voice" | "stage" | "external";
export type EventStatus = "scheduled" | "active" | "completed" | "canceled";

export const EVENT_ENTITY_TYPES: readonly EventEntityType[] = ["voice", "stage", "external"];
export const EVENT_STATUSES: readonly EventStatus[] = ["scheduled", "active", "completed", "canceled"];

export const MAX_EVENT_NAME_LENGTH = 100;
export const MAX_EVENT_DESCRIPTION_LENGTH = 1000;
export const MAX_EVENT_LOCATION_LENGTH = 100;
/** Events can be scheduled up to a year ahead. */
export const MAX_EVENT_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
/** An event with no end time is completed this long after it started. */
export const DEFAULT_ACTIVE_MS = 12 * 60 * 60 * 1000;
/** "Starting soon" window in the UI. */
export const STARTING_SOON_MS = 60 * 60 * 1000;
/** A little slack for clocks and slow forms when checking "in the future". */
const START_GRACE_MS = 2 * 60 * 1000;
/** Upcoming / live events per server. */
export const MAX_OPEN_EVENTS_PER_SERVER = 100;

/** Discord numbering (guild scheduled event objects for the bot API / gateway). */
export const DISCORD_ENTITY_TYPE: Record<EventEntityType, number> = { stage: 1, voice: 2, external: 3 };
export const DISCORD_EVENT_STATUS: Record<EventStatus, number> = { scheduled: 1, active: 2, completed: 3, canceled: 4 };

export interface EventInput {
  name: string;
  description: string | null;
  entityType: EventEntityType;
  channelId: string | null;
  location: string | null;
  image: string | null;
  startAt: Date;
  endAt: Date | null;
}

/** The stored fields an edit starts from. */
export interface StoredEventFields {
  name: string;
  description: string | null;
  entityType: EventEntityType;
  channelId: string | null;
  location: string | null;
  image: string | null;
  startAt: Date;
  endAt: Date | null;
  status: EventStatus;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  if (!t) return null;
  return t.slice(0, max);
}

function parseDate(value: unknown): Date | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return "invalid";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : "invalid";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cover image URL we host (`allowedPrefix` = config.CDN_URL), or null. */
export function cleanEventImage(value: unknown, allowedPrefixes: string[]): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return "invalid";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "invalid";
  } catch {
    return "invalid";
  }
  const ok = allowedPrefixes.some((p) => p && value.startsWith(p.endsWith("/") ? p : `${p}/`));
  return ok ? value : "invalid";
}

/**
 * Validate a create (no `existing`) or edit (`existing` = the stored event)
 * request body. Edits only change the fields present in the body. Times must
 * be in the future while the event is still scheduled; an end time must come
 * after the start; somewhere-else events need a location and an end time
 * (like Discord); channel events need a channel.
 */
export function normalizeEventInput(
  body: Record<string, unknown>,
  opts: { now?: number; existing?: StoredEventFields | null; imagePrefixes?: string[] } = {},
): { value: EventInput } | { error: string } {
  const now = opts.now ?? Date.now();
  const ex = opts.existing ?? null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  const name = has("name") || !ex ? cleanText(body.name, MAX_EVENT_NAME_LENGTH) : ex.name;
  if (!name) return { error: "Event topic is required" };

  const description = has("description") || !ex ? cleanText(body.description, MAX_EVENT_DESCRIPTION_LENGTH) : ex.description;

  let entityType: EventEntityType = ex?.entityType ?? "voice";
  if (has("entityType") || !ex) {
    const raw = body.entityType;
    if (!EVENT_ENTITY_TYPES.includes(raw as EventEntityType)) return { error: "Invalid event location type" };
    entityType = raw as EventEntityType;
  }

  let channelId: string | null = ex?.channelId ?? null;
  let location: string | null = ex?.location ?? null;
  if (entityType === "external") {
    channelId = null;
    if (has("location") || !ex || ex.entityType !== "external") location = cleanText(body.location, MAX_EVENT_LOCATION_LENGTH);
    if (!location) return { error: "Enter where the event takes place" };
  } else {
    location = null;
    if (has("channelId") || !ex || ex.entityType === "external") {
      channelId = typeof body.channelId === "string" && UUID_RE.test(body.channelId) ? body.channelId.toLowerCase() : null;
    }
    if (!channelId) return { error: "Choose a channel for the event" };
  }

  let image: string | null = ex?.image ?? null;
  if (has("image") || !ex) {
    const img = cleanEventImage(body.image, opts.imagePrefixes ?? []);
    if (img === "invalid") return { error: "Invalid cover image" };
    image = img;
  }

  let startAt: Date = ex?.startAt ?? new Date(NaN);
  const startChanged = has("startAt") || !ex;
  if (startChanged) {
    const d = parseDate(body.startAt);
    if (d === null || d === "invalid") return { error: "Choose a valid start time" };
    startAt = d;
  }
  let endAt: Date | null = ex?.endAt ?? null;
  const endChanged = has("endAt") || !ex;
  if (endChanged) {
    const d = parseDate(body.endAt);
    if (d === "invalid") return { error: "Choose a valid end time" };
    endAt = d;
  }

  const stillScheduled = !ex || ex.status === "scheduled";
  if (stillScheduled && startChanged) {
    if (startAt.getTime() < now - START_GRACE_MS) return { error: "The start time must be in the future" };
    if (startAt.getTime() > now + MAX_EVENT_LEAD_MS) return { error: "Events can be scheduled up to a year ahead" };
  }
  if (entityType === "external" && !endAt) return { error: "Events somewhere else need an end time" };
  if (endAt && endAt.getTime() <= startAt.getTime()) return { error: "The end time must be after the start time" };
  if (endAt && endChanged && endAt.getTime() <= now) return { error: "The end time must be in the future" };

  return { value: { name, description, entityType, channelId, location, image, startAt, endAt } };
}

/** Status changes a manager may request. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  if (from === to) return false;
  if (from === "scheduled") return to === "active" || to === "canceled";
  if (from === "active") return to === "completed";
  return false;
}

/** When an active event completes on its own. */
export function eventAutoEndAt(ev: { startAt: Date | string; endAt?: Date | string | null; startedAt?: Date | string | null }): number {
  if (ev.endAt) return new Date(ev.endAt).getTime();
  const base = Math.max(new Date(ev.startAt).getTime(), ev.startedAt ? new Date(ev.startedAt).getTime() : 0);
  return base + DEFAULT_ACTIVE_MS;
}

/** The status the clock moves an event to now, or null when it stays put. */
export function nextAutoStatus(
  ev: { status: EventStatus; startAt: Date | string; endAt?: Date | string | null; startedAt?: Date | string | null },
  now: number = Date.now(),
): EventStatus | null {
  if (ev.status === "scheduled") {
    if (new Date(ev.startAt).getTime() > now) return null;
    // Missed the whole window (server was down): skip straight to completed.
    return eventAutoEndAt(ev) <= now ? "completed" : "active";
  }
  if (ev.status === "active") return eventAutoEndAt(ev) <= now ? "completed" : null;
  return null;
}

export function isOpenStatus(status: string | null | undefined): boolean {
  return status === "scheduled" || status === "active";
}

/** Live events first, then upcoming by start time. */
export function sortEvents<T extends { status: string; startAt: string | Date; id: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const la = a.status === "active" ? 0 : 1;
    const lb = b.status === "active" ? 0 : 1;
    if (la !== lb) return la - lb;
    const d = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

export function isStartingSoon(ev: { status: string; startAt: string | Date }, now: number = Date.now()): boolean {
  if (ev.status !== "scheduled") return false;
  const delta = new Date(ev.startAt).getTime() - now;
  return delta <= STARTING_SOON_MS;
}

/** Interested users who should be told an event started (never the person who started it). */
export function startNotifyRecipients(interested: string[], actorId?: string | null): string[] {
  const actor = actorId?.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of interested) {
    const k = id.toLowerCase();
    if (k === actor || seen.has(k)) continue;
    seen.add(k);
    out.push(id);
  }
  return out;
}

/**
 * Value for an `<input type="datetime-local">` in the viewer's time zone, and
 * back. Kept here so both directions are tested together.
 */
export function toLocalInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** A sensible default start for the create form: the next full hour. */
export function defaultEventStart(now: number = Date.now()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
