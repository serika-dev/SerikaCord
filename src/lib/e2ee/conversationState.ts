// Turning end-to-end encryption off for one conversation, without letting the
// server do it silently (docs/architecture/e2ee.md "Turning encryption off").
// A member's device signs
//   frame("serika-e2ee-conv-state-v1", channelId, kind, dmA, dmB, userId, deviceId, "off", ts)
// (kind "dm" | "group_dm"; dmA < dmB the two people of a 1:1 DM, empty for groups)
// with its device signing key. The server stores the record and posts it on
// a "turned off" notice; other members' devices accept plaintext in that
// conversation only once the signature verifies under a device they trust
// for a member of that very conversation, and the record is newer than the
// last time they saw the conversation encrypted (a replayed old record is
// refused). Anything else keeps the conversation encrypted on that device,
// with a warning.
//
// Isomorphic and pure; unit-tested in tests/e2ee-pin.test.ts.
import { DEVICE_ID_RE, SIGNATURE_BYTES, UUID_RE } from "./constants";
import { E2eeFormatError, b64ByteLength, frame, fromB64, isBase64, toB64, type Bytes } from "./encoding";
import { signBytes, verifyBytes } from "./keys";

export const CONVERSATION_STATE_LABEL = "serika-e2ee-conv-state-v1";

/** How far the signer's clock may be off (both directions). */
export const CONVERSATION_STATE_MAX_SKEW_MS = 10 * 60_000;

/** What kind of conversation a record is for: a 1:1 DM (bound to its two people too) or a group DM. */
export type ConversationKind = "dm" | "group_dm";

export interface ConversationStateRecord {
  v: 1;
  /** The conversation (DM / group DM channel id, lower-case). */
  channelId: string;
  kind: ConversationKind;
  /** 1:1 DMs only: the two people, lower-case and sorted (a group's record can't pass as a DM's). */
  members?: [string, string];
  /** The member who turned encryption off. */
  userId: string;
  /** Their device that signed. */
  deviceId: string;
  state: "off";
  /** Signer's clock, ms. */
  ts: number;
  sig: string;
}

type Unsigned = Omit<ConversationStateRecord, "sig" | "v">;

/** The sorted, lower-cased pair of a 1:1 DM. */
export function dmPair(a: string, b: string): [string, string] {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return [x, y];
}

function checkBinding(r: Pick<ConversationStateRecord, "kind" | "members" | "userId">) {
  if (r.kind === "dm") {
    const m = r.members;
    if (!Array.isArray(m) || m.length !== 2 || !m.every((id) => typeof id === "string" && UUID_RE.test(id))) throw new E2eeFormatError("Bad members");
    if (m[0] !== m[0].toLowerCase() || m[1] !== m[1].toLowerCase() || !(m[0] < m[1])) throw new E2eeFormatError("Members must be sorted");
    if (!m.includes(r.userId.toLowerCase())) throw new E2eeFormatError("The signer must be one of the two people");
  } else if (r.kind === "group_dm") {
    if (r.members !== undefined) throw new E2eeFormatError("Group records name no members");
  } else {
    throw new E2eeFormatError("Bad kind");
  }
}

export function conversationStatePayload(r: Unsigned): Bytes {
  if (!UUID_RE.test(r.channelId) || !UUID_RE.test(r.userId)) throw new E2eeFormatError("Bad id");
  if (!DEVICE_ID_RE.test(r.deviceId)) throw new E2eeFormatError("Bad device id");
  if (r.state !== "off") throw new E2eeFormatError("Bad state");
  if (!Number.isSafeInteger(r.ts) || r.ts <= 0) throw new E2eeFormatError("Bad time");
  checkBinding(r);
  return frame(
    CONVERSATION_STATE_LABEL,
    r.channelId.toLowerCase(),
    r.kind,
    r.kind === "dm" ? r.members![0] : "",
    r.kind === "dm" ? r.members![1] : "",
    r.userId.toLowerCase(),
    r.deviceId,
    r.state,
    String(r.ts),
  );
}

/** Strict shape check (server before storing, clients before verifying). */
export function validateConversationState(input: unknown): ConversationStateRecord {
  const r = input as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new E2eeFormatError("Bad record");
  const allowed = new Set(["v", "channelId", "kind", "members", "userId", "deviceId", "state", "ts", "sig"]);
  for (const k of Object.keys(r)) if (!allowed.has(k)) throw new E2eeFormatError("Unknown field");
  if (r.v !== 1) throw new E2eeFormatError("Bad version");
  if (typeof r.channelId !== "string" || !UUID_RE.test(r.channelId)) throw new E2eeFormatError("Bad channel");
  if (typeof r.userId !== "string" || !UUID_RE.test(r.userId)) throw new E2eeFormatError("Bad user");
  if (typeof r.deviceId !== "string" || !DEVICE_ID_RE.test(r.deviceId)) throw new E2eeFormatError("Bad device");
  if (r.kind !== "dm" && r.kind !== "group_dm") throw new E2eeFormatError("Bad kind");
  if (r.state !== "off") throw new E2eeFormatError("Bad state");
  if (typeof r.ts !== "number" || !Number.isSafeInteger(r.ts) || r.ts <= 0) throw new E2eeFormatError("Bad time");
  if (!isBase64(r.sig) || b64ByteLength(r.sig) !== SIGNATURE_BYTES) throw new E2eeFormatError("Bad signature");
  const out: ConversationStateRecord = {
    v: 1,
    channelId: r.channelId.toLowerCase(),
    kind: r.kind,
    ...(r.kind === "dm" ? { members: r.members as [string, string] } : {}),
    userId: r.userId.toLowerCase(),
    deviceId: r.deviceId,
    state: "off",
    ts: r.ts,
    sig: r.sig,
  };
  if (r.kind === "group_dm" && r.members !== undefined) throw new E2eeFormatError("Group records name no members");
  checkBinding(out);
  return out;
}

