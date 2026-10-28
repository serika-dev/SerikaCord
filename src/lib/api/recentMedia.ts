import { Elysia, t } from 'elysia';
import { authenticateRequest, invalidateUserCache } from '@/lib/services/auth';
import { User } from '@/lib/models';
import { accountsSyncProfile } from '@/lib/services/accountsClient';
import { checkRateLimit } from '@/lib/security';
import { config } from '@/lib/config';
import { ANIMATED_BANNER_MAX_BYTES } from '@/lib/media/imageUploadLimits';
import { fetchRemoteImage, remoteImageResponse } from '@/lib/media/remoteImage';
import { DISCORD_CDN_HOST, discordAvatarUrl, discordBannerUrl, type RecentMediaKind } from '@/lib/profiles/recentMedia';
import {
  findRecentProfileMedia,
  getRecentProfileMedia,
  recordProfileMediaChange,
  removeRecentProfileMedia,
} from '@/lib/services/recentProfileMedia';
import { discordMediaPreview, getLinkedDiscordMedia } from '@/lib/services/discordProfileMedia';

/**
 * Recent avatars / banners and the linked Discord account's images for the
 * "Select an Image" dialog (src/components/ui/SelectImageDialog.tsx).
 *
 *   GET    /users/@me/recent-media                → { avatars, banners, discord }
 *   POST   /users/@me/recent-media/apply          { kind, url } → sets the main avatar / banner
 *   DELETE /users/@me/recent-media                { kind, url } → removes one entry
 *   GET    /users/@me/recent-media/discord/:kind  → the Discord image's bytes
 *
 * Server profiles reuse a recent image by saving its URL with
 * PATCH /servers/:id/members/@me (which accepts the caller's recent URLs).
 * A Discord image is never stored from here: the client sends the bytes
 * through the normal crop + upload route (type check, Trust & Safety scan).
 */

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authToken = cookie.auth_token?.value;
  return authenticateRequest(headers.authorization ?? null, typeof authToken === 'string' ? { auth_token: authToken } : {});
}

const kindOf = (value: unknown): RecentMediaKind | null => (value === 'avatar' ? 'avatar' : value === 'banner' ? 'banner' : null);
const toClient = (list: Array<{ url: string }>) => list.map((e) => ({ url: e.url }));

export const recentMediaRoutes = new Elysia({ prefix: '/users/@me/recent-media' })
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const [lists, discord] = await Promise.all([
      getRecentProfileMedia(user.id).catch((err) => {
        console.error('[recent-media] GET failed:', (err as Error)?.message ?? err);
        return { avatar: [], banner: [] };
      }),
      getLinkedDiscordMedia(user.id).catch(() => null),
    ]);
    return {
      avatars: toClient(lists.avatar),
      banners: toClient(lists.banner),
      discord: discordMediaPreview(discord),
    };
  })
  // Set a recent image as the main avatar / banner (no re-upload).
  .post('/apply', async ({ headers, cookie, body, set }) => {
    const { user: authUser, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!authUser) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await checkRateLimit('recentMedia', authUser.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }
    const kind = kindOf(body.kind);
    if (!kind) {
      set.status = 400;
      return { error: 'Unknown image kind' };
    }
    const url = await findRecentProfileMedia(authUser.id, kind, body.url).catch(() => null);
    if (!url) {
      set.status = 404;
      return { error: 'That image is not in your recent images' };
    }
    const user = await User.findById(authUser.id);
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }
    const previous = kind === 'avatar' ? user.avatar : user.banner;
    if (previous !== url) {
      await User.updateById(user.id, kind === 'avatar' ? { avatar: url } : { banner: url });
      void accountsSyncProfile(user.email ?? '', kind === 'avatar' ? { avatar: url } : { banner: url });
      await invalidateUserCache(user.id);
    }
    await recordProfileMediaChange(user.id, kind, { url, previous });
    return { success: true, url };
  }, {
    body: t.Object({
      kind: t.String({ maxLength: 16 }),
      url: t.String({ maxLength: 512 }),
    }),
  })
  // Remove one entry ("x" on a tile). The file is deleted when nothing uses it.
  .delete('/', async ({ headers, cookie, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const rl = await checkRateLimit('recentMedia', user.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }
    const kind = kindOf(body.kind);
    if (!kind) {
      set.status = 400;
      return { error: 'Unknown image kind' };
    }
    try {
      const list = await removeRecentProfileMedia(user.id, kind, body.url);
      return { success: true, kind, items: toClient(list) };
    } catch (err) {
      console.error('[recent-media] DELETE failed:', (err as Error)?.message ?? err);
      set.status = 500;
      return { error: 'Could not remove the image' };
    }
  }, {
    body: t.Object({
      kind: t.String({ maxLength: 16 }),
      url: t.String({ maxLength: 512 }),
    }),
  })
  // The linked Discord account's current avatar / banner, fetched from
  // cdn.discordapp.com only (URL built here from the Discord API's hash).
  .get('/discord/:kind', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
    const kind = kindOf(params.kind);
    if (!kind) {
      set.status = 404;
      return { error: 'Unknown image kind' };
    }
    const rl = await checkRateLimit('mediaImport', user.id);
    if (!rl.success) {
      set.status = 429;
      return { error: 'Too many requests', retryAfter: rl.retryAfter };
    }
    const media = await getLinkedDiscordMedia(user.id).catch(() => null);
    const url = media
      ? kind === 'avatar' ? discordAvatarUrl(media.discordId, media.avatar, 1024) : discordBannerUrl(media.discordId, media.banner, 1024)
      : null;
    if (!url) {
      set.status = 404;
      return { error: kind === 'avatar' ? 'No Discord avatar found' : 'No Discord banner found' };
    }
    const image = await fetchRemoteImage(url, {
      maxBytes: kind === 'avatar' ? Math.max(config.MAX_AVATAR_SIZE, 10 * 1024 * 1024) : ANIMATED_BANNER_MAX_BYTES,
      allowHost: (host) => host === DISCORD_CDN_HOST,
    });
    if (!image.ok) {
      set.status = image.status;
      return { error: image.error };
    }
    return remoteImageResponse(image);
  }, {
    params: t.Object({ kind: t.String() }),
  });
