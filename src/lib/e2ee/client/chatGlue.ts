"use client";

// Light glue between the shared chat engine (useChatSession) and the lazily
// loaded E2EE session: nothing here pulls in the crypto module until a
// conversation actually has encrypted messages.
import type { ChatMessage, MessageAttachment, MessageSticker } from "@/lib/chat/types";
import type { RawMessagePayload } from "@/lib/chat/messages";
import {
  conversationKey,
  isUnverifiablePlaintextRowIn,
  mergeTimelines,
  rowTime,
  timelineOf,
  type E2eeTarget,
  type EncryptionTimeline,
} from "@/lib/e2ee/conversation";
import { noticeTimeMatches } from "@/lib/e2ee/conversationState";
import { getConversationStateMemory, isConversationRememberedEncrypted, rememberConversationEncrypted } from "./keyStore";
import { getE2eeSnapshot, loadE2eeSession } from "./state";
import type { DecryptContext } from "./session";
import { peekPlain, plainCacheKey, validatedChannelOf } from "./plainCache";
import { applyPayload } from "./view";
import { rawRowForRetry } from "@/lib/e2ee/decryptRetry";

/**
 * Whether this device has seen the conversation encrypted (downgrade
 * protection, keyed by what the user opened, never by a server channel id).
 * Rejects when storage fails: callers treat that as encrypted (fail closed).
 */
export function isRememberedEncrypted(userId: string, target: E2eeTarget): Promise<boolean> {
  return isConversationRememberedEncrypted(userId, conversationKey(target));
}

/** Remember the conversation as encrypted on this device (seen now; clears an accepted "turned off"). */
export function rememberEncrypted(userId: string, target: E2eeTarget): Promise<void> {
  resolutions.delete(`${userId.toLowerCase()}|${conversationKey(target)}`);
  // "Off" checks still running were made against the old memory.
  void loadE2eeSession().then((m) => m.forgetOffChecks()).catch(() => {});
  return rememberConversationEncrypted(userId, conversationKey(target));
}

/** Whether this device must treat a conversation as encrypted right now, and why not when it doesn't. */
export interface ConversationEncryption {
  encrypted: boolean;
  /** A member turned encryption off (signature verified on this device). */
  off: { by: string; at: number } | null;
  /**
   * The server reports the conversation unencrypted, but this device saw it
   * encrypted and no valid member-signed "turned off" record was found: it
   * stays encrypted here (sends are refused by the server) — show a warning.
   */
  unverifiedOff: boolean;
  /**
   * With `unverifiedOff`: the member the server's record names, when there is
   * one (e.g. signed on their new device whose security code isn't accepted
   * here yet). Null when there is no record at all.
   */
  unverifiedOffBy?: string | null;
}

const resolutions = new Map<string, { channelId: string | null; serverE2ee: boolean; trust: string; value: Promise<ConversationEncryption> }>();

/** Trust / local state this answer depends on: accepting a security code or confirming an "off" re-checks at once. */
function trustToken(): string {
  const snap = getE2eeSnapshot();
  return `${snap.pinsVersion}|${snap.conversationsVersion}`;
}

/** Forget cached answers for a conversation (live on / off events). */
export function forgetConversationEncryption(userId: string | null | undefined, target: E2eeTarget | null): void {
  if (!userId || !target) return;
  resolutions.delete(`${userId.toLowerCase()}|${conversationKey(target)}`);
}

/**
 * Downgrade protection with member-controlled "off": a conversation the
 * server flags encrypted is encrypted (and remembered); one this device saw
 * encrypted stays encrypted unless a member's signed "turned off" record
 * verifies here (lib/e2ee/conversationState.ts); a storage error counts as
 * encrypted. `meta` null (not loaded yet) never downgrades.
 */
