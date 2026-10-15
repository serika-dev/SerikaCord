"use client";

// Light glue between the shared chat engine (useChatSession) and the lazily
// loaded E2EE session: nothing here pulls in the crypto module until a
// conversation actually has encrypted messages.
import type { ChatMessage, MessageAttachment, MessageSticker } from "@/lib/chat/types";
import type { RawMessagePayload } from "@/lib/chat/messages";
import {
  conversationKey,
  encryptionNoticeTime,
  isUnverifiablePlaintextRow,
  type E2eeTarget,
} from "@/lib/e2ee/conversation";
import { isConversationRememberedEncrypted, rememberConversationEncrypted } from "./keyStore";
import { loadE2eeSession } from "./state";
import type { DecryptContext } from "./session";

/**
 * Whether this device has seen the conversation encrypted (downgrade
 * protection, keyed by what the user opened, never by a server channel id).
 * Rejects when storage fails: callers treat that as encrypted (fail closed).
 */
export function isRememberedEncrypted(userId: string, target: E2eeTarget): Promise<boolean> {
  return isConversationRememberedEncrypted(userId, conversationKey(target));
}

/** Remember the conversation as encrypted on this device (one-way). */
export function rememberEncrypted(userId: string, target: E2eeTarget): Promise<void> {
  return rememberConversationEncrypted(userId, conversationKey(target));
}

/** A raw API / SSE message still carrying its envelope (not yet decrypted). */
export function hasEnvelope(raw: RawMessagePayload | null | undefined): boolean {
  const e = raw?.e2ee;
  return Boolean(e && typeof e === "object" && !("status" in e));
}

/** Which channel an encrypted page's rows must belong to (the URL's group, or the DM channel checked against the URL's person). */
export function decryptContextFor(target: E2eeTarget | null, meta: ConversationMeta | null): DecryptContext {
  if (!target) return { channelId: meta?.channelId ?? null };
  if (target.kind === "group") return { channelId: target.channelId };
  return { channelId: meta?.channelId ?? null, dmPeer: target.recipientId };
}

/** The channel id sends / edits are encrypted for (never a server-supplied id for groups). */
export function encryptChannelIdFor(target: E2eeTarget | null, meta: ConversationMeta | null): string | null {
  if (target?.kind === "group") return target.channelId;
  return meta?.channelId ?? null;
}

// Earliest "turned on encryption" notice seen per conversation (memory only):
// plain rows before it are legitimate history.
const encryptedSince = new Map<string, number>();

/** Mark rows without an envelope in an encrypted conversation: nobody vouches for their sender. */
function flagPlaintextRows(rows: RawMessagePayload[], target: E2eeTarget | null): RawMessagePayload[] {
  const key = target ? conversationKey(target) : null;
  const notice = encryptionNoticeTime(rows as Array<{ type?: unknown; e2ee?: unknown; createdAt?: unknown }>);
  if (key && notice !== null) {
    const prev = encryptedSince.get(key);
    if (prev === undefined || notice < prev) encryptedSince.set(key, notice);
  }
  const since = key ? encryptedSince.get(key) ?? null : notice;
  return rows.map((r) => (
    isUnverifiablePlaintextRow(r as { type?: unknown; e2ee?: unknown; createdAt?: unknown }, since)
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
}

/**
 * Prepare a raw DM / group DM page for the chat: flag plaintext rows of an
 * encrypted conversation and decrypt envelopes (bound to the open
 * conversation). No crypto import when there are no envelopes.
 */
export async function decodeConversationRows(raw: RawMessagePayload[], opts: DecodeOptions): Promise<RawMessagePayload[]> {
  const rows = opts.encrypted ? flagPlaintextRows(raw, opts.target) : raw;
  if (!rows.some(hasEnvelope)) return rows;
  const session = await loadE2eeSession();
  return session.decryptRawMessages(rows as Array<Record<string, unknown>>, decryptContextFor(opts.target, opts.meta));
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
}): Promise<Record<string, unknown>> {
  const session = await loadE2eeSession();
  const files = opts.attachments.filter((a) => a.e2ee && a.original);
  const envelope = await session.encryptForChannel(opts.channelId, {
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
  }, opts.target, opts.memberIds);
  return {
    content: "",
    e2ee: envelope,
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
): Promise<Record<string, unknown>> {
  const session = await loadE2eeSession();
  const files = (message.attachments ?? []).filter((a) => a.e2ee);
  const envelope = await session.encryptForChannel(channelId, {
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
  }, target, memberIds);
  return { content: "", e2ee: envelope };
}
