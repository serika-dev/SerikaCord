import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { storage } from '@/lib/services/storage';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { config } from '@/lib/config';
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

// Type guard for file validation
function isValidImageType(type: string): type is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  return config.ALLOWED_IMAGE_TYPES.includes(type as typeof config.ALLOWED_IMAGE_TYPES[number]);
}

function isValidFileType(type: string, customWhitelist?: IAllowedFileType[]): { allowed: boolean; warn: boolean } {
  if (customWhitelist && customWhitelist.length > 0) {
    const entry = customWhitelist.find((f) => f.type === type);
    if (entry) {
      return { allowed: true, warn: !entry.safe };
    }
    return { allowed: false, warn: false };
  }
  const allowed = config.ALLOWED_FILE_TYPES.includes(type as typeof config.ALLOWED_FILE_TYPES[number]);
  return { allowed, warn: false };
}

export const uploadRoutes = new Elysia({ prefix: '/upload' })
  // Upload avatar
  .post('/avatar', async ({ headers, cookie, body, request, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch the actual user document
    const userId = (authUser as any).id || (authUser as any)._id;
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
      // Delete old avatar if exists
      if (user.avatar && user.avatar.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(user.avatar);
        } catch (e) {
          console.error('Failed to delete old avatar:', e);
        }
      }

      // Upload new avatar
      const result = await storage.uploadFromFormData(file, 'avatars', {
        userId: user.id,
      });

      // Update user, mirroring the change to the accounts service
      await User.updateById(user.id, { avatar: result.url });
      void accountsSyncProfile(user.email ?? '', { avatar: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar';
      console.error('Avatar upload error:', error);
      set.status = 500;
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
    const userId = (authUser as any).id || (authUser as any)._id;
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
      // Delete old banner if exists
      if (user.banner && user.banner.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(user.banner);
        } catch (e) {
          console.error('Failed to delete old banner:', e);
        }
      }

      // Upload new banner
      const result = await storage.uploadFromFormData(file, 'banners', {
        userId: user.id,
      });

      // Update user, mirroring the change to the accounts service
      await User.updateById(user.id, { banner: result.url });
      void accountsSyncProfile(user.email ?? '', { banner: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload banner';
      console.error('Banner upload error:', error);
      set.status = 500;
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
      if (member.avatar && member.avatar.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(member.avatar);
        } catch (e) {
          console.error('Failed to delete old server avatar:', e);
        }
      }

      const result = await storage.uploadFromFormData(file, 'avatars', {
        userId: user.id,
        serverId: params.serverId,
      });

      await ServerMember.updateById(member.id, { avatar: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar';
      set.status = 500;
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
  // Upload server member banner
  .post('/server/:serverId/banner', async ({ headers, cookie, params, body, request, set }) => {
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
      if (member.banner && member.banner.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(member.banner);
        } catch (e) {
          console.error('Failed to delete old server banner:', e);
        }
      }

      const result = await storage.uploadFromFormData(file, 'banners', {
        userId: user.id,
        serverId: params.serverId,
      });

      await ServerMember.updateById(member.id, { banner: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload banner';
      set.status = 500;
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
      // Delete old icon if exists
      if (server.icon && server.icon.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(server.icon);
        } catch (e) {
          console.error('Failed to delete old server icon:', e);
        }
      }

      // Upload new icon
      const result = await storage.uploadFromFormData(file, 'server-icons', {
        serverId: params.serverId,
      });

      // Update server
      await Server.updateById(server.id, { icon: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload server icon';
      console.error('Server icon upload error:', error);
      set.status = 500;
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
      if (server.banner && server.banner.includes(config.B2_BUCKET_NAME)) {
        try {
          await storage.deleteByUrl(server.banner);
        } catch (e) {
          console.error('Failed to delete old server banner:', e);
        }
      }

      const result = await storage.uploadFromFormData(file, 'server-banners', {
        serverId: params.serverId,
      });

      await Server.updateById(server.id, { banner: result.url });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload server banner';
      console.error('Server banner upload error:', error);
      set.status = 500;
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

    const { file, channelId } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type (use platform settings whitelist if configured)
    const platformSettings = await getPlatformSettings();
    const customWhitelist = platformSettings.allowedFileTypes as any[] | undefined;
    const fileCheck = isValidFileType(file.type, customWhitelist);
    if (!fileCheck.allowed) {
      const shouldWarn = platformSettings.warnOnUnknownFileTypes !== false;
      set.status = 400;
      return { error: shouldWarn ? `File type "${file.type}" is not allowed. Only whitelisted file types can be uploaded.` : 'File type not allowed' };
    }
    // File is allowed — if it's tagged as "bad" or unknown with warnings enabled, include a warning
    const warning = fileCheck.warn ? 'Warning: This file type is flagged as potentially unsafe.' : undefined;

    // Validate file size — premium users get higher limit
    const maxSize = user.isPremium ? config.MAX_FILE_SIZE_PREMIUM : config.MAX_FILE_SIZE;
    if (file.size > maxSize) {
      set.status = 400;
      const maxMB = maxSize / 1024 / 1024;
      return { error: `File too large. Maximum size is ${maxMB}MB${user.isPremium ? ' (Serika+)' : ''}.` };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'attachments', {
        userId: user.id,
        channelId,
      });

      return {
        success: true,
        warning,
        attachment: {
          id: result.hash.slice(0, 16),
          filename: file.name,
          contentType: file.type,
          size: file.size,
          url: result.url,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload attachment';
      console.error('Attachment upload error:', error);
      set.status = 500;
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
      channelId: t.Optional(t.String()),
    }),
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
      set.status = 500;
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
        userId: user.id,
      });

      return {
        success: true,
        url: result.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload emoji';
      console.error('Emoji upload error:', error);
      set.status = 500;
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
      set.status = 500;
      return { error: message };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  });
