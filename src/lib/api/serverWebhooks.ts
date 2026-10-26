// Server-wide webhook list for the web app's settings, mounted at /api.
//
//   GET /servers/:serverId/webhooks   every channel webhook in the server
//
// Like Discord's GET /guilds/{id}/webhooks: needs MANAGE_WEBHOOKS (owner,
// ADMINISTRATOR or the bit). Managers get each webhook's URL except an
// application's own webhooks, whose token stays with that app. Editing goes
// through the per-channel routes in channels.ts.
import { Elysia, t } from 'elysia';
import { Server, ServerMember } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { isValidObjectId } from '@/lib/security';
import { hasServerPermission } from '@/lib/permissions/serverPermissions';
import { PERMISSION_BITS } from '@/lib/permissions/bits';

export const serverWebhookRoutes = new Elysia({ prefix: '/servers' })
  .get('/:serverId/webhooks', async ({ headers, cookie, params, set }) => {
    const authToken = (cookie as Record<string, { value?: unknown }>).auth_token?.value;
    const { user, error: authError } = await authenticateRequest(
      headers.authorization ?? null,
      typeof authToken === 'string' ? { auth_token: authToken } : {},
    );
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }
    if (!isValidObjectId(params.serverId)) { set.status = 404; return { error: 'Server not found' }; }
    const server = await Server.findById(params.serverId);
    if (!server) { set.status = 404; return { error: 'Server not found' }; }
    const membership = await ServerMember.findOne({ serverId: server.id, userId: user.id });
    if (!membership && server.ownerId !== user.id) { set.status = 404; return { error: 'Server not found' }; }
    if (!(await hasServerPermission(server, user.id, PERMISSION_BITS.MANAGE_WEBHOOKS, membership))) {
      set.status = 403; return { error: 'Missing MANAGE_WEBHOOKS permission' };
    }
    const { ChannelWebhook } = await import('@/lib/models');
    const { serializeWebhookForUser, loadWebhookCreators } = await import('@/lib/services/channelWebhooks');
    const webhooks = await ChannelWebhook.find({ serverId: server.id });
    const creators = await loadWebhookCreators(webhooks);
    return webhooks
      .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
      .map((w) => serializeWebhookForUser(w, { withToken: true, creator: w.creatorId ? creators.get(w.creatorId.toLowerCase()) : null }));
  }, {
    params: t.Object({ serverId: t.String() }),
  });
