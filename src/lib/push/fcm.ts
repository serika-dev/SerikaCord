/**
 * Pure helpers for mobile push (Firebase Cloud Messaging HTTP v1): parsing the
 * service account, building messages, classifying send errors and deciding
 * who should get a push at all. No I/O here — see
 * src/lib/services/pushNotifications.ts for the sending side.
 */
import { renderMentionText, type MentionNames } from "@/lib/chat/mentionText";
import { notifyPushBlock } from "@/lib/e2ee/notifyKeys";

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
/** Server @mentions (APKs that render pushes natively; see NotificationChannels.java). */
export const PUSH_CHANNEL_MENTIONS = "mentions";

/**
 * Push protocol a registered device speaks, carried in `push_devices.platform`:
 *  - "android" / "ios" (1): system-rendered `notification` pushes (old APKs).
 *  - "android-2" (2): data-only message pushes the app renders itself
 *    (MessagingStyle, avatars, inline Reply / Mark as read).
 * Unknown values fall back to 1, so a device only gets data-only pushes once
 * its APK said it can draw them.
 */
export const RICH_PUSH_PROTOCOL = 2;
/**
 *  - "android-3" (3): as 2, and the app can decrypt end-to-end encrypted
 *    message previews: a push to a device linked to an E2EE notification key
 *    carries that key's wrap entry + the envelope fields (`e2ee`, see
 *    lib/e2ee/notifyKeys.ts). Never plaintext.
 */
export const E2EE_PUSH_PROTOCOL = 3;

export function pushProtocolOf(platform: string | null | undefined): number {
  const m = /^android-(\d{1,3})$/.exec(platform ?? "");
  return m ? Number(m[1]) : 1;
}

/** Normalise the `platform` a client registers with (unknown → "android"). */
export function normalizePushPlatform(raw: unknown): string {
  if (raw === "ios") return "ios";
  if (typeof raw === "string") {
    const n = pushProtocolOf(raw);
    if (n >= RICH_PUSH_PROTOCOL && n <= 99) return `android-${n}`;
  }
  return "android";
}

/** Everything the Android app needs to draw a message notification itself. */
export interface RichMessageInfo {
  kind: "dm" | "group_dm" | "channel";
  channelId: string;
  serverId?: string | null;
  /** DM: the author; group: the group name; server: "#channel · Server". */
  conversationTitle: string;
  authorId: string;
  authorName: string;
  /** Small square avatar URL (see pushImageUrl). */
  authorAvatar?: string | null;
  /** Server icon / group DM icon. */
  icon?: string | null;
  messageId?: string | null;
  /** First (non-spoiler) image attachment, for an inline picture. */
  image?: string | null;
  /** The recipient was pinged (server @mention / role mention). */
  mention?: boolean;
  /** Message time, ms since epoch. */
  timestamp?: number;
  /** Inline Reply is offered (posts to /api/channels/:channelId/messages). */
  canReply?: boolean;
  /** End-to-end encrypted message (protocol 3 apps never show `body` or offer Reply for it). */
  encrypted?: boolean;
  /**
   * End-to-end encrypted message: its stored envelope. Only the entry of the
   * receiving device's notification key is sent, and only to protocol 3+.
   */
  e2ee?: unknown;
}

/** Per-device facts the push builder needs. */
export interface PushTarget {
  /** The device's push protocol (pushProtocolOf its platform). */
  protocol?: number;
  /** The E2EE notification key the device holds (push_devices.e2ee_notify_id). */
  notifyId?: string | null;
  /** The iOS app (platform "ios"): APNs needs visible / background pushes, it ignores data-only ones. */
  ios?: boolean;
}

export type PushPayload =
  | {
      kind: "message";
      title: string;
      body: string;
      /** In-app path opened on tap. */
      route: string;
      /** Groups / replaces notifications per conversation; cleared once read. */
      tag: string;
      /** Set for conversation messages: rich data-only push on capable APKs. */
      rich?: RichMessageInfo;
    }
  | {
      kind: "call_ring";
      roomId: string;
      callerName: string;
      video: boolean;
      route: string;
      answerRoute: string;
    }
  | { kind: "call_cancel"; roomId: string }
  /** The conversation was read on another device: remove its notification. */
  | { kind: "message_read"; tag: string };

