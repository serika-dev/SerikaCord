"use client";

// Light glue between the shared chat engine (useChatSession) and the lazily
// loaded E2EE session: nothing here pulls in the crypto module until a
// conversation actually has encrypted messages.
import type { ChatMessage, MessageAttachment, MessageSticker } from "@/lib/chat/types";
import type { RawMessagePayload } from "@/lib/chat/messages";
import { loadE2eeSession } from "./state";

/** A raw API / SSE message still carrying its envelope (not yet decrypted). */
export function hasEnvelope(raw: RawMessagePayload | null | undefined): boolean {
  const e = raw?.e2ee;
  return Boolean(e && typeof e === "object" && !("status" in e));
}

/** Decrypt the envelopes in a raw page (no-op, no import, when there are none). */
export async function decryptIfNeeded(raw: RawMessagePayload[], channelId?: string | null): Promise<RawMessagePayload[]> {
  if (!raw.some(hasEnvelope)) return raw;
  const session = await loadE2eeSession();
  return session.decryptRawMessages(raw as Array<Record<string, unknown>>, channelId ?? null);
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
  });
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
export async function buildEncryptedEditBody(channelId: string, message: ChatMessage, content: string): Promise<Record<string, unknown>> {
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
  });
  return { content: "", e2ee: envelope };
}