export function conversationEncryptionHere(userId: string | null | undefined, target: E2eeTarget | null, meta: ConversationMeta | null): Promise<ConversationEncryption> {
  if (!userId || !target) return Promise.resolve({ encrypted: false, off: null, unverifiedOff: false });
  const key = `${userId.toLowerCase()}|${conversationKey(target)}`;
  if (meta?.e2ee) {
    resolutions.delete(key);
    return Promise.resolve({ encrypted: true, off: null, unverifiedOff: false });
  }
  const channelId = meta?.channelId ?? null;
  const trust = trustToken();
  const cached = resolutions.get(key);
  if (cached && cached.channelId === channelId && cached.serverE2ee === Boolean(meta?.e2ee) && cached.trust === trust) return cached.value;
  const value = resolveEncryption(userId, target, meta).catch((): ConversationEncryption => ({ encrypted: true, off: null, unverifiedOff: false }));
  resolutions.set(key, { channelId, serverE2ee: Boolean(meta?.e2ee), trust, value });
  // Only "stay encrypted" answers outlive the request (never a downgrade: an
  // "off" is re-checked against the current memory every time, which is a
  // local read once accepted). "Unknown yet" (no meta) is retried at once,
  // an unverifiable "off" after 30 s.
  void value.then((r) => {
    if (resolutions.get(key)?.value !== value) return;
    if (!r.encrypted || !meta) resolutions.delete(key);
    else setTimeout(() => {
      if (resolutions.get(key)?.value === value) resolutions.delete(key);
    }, 30_000);
  });
  return value;
}

async function resolveEncryption(userId: string, target: E2eeTarget, meta: ConversationMeta | null): Promise<ConversationEncryption> {
  const remembered = await isRememberedEncrypted(userId, target).catch(() => true);
  if (!remembered) {
    const memory = await getConversationStateMemory(userId, conversationKey(target)).catch(() => null);
    return { encrypted: false, off: memory?.off ? { by: memory.off.by, at: memory.off.ts } : null, unverifiedOff: false };
  }
  if (!meta?.channelId) return { encrypted: true, off: null, unverifiedOff: false };
  const session = await loadE2eeSession();
  const check = await session.verifyConversationOff(target, meta.channelId);
  if (check.ok) return { encrypted: false, off: { by: check.record.userId, at: check.record.ts }, unverifiedOff: false };
  const unverifiedOff = check.reason !== "keys_unavailable" && check.reason !== "not_ready";
  return { encrypted: true, off: null, unverifiedOff, unverifiedOffBy: unverifiedOff ? check.by ?? null : null };
}

/** A raw API / SSE message still carrying its envelope (not yet decrypted). */
export function hasEnvelope(raw: RawMessagePayload | null | undefined): boolean {
  const e = raw?.e2ee;
  return Boolean(e && typeof e === "object" && !("status" in e));
}

/**
 * Which channel an encrypted page's rows must belong to (the URL's group, or
 * the DM channel checked against the URL's person). A 1:1 DM whose facts
 * haven't loaded yet (a live message right after opening it) uses the rows'
 * own channel: it is checked against the URL's person exactly like the one
 * the page fetch reports, so a message that arrives first still decrypts.
 */
export function decryptContextFor(target: E2eeTarget | null, meta: ConversationMeta | null, rows?: ReadonlyArray<{ channelId?: unknown } | null | undefined>): DecryptContext {
  if (!target) return { channelId: meta?.channelId ?? null };
  if (target.kind === "group") return { channelId: target.channelId, group: true };
  return { channelId: meta?.channelId ?? soleChannelOf(rows), dmPeer: target.recipientId };
}

/** The one channel every row names (null when none does or they differ). */
function soleChannelOf(rows?: ReadonlyArray<{ channelId?: unknown } | null | undefined>): string | null {
  let found: string | null = null;
  for (const r of rows ?? []) {
    const id = typeof r?.channelId === "string" && r.channelId ? r.channelId.toLowerCase() : null;
    if (!id) continue;
    if (found && found !== id) return null;
    found = id;
  }
  return found;
}

type PendingLike = { id: string; channelId?: string; authorId?: string; e2ee?: { status?: string; envelope?: unknown } };

function pendingEnvelopeSig(m: PendingLike): string | null {
  if (m.e2ee?.status !== "pending") return null;
  const sig = (m.e2ee.envelope as { sig?: unknown } | null | undefined)?.sig;
  return typeof sig === "string" ? sig : null;
}

/** Whether a cached list still has envelope-only placeholders (from the localStorage message cache). */
export function hasPendingPlaceholders(messages: PendingLike[]): boolean {
  return messages.some((m) => pendingEnvelopeSig(m) !== null);
}

/**
 * Fill envelope-only placeholders from the in-memory decrypted cache,
 * synchronously (first paint of a conversation this tab already decrypted
 * and checked). Only rows of the conversation's validated channel (the URL's
 * group; for a 1:1 DM the channel last checked to be exactly us + them);
 * memory entries are dropped whenever trust changes, and only results that
 * passed the URL allowlist are ever cached. Returns the same array when
 * nothing was filled.
 */
