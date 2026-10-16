/**
 * PATCH /users/@me for bots: apply a validated username / avatar / banner
 * change (src/lib/botapi/users.ts parseBotUserPatch) through the regular
 * upload pipeline (type + size checks, Trust & Safety scan attributed to the
 * app owner), then send the bot USER_UPDATE on its own gateway sessions.
 */
import { config } from '@/lib/config';
import { checkRateLimit } from '@/lib/security';
import { User, type IUser } from '@/lib/models';
import { invalidFormBody } from '@/lib/botapi/errors';
import type { BotUserPatch } from '@/lib/botapi/users';

type Result =
  | { ok: true; user: IUser }
  | { ok: false; status: number; body: unknown; headers?: Record<string, string> };

export async function updateBotProfile(
  bot: IUser,
  patch: BotUserPatch,
  opts: { ip?: string; ownerId?: string | null },
): Promise<Result> {
  const updates: Partial<Pick<IUser, 'username' | 'avatar' | 'banner'>> = {};

  if (patch.username !== undefined && patch.username !== bot.username) {
    const limited = await checkRateLimit('botUsernameChange', bot.id);
    if (!limited.success) {
      return { ok: false, status: 400, body: invalidFormBody([{ path: 'username', code: 'USERNAME_RATE_LIMIT', message: 'You are changing your username too fast. Try again later.' }]) };
    }
    const taken = await User.findOne({ username: patch.username });
    if (taken && taken.id !== bot.id) {
      return { ok: false, status: 400, body: invalidFormBody([{ path: 'username', code: 'USERNAME_ALREADY_TAKEN', message: 'Username is unavailable. Try adding numbers, letters, underscores _ , or periods.' }]) };
    }
    updates.username = patch.username;
  }

  const images = (['avatar', 'banner'] as const).filter((k) => patch[k] !== undefined);
  if (images.length > 0) {
    const limited = await checkRateLimit('botProfileImage', bot.id);
    if (!limited.success) {
      return { ok: false, status: 400, body: invalidFormBody(images.map((k) => ({ path: k, code: 'AVATAR_RATE_LIMIT', message: 'You are changing your avatar too fast. Try again later.' }))) };
    }
  }
  const { storage } = await import('@/lib/services/storage');
  for (const key of images) {
    const field = patch[key]!;
    const current = key === 'avatar' ? bot.avatar : bot.banner;
    if (field.kind === 'clear') {
      updates[key] = null;
    } else {
      try {
        const ext = field.mime.split('/')[1] === 'jpeg' ? 'jpg' : field.mime.split('/')[1];
        const result = await storage.upload({
          category: key === 'avatar' ? 'avatars' : 'banners',
          contentType: field.mime,
          data: field.data,
          size: field.data.length,
          filename: `${key}.${ext}`,
          userId: bot.id,
          // The developer behind the bot is accountable, like the portal upload.
          scanUserId: opts.ownerId ?? bot.id,
          ip: opts.ip,
        });
        updates[key] = result.url;
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e?.name === 'ContentBlockedError') return { ok: false, status: 400, body: invalidFormBody([{ path: key, code: 'IMAGE_INVALID', message: 'This image is not allowed.' }]) };
        if (/too large/i.test(e?.message ?? '')) {
          const max = key === 'avatar' ? config.MAX_AVATAR_SIZE : config.MAX_BANNER_SIZE;
          return { ok: false, status: 400, body: invalidFormBody([{ path: key, code: 'BINARY_TYPE_MAX_SIZE', message: `File cannot be larger than ${(max / 1024).toFixed(1)} kb.` }]) };
        }
        console.error(`[bot-api] bot ${key} upload failed:`, e?.message ?? err);
        return { ok: false, status: 500, body: { code: 0, message: '500: Internal Server Error' } };
      }
    }
    // The old object on our own bucket is no longer referenced.
    if (current && current.includes(config.B2_BUCKET_NAME)) void storage.deleteByUrl(current).catch(() => {});
  }

  if (Object.keys(updates).length === 0) return { ok: true, user: bot };
  const updated = (await User.updateById(bot.id, updates)) ?? { ...bot, ...updates };
  const { invalidateUserCache } = await import('@/lib/services/auth');
  await invalidateUserCache(bot.id).catch(() => {});
  const { emitUserUpdate } = await import('@/lib/services/gatewayEvents');
  void emitUserUpdate(updated as IUser);
  return { ok: true, user: updated as IUser };
}
