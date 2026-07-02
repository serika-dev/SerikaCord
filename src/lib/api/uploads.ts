import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { storage } from '@/lib/services/storage';
import { checkRateLimit, getClientIP } from '@/lib/security';
import { config } from '@/lib/config';
import { Server, ServerMember, User } from '@/lib/models';

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

function isValidFileType(type: string): boolean {
  return config.ALLOWED_FILE_TYPES.includes(type as typeof config.ALLOWED_FILE_TYPES[number]);
}

export const uploadRoutes = new Elysia({ prefix: '/upload' })
  // Upload avatar
  .post('/avatar', async ({ headers, cookie, body, request, set }) => {
    const { user: authUser, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Fetch the actual Mongoose document
    const userId = authUser._id || (authUser as unknown as { id: string }).id;
    const user = await User.findById(userId);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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
        userId: user._id.toString(),
      });

      // Update user
      user.avatar = result.url;
      await user.save();

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

    // Fetch the actual Mongoose document
    const userId = authUser._id || (authUser as unknown as { id: string }).id;
    const user = await User.findById(userId);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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
    if (file.size > config.MAX_BANNER_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_BANNER_SIZE / 1024 / 1024}MB.` };
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
        userId: user._id.toString(),
      });

      // Update user
      user.banner = result.url;
      await user.save();

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
    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to change the server icon' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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
      server.icon = result.url;
      await server.save();

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

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'You do not have permission to change the server banner' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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

    if (file.size > config.MAX_BANNER_SIZE) {
      set.status = 400;
      return { error: `File too large. Maximum size is ${config.MAX_BANNER_SIZE / 1024 / 1024}MB.` };
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

      server.banner = result.url;
      await server.save();

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
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Upload rate limited', retryAfter: rateLimit.retryAfter };
    }

    const { file, channelId } = body;

    if (!file) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    // Validate file type
    if (!isValidFileType(file.type)) {
      set.status = 400;
      return { error: 'File type not allowed' };
    }

    // Validate file size — premium users get higher limit
    const maxSize = user.isPremium ? config.MAX_FILE_SIZE_PREMIUM : config.MAX_FILE_SIZE;
    if (file.size > maxSize) {
      set.status = 400;
      const maxMB = maxSize / 1024 / 1024;
      return { error: `File too large. Maximum size is ${maxMB}MB${user.isPremium ? ' (Serika+)' : ''}.` };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'attachments', {
        userId: user._id.toString(),
        channelId,
      });

      return {
        success: true,
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
      serverId: server._id,
      userId: user._id,
    });
    if (!membership) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }

    if (!server.ownerId.equals(user._id)) {
      set.status = 403;
      return { error: 'Only the server owner can upload stickers' };
    }

    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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

    const MAX_STICKER_SIZE = 512 * 1024;
    if (file.size > MAX_STICKER_SIZE) {
      set.status = 400;
      return { error: 'Sticker must be less than 512KB.' };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'stickers', {
        serverId: params.serverId,
        userId: user._id.toString(),
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
    const rateLimit = await checkRateLimit('upload', `${user._id}:${ip}`);
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

    // Validate file size (256KB max for emoji)
    const MAX_EMOJI_SIZE = 256 * 1024;
    if (file.size > MAX_EMOJI_SIZE) {
      set.status = 400;
      return { error: 'Emoji must be less than 256KB.' };
    }

    try {
      const result = await storage.uploadFromFormData(file, 'emojis', {
        userId: user._id.toString(),
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
        userId: user._id.toString(),
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