export function hydrateFromMemory<M extends PendingLike>(messages: M[], selfId: string | null | undefined, target: E2eeTarget | null): M[] {
  if (!selfId || !target) return messages;
  const channelId = target.kind === "group" ? target.channelId.toLowerCase() : validatedChannelOf(conversationKey(target));
  if (!channelId) return messages;
  let changed = false;
  const next = messages.map((m) => {
    const sig = pendingEnvelopeSig(m);
    if (!sig || !m.channelId || !m.authorId || m.channelId.toLowerCase() !== channelId) return m;
    // Runs during render: read without reordering the LRU.
    const hit = peekPlain(selfId, plainCacheKey(channelId, m.id, sig, m.authorId), false);
    if (!hit) return m;
    changed = true;
    return applyPayload(m as unknown as Record<string, unknown>, hit.payload, hit.verified, m.e2ee!.envelope, channelId) as unknown as M;
  });
  return changed ? next : messages;
}

/** The channel id sends / edits are encrypted for (never a server-supplied id for groups). */
export function encryptChannelIdFor(target: E2eeTarget | null, meta: ConversationMeta | null): string | null {
  if (target?.kind === "group") return target.channelId;
  return meta?.channelId ?? null;
}

// On / off switches seen per conversation (memory only): plain rows from the
// plain era before encryption was first turned on, or from a period a
// member turned it off (verified record), are legitimate history.
const timelines = new Map<string, EncryptionTimeline>();

type NoticeRow = { id?: unknown; type?: unknown; e2ee?: unknown; createdAt?: unknown; e2eeRecord?: unknown; channelId?: unknown; e2eeNoticeVerified?: unknown };

/**
 * "Turned off" notice rows: mark each with whether its member-signed record
 * verifies here (the system row says so), and return the signed time of the
 * verified ones. A row whose server time is more than the clock skew away
 * from its record's time is ignored, and each record counts once.
 */
async function checkOffNotices(rows: RawMessagePayload[], target: E2eeTarget | null, meta: ConversationMeta | null): Promise<{ rows: RawMessagePayload[]; offAt: Map<unknown, number> }> {
  const offAt = new Map<unknown, number>();
  const typed = rows as unknown as NoticeRow[];
  if (!target || !typed.some((r) => r?.type === "e2ee_disabled")) return { rows, offAt };
  const session = await loadE2eeSession();
  const seen = new Set<string>();
  const out = await Promise.all(typed.map(async (r, i) => {
    if (r?.type !== "e2ee_disabled") return rows[i];
    const channelId = typeof r.channelId === "string" ? r.channelId : meta?.channelId ?? null;
    const record = channelId ? await session.verifiedOffNotice(target, channelId, r.e2eeRecord).catch(() => null) : null;
    const ok = Boolean(record && noticeTimeMatches(rowTime(r.createdAt), record));
    if (ok && record && !seen.has(record.sig)) {
      seen.add(record.sig);
      offAt.set(r, record.ts);
    }
    return { ...rows[i], e2eeNoticeVerified: ok } as RawMessagePayload;
  }));
  return { rows: out, offAt };
}

/** Mark rows without an envelope in an encrypted conversation: nobody vouches for their sender. */
async function flagPlaintextRows(
  rows: RawMessagePayload[],
  target: E2eeTarget | null,
  offAt: Map<unknown, number>,
  selfId: string | null | undefined,
): Promise<RawMessagePayload[]> {
  const key = target ? conversationKey(target) : null;
  const original = rows as unknown as NoticeRow[];
  const batch = timelineOf(original, (r) => offAt.get(r) ?? null);
  let timeline = key ? mergeTimelines(timelines.get(key) ?? { on: [], off: [] }, batch) : batch;
  if (key) timelines.set(key, timeline);
  // An off window also ends where this device itself last saw the conversation
  // encrypted (a replayed "turned off" notice can't cover later plaintext).
  if (selfId && key && timeline.off.length > 0) {
    const memory = await getConversationStateMemory(selfId, key).catch(() => null);
    const seenAt = memory?.seenEncryptedAt ?? null;
    if (seenAt !== null && timeline.off.some((t) => t < seenAt)) timeline = mergeTimelines(timeline, { on: [seenAt], off: [] });
  }
  return rows.map((r) => (
    isUnverifiablePlaintextRowIn(r as { type?: unknown; e2ee?: unknown; createdAt?: unknown }, timeline)
      ? ({ ...r, e2eePlaintext: true } as RawMessagePayload)
      : r
  ));
}

