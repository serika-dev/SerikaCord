// Pure conversation-binding rules of the E2EE client (no DOM, no crypto, no
// network): which conversation a page / call room is, who may receive keys
// in it, which plaintext rows can't be trusted, and which payload URLs a
// client may load. The server is untrusted for all of this: these checks tie
// what the client encrypts to and renders to what the user actually opened
// and sees. Unit-tested in tests/e2ee.test.ts.
import { UUID_RE } from "./constants";
import type { MessagePayload } from "./payload";

const lower = (s: string) => s.toLowerCase();

// ─── Conversation identity (from the URL, never from the server) ─────────────

/** What a DM / group DM page opened: the person in `/dm/<id>` or the group in `/dm/group/<id>`. */
export type E2eeTarget =
  | { kind: "dm"; recipientId: string }
  | { kind: "group"; channelId: string };

/** Local key of a conversation ("seen encrypted" memory, call rooms). */
export function conversationKey(target: E2eeTarget): string {
  return target.kind === "dm" ? `dm:${lower(target.recipientId)}` : `gdm:${lower(target.channelId)}`;
}

const DM_API_BASE = /^\/api\/dms\/([0-9a-f-]{36})$/i;
const GROUP_API_BASE = /^\/api\/group-dms\/([0-9a-f-]{36})$/i;

/** The conversation of a chat API base (`/api/dms/<user>`, `/api/group-dms/<channel>`); null for server channels. */
export function e2eeTargetForApiBase(apiBase: string | null | undefined): E2eeTarget | null {
  if (!apiBase) return null;
  const dm = DM_API_BASE.exec(apiBase);
  if (dm && UUID_RE.test(dm[1])) return { kind: "dm", recipientId: lower(dm[1]) };
  const group = GROUP_API_BASE.exec(apiBase);
  if (group && UUID_RE.test(group[1])) return { kind: "group", channelId: lower(group[1]) };
  return null;
}

const DM_CALL_ROOM = /^dm:([0-9a-f-]{36})_([0-9a-f-]{36})$/i;
const GROUP_CALL_ROOM = /^gdm:([0-9a-f-]{36})$/i;

/**
 * The conversation a DM / group DM call room belongs to (`dm:<a>_<b>` → the
 * DM with the other person, `gdm:<id>` → the group). Null when it isn't one,
 * or when `selfId` isn't one of a 1:1 room's two people.
 */
export function e2eeTargetForCallRoom(roomId: string, selfId: string): E2eeTarget | null {
  const dm = DM_CALL_ROOM.exec(roomId);
  if (dm) {
    const [a, b] = [lower(dm[1]), lower(dm[2])];
    const me = lower(selfId || "");
    if (!UUID_RE.test(a) || !UUID_RE.test(b) || a === b) return null;
    if (me === a) return { kind: "dm", recipientId: b };
    if (me === b) return { kind: "dm", recipientId: a };
    return null;
  }
  const group = GROUP_CALL_ROOM.exec(roomId);
  if (group && UUID_RE.test(group[1])) return { kind: "group", channelId: lower(group[1]) };
  return null;
}

// ─── Who gets keys ────────────────────────────────────────────────────────────

/** Whether a member list names someone twice (case-insensitively). */
export function hasDuplicateIds(ids: string[]): boolean {
  return new Set(ids.map(lower)).size !== ids.length;
}

/**
 * A 1:1 DM's key bundle list must be exactly the viewer and the person in
 * the URL: no one else, no one twice.
 */
export function isExactDmMembers(memberIds: string[], selfId: string, recipientId: string): boolean {
  if (!selfId || !recipientId || lower(selfId) === lower(recipientId)) return false;
  if (memberIds.length !== 2 || hasDuplicateIds(memberIds)) return false;
  const ids = new Set(memberIds.map(lower));
  return ids.has(lower(selfId)) && ids.has(lower(recipientId));
}

export interface GroupMemberCheck {
  /** Bundle members the group UI also shows (plus the viewer): the only ones messages are encrypted to. */
  allowed: Set<string>;
  /** In the server's key list but not shown in the group: never encrypted to. */
  hidden: string[];
  /** Shown in the group but missing from the key list (they can't read new messages). */
  missing: string[];
}

/** Compare a group's key bundle list with the members its UI shows. */
export function compareGroupMembers(bundleIds: string[], shownIds: string[], selfId: string): GroupMemberCheck {
  const shown = new Set([...shownIds.map(lower), lower(selfId)]);
  const bundle = new Set(bundleIds.map(lower));
  const allowed = new Set<string>();
  const hidden: string[] = [];
  for (const id of bundle) {
    if (shown.has(id)) allowed.add(id);
    else hidden.push(id);
  }
  const missing = [...shown].filter((id) => id !== lower(selfId) && !bundle.has(id));
  return { allowed, hidden, missing };
}

// ─── Plaintext rows in an encrypted conversation ──────────────────────────────

type RowLike = { type?: unknown; e2ee?: unknown; createdAt?: unknown };

/** Rows people type (the only kind that must be encrypted); call / group event / notice rows are system rows. */
function isUserTextRow(type: unknown): boolean {
  return type === undefined || type === null || type === "" || type === "default" || type === "reply";
}

function timeOf(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date) && typeof value !== "number") return null;
  const t = new Date(value as string).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The earliest "turned on encryption" notice in a batch of rows (ms), or null. */
