import { Elysia, t } from 'elysia';
import { checkAttachmentWhitelist, storedAttachmentType } from '@/lib/chat/uploadPolicy';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { storage, keyFromUrl, ContentBlockedError } from '@/lib/services/storage';
import { sniffImageType } from '@/lib/safety/imageHash';
import { ATTACHMENT_BLOB_NAME_RE, ATTACHMENT_BLOB_TYPE, hasAttachmentMagic } from '@/lib/e2ee';
import { e2eeEnabled } from '@/lib/services/e2ee';
import { isOwnedMediaKey } from '@/lib/utils/ownedMedia';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { config } from '@/lib/config';
import { getRedis } from '@/lib/db/redis';
import { nanoid } from 'nanoid';
import { Server, ServerMember, User } from '@/lib/models';
import { accountsSyncProfile } from '@/lib/services/accountsClient';
import { getPlatformSettings, type IAllowedFileType } from '@/lib/models/PlatformSettings';

// Helper function for auth
async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

/**
 * Best-effort, fire-and-forget delete of a replaced avatar/banner/icon. Runs
 * only after the new upload and the DB update succeeded (so a failed upload
 * never leaves the row pointing at a deleted file), handles both CDN and
 * legacy B2 URLs via keyFromUrl, and only deletes keys inside the owner's own
 * upload prefix, so a URL pointing at someone else's object is never removed.
 */
function cleanupOldMedia(oldUrl: string | null | undefined, newUrl: string, ownerPrefix: string): void {
  if (!oldUrl || oldUrl === newUrl) return;
  const oldKey = keyFromUrl(oldUrl);
  if (!isOwnedMediaKey(oldKey, ownerPrefix)) return;
  void storage.delete(oldKey).catch((e) => console.error('Failed to delete replaced media:', e));
}

// Type guard for file validation
function isValidImageType(type: string): type is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  return config.ALLOWED_IMAGE_TYPES.includes(type as typeof config.ALLOWED_IMAGE_TYPES[number]);
}

/**
 * An end-to-end encrypted attachment blob (`e2ee-<random>.bin`, octet-stream):
 * opaque ciphertext the server can't type-check or scan. The real file type
 * lives in the encrypted message; uploads must start with the E2EE magic
 * header (checked on the bytes), so nothing else can hide behind the name.
 */
function isE2eeBlobUpload(name: string, type: string): boolean {
  // Only while E2EE is on; otherwise blobs go through the normal whitelist.
  return e2eeEnabled() && ATTACHMENT_BLOB_NAME_RE.test(name) && (type || ATTACHMENT_BLOB_TYPE).toLowerCase() === ATTACHMENT_BLOB_TYPE;
}

/** Whitelist check for an attachment, with the user-facing error. */
async function attachmentCheck(name: string, type: string): Promise<{ allowed: boolean; error?: string; warning?: string }> {
  if (isE2eeBlobUpload(name, type)) return { allowed: true };
  const platformSettings = await getPlatformSettings();
  const whitelist = (platformSettings.allowedFileTypes as IAllowedFileType[] | undefined) ?? [];
  const result = checkAttachmentWhitelist(name, type, whitelist, config.ALLOWED_FILE_TYPES);
  if (!result.allowed) {
    const what = type ? `"${type}" files` : `"${name}"`;
    return {
      allowed: false,
      error: platformSettings.warnOnUnknownFileTypes !== false
        ? `${what} can't be uploaded here. This file type isn't on the allowed list.`
        : 'File type not allowed',
    };
  }
  return { allowed: true, warning: result.warn ? 'Warning: This file type is flagged as potentially unsafe.' : undefined };
}

// ─── Chunked attachment uploads ──────────────────────────────────────────────
// Cloudflare (free plan) rejects request bodies over 100 MB with a bare 413,
// so bigger files go up in parts of CHUNK_PART_SIZE: start → PUT each part →
// complete. Sessions live in Redis for a day.
export const CHUNK_PART_SIZE = 50 * 1024 * 1024;
const CHUNK_TTL_SECONDS = 24 * 60 * 60;

