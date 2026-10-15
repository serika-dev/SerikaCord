// Preview text of a decrypted message (in-app / desktop notifications, the DM
// list). Pure and crypto-free. The server never sees this text: it is built
// on the device right after decrypting (session.decryptForPreview).
import { renderMentionText, type MentionNames } from "@/lib/chat/mentionText";

export interface EncryptedPreviewParts {
  /** Decrypted content (raw markup: mentions, spoilers; never HTML-escaped). */
  text: string;
  /** Number of files in the payload. */
  attachments: number;
  sticker: boolean;
}

/** Translated labels (the caller passes gt() results). */
export interface EncryptedPreviewLabels {
  attachment: string;
  sticker: string;
  /** Replaces spoiler text (`||…||`). */
  spoiler: string;
}

const SPOILER_RE = /\|\|[\s\S]+?\|\|/g;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  // Never cut an emoji (surrogate pair) in half.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/**
 * One line of preview: mentions as names ("@Alice"; unknown ids stay
 * generic), spoilers hidden, whitespace collapsed; a message without text
 * shows its file / sticker label. Empty only when there is nothing at all.
 */
export function encryptedPreviewText(
  parts: EncryptedPreviewParts,
  labels: EncryptedPreviewLabels,
  opts: { names?: MentionNames | null; max?: number } = {},
): string {
  const max = Math.max(8, opts.max ?? 140);
  const text = renderMentionText(parts.text.replace(SPOILER_RE, labels.spoiler), opts.names)
    .replace(/\s+/g, " ")
    .trim();
  if (text) return clip(text, max);
  if (parts.attachments > 0) return clip(labels.attachment, max);
  if (parts.sticker) return clip(labels.sticker, max);
  return "";
}

const lower = (s: string) => s.toLowerCase();

/**
 * Whether decrypted content mentions `userId` (`<@id>` / `<@!id>`, spoilers
 * included). The server can't see mentions inside encrypted messages, so the
 * device that decrypted one decides.
 */
export function mentionsUser(content: string, userId: string | null | undefined): boolean {
  if (!content || !userId) return false;
  const id = lower(userId);
  for (const m of content.matchAll(/<@!?([0-9a-fA-F-]{36})>/g)) {
    if (lower(m[1]) === id) return true;
  }
  return false;
}
