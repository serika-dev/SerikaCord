// The plaintext inside an envelope (v1). Validated strictly on both ends: the
// sender before encrypting, recipients and the franking verifier after
// decrypting. Unknown fields are dropped.
import { AES_KEY_BYTES, E2EE_VERSION, GCM_IV_BYTES, LIMITS, SHA256_BYTES, UUID_RE } from "./constants";
import { E2eeFormatError, b64ByteLength, isBase64 } from "./encoding";

export interface PayloadAttachment {
  /** Id of the uploaded ciphertext blob (server attachment id). */
  id: string;
  /** CDN URL of the ciphertext blob. */
  url: string;
  /** Real file name, MIME type and size (hidden from the server). */
  name: string;
  type: string;
  size: number;
  /** AES-256-GCM key + iv of the blob, and SHA-256 of the plaintext file. */
  key: string;
  iv: string;
  sha256: string;
  spoiler?: boolean;
  /** Voice message metadata. */
  durationSecs?: number;
  waveform?: string;
}

export interface PayloadSticker {
  id: string;
  name: string;
  imageUrl: string;
  serverId?: string;
  serverName?: string;
}

export interface MessagePayload {
  v: typeof E2EE_VERSION;
  content: string;
  attachments?: PayloadAttachment[];
  /** Snippet of the replied-to message (its own envelope may not be loaded). */
  replyPreview?: { id: string; content: string };
  sticker?: PayloadSticker;
  /** Sender clock (ms). */
  ts: number;
  /** Edits: the id of the message this envelope replaces. */
  mid?: string;
}

const MAX_CONTENT = 4000;
const MAX_REPLY_PREVIEW = 200;

function str(value: unknown, max: number, what: string, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof value !== "string") throw new E2eeFormatError(`${what} must be a string`);
  if (value.length > max) throw new E2eeFormatError(`${what} is too long`);
  if (!opts.allowEmpty && value.length === 0) throw new E2eeFormatError(`${what} is empty`);
  return value;
}

function b64Sized(value: unknown, bytes: number, what: string): string {
  if (!isBase64(value) || b64ByteLength(value) !== bytes) throw new E2eeFormatError(`Bad ${what}`);
  return value;
}

function httpsUrl(value: unknown, what: string): string {
  const s = str(value, 2048, what);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new E2eeFormatError(`Bad ${what}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new E2eeFormatError(`Bad ${what}`);
  return s;
}

function attachment(raw: unknown): PayloadAttachment {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new E2eeFormatError("Bad attachment");
  const size = a.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new E2eeFormatError("Bad attachment size");
  const out: PayloadAttachment = {
    id: str(a.id, 64, "Attachment id"),
    url: httpsUrl(a.url, "attachment url"),
    name: str(a.name, 255, "File name"),
    type: str(a.type, 255, "File type", { allowEmpty: true }),
    size,
    key: b64Sized(a.key, AES_KEY_BYTES, "attachment key"),
    iv: b64Sized(a.iv, GCM_IV_BYTES, "attachment iv"),
    sha256: b64Sized(a.sha256, SHA256_BYTES, "attachment hash"),
  };
  if (a.spoiler === true) out.spoiler = true;
  if (a.durationSecs !== undefined) {
    if (typeof a.durationSecs !== "number" || !Number.isFinite(a.durationSecs) || a.durationSecs < 0 || a.durationSecs > 86_400) {
      throw new E2eeFormatError("Bad voice duration");
    }
    out.durationSecs = a.durationSecs;
  }
  if (a.waveform !== undefined) out.waveform = str(a.waveform, 400, "Waveform");
  return out;
}

/** Validate (and normalise) a decrypted or to-be-encrypted payload. */
export function validatePayload(input: unknown): MessagePayload {
  const p = input as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new E2eeFormatError("Payload must be an object");
  if (p.v !== E2EE_VERSION) throw new E2eeFormatError("Unsupported payload version");
  if (typeof p.ts !== "number" || !Number.isSafeInteger(p.ts) || p.ts < 0) throw new E2eeFormatError("Bad timestamp");
  const out: MessagePayload = { v: E2EE_VERSION, content: str(p.content, MAX_CONTENT, "Content", { allowEmpty: true }), ts: p.ts };
  if (p.attachments !== undefined) {
    if (!Array.isArray(p.attachments) || p.attachments.length > LIMITS.maxAttachments) throw new E2eeFormatError("Bad attachments");
    if (p.attachments.length > 0) out.attachments = p.attachments.map(attachment);
  }
  if (p.replyPreview !== undefined) {
    const r = p.replyPreview as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !UUID_RE.test(r.id)) throw new E2eeFormatError("Bad reply preview");
    out.replyPreview = { id: r.id, content: str(r.content, MAX_REPLY_PREVIEW, "Reply preview", { allowEmpty: true }) };
  }
  if (p.sticker !== undefined) {
    const s = p.sticker as Record<string, unknown> | null;
    if (!s || typeof s !== "object") throw new E2eeFormatError("Bad sticker");
    out.sticker = {
      id: str(s.id, 64, "Sticker id"),
      name: str(s.name, 100, "Sticker name"),
      imageUrl: httpsUrl(s.imageUrl, "sticker url"),
      ...(typeof s.serverId === "string" ? { serverId: str(s.serverId, 64, "Sticker server") } : {}),
      ...(typeof s.serverName === "string" ? { serverName: str(s.serverName, 100, "Sticker server name", { allowEmpty: true }) } : {}),
    };
  }
  if (p.mid !== undefined) {
    if (typeof p.mid !== "string" || !UUID_RE.test(p.mid)) throw new E2eeFormatError("Bad edited message id");
    out.mid = p.mid.toLowerCase();
  }
  if (!out.content && !out.attachments?.length && !out.sticker) throw new E2eeFormatError("Empty message");
  return out;
}