export interface DecodeOptions {
  /** What the page opened (from the URL). */
  target: E2eeTarget | null;
  /** Conversation facts from the server (channel id, flag). */
  meta: ConversationMeta | null;
  /** The conversation is encrypted (server flag, or remembered on this device). */
  encrypted: boolean;
  /** The signed-in user (starts E2EE at once if it hasn't started). */
  selfId?: string | null;
  /** Rows that just arrived live (not in any cache yet). */
  live?: boolean;
  /** The member key set the server sent with the page (`e2eeKeys`). */
  pageKeys?: unknown;
}

/**
 * Prepare a raw DM / group DM page for the chat: flag plaintext rows of an
 * encrypted conversation and decrypt envelopes (bound to the open
 * conversation). No crypto import when there are no envelopes.
 */
export async function decodeConversationRows(raw: RawMessagePayload[], opts: DecodeOptions): Promise<RawMessagePayload[]> {
  const notices = await checkOffNotices(raw, opts.target, opts.meta);
  const rows = opts.encrypted ? await flagPlaintextRows(raw, opts.target, notices.offAt, opts.selfId).then((flagged) =>
    flagged.map((r, i) => (notices.rows[i] !== raw[i] ? { ...r, e2eeNoticeVerified: (notices.rows[i] as { e2eeNoticeVerified?: boolean }).e2eeNoticeVerified } as RawMessagePayload : r))) : notices.rows;
  if (!rows.some(hasEnvelope)) return rows;
  const session = await loadE2eeSession();
  return session.decryptRawMessages(rows as Array<Record<string, unknown>>, {
    ...decryptContextFor(opts.target, opts.meta, rows as Array<{ channelId?: unknown }>),
    selfId: opts.selfId ?? null,
    live: opts.live === true,
    pageKeys: opts.pageKeys,
  });
}

/** The key set a DM / group DM page carries (`e2eeKeys`), if any. */
export function pageKeysOf(data: unknown): unknown {
  const d = data as { e2eeKeys?: unknown } | null;
  return d && typeof d === "object" && !Array.isArray(d) ? d.e2eeKeys : undefined;
}

/**
 * Decrypt failed messages again (automatic retries, "Try again"): each row is
 * rebuilt from the envelope and stored blobs it kept. `fresh` (Try again)
 * first forgets what is remembered about them and reloads the keys from the
 * server. Returns the rows as decryptRawMessages leaves them (callers count
 * the attempts: lib/e2ee/decryptRetry stateAfterRetry).
 */
export async function retryDecryptRows<M extends { id: string; channelId?: string; authorId?: string; e2ee?: unknown }>(
  messages: M[],
  opts: { target: E2eeTarget | null; meta: ConversationMeta | null; selfId?: string | null; fresh?: boolean },
): Promise<Array<Record<string, unknown>>> {
  const rows = messages.map((m) => rawRowForRetry(m as Parameters<typeof rawRowForRetry>[0])).filter((r): r is Record<string, unknown> => r !== null);
  if (rows.length === 0) return [];
  const session = await loadE2eeSession();
  const ctx = decryptContextFor(opts.target, opts.meta, rows as Array<{ channelId?: unknown }>);
  if (opts.fresh) await session.prepareDecryptRetry(ctx.channelId, rows as Array<{ id: string; authorId?: string }>);
  return session.decryptRawMessages(rows, { ...ctx, selfId: opts.selfId ?? null });
}

/** Conversation facts the DM / group DM message endpoints return with a page. */
export interface ConversationMeta {
  channelId: string | null;
  e2ee: boolean;
  /** Started plain because someone had no keys: turn on once everyone has them. */
  e2eeAuto: boolean;
}

export function conversationMetaOf(data: unknown): ConversationMeta | null {
  const d = data as { channelId?: unknown; e2ee?: unknown; e2eeAuto?: unknown } | null;
  if (!d || Array.isArray(d) || typeof d !== "object" || typeof d.channelId !== "string") return null;
  return { channelId: d.channelId, e2ee: d.e2ee === true, e2eeAuto: d.e2eeAuto === true };
}