interface ChunkSession {
  userId: string;
  key: string;
  uploadId: string;
  filename: string;
  size: number;
  storedType: string;
  partCount: number;
  spoiler: boolean;
  warning?: string;
}

const chunkKey = (token: string) => `upload:chunk:${token}`;
const chunkPartsKey = (token: string) => `upload:chunk:${token}:parts`;

async function loadChunkSession(token: string, userId: string): Promise<ChunkSession | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const raw = await getRedis()?.get(chunkKey(token)).catch(() => null);
  if (!raw) return null;
  const session = JSON.parse(raw) as ChunkSession;
  return session.userId === userId ? session : null;
}

function tooLargeError(maxSize: number, premium: boolean): string {
  const maxMB = Math.round(maxSize / 1024 / 1024);
  return `File too large. The maximum size is ${maxMB >= 1024 ? `${maxMB / 1024}GB` : `${maxMB}MB`}${premium ? ' (Serika+)' : ', or more with Serika+'}.`;
}

/** Blocked by Trust & Safety scanning → 403 (the message is safe to show); otherwise 500. */
const uploadErrorStatus = (error: unknown) => (error instanceof ContentBlockedError ? 403 : 500);

export const uploadRoutes = new Elysia({ prefix: '/upload' })
  // Upload avatar
  .post('/avatar', async ({ headers, cookie, body, request, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch the actual user document
    const userId = authUser.id;
    const user = await User.findById(userId);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type
    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size
    if (file.size > config.MAX_AVATAR_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_AVATAR_SIZE / 1024 / 1024}MB.` };
    }

    try {
      // Upload new avatar
      const result = await storage.uploadFromFormData(file, 'avatars', {
        ip: getClientIP(request),
        userId: user.id,
      });

      // Update user, mirroring the change to the accounts service
      await User.updateById(user.id, { avatar: result.url });
      void accountsSyncProfile(user.email ?? '', { avatar: result.url });
      // The 5-minute auth cache still holds the old URL; drop it so /@me,
      // refresh() and new messages pick up the new avatar right away.
      await invalidateUserCache(user.id);
      cleanupOldMedia(user.avatar, result.url, `avatars/${user.id}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar';
      console.error('Avatar upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload banner
  .post('/banner', async ({ headers, cookie, body, request, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch the actual user document
    const userId = authUser.id;
    const user = await User.findById(userId);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type
    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size (GIFs get a higher limit to preserve animation)
    const maxBannerSize = file.type === 'image/gif' ? 50 * 1024 * 1024 : config.MAX_BANNER_SIZE;
    if (file.size > maxBannerSize) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${maxBannerSize / 1024 / 1024}MB.` };
    }

    try {
      // Upload new banner
      const result = await storage.uploadFromFormData(file, 'banners', {
        ip: getClientIP(request),
        userId: user.id,
      });

      // Update user, mirroring the change to the accounts service
      await User.updateById(user.id, { banner: result.url });
      void accountsSyncProfile(user.email ?? '', { banner: result.url });
      await invalidateUserCache(user.id);
      cleanupOldMedia(user.banner, result.url, `banners/${user.id}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload banner';
      console.error('Banner upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload server member avatar
  .post('/server/:serverId/avatar', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const member = await ServerMember.findOne({ serverId: params.serverId, userId: user.id });
    if (!member) {
      set.status = 404;
      return { error: 'You are not a member of this server' };
    }

    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;
    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    if (file.size > config.MAX_AVATAR_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_AVATAR_SIZE / 1024 / 1024}MB.` };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'avatars', {
        ip: getClientIP(request),
        userId: user.id,
        serverId: params.serverId,
      });

      await ServerMember.updateById(member.id, { avatar: result.url });
      cleanupOldMedia(member.avatar, result.url, `avatars/${params.serverId}/${user.id}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar';
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload server member (per-server profile) banner. Its own path: the
  // owner-only server banner route below uses /server/:serverId/banner and
  // Elysia keeps only the last handler registered for a method + path.
  .post('/server/:serverId/member-banner', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const member = await ServerMember.findOne({ serverId: params.serverId, userId: user.id });
    if (!member) {
      set.status = 404;
      return { error: 'You are not a member of this server' };
    }

    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;
    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size (GIFs get a higher limit to preserve animation)
    const maxMemberBannerSize = file.type === 'image/gif' ? 50 * 1024 * 1024 : config.MAX_BANNER_SIZE;
    if (file.size > maxMemberBannerSize) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${maxMemberBannerSize / 1024 / 1024}MB.` };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'banners', {
        ip: getClientIP(request),
        userId: user.id,
        serverId: params.serverId,
      });

      await ServerMember.updateById(member.id, { banner: result.url });
      cleanupOldMedia(member.banner, result.url, `banners/${params.serverId}/${user.id}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload banner';
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload server icon
  .post('/server/:serverId/icon', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    // Check if user is owner or has manage server permission
    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to change the server icon' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type
    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size
    if (file.size > config.MAX_AVATAR_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_AVATAR_SIZE / 1024 / 1024}MB.` };
    }

    try {
      // Upload new icon
      const result = await storage.uploadFromFormData(file, 'server-icons', {
        ip: getClientIP(request),
        scanUserId: user.id,
        serverId: params.serverId,
      });

      // Update server
      await Server.updateById(server.id, { icon: result.url });
      cleanupOldMedia(server.icon, result.url, `server-icons/${params.serverId}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload server icon';
      console.error('Server icon upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload server banner
  .post('/server/:serverId/banner', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'You do not have permission to change the server banner' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size (GIFs get a higher limit to preserve animation)
    const maxServerBannerSize = file.type === 'image/gif' ? 50 * 1024 * 1024 : config.MAX_BANNER_SIZE;
    if (file.size > maxServerBannerSize) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${maxServerBannerSize / 1024 / 1024}MB.` };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'server-banners', {
        ip: getClientIP(request),
        scanUserId: user.id,
        serverId: params.serverId,
      });

      await Server.updateById(server.id, { banner: result.url });
      cleanupOldMedia(server.banner, result.url, `server-banners/${params.serverId}/`);

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload server banner';
      console.error('Server banner upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload attachment
  .post('/attachment', async ({ headers, cookie, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file, channelId, spoiler } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // The platform whitelist (admin settings) decides what can be attached:
    // MIME types, file endings like ".7z.001", or "*". Page-like and unknown
    // types are stored as plain downloads either way.
    const check = await attachmentCheck(file.name, file.type);
    if (!check.allowed) {
      set.status = 400;
      return { error: check.error };
    }
    if (isE2eeBlobUpload(file.name, file.type) && !hasAttachmentMagic(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
      set.status = 400;
      return { error: 'Not an encrypted attachment' };
    }
    const storedType = storedAttachmentType(file.type, config.ALLOWED_FILE_TYPES);
    const warning = check.warning;

    // Validate file size — premium users get higher limit
    const maxSize = user.isPremium ? config.MAX_FILE_SIZE_PREMIUM : config.MAX_FILE_SIZE;
    if (file.size > maxSize) {
      set.status = 413;
      return { error: tooLargeError(maxSize, Boolean(user.isPremium)), maxSize };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'attachments', {
        ip: getClientIP(request),
        userId: user.id,
        channelId,
        contentType: storedType,
      });

      return {
        success: true,
        warning,
        attachment: {
          id: result.hash.slice(0, 16),
          filename: file.name,
          contentType: storedType,
          size: file.size,
          url: result.url,
          spoiler: spoiler === 'true',
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload attachment';
      console.error('Attachment upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
      channelId: t.Optional(t.String()),
      spoiler: t.Optional(t.String()),
    }),
  })
  // Start a chunked attachment upload (files over ~90 MB).
  .post('/attachment/chunked', async ({ headers, cookie, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const rateLimit = await checkRateLimit('upload', `${user.id}:${getClientIP(request)}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }
    const redis = getRedis();
    if (!redis) {
      set.status = 503;
      return { error: 'Large uploads are unavailable right now' };
    }
    const { filename, size, type, channelId, spoiler } = body;
    const check = await attachmentCheck(filename, type ?? '');
    if (!check.allowed) {
      set.status = 400;
      return { error: check.error };
    }
    const maxSize = user.isPremium ? config.MAX_FILE_SIZE_PREMIUM : config.MAX_FILE_SIZE;
    if (size > maxSize) {
      set.status = 413;
      return { error: tooLargeError(maxSize, Boolean(user.isPremium)), maxSize };
    }
    // The chunked path stores bytes without the Trust & Safety image scan, so
    // it only takes big non-image files; images go through POST /attachment.
    if (size <= CHUNK_PART_SIZE) {
      set.status = 400;
      return { error: 'Use a normal upload for files this small' };
    }
    if (String(type || '').toLowerCase().startsWith('image/')) {
      set.status = 400;
      return { error: 'Images this large cannot be uploaded' };
    }
    const storedType = storedAttachmentType(type, config.ALLOWED_FILE_TYPES);
    try {
      const { key, uploadId } = await storage.startMultipart({
        category: 'attachments',
        filename,
        contentType: storedType,
        userId: user.id,
        channelId,
      });
      const token = nanoid(24);
      const session: ChunkSession = {
        userId: user.id,
        key,
        uploadId,
        filename,
        size,
        storedType,
        partCount: Math.max(1, Math.ceil(size / CHUNK_PART_SIZE)),
        spoiler: Boolean(spoiler),
        warning: check.warning,
      };
      await redis.set(chunkKey(token), JSON.stringify(session), 'EX', CHUNK_TTL_SECONDS);
      return { token, partSize: CHUNK_PART_SIZE, partCount: session.partCount };
    } catch (error) {
      console.error('Chunked upload start error:', error);
      set.status = 500;
      return { error: 'Could not start the upload' };
    }
  }, {
    body: t.Object({
      filename: t.String({ minLength: 1, maxLength: 255 }),
      size: t.Number({ minimum: 1 }),
      type: t.Optional(t.String({ maxLength: 255 })),
      channelId: t.Optional(t.String({ maxLength: 64 })),
      spoiler: t.Optional(t.Boolean()),
    }),
  })
  // One part of a chunked upload (raw bytes, 1-based part number).
  .put('/attachment/chunked/:token/:part', async ({ headers, cookie, params, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const session = await loadChunkSession(params.token, user.id);
    if (!session) {
      set.status = 404;
      return { error: 'Upload not found or expired' };
    }
    const part = Number(params.part);
    if (!Number.isInteger(part) || part < 1 || part > session.partCount) {
      set.status = 400;
      return { error: 'Invalid part number' };
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const expected = part < session.partCount ? CHUNK_PART_SIZE : session.size - CHUNK_PART_SIZE * (session.partCount - 1);
    if (bytes.byteLength !== expected) {
      set.status = 400;
      return { error: 'Part size mismatch' };
    }
    // An image renamed to something else would skip the scanners.
    if (part === 1 && (sniffImageType(bytes) || (isE2eeBlobUpload(session.filename, session.storedType) && !hasAttachmentMagic(bytes)))) {
      await storage.abortMultipart(session.key, session.uploadId).catch(() => null);
      set.status = 400;
      return { error: 'Images this large cannot be uploaded' };
    }
    try {
      const etag = await storage.uploadPart(session.key, session.uploadId, part, bytes);
      const redis = getRedis();
      await redis?.hset(chunkPartsKey(params.token), String(part), etag);
      await redis?.expire(chunkPartsKey(params.token), CHUNK_TTL_SECONDS);
      return { ok: true };
    } catch (error) {
      console.error('Chunked upload part error:', error);
      set.status = 502;
      return { error: 'Part upload failed, please retry' };
    }
  }, { parse: 'none' })
  // Finish a chunked upload: returns the attachment like POST /attachment.
  .post('/attachment/chunked/:token/complete', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const session = await loadChunkSession(params.token, user.id);
    const redis = getRedis();
    if (!session || !redis) {
      set.status = 404;
      return { error: 'Upload not found or expired' };
    }
    const etags = await redis.hgetall(chunkPartsKey(params.token));
    const parts = Array.from({ length: session.partCount }, (_, i) => ({ partNumber: i + 1, etag: etags[String(i + 1)] }));
    if (parts.some((p) => !p.etag)) {
      set.status = 400;
      return { error: 'Some parts are missing' };
    }
    try {
      const url = await storage.completeMultipart(session.key, session.uploadId, parts);
      await redis.del(chunkKey(params.token), chunkPartsKey(params.token));
      return {
        success: true,
        warning: session.warning,
        attachment: {
          id: nanoid(16),
          filename: session.filename,
          contentType: session.storedType,
          size: session.size,
          url,
          spoiler: session.spoiler,
        },
      };
    } catch (error) {
      console.error('Chunked upload complete error:', error);
      set.status = 500;
      return { error: 'Could not finish the upload' };
    }
  })
  // Cancel a chunked upload.
  .delete('/attachment/chunked/:token', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const session = await loadChunkSession(params.token, user.id);
    if (!session) return { ok: true };
    await storage.abortMultipart(session.key, session.uploadId).catch(() => null);
    await getRedis()?.del(chunkKey(params.token), chunkPartsKey(params.token));
    return { ok: true };
  })
  // Upload sticker
  .post('/sticker/:serverId', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const server = await Server.findById(params.serverId);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found' };
    }

    const membership = await ServerMember.findOne({
      serverId: server.id,
      userId: user.id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    if (server.ownerId !== user.id) {
      set.status = 403;
      return { error: 'Only the server owner can upload stickers' };
    }

    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;
    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    const allowedTypes = ['image/png', 'image/apng', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Stickers must be PNG/APNG/GIF/WebP.' };
    }

    const MAX_STICKER_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_STICKER_SIZE) {
      set.status = 400;
      return { error: 'Sticker must be less than 20MB.' };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'stickers', {
        ip: getClientIP(request),
        serverId: params.serverId,
        userId: user.id,
      });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload sticker';
      console.error('Sticker upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    params: t.Object({
      serverId: t.String(),
    }),
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload emoji
  .post('/emoji', async ({ headers, cookie, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type (emoji can be PNG, GIF, JPEG, WebP)
    if (!isValidImageType(file.type)) {
      set.status = 400;
      return { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' };
    }

    // Validate file size (20MB max for emoji)
    const MAX_EMOJI_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_EMOJI_SIZE) {
      set.status = 400;
      return { error: 'Emoji must be less than 20MB.' };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'emojis', {
        ip: getClientIP(request),
        userId: user.id,
      });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload emoji';
      console.error('Emoji upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  })
  // Upload audio (for soundboard)
  .post('/audio', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const file = body.file as File;

    if (!file.type.startsWith('audio/')) {
      set.status = 400;
      return { error: 'File must be an audio file' };
    }

    if (file.size > 20 * 1024 * 1024) {
      set.status = 400;
      return { error: 'Audio file must be less than 20MB' };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'audio', {
        userId: user.id,
      });

      return {
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload audio';
      console.error('Audio upload error:', error);
      set.status = uploadErrorStatus(error);
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  });
