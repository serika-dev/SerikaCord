"use client";

// Turning a decrypted payload into the message the chat renders (crypto-free:
// the chat engine's first paint uses it with the memory cache, before the
// crypto module has loaded). Used by session.decryptRawMessages too.
import type { MessagePayload, PayloadAttachment } from "@/lib/e2ee/payload";
import { decryptedTextOf } from "./plainCache";

const MENTION_RE = /<@!?([0-9a-fA-F-]{36})>/g;

export type RawRef = Record<string, unknown> & { id?: unknown; content?: unknown; encrypted?: unknown; quotedBySender?: unknown };

export function attachmentView(a: PayloadAttachment) {
  return {
    id: a.id,
    url: a.url,
    filename: a.name,
    contentType: a.type || "application/octet-stream",
    size: a.size,
    ...(a.spoiler ? { spoiler: true } : {}),
    ...(a.durationSecs !== undefined ? { durationSecs: a.durationSecs } : {}),
    ...(a.waveform !== undefined ? { waveform: a.waveform } : {}),
    e2ee: { key: a.key, iv: a.iv, sha256: a.sha256 },
  };
}

export function mentionsOf(content: string): string[] {
  return [...new Set([...content.matchAll(MENTION_RE)].map((x) => x[1].toLowerCase()))];
}

/**
 * The renderable message: content, files (with their keys), sticker,
 * mentions and the reply quote come from the payload; `e2ee` becomes a
 * status. A quote of an encrypted message prefers our own decryption of it,
 * otherwise the sender's snippet labelled as theirs.
 */
export function applyPayload<T extends Record<string, unknown>>(
  item: T,
  payload: MessagePayload,
  verified: boolean,
  envelope: unknown,
  /** The (validated) conversation channel: reply quotes only use our text from it. */
  channelId: string,
): T {
  const ref = item.referencedMessage as RawRef | null | undefined;
  let referencedMessage: RawRef | null | undefined = ref;
  if (ref && ref.encrypted && ref.id !== undefined) {
    const refId = String(ref.id).toLowerCase();
    const local = decryptedTextOf(channelId, refId);
    if (local !== undefined) referencedMessage = { ...ref, content: local, quotedBySender: false };
    else if (payload.replyPreview && payload.replyPreview.id === refId) referencedMessage = { ...ref, content: payload.replyPreview.content, quotedBySender: true };
  }
  return {
    ...item,
    content: payload.content,
    attachments: (payload.attachments ?? []).map(attachmentView),
    sticker: payload.sticker,
    mentionedUserIds: mentionsOf(payload.content),
    ...(referencedMessage !== ref ? { referencedMessage } : {}),
    e2ee: { status: "ok", verified, envelope },
  } as T;
}
