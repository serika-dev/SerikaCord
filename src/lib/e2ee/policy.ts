// Pure end-to-end encryption policy for the server routes (no DB, no env):
// what an encrypted send/edit body must look like, which conversations take
// envelopes, and how stored rows are recognised. Wrapped by
// src/lib/services/e2ee.ts; unit-tested in tests/e2ee.test.ts.
import { validateMessageAttachments } from '@/lib/chat/attachmentPolicy';
import { ATTACHMENT_BLOB_NAME_RE, ATTACHMENT_BLOB_TYPE } from './constants';
import { E2eeFormatError } from './encoding';
import { validateEnvelope, type Envelope } from './envelope';

export type ChannelLike = { e2ee?: boolean | null };

export function isE2eeChannel(channel: ChannelLike | null | undefined): boolean {
  return channel?.e2ee === true;
}

/** The "turned on encryption" system row marker stored in messages.e2ee. */
export const E2EE_NOTICE = { v: 1, notice: 'enabled' } as const;

export function isE2eeNotice(value: unknown): boolean {
  const v = value as { notice?: unknown } | null;
  return Boolean(v && typeof v === 'object' && v.notice === 'enabled');
}

/** The envelope stored on a message row, if it is a (well-formed) envelope. */
export function storedEnvelope(value: unknown): Envelope | null {
  if (!value || typeof value !== 'object' || isE2eeNotice(value)) return null;
  try {
    return validateEnvelope(value);
  } catch {
    return null;
  }
}

type IncomingAttachment = { id: string; url: string; filename: string; contentType: string; size?: number; spoiler?: boolean };

export type ParsedEncryptedBody =
  | { ok: true; envelope: Envelope; attachments: IncomingAttachment[] }
  | { ok: false; status: number; error: string };

/**
 * Validate an encrypted send/edit body (no DB access): envelope shape and
 * sizes, no plaintext alongside it, and attachments are opaque `e2ee-*.bin`
 * blobs this user uploaded to our CDN.
 */
export function parseEncryptedBody(
  userId: string,
  cdnUrl: string,
  body: { e2ee?: unknown; content?: unknown; sticker?: unknown; attachments?: IncomingAttachment[] },
): ParsedEncryptedBody {
  let envelope: Envelope;
  try {
    envelope = validateEnvelope(body.e2ee);
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof E2eeFormatError ? `Invalid encrypted message: ${err.message}` : 'Invalid encrypted message' };
  }
  if ((typeof body.content === 'string' && body.content.length > 0) || body.sticker) {
    return { ok: false, status: 400, error: 'Encrypted messages carry their content inside the envelope' };
  }
  const attachments = body.attachments ?? [];
  const attachmentError = validateMessageAttachments(attachments, { cdnUrl, userId });
  if (attachmentError) return { ok: false, status: 400, error: attachmentError };
  for (const a of attachments) {
    const name = a.url.split('?')[0].split('/').pop() ?? '';
    if (a.contentType !== ATTACHMENT_BLOB_TYPE || !ATTACHMENT_BLOB_NAME_RE.test(a.filename) || !name.endsWith('.bin')) {
      return { ok: false, status: 400, error: 'Attachments in encrypted conversations must be encrypted' };
    }
  }
  return {
    ok: true,
    envelope,
    // Only the opaque blob facts are stored; the real name/type live in the envelope.
    attachments: attachments.map((a) => ({
      id: a.id,
      url: a.url,
      filename: a.filename,
      contentType: ATTACHMENT_BLOB_TYPE,
      ...(typeof a.size === 'number' ? { size: a.size } : {}),
    })),
  };
}

/** Plaintext sent to an encrypted conversation (or the other way round). */
export function e2eeMismatch(channel: ChannelLike, hasEnvelope: boolean): { status: number; error: string } | null {
  if (isE2eeChannel(channel) && !hasEnvelope) {
    return { status: 400, error: 'This conversation is end-to-end encrypted. Update or reload the app to send messages here.' };
  }
  if (!isE2eeChannel(channel) && hasEnvelope) {
    return { status: 400, error: 'This conversation is not end-to-end encrypted' };
  }
  return null;
}

/** Shown in DM lists / previews for encrypted messages (the server can't read them). */
export const ENCRYPTED_PREVIEW = 'Encrypted message';