export function parseConversationState(input: unknown): ConversationStateRecord | null {
  try {
    return validateConversationState(input);
  } catch {
    return null;
  }
}

export async function signConversationOff(
  signKey: CryptoKey,
  fields: { channelId: string; kind: ConversationKind; members?: [string, string]; userId: string; deviceId: string; ts?: number },
): Promise<ConversationStateRecord> {
  const base: Unsigned = {
    channelId: fields.channelId.toLowerCase(),
    kind: fields.kind,
    ...(fields.kind === "dm" && fields.members ? { members: dmPair(fields.members[0], fields.members[1]) } : {}),
    userId: fields.userId.toLowerCase(),
    deviceId: fields.deviceId,
    state: "off",
    ts: fields.ts ?? Date.now(),
  };
  const sig = toB64(await signBytes(signKey, conversationStatePayload(base)));
  return { v: 1, ...base, sig };
}

/** Signature check only (false on anything malformed). */
export async function verifyConversationStateSig(signPub: string, record: ConversationStateRecord): Promise<boolean> {
  try {
    return await verifyBytes(signPub, fromB64(record.sig), conversationStatePayload(record));
  } catch {
    return false;
  }
}

/** Whether a notice row's server time agrees with its signed record (else the row is ignored). */
export function noticeTimeMatches(createdAt: number | null, record: Pick<ConversationStateRecord, "ts">): boolean {
  return createdAt !== null && Math.abs(createdAt - record.ts) <= CONVERSATION_STATE_MAX_SKEW_MS;
}

export type OffRejection =
  | "malformed"
  | "wrong_conversation"
  | "not_member"
  | "unknown_device"
  | "revoked_device"
  | "signature"
  | "future"
  | "stale";

/**
 * Whether a client accepts a verified-signature "off" record for the
 * conversation it opened. `channelId` is the conversation's channel as the
 * client bound it (the URL's group, or the DM channel proved to be exactly
 * us + the URL's person); `memberIds` the members it encrypts to;
 * `signer` the record device as found in that member's trusted key bundle;
 * `seenEncryptedAt` the last time this device saw the conversation encrypted
 * (local clock, ms; null when never); `acceptedOffTs` the newest off record
 * this device already accepted for it (an older one can't win).
 */
export function checkOffRecord(opts: {
  record: ConversationStateRecord | null;
  channelId: string;
  /** What the user opened: a 1:1 DM with these two people (sorted or not), or a group DM. */
  expected: { kind: "dm"; members: [string, string] } | { kind: "group_dm" };
  memberIds: string[];
  signer: { trusted: boolean; revokedAt: number | null } | null | undefined;
  signatureValid: boolean;
  now: number;
  seenEncryptedAt: number | null;
  acceptedOffTs?: number | null;
  /**
   * The newest off record this device accepted and then saw superseded (the
   * conversation was encrypted again): it, and anything older, can never be
   * accepted again (replay protection independent of clocks).
   */
  consumedOffTs?: number | null;
}): { ok: true } | { ok: false; reason: OffRejection } {
  const r = opts.record;
  if (!r) return { ok: false, reason: "malformed" };
  if (r.channelId !== opts.channelId.toLowerCase()) return { ok: false, reason: "wrong_conversation" };
  if (r.kind !== opts.expected.kind) return { ok: false, reason: "wrong_conversation" };
  if (opts.expected.kind === "dm") {
    const want = dmPair(opts.expected.members[0], opts.expected.members[1]);
    if (!r.members || r.members[0] !== want[0] || r.members[1] !== want[1]) return { ok: false, reason: "wrong_conversation" };
  }
  if (!opts.memberIds.some((id) => id.toLowerCase() === r.userId)) return { ok: false, reason: "not_member" };
  if (!opts.signer || !opts.signer.trusted) return { ok: false, reason: "unknown_device" };
  if (opts.signer.revokedAt !== null && r.ts > opts.signer.revokedAt + 60_000) return { ok: false, reason: "revoked_device" };
  if (!opts.signatureValid) return { ok: false, reason: "signature" };
  if (r.ts > opts.now + CONVERSATION_STATE_MAX_SKEW_MS) return { ok: false, reason: "future" };
  if (opts.seenEncryptedAt !== null && r.ts < opts.seenEncryptedAt - CONVERSATION_STATE_MAX_SKEW_MS) return { ok: false, reason: "stale" };
  if (opts.acceptedOffTs != null && r.ts < opts.acceptedOffTs) return { ok: false, reason: "stale" };
  if (opts.consumedOffTs != null && r.ts <= opts.consumedOffTs) return { ok: false, reason: "stale" };
  return { ok: true };
}