/** What an encrypted upload returns (MessageBar.uploadAttachments with encryptFile). */
export interface EncryptedAttachmentUpload {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  spoiler?: boolean;
  e2ee?: { key: string; iv: string; sha256: string };
  original?: { name: string; type: string; size: number };
}

/** The attachment as the chat renders it (real name / type, decryption keys). */
export function attachmentViewOf(a: EncryptedAttachmentUpload): MessageAttachment {
  return {
    id: a.id,
    url: a.url,
    filename: a.original?.name ?? a.filename,
    contentType: a.original?.type || "application/octet-stream",
    size: a.original?.size ?? a.size,
    ...(a.spoiler ? { spoiler: true } : {}),
    ...(a.e2ee ? { e2ee: a.e2ee } : {}),
  };
}

/**
 * The POST body of an encrypted send: content, files (with their keys), the
 * sticker and a reply snippet go inside the envelope; only opaque blob facts
 * travel in the clear.
 */
export async function buildEncryptedSendBody(opts: {
  channelId: string;
  /** What the page opened, and (groups) the members it shows: only they get keys. */
  target: E2eeTarget;
  memberIds?: string[] | null;
  content: string;
  attachments: EncryptedAttachmentUpload[];
  sticker?: MessageSticker;
  reply?: { id: string; content?: string } | null;
  selfId?: string | null;
  /** Retry after the server said the key set changed: load it from the server first. */
  freshKeys?: boolean;
}): Promise<Record<string, unknown>> {
  const session = await loadE2eeSession();
  const files = opts.attachments.filter((a) => a.e2ee && a.original);
  const { envelope, keysVersion } = await session.encryptForChannel(opts.channelId, {
    v: 1,
    content: opts.content,
    ts: Date.now(),
    ...(files.length
      ? {
          attachments: files.map((a) => ({
            id: a.id,
            url: a.url,
            name: a.original!.name,
            type: a.original!.type,
            size: a.original!.size,
            key: a.e2ee!.key,
            iv: a.e2ee!.iv,
            sha256: a.e2ee!.sha256,
            ...(a.spoiler ? { spoiler: true } : {}),
          })),
        }
      : {}),
    ...(opts.sticker ? { sticker: opts.sticker } : {}),
    ...(opts.reply ? { replyPreview: { id: opts.reply.id.toLowerCase(), content: (opts.reply.content ?? "").slice(0, 200) } } : {}),
  }, opts.target, opts.memberIds, { selfId: opts.selfId, freshKeys: opts.freshKeys });
  return {
    content: "",
    e2ee: envelope,
    ...(keysVersion ? { e2eeKeys: keysVersion } : {}),
    ...(files.length
      ? {
          attachments: files.map((a) => ({
            id: a.id,
            url: a.url,
            filename: a.filename,
            contentType: "application/octet-stream",
            ...(typeof a.size === "number" ? { size: a.size } : {}),
          })),
        }
      : {}),
  };
}

/** The PATCH body of an encrypted edit: the whole payload again, bound to the message id. */
export async function buildEncryptedEditBody(
  channelId: string,
  message: ChatMessage,
  content: string,
  target: E2eeTarget,
  memberIds?: string[] | null,
  selfId?: string | null,
): Promise<Record<string, unknown>> {
  const session = await loadE2eeSession();
  const files = (message.attachments ?? []).filter((a) => a.e2ee);
  const { envelope } = await session.encryptForChannel(channelId, {
    v: 1,
    content,
    ts: Date.now(),
    mid: message.id.toLowerCase(),
    ...(files.length
      ? {
          attachments: files.map((a) => ({
            id: a.id,
            url: a.url,
            name: a.filename,
            type: a.contentType,
            size: a.size ?? 0,
            key: a.e2ee!.key,
            iv: a.e2ee!.iv,
            sha256: a.e2ee!.sha256,
            ...(a.spoiler ? { spoiler: true } : {}),
          })),
        }
      : {}),
    ...(message.sticker ? { sticker: message.sticker } : {}),
    ...(message.referencedMessage
      ? { replyPreview: { id: message.referencedMessage.id.toLowerCase(), content: (message.referencedMessage.content ?? "").slice(0, 200) } }
      : {}),
  }, target, memberIds, { selfId });
  return { content: "", e2ee: envelope };
}
