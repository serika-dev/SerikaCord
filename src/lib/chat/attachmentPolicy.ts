/**
 * Server-side check for message attachments sent by a user client.
 *
 * Attachments arrive as free-form JSON on the send routes, but the only
 * legitimate source is our own upload endpoint (`POST /api/upload/attachment`),
 * which stores files at `<CDN>/attachments/[<channelId>/]<userId>/<file>`.
 * Anything else (a foreign host, another user's upload path, an odd content
 * type) would render as a first-party file card, so it is rejected.
 */

export interface IncomingAttachment {
  id: string;
  filename: string;
  contentType: string;
  url: string;
  size?: number;
  width?: number;
  height?: number;
  spoiler?: boolean;
  /** Alt text (bot API `attachments[].description`). */
  description?: string;
  /** Voice messages only (see lib/chat/voiceMessage). */
  durationSecs?: number;
  waveform?: string;
}

// Generous: the composer allows 10 (Serika+ tiers up to 25).
export const MAX_ATTACHMENTS_PER_MESSAGE = 25;
const MAX_FILENAME_LENGTH = 255;
// type/subtype with optional parameters. Browsers send '' for unknown types.
const CONTENT_TYPE_RE = /^(?:[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:\s*;[^\r\n<>]{0,200})?)?$/i;

/** Returns an error string, or null when every attachment is acceptable. */
export function validateMessageAttachments(
  attachments: IncomingAttachment[] | undefined,
  opts: { cdnUrl: string; userId: string },
): string | null {
  if (!attachments || attachments.length === 0) return null;
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) return 'Too many attachments';

  let cdn: URL;
  try {
    cdn = new URL(opts.cdnUrl);
  } catch {
    return 'Attachments are not available';
  }
  const basePath = `${cdn.pathname.replace(/\/+$/, '')}/attachments/`;
  const userId = opts.userId.toLowerCase();

  for (const att of attachments) {
    if (!att || typeof att.url !== 'string') return 'Invalid attachment';
    let url: URL;
    try {
      url = new URL(att.url);
    } catch {
      return 'Invalid attachment URL';
    }
    if (
      url.protocol !== cdn.protocol ||
      url.host !== cdn.host ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(basePath)
    ) {
      return 'Attachments must be uploaded to SerikaCord first';
    }
    // The upload key always contains the uploader's id as a path segment.
    const segments = url.pathname.slice(basePath.length).split('/').map((s) => s.toLowerCase());
    if (segments.length < 2 || !segments.slice(0, -1).includes(userId)) {
      return 'Attachments must be uploaded to SerikaCord first';
    }
    if (typeof att.filename !== 'string' || att.filename.length === 0 || att.filename.length > MAX_FILENAME_LENGTH) {
      return 'Invalid attachment filename';
    }
    if (typeof att.contentType !== 'string' || !CONTENT_TYPE_RE.test(att.contentType)) {
      return 'Invalid attachment content type';
    }
    if (att.size !== undefined && (!Number.isFinite(att.size) || att.size < 0)) {
      return 'Invalid attachment size';
    }
  }
  return null;
}

/**
 * Bot API (`POST /api/v10/channels/:id/messages`): turn Discord-shaped
 * `attachments` (`{ url, filename, content_type, size, ... }`) into stored
 * attachments, accepting only files the bot itself uploaded to our CDN — the
 * same ownership rule users get. A bot can no longer make an arbitrary URL
 * render as a native file card; external media belongs in an embed.
 */
export function normalizeBotAttachments(
  raw: unknown,
  opts: { cdnUrl: string; botId: string },
): { attachments: IncomingAttachment[] } | { error: string } {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { error: 'attachments must be an array' };
  const attachments: IncomingAttachment[] = raw.map((item, i) => {
    const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const durationSecs = num(a.durationSecs) ?? num(a.duration_secs);
    const waveform = str(a.waveform);
    return {
      id: str(a.id) ?? String(i),
      filename: str(a.filename) ?? '',
      contentType: str(a.contentType) ?? str(a.content_type) ?? '',
      url: str(a.url) as string,
      ...(num(a.size) !== undefined ? { size: num(a.size) } : {}),
      ...(num(a.width) !== undefined ? { width: num(a.width) } : {}),
      ...(num(a.height) !== undefined ? { height: num(a.height) } : {}),
      ...(a.spoiler === true ? { spoiler: true } : {}),
      ...(durationSecs !== undefined ? { durationSecs } : {}),
      ...(waveform !== undefined ? { waveform } : {}),
    };
  });
  const error = validateMessageAttachments(attachments, { cdnUrl: opts.cdnUrl, userId: opts.botId });
  if (error) {
    return {
      error: error === 'Attachments must be uploaded to SerikaCord first'
        ? 'attachments must be files this bot uploaded to SerikaCord; link external media with an embed instead'
        : error,
    };
  }
  return { attachments };
}
