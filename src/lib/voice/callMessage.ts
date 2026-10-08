// The "call" message a DM call leaves in the conversation (Discord-style
// "X started a call." / "You missed a call from X."). Pure: the server keeps
// the stored metadata up to date (src/lib/services/dmCallMessages.ts) and the
// chat renders it (src/components/chat/CallMessageRow.tsx).

/** Stored in messages.call (jsonb) for messages of type 'call'. */
export interface CallMessageData {
  callerId: string;
  /** ISO timestamps. */
  startedAt: string;
  endedAt: string | null;
  /** Everyone who was in the call at some point, caller first. */
  participantIds: string[];
  /** True once someone other than the caller joined. */
  answered: boolean;
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const toIso = (d: Date | string | number) => new Date(d).toISOString();

export function newCallData(callerId: string, now: Date | string | number = Date.now()): CallMessageData {
  return { callerId, startedAt: toIso(now), endedAt: null, participantIds: [callerId], answered: false };
}

/**
 * Someone is in the call. Returns the same object when nothing changes (the
 * caller resuming, a second device) so the server can skip the write.
 */
export function callDataJoin(data: CallMessageData, userId: string): CallMessageData {
  if (data.endedAt) return data;
  const known = data.participantIds.some((id) => sameId(id, userId));
  const answered = data.answered || !sameId(userId, data.callerId);
  if (known && answered === data.answered) return data;
  return {
    ...data,
    participantIds: known ? data.participantIds : [...data.participantIds, userId],
    answered,
  };
}

/** The call is over (room empty, declined, timed out). Ending twice is a no-op. */
export function callDataEnd(data: CallMessageData, now: Date | string | number = Date.now()): CallMessageData {
  if (data.endedAt) return data;
  const end = Math.max(new Date(now).getTime(), new Date(data.startedAt).getTime());
  return { ...data, endedAt: toIso(end) };
}

/** Validate whatever came out of the DB / over the wire. */
export function parseCallData(raw: unknown): CallMessageData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.callerId !== "string" || typeof r.startedAt !== "string") return null;
  if (Number.isNaN(new Date(r.startedAt).getTime())) return null;
  const endedAt = typeof r.endedAt === "string" && !Number.isNaN(new Date(r.endedAt).getTime()) ? r.endedAt : null;
  const participantIds = Array.isArray(r.participantIds)
    ? r.participantIds.filter((id): id is string => typeof id === "string")
    : [r.callerId];
  return {
    callerId: r.callerId,
    startedAt: r.startedAt,
    endedAt,
    participantIds: participantIds.length ? participantIds : [r.callerId],
    answered: Boolean(r.answered),
  };
}

export type CallMessageKind =
  /** Still going (or at least not marked ended yet). */
  | "ongoing"
  /** Someone picked up; shows how long it lasted. */
  | "ended"
  /** Nobody answered, seen by the person who was called. */
  | "missed"
  /** Nobody answered, seen by the caller. */
  | "unanswered";

export interface CallMessageView {
  kind: CallMessageKind;
  /** The viewer started the call. */
  viewerIsCaller: boolean;
  /** Length of an answered, ended call. */
  durationMs: number | null;
}

export function describeCallMessage(data: CallMessageData, viewerId: string | null | undefined): CallMessageView {
  const viewerIsCaller = !!viewerId && sameId(viewerId, data.callerId);
  if (!data.endedAt) return { kind: "ongoing", viewerIsCaller, durationMs: null };
  if (data.answered) {
    const ms = new Date(data.endedAt).getTime() - new Date(data.startedAt).getTime();
    return { kind: "ended", viewerIsCaller, durationMs: Math.max(0, ms) };
  }
  return { kind: viewerIsCaller ? "unanswered" : "missed", viewerIsCaller, durationMs: null };
}

export type CallDurationUnit = "second" | "minute" | "hour";

/**
 * The largest sensible unit for "lasted {duration}" (formatted with
 * Intl.NumberFormat's unit style, so it's localized): 45 seconds, 3 minutes,
 * 2 hours. Never zero.
 */
export function callDurationParts(ms: number): { value: number; unit: CallDurationUnit } {
  const seconds = Math.max(1, Math.round(Math.max(0, ms) / 1000));
  if (seconds < 60) return { value: seconds, unit: "second" };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { value: minutes, unit: "minute" };
  return { value: Math.max(1, Math.floor(minutes / 60)), unit: "hour" };
}

/** Localized "3 minutes" for a call length. */
export function formatCallLength(ms: number, locale?: string): string {
  const { value, unit } = callDurationParts(ms);
  try {
    return new Intl.NumberFormat(locale || undefined, { style: "unit", unit, unitDisplay: "long" }).format(value);
  } catch {
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
  }
}

/** Short English preview for the DM list ("📞 Missed call"). */
export function callPreviewText(data: CallMessageData | null, viewerId?: string | null): string {
  if (!data) return "📞 Call";
  const view = describeCallMessage(data, viewerId);
  if (view.kind === "missed") return "📞 Missed call";
  if (view.kind === "unanswered") return "📞 Call not answered";
  if (view.kind === "ongoing") return "📞 Call started";
  return "📞 Call";
}