export function encryptionNoticeTime(rows: RowLike[]): number | null {
  let min: number | null = null;
  for (const r of rows) {
    if (r?.type !== "e2ee_enabled") continue;
    const t = timeOf(r.createdAt);
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min;
}

/**
 * A message without an envelope in an encrypted conversation: nobody can
 * vouch for who wrote it (the server could have inserted it). Rows from
 * before the "turned on encryption" notice (`encryptedSince`, when known) are
 * legitimate plain history.
 */
export function isUnverifiablePlaintextRow(row: RowLike, encryptedSince: number | null): boolean {
  if (!row || (row.e2ee && typeof row.e2ee === "object")) return false;
  if (!isUserTextRow(row.type)) return false;
  if (encryptedSince !== null) {
    const t = timeOf(row.createdAt);
    if (t !== null && t < encryptedSince) return false;
  }
  return true;
}

/**
 * When a conversation was switched on / off, as far as this device knows:
 * `on` = "turned on encryption" notice times, `off` = times of "turned off"
 * notices whose signed record verified (unverified ones are never added).
 */
export interface EncryptionTimeline {
  on: number[];
  off: number[];
}

/**
 * The switch times in a batch of rows: "turned on" notices at their row
 * time; "turned off" notices only when `offTimeOf` vouches for them, at the
 * time it returns (the signed record's time, not the server's row time).
 */
export function timelineOf(rows: Array<RowLike & { id?: unknown }>, offTimeOf: (row: RowLike & { id?: unknown }) => number | null): EncryptionTimeline {
  const on: number[] = [];
  const off: number[] = [];
  for (const r of rows) {
    if (r?.type === "e2ee_enabled") {
      const t = timeOf(r.createdAt);
      if (t !== null) on.push(t);
    } else if (r?.type === "e2ee_disabled") {
      const t = offTimeOf(r);
      if (t !== null) off.push(t);
    }
  }
  return { on, off };
}

/** Row time as ms (null when missing / invalid). */
export function rowTime(value: unknown): number | null {
  return timeOf(value);
}

/** Merge two timelines (deduplicated, sorted). */
export function mergeTimelines(a: EncryptionTimeline, b: EncryptionTimeline): EncryptionTimeline {
  const uniq = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);
  return { on: uniq([...a.on, ...b.on]), off: uniq([...a.off, ...b.off]) };
}

/**
 * Whether a plaintext user row sent at `t` is legitimate history in a
 * conversation that is encrypted now: the latest known switch at or before
 * `t` turned encryption off (a verified record), or there was none and the
 * first known switch turned it on (the plain era before it). With no known
 * switch at all (created encrypted) nothing plain is legitimate. A "turned
 * off" notice proves the conversation was encrypted before it, so rows
 * before a first "off" are not legitimate either.
 */
export function isPlainAllowedAt(t: number | null, timeline: EncryptionTimeline): boolean {
  if (t === null) return false;
  let lastOn: number | null = null;
  let lastOff: number | null = null;
  for (const x of timeline.on) if (x <= t && (lastOn === null || x > lastOn)) lastOn = x;
  for (const x of timeline.off) if (x <= t && (lastOff === null || x > lastOff)) lastOff = x;
  if (lastOff !== null && (lastOn === null || lastOff >= lastOn)) return true;
  if (lastOn !== null) return false;
  // Before every known switch: plain only if the first one turned encryption on.
  const firstOn = timeline.on.length ? Math.min(...timeline.on) : null;
  const firstOff = timeline.off.length ? Math.min(...timeline.off) : null;
  return firstOn !== null && (firstOff === null || firstOn < firstOff);
}

/** isUnverifiablePlaintextRow against a full on / off timeline. */
export function isUnverifiablePlaintextRowIn(row: RowLike, timeline: EncryptionTimeline): boolean {
  if (!row || (row.e2ee && typeof row.e2ee === "object")) return false;
  if (!isUserTextRow(row.type)) return false;
  return !isPlainAllowedAt(timeOf(row.createdAt), timeline);
}

// ─── URLs inside a decrypted payload ──────────────────────────────────────────

/** `url` is on our CDN (same scheme + host, no credentials), optionally under `pathPrefix`. */
export function isCdnUrl(url: string, cdnUrl: string, pathPrefix = ""): boolean {
  let u: URL;
  let cdn: URL;
  try {
    u = new URL(url);
    cdn = new URL(cdnUrl);
  } catch {
    return false;
  }
  if (u.protocol !== cdn.protocol || u.host !== cdn.host || u.username || u.password) return false;
  const base = cdn.pathname.replace(/\/+$/, "");
  return u.pathname.startsWith(`${base}${pathPrefix}`);
}

/**
 * Only load what the sender really attached: every payload attachment must
 * be one of the message's stored (server-side) blobs AND live under our CDN's
 * attachments path; a sticker image must be on our CDN. Anything else would
 * make recipients fetch an attacker-chosen URL (IP / read-receipt leak).
 */
export function payloadUrlsAllowed(
  payload: Pick<MessagePayload, "attachments" | "sticker">,
  opts: { cdnUrl: string; storedAttachmentUrls: string[] },
): boolean {
  const stored = new Set(opts.storedAttachmentUrls);
  for (const a of payload.attachments ?? []) {
    if (!stored.has(a.url) || !isCdnUrl(a.url, opts.cdnUrl, "/attachments/")) return false;
  }
  if (payload.sticker && !isCdnUrl(payload.sticker.imageUrl, opts.cdnUrl)) return false;
  return true;
}
