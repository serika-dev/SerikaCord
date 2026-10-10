/**
 * Automatic Idle (AFK) presence, Discord-style: after 10 minutes without input
 * on every device the user goes Idle, and the first input brings them back
 * Online. Only ever moves between online and idle: Do Not Disturb, Invisible
 * and a manually chosen Idle are never touched.
 *
 * Clients report `idle: true|false` on their presence heartbeat. The server
 * keeps two Redis keys per user: `presence:active:<id>` (some device had input
 * recently, short TTL refreshed by non-idle heartbeats) and
 * `presence:autoidle:<id>` (we set the Idle, so we may undo it). This module
 * is the pure decision; the Redis plumbing lives in the heartbeat route.
 */

export const AUTO_IDLE_AFTER_MS = 10 * 60 * 1000;
/** How long one non-idle heartbeat keeps the user "active" for other devices. */
export const ACTIVE_DEVICE_TTL_SECONDS = 120;
/** The auto-idle marker outlives any realistic absence. */
export const AUTO_IDLE_FLAG_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AutoIdleAction = "set-idle" | "restore-online" | "none";

export interface AutoIdleInput {
  /** Stored status: online | idle | dnd | invisible | offline. */
  status: string | null | undefined;
  /** This device reports no input for AUTO_IDLE_AFTER_MS. */
  idle: boolean;
  /** Another device reported input recently. */
  otherDeviceActive: boolean;
  /** The current Idle was set automatically. */
  autoIdleFlag: boolean;
}

export function decideAutoIdle(input: AutoIdleInput): AutoIdleAction {
  const status = (input.status || "offline").toLowerCase();
  if (input.idle) {
    if (status !== "online") return "none";
    if (input.otherDeviceActive) return "none";
    return "set-idle";
  }
  if (status === "idle" && input.autoIdleFlag) return "restore-online";
  return "none";
}

/** Parse the optional heartbeat body. Undefined = the client didn't say. */
export function parseHeartbeatIdle(body: unknown): boolean | undefined {
  let data = body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!data || typeof data !== "object") return undefined;
  const idle = (data as { idle?: unknown }).idle;
  return typeof idle === "boolean" ? idle : undefined;
}