const MAX_TITLE = 100;
const MAX_BODY = 240;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let end = max - 1;
  // Never cut an emoji (surrogate pair) in half.
  const code = t.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${t.slice(0, end)}…`;
}

/** FCM caps the whole data payload at 4096 bytes; stay well under it. */
export const RICH_DATA_BUDGET = 3600;
const MAX_URL = 600;
const MAX_ID = 64;

function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function dataSize(data: Record<string, string>): number {
  let n = 0;
  for (const [k, v] of Object.entries(data)) n += utf8Length(k) + utf8Length(v);
  return n;
}

function safeUrl(url: string | null | undefined): string {
  if (!url || url.length > MAX_URL) return "";
  return /^https:\/\/[^\s]+$/.test(url) ? url : "";
}

function shortId(id: string | null | undefined): string {
  return id ? String(id).slice(0, MAX_ID) : "";
}

/**
 * The data map of a rich (data-only) message push. Values are strings, the
 * total stays under RICH_DATA_BUDGET bytes: optional pictures are dropped
 * first, then the body is shortened. For an end-to-end encrypted message and
 * a protocol 3+ device holding a notification key, `e2ee` carries that key's
 * wrap entry and the envelope fields (pictures make room for it first); when
 * it can't fit, it is left out and the app shows "New encrypted message".
 */
export function buildRichMessageData(payload: Extract<PushPayload, { kind: "message" }>, target: PushTarget = {}): Record<string, string> {
  const r = payload.rich;
  if (!r) return { type: "message", route: payload.route, tag: payload.tag };
  const data: Record<string, string> = {
    type: "message",
    v: String(RICH_PUSH_PROTOCOL),
    tag: payload.tag,
    route: payload.route,
    kind: r.kind,
    channelId: shortId(r.channelId),
    serverId: shortId(r.serverId),
    title: clip(r.conversationTitle || payload.title, MAX_TITLE),
    authorId: shortId(r.authorId),
    authorName: clip(r.authorName || payload.title, MAX_TITLE),
    avatar: safeUrl(r.authorAvatar),
    icon: safeUrl(r.icon),
    messageId: shortId(r.messageId),
    body: clip(payload.body, MAX_BODY),
    image: safeUrl(r.image),
    mention: r.mention ? "1" : "0",
    ts: String(Math.max(0, Math.floor(r.timestamp ?? Date.now()))),
    replyChannelId: r.canReply === false ? "" : shortId(r.channelId),
    canReply: r.canReply === false ? "0" : "1",
  };
  // Encrypted message to an APK that decrypts previews: it shows its own
  // (translated) "New encrypted message" whenever it can't open `e2ee`.
  const e2eeCapable = Boolean(r.encrypted || r.e2ee) && (target.protocol ?? 1) >= E2EE_PUSH_PROTOCOL;
  if (e2eeCapable) data.enc = "1";
  for (const key of ["image", "icon", "avatar"] as const) {
    if (dataSize(data) <= RICH_DATA_BUDGET) break;
    data[key] = "";
  }
  if (dataSize(data) > RICH_DATA_BUDGET) data.route = data.route.slice(0, 200);
  let bodyMax = MAX_BODY;
  while (dataSize(data) > RICH_DATA_BUDGET && bodyMax > 20) {
    bodyMax = Math.floor(bodyMax / 2);
    data.body = clip(payload.body, bodyMax);
    data.title = clip(data.title, Math.min(MAX_TITLE, bodyMax));
    data.authorName = clip(data.authorName, Math.min(MAX_TITLE, bodyMax));
  }
  const block = e2eeCapable && r.e2ee && target.notifyId ? notifyPushBlock(r.e2ee, target.notifyId) : null;
  if (block) {
    const withBlock: Record<string, string> = { ...data, e2ee: JSON.stringify(block) };
    for (const key of ["image", "icon", "avatar"] as const) {
      if (dataSize(withBlock) <= RICH_DATA_BUDGET) break;
      withBlock[key] = "";
    }
    if (dataSize(withBlock) <= RICH_DATA_BUDGET) return withBlock;
  }
  return data;
}

/**
 * One FCM v1 `message` object for a device token. `protocol` is the device's
 * push protocol (pushProtocolOf its platform): message pushes become
 * data-only rich pushes only for devices that can render them.
 */
export function buildFcmMessage(
  token: string,
  payload: PushPayload,
  opts: PushTarget = {},
): Record<string, unknown> {
  if (opts.ios && payload.kind !== "message") return buildIosMessage(token, payload);
  if (payload.kind === "message" && payload.rich && (opts.protocol ?? 1) >= RICH_PUSH_PROTOCOL) {
    // Data-only + high priority: the app draws a MessagingStyle notification
    // (avatars, history, inline Reply / Mark as read) even when it's closed.
    // No collapse_key: each message must arrive to build the conversation.
    return {
      token,
      data: buildRichMessageData(payload, opts),
      android: { priority: "HIGH", ttl: "86400s" },
    };
  }
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
  if (payload.kind === "message_read") {
    // Data-only: the app's messaging service cancels the notification by tag.
    return {
      token,
      data: { type: "message_read", tag: payload.tag },
      android: { priority: "NORMAL", ttl: "86400s", collapse_key: `read-${payload.tag}` },
    };
  }
  return {
    token,
    data: { type: "call_cancel", roomId: payload.roomId },
    android: { priority: "HIGH", ttl: "60s" },
  };
}

/** Seconds an iOS incoming-call notification stays deliverable (APNs drops it after). */
export const IOS_CALL_RING_TTL_SECONDS = 45;

/**
 * iOS (no CallKit / background renderer): the system only shows what the
 * push itself describes, and a data-only push never reaches a suspended app.
 *  - call_ring: a visible, time-limited notification that opens the DM.
 *  - call_cancel / message_read: background pushes (content-available) the
 *    app uses to remove the matching notification (AppDelegate). iOS throttles
 *    these, so that part is best effort.
 * Message pushes use the shared `notification` + `apns` form above.
 */
function buildIosMessage(
  token: string,
  payload: Exclude<PushPayload, { kind: "message" }>,
  now: number = Date.now(),
): Record<string, unknown> {
  if (payload.kind === "call_ring") {
    const thread = `call-${payload.roomId}`;
    const label = payload.video ? "Incoming video call" : "Incoming voice call";
    return {
      token,
      notification: { title: clip(payload.callerName, MAX_TITLE) || label, body: label },
      data: { type: "call_ring", roomId: payload.roomId, route: payload.route, tag: thread },
      apns: {
        headers: {
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(now / 1000) + IOS_CALL_RING_TTL_SECONDS),
        },
        payload: { aps: { sound: "default", "thread-id": thread } },
      },
    };
  }
  const background = {
    headers: { "apns-push-type": "background", "apns-priority": "5" },
    payload: { aps: { "content-available": 1 } },
  };
  if (payload.kind === "message_read") {
    return { token, data: { type: "message_read", tag: payload.tag }, apns: background };
  }
  return { token, data: { type: "call_cancel", roomId: payload.roomId }, apns: background };
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

/**
 * Plain-text push body from stored (HTML-escaped, markup-bearing) message
 * text. Mentions use `names` when given ("@Alice"), spoilers stay hidden.
 */
export function pushPreview(raw: string | null | undefined, max = MAX_BODY, names?: MentionNames | null): string {
  if (!raw) return "";
  const decoded = raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\|\|[\s\S]+?\|\|/g, "[spoiler]");
  return clip(renderMentionText(decoded, names), max);
}

/** The attachment fields a push preview looks at (stored message attachments). */
export interface PushAttachment {
  url?: string | null;
  filename?: string | null;
  contentType?: string | null;
  spoiler?: boolean | null;
  sensitive?: boolean | null;
  durationSecs?: number | null;
}

function attachmentKind(a: PushAttachment): "image" | "gif" | "video" | "audio" | "voice" | "file" {
  const type = (a.contentType ?? "").toLowerCase();
  const name = (a.filename ?? "").toLowerCase();
  if (type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|avif|heic|bmp)$/.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v)$/.test(name)) return "video";
  if (a.durationSecs != null && a.durationSecs > 0 && (type.startsWith("audio/") || /\.(ogg|opus|m4a|webm)$/.test(name))) {
    return "voice";
  }
  if (type.startsWith("audio/") || /\.(mp3|ogg|opus|wav|flac|m4a|aac)$/.test(name)) return "audio";
  return "file";
}

/**
 * A short label for a message's media ("📷 Photo", "🎥 Video", "📎 report.pdf")
 * plus the first safe image to show inline (never a spoiler / sensitive one).
 * English like the other server-side push fallbacks.
 */
export function attachmentPreview(
  attachments: readonly PushAttachment[] | null | undefined,
  sticker?: { name?: string | null } | null,
): { label: string; image: string | null } {
  const list = (attachments ?? []).filter(Boolean);
  if (list.length === 0) {
    if (sticker) return { label: sticker.name ? `Sticker: ${clip(sticker.name, 40)}` : "Sticker", image: null };
    return { label: "", image: null };
  }
  const kinds = list.map(attachmentKind);
  const first = kinds[0];
  const same = kinds.every((k) => k === first);
  const n = list.length;
  let label: string;
  if (same && (first === "image" || first === "gif")) {
    label = first === "gif" ? (n > 1 ? `🖼️ ${n} GIFs` : "🖼️ GIF") : n > 1 ? `📷 ${n} photos` : "📷 Photo";
  } else if (same && first === "video") {
    label = n > 1 ? `🎥 ${n} videos` : "🎥 Video";
  } else if (first === "voice" && n === 1) {
    label = "🎤 Voice message";
  } else if (same && first === "audio") {
    label = n > 1 ? `🎵 ${n} audio files` : "🎵 Audio";
  } else if (n === 1) {
    label = `📎 ${clip(list[0].filename || "File", 60)}`;
  } else {
    label = `📎 ${n} attachments`;
  }
  if (list.some((a) => a.spoiler)) label = `${label} (spoiler)`;
  const pic = list.find((a, i) => kinds[i] === "image" && !a.spoiler && !a.sensitive && safeUrl(a.url));
  return { label, image: pic?.url ?? null };
}

/**
 * A small CDN rendition for a notification picture: on our CDN host (wsrv
 * transforms, like cdnImage) request a still, resized WebP; other https URLs
 * pass through; anything else is dropped.
 */
export function pushImageUrl(url: string | null | undefined, size: number, cdnHost = "cdn.serika.chat"): string | null {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const u = new URL(url);
    // Only our CDN: an arbitrary host would learn the phone's IP and when the push arrived.
    if (u.hostname !== cdnHost) return null;
    u.searchParams.set("w", String(size));
    u.searchParams.set("h", String(size));
    u.searchParams.set("fit", size <= 256 ? "cover" : "inside");
    u.searchParams.set("n", "1");
    if (!u.searchParams.has("format") && !u.searchParams.has("output") && !u.searchParams.has("fm")) {
      u.searchParams.set("format", "webp");
    }
    return safeUrl(u.toString()) || null;
  } catch {
    return null;
  }
}

const FCM_TOKEN_RE = /^[A-Za-z0-9_:\-.]{20,4096}$/;

/** Shape check for a device token sent by a client. */
export function isPlausibleDeviceToken(token: unknown): token is string {
  return typeof token === "string" && FCM_TOKEN_RE.test(token);
}
