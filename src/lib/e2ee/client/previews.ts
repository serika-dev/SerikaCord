"use client";

// Previews of end-to-end encrypted messages for in-app / desktop
// notifications and the DM list (stage 2). Crypto-free until used: the
// session module loads lazily on the first encrypted preview. The text is
// decrypted on this device (session.decryptForPreview, every cache reused)
// and never leaves it.
import type { MentionNames } from "@/lib/chat/mentionText";
import { encryptedPreviewText, mentionsUser, type EncryptedPreviewLabels } from "@/lib/e2ee/previewText";
import { isTransientDecryptFailure } from "@/lib/e2ee/decryptRetry";
import { loadE2eeSession } from "./state";

export interface EncryptedPreviewInput {
  id: string;
  channelId: string;
  authorId: string;
  createdAt?: string | Date | null;
  /** The message's envelope, as the server sent it. */
  e2ee: unknown;
}

export interface EncryptedPreview {
  /** One line of preview text (labels for files / stickers when there is no text). */
  text: string;
  /** The decrypted text mentions the signed-in user. */
  mentioned: boolean;
}

/** A notification must not wait long for keys: after this it says "New encrypted message". */
const DEFAULT_TIMEOUT_MS = 4000;
/** Waits before trying a transient failure again (keys unreachable for a moment, …), within the timeout. */
const PREVIEW_RETRY_DELAYS_MS = [400, 1200];

/**
 * Decrypt one encrypted message for a preview. `dmPeer` (1:1 DMs: the other
 * person) makes the channel prove it is exactly the two of you, as when the
 * conversation is opened. Null when it can't be decrypted or verified here
 * (no keys, unknown sender device, timeout…): callers show the generic text.
 */
export async function previewEncryptedMessage(
  msg: EncryptedPreviewInput,
  selfId: string,
  opts: { dmPeer?: string | null; labels: EncryptedPreviewLabels; names?: MentionNames | null; max?: number; timeoutMs?: number },
): Promise<EncryptedPreview | null> {
  if (!msg.e2ee || typeof msg.e2ee !== "object" || !msg.channelId || !msg.authorId || !selfId) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
  let timedOut = false;
  const work = (async () => {
    const session = await loadE2eeSession();
    const attempt = () => session.decryptForPreview(
      { id: msg.id, authorId: msg.authorId, channelId: msg.channelId, createdAt: msg.createdAt ?? undefined, e2ee: msg.e2ee },
      msg.channelId,
      selfId,
      { dmPeer: opts.dmPeer ?? null },
    );
    let r = await attempt();
    // A key fetch that failed once (network, token refresh, rate limit) is
    // never remembered: try again while the preview may still wait.
    for (const delay of PREVIEW_RETRY_DELAYS_MS) {
      if (r.ok || timedOut || !isTransientDecryptFailure(r.reason)) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (timedOut) break;
      r = await attempt();
    }
    if (!r.ok) return null;
    const text = encryptedPreviewText({ text: r.text, attachments: r.attachments, sticker: r.sticker }, opts.labels, { names: opts.names, max: opts.max });
    return text ? { text, mentioned: mentionsUser(r.text, selfId) } : null;
  })().catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    timedOut = true;
    if (timer) clearTimeout(timer);
  }
}
