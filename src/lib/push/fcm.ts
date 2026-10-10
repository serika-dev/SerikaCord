/**
 * Pure helpers for mobile push (Firebase Cloud Messaging HTTP v1): parsing the
 * service account, building messages, classifying send errors and deciding
 * who should get a push at all. No I/O here — see
 * src/lib/services/pushNotifications.ts for the sending side.
 */

export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** Parse FCM_SERVICE_ACCOUNT_JSON (raw JSON or base64 JSON). Null when unusable. */
export function parseServiceAccount(raw: string | null | undefined): FcmServiceAccount | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const candidates = [value];
  if (!value.startsWith("{")) {
    try {
      candidates.push(Buffer.from(value, "base64").toString("utf8").trim());
    } catch {
      /* not base64 */
    }
  }
  for (const text of candidates) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const projectId = typeof json.project_id === "string" ? json.project_id : "";
      const clientEmail = typeof json.client_email === "string" ? json.client_email : "";
      let privateKey = typeof json.private_key === "string" ? json.private_key : "";
      // Keys pasted through env files often keep literal "\n" sequences.
      if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
      if (projectId && clientEmail && privateKey.includes("PRIVATE KEY")) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      /* try the next form */
    }
  }
  return null;
}

/** Android notification channels created by the app (MainActivity). */
export const PUSH_CHANNEL_MESSAGES = "messages";
export const PUSH_CHANNEL_CALLS = "calls";

export type PushPayload =
  | {
      kind: "message";
      title: string;
      body: string;
      /** In-app path opened on tap. */
      route: string;
      /** Groups / replaces notifications per conversation; cleared once read. */
      tag: string;
    }
  | {
      kind: "call_ring";
      roomId: string;
      callerName: string;
      video: boolean;
      route: string;
      answerRoute: string;
    }
  | { kind: "call_cancel"; roomId: string };

const MAX_TITLE = 100;
const MAX_BODY = 240;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One FCM v1 `message` object for a device token. */
export function buildFcmMessage(token: string, payload: PushPayload): Record<string, unknown> {
  if (payload.kind === "message") {
    const title = clip(payload.title, MAX_TITLE);
    const body = clip(payload.body, MAX_BODY);
    return {
      token,
      notification: { title, body },
      data: { type: "message", route: payload.route, tag: payload.tag },
      android: {
        priority: "HIGH",
        ttl: "86400s",
        collapse_key: payload.tag,
        notification: {
          channel_id: PUSH_CHANNEL_MESSAGES,
          tag: payload.tag,
          icon: "ic_stat_serika",
          color: "#8B5CF6",
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
      apns: {
        payload: { aps: { sound: "default", "thread-id": payload.tag } },
      },
    };
  }
  if (payload.kind === "call_ring") {
    // Data-only + high priority: the app's messaging service raises a
    // full-screen incoming-call notification itself, even when closed.
    return {
      token,
      data: {
        type: "call_ring",
        roomId: payload.roomId,
        callerName: clip(payload.callerName, MAX_TITLE),
        video: payload.video ? "1" : "0",
        route: payload.route,
        answerRoute: payload.answerRoute,
      },
      android: { priority: "HIGH", ttl: "45s" },
    };
  }
  return {
    token,
    data: { type: "call_cancel", roomId: payload.roomId },
    android: { priority: "HIGH", ttl: "60s" },
  };
}

export type FcmSendOutcome = "ok" | "unregistered" | "retry" | "failed";

/** Map an FCM v1 HTTP response to what we should do with the token. */
export function classifyFcmResponse(status: number, body: unknown): FcmSendOutcome {
  if (status >= 200 && status < 300) return "ok";
  const err = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } } | null)?.error;
  const codes = new Set<string>([err?.status ?? "", ...(err?.details ?? []).map((d) => d?.errorCode ?? "")]);
  if (status === 404 || codes.has("UNREGISTERED")) return "unregistered";
  // A malformed token (not a malformed message) is just as dead.
  if (status === 400 && codes.has("INVALID_ARGUMENT") && /registration token/i.test(JSON.stringify(body ?? ""))) {
    return "unregistered";
  }
  if (status === 429 || status >= 500 || codes.has("UNAVAILABLE") || codes.has("INTERNAL")) return "retry";
  return "failed";
}

/** A presence heartbeat newer than this means a client is open somewhere. */
export const ACTIVE_HEARTBEAT_MS = 90_000;

/**
 * Whether a user should get a mobile push for a live event. Discord-style:
 * no push while they're using the app; always push when their phone app said
 * it went to the background.
 */
export function shouldPushToUser(input: {
  /** The phone app reported it is in the background. */
  away: boolean;
  /** An activity stream for the user is open on this instance. */
  connectedHere: boolean;
  /** Last presence heartbeat (any instance), if known. */
  lastHeartbeatAt?: Date | string | number | null;
  now?: number;
}): boolean {
  if (input.away) return true;
  if (input.connectedHere) return false;
  if (input.lastHeartbeatAt == null) return true;
  const at = new Date(input.lastHeartbeatAt).getTime();
  if (Number.isNaN(at)) return true;
  return (input.now ?? Date.now()) - at > ACTIVE_HEARTBEAT_MS;
}

/** Plain-text push body from stored (HTML-escaped, markup-bearing) message text. */
export function pushPreview(raw: string | null | undefined, max = MAX_BODY): string {
  if (!raw) return "";
  const text = raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<@&[\w-]+>/g, "@role")
    .replace(/<@!?[\w-]+>/g, "@user")
    .replace(/<#[\w-]+>/g, "#channel")
    .replace(/<a?:(\w+):[\w-]+>/g, ":$1:");
  return clip(text, max);
}

const FCM_TOKEN_RE = /^[A-Za-z0-9_:\-.]{20,4096}$/;

/** Shape check for a device token sent by a client. */
export function isPlausibleDeviceToken(token: unknown): token is string {
  return typeof token === "string" && FCM_TOKEN_RE.test(token);
}
