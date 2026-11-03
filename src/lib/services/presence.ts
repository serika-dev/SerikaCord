export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;
export const PRESENCE_TIMEOUT_MS = 90_000;

export type PublicPresenceStatus = "online" | "idle" | "dnd" | "offline";

interface PresenceInput {
  status?: string | null;
  presenceLastHeartbeatAt?: Date | string | number | null;
  isSystem?: boolean | null;
}

function toTimestamp(value: PresenceInput["presenceLastHeartbeatAt"]): number | null {
  if (!value) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isPresenceStale(
  presenceLastHeartbeatAt: PresenceInput["presenceLastHeartbeatAt"],
  nowMs: number = Date.now()
): boolean {
  const timestamp = toTimestamp(presenceLastHeartbeatAt);
  if (!timestamp) return true;
  return nowMs - timestamp > PRESENCE_TIMEOUT_MS;
}

export function resolveEffectiveStatus(input: PresenceInput, nowMs: number = Date.now()): PublicPresenceStatus {
  if (input.isSystem) {
    return "online";
  }

  const status = (input.status || "offline").toLowerCase();

  if (status === "offline" || status === "invisible") {
    return "offline";
  }

  if (isPresenceStale(input.presenceLastHeartbeatAt, nowMs)) {
    return "offline";
  }

  if (status === "online" || status === "idle" || status === "dnd") {
    return status;
  }

  return "offline";
}

/**
 * The public status of someone acting right now (sending a message): they're
 * here, so only their chosen status counts (invisible / offline read as offline).
 * Their cached heartbeat may be minutes old, which resolveEffectiveStatus would
 * call stale.
 */
export function actingUserStatus(input: PresenceInput): PublicPresenceStatus {
  return resolveEffectiveStatus({ ...input, presenceLastHeartbeatAt: Date.now() });
}
