/**
 * What the server really stored for each chat attachment upload, so a send
 * can't relabel it.
 *
 * The upload routes (storeChatAttachment / chunked complete in
 * src/lib/api/uploads.ts) record `{ uploaderId, filename, contentType, size,
 * width?, height? }` per storage key in Redis for a day (long enough for a
 * draft). The send routes call resolveAttachmentMetadata after the ownership
 * check (validateMessageAttachments), which swaps the body's values for the
 * record (applyAttachmentTruth in src/lib/chat/attachmentPolicy.ts).
 *
 * No record (uploaded before records existed, expired, or Redis was down):
 * the object's own bucket metadata (HEAD: stored type, real size, upload
 * name) is used instead, and when that fails too the client's values are
 * clamped (type must fit the stored key's extension, the shown name ends in
 * the real extension). Never throws: a lookup failure only means the
 * stricter fallback.
 */
import { config } from '@/lib/config';
import { getRedis } from '@/lib/db/redis';
import { keyFromUrl, storage } from '@/lib/services/storage';
import {
  applyAttachmentTruth,
  parseAttachmentRecord,
  type AttachmentRecord,
  type AttachmentTruth,
  type IncomingAttachment,
} from '@/lib/chat/attachmentPolicy';

export const ATTACHMENT_RECORD_TTL_SECONDS = 24 * 60 * 60;
const REDIS_TIMEOUT_MS = 1500;
const HEAD_TIMEOUT_MS = 2500;

export const attachmentRecordKey = (storageKey: string) => `upload:attachment:${storageKey}`;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Record an upload under its storage key (best effort; never throws). */
export async function recordStoredAttachment(url: string, record: AttachmentRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await withTimeout(
    redis.set(attachmentRecordKey(keyFromUrl(url)), JSON.stringify(record), 'EX', ATTACHMENT_RECORD_TTL_SECONDS).then(() => undefined),
    REDIS_TIMEOUT_MS,
    undefined,
  );
}

async function storageTruth(storageKey: string): Promise<AttachmentTruth> {
  const controller = new AbortController();
  const meta = await withTimeout(
    storage.getMetadata(storageKey, { abortSignal: controller.signal }),
    HEAD_TIMEOUT_MS,
    null,
  );
  if (!meta) {
    controller.abort();
    return { source: 'none' };
  }
  return { source: 'storage', contentType: meta.contentType, size: meta.size, filename: meta.originalFilename };
}

/**
 * The attachments with their name, type, size and dimensions taken from what
 * the server stored (see the module comment). Call after
 * validateMessageAttachments has checked they are `uploaderId`'s uploads.
 */
export async function resolveAttachmentMetadata<A extends IncomingAttachment>(
  attachments: readonly A[] | undefined,
  opts: { uploaderId: string },
): Promise<A[]> {
  if (!attachments || attachments.length === 0) return [];
  const keys = attachments.map((a) => keyFromUrl(a.url));
  const redis = getRedis();
  const raw: (string | null)[] = redis
    ? await withTimeout(redis.mget(...keys.map(attachmentRecordKey)), REDIS_TIMEOUT_MS, keys.map(() => null))
    : keys.map(() => null);
  const uploader = opts.uploaderId.toLowerCase();
  const truths = await Promise.all(keys.map(async (key, i): Promise<AttachmentTruth> => {
    const record = parseAttachmentRecord(raw[i]);
    if (record && record.uploaderId.toLowerCase() === uploader) return { source: 'record', record };
    return storageTruth(key);
  }));
  return attachments.map((att, i) => applyAttachmentTruth(att, truths[i], config.ALLOWED_FILE_TYPES));
}
