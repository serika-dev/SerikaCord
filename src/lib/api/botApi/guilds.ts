// Discord v10 bot routes: guild resources (search, join requests, scheduled events, soundboard, widget, stage).
// Mounted at the end of botApiRoutes (src/lib/api/botApi.ts), so the id
// boundary, per-bot rate limits and the guild/channel access guard registered
// there run for every route here too. Same conventions as botApi.ts.
//
// Handlers stay thin: the work lives in src/lib/botapi/guild*.ts (pure rules
// in the *Rules.ts files, unit tested in tests/guildparity-*.test.ts).
import { Elysia } from 'elysia';
import { User, type IApplication } from '@/lib/models';
import { appHasMessageContent } from '@/lib/gateway/intents';

type BotAuth = { app: IApplication; botUser: NonNullable<Awaited<ReturnType<typeof User.findById>>> };
type Headers = Record<string, string | undefined>;
type SetLike = { status?: number | string; headers: Record<string, string | number> };

const UNAUTHORIZED = { code: 0, message: '401: Unauthorized' };

// One lookup per request (the hooks in botApi.ts resolve the same token; the
// token resolution itself is cached in services/botTokens).
const authMemo = new WeakMap<object, Promise<BotAuth | null>>();

function botAuth(headers: Headers): Promise<BotAuth | null> {
  const memo = authMemo.get(headers);
  if (memo) return memo;
  const p = (async () => {
    const header = headers.authorization;
    if (!header) return null;
    const token = header.startsWith('Bot ') ? header.slice(4) : header;
    if (!token) return null;
    const { resolveBotToken } = await import('@/lib/services/botTokens');
    const app = await resolveBotToken(token);
    if (!app || !app.botId) return null;
    const botUser = await User.findById(app.botId);
    return botUser ? { app, botUser } : null;
  })();
  authMemo.set(headers, p);
  return p;
}

function respond(set: SetLike, r: { status: number; body: unknown; headers?: Record<string, string> }) {
  set.status = r.status;
  if (r.headers) Object.assign(set.headers, r.headers);
  return r.status === 204 ? '' : r.body;
}

export const guildsBotRoutes = new Elysia()

// ─── Message search ────────────────────────────────────────
// Discord's guild search over Serika's message index (src/lib/botapi/guildSearch.ts).
.get('/guilds/:guildId/messages/search', async ({ headers, params, query: parsedQuery, request, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  // Searches are expensive: the same per-account budget as the web search.
  const { checkRateLimit } = await import('@/lib/security');
  const rl = await checkRateLimit('search', `bot:${auth.botUser.id}`);
  if (!rl.success) {
    const { rateLimitedResponse } = await import('@/lib/security/botRateLimit');
    const limited = rateLimitedResponse({ retryAfterSeconds: rl.retryAfter ?? 1, global: false });
    return respond(set, { status: 429, body: limited.body, headers: limited.headers });
  }
  // Array params repeat their key (?author_id=1&author_id=2).
  const { arrayQuery } = await import('@/lib/botapi/guildSearchRules');
  const query = arrayQuery(request.url, parsedQuery as Record<string, unknown>);
  const {
    content, slop, author_id, author_type, mentions, mentions_role_id, replied_to_user_id, replied_to_message_id,
    mention_everyone, min_id, max_id, limit, offset, has, link_hostname, embed_provider, embed_type,
    attachment_extension, attachment_filename, pinned, include_nsfw, channel_id, sort_by, sort_order,
  } = query;
  const { searchGuildMessagesForBot } = await import('@/lib/botapi/guildSearch');
  return respond(set, await searchGuildMessagesForBot(params.guildId, { botId: auth.botUser.id, hasMessageContent: appHasMessageContent(auth.app) }, {
    content, slop, author_id, author_type, mentions, mentions_role_id, replied_to_user_id, replied_to_message_id,
    mention_everyone, min_id, max_id, limit, offset, has, link_hostname, embed_provider, embed_type,
    attachment_extension, attachment_filename, pinned, include_nsfw, channel_id, sort_by, sort_order,
  }));
})

// ─── Server Guide, join requests, incident actions ─────────
.get('/guilds/:guildId/new-member-welcome', async ({ headers, params, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { getNewMemberWelcomeForBot } = await import('@/lib/botapi/guildExtras');
  return respond(set, await getNewMemberWelcomeForBot(params.guildId, auth.botUser.id));
})
.get('/guilds/:guildId/requests', async ({ headers, params, query, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { status, limit, before, after } = query as Record<string, unknown>;
  const { listJoinRequestsForBot } = await import('@/lib/botapi/guildJoinRequests');
  return respond(set, await listJoinRequestsForBot(params.guildId, auth.botUser.id, { status, limit, before, after }));
})
.patch('/guilds/:guildId/requests/:requestId', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { action, rejection_reason } = (body ?? {}) as Record<string, unknown>;
  const { actionJoinRequestForBot } = await import('@/lib/botapi/guildJoinRequests');
  return respond(set, await actionJoinRequestForBot(params.guildId, params.requestId, auth.botUser.id, { action, rejection_reason }));
})
.put('/guilds/:guildId/incident-actions', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { invites_disabled_until, dms_disabled_until } = (body ?? {}) as Record<string, unknown>;
  const { putIncidentActionsForBot } = await import('@/lib/botapi/guildExtras');
  return respond(set, await putIncidentActionsForBot(params.guildId, auth.botUser.id, { invites_disabled_until, dms_disabled_until }));
})

// ─── Scheduled event counts + exceptions ───────────────────
// Serika events don't recur, so there are never exceptions (src/lib/botapi/guildEventExceptions.ts).
.get('/guilds/:guildId/scheduled-events/:eventId/users/counts', async ({ headers, params, query: parsedQuery, request, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { arrayQuery } = await import('@/lib/botapi/guildSearchRules');
  const query = arrayQuery(request.url, parsedQuery as Record<string, unknown>);
  const { guild_scheduled_event_exception_ids } = query;
  const { countEventUsersForBot } = await import('@/lib/botapi/guildEventExceptions');
  return respond(set, await countEventUsersForBot(params.guildId, params.eventId, auth.botUser.id, { guild_scheduled_event_exception_ids }));
})
.post('/guilds/:guildId/scheduled-events/:eventId/exceptions', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { original_scheduled_start_time, scheduled_start_time, scheduled_end_time, is_canceled } = (body ?? {}) as Record<string, unknown>;
  const { createEventExceptionForBot } = await import('@/lib/botapi/guildEventExceptions');
  return respond(set, await createEventExceptionForBot(params.guildId, params.eventId, auth.botUser.id, { original_scheduled_start_time, scheduled_start_time, scheduled_end_time, is_canceled }));
})
.patch('/guilds/:guildId/scheduled-events/:eventId/exceptions/:exceptionId', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { scheduled_start_time, scheduled_end_time, is_canceled } = (body ?? {}) as Record<string, unknown>;
  const { missingEventExceptionForBot } = await import('@/lib/botapi/guildEventExceptions');
  return respond(set, await missingEventExceptionForBot(params.guildId, params.eventId, auth.botUser.id, { manage: true, body: { scheduled_start_time, scheduled_end_time, is_canceled } }));
})
.delete('/guilds/:guildId/scheduled-events/:eventId/exceptions/:exceptionId', async ({ headers, params, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { missingEventExceptionForBot } = await import('@/lib/botapi/guildEventExceptions');
  return respond(set, await missingEventExceptionForBot(params.guildId, params.eventId, auth.botUser.id, { manage: true }));
})
.get('/guilds/:guildId/scheduled-events/:eventId/:exceptionId/users', async ({ headers, params, query, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { with_member, limit, before, after } = query as Record<string, unknown>;
  const { missingEventExceptionForBot } = await import('@/lib/botapi/guildEventExceptions');
  return respond(set, await missingEventExceptionForBot(params.guildId, params.eventId, auth.botUser.id, { manage: false, query: { with_member, limit, before, after } }));
})

// ─── Soundboard (writes; GETs live in botApi.ts) ───────────
.post('/guilds/:guildId/soundboard-sounds', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { name, sound, volume, emoji_id, emoji_name } = (body ?? {}) as Record<string, unknown>;
  const { createSoundForBot } = await import('@/lib/botapi/guildSoundboard');
  return respond(set, await createSoundForBot(params.guildId, auth.botUser.id, { name, sound, volume, emoji_id, emoji_name }, headers));
})
.patch('/guilds/:guildId/soundboard-sounds/:soundId', async ({ headers, params, body, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { name, volume, emoji_id, emoji_name } = (body ?? {}) as Record<string, unknown>;
  const { updateSoundForBot } = await import('@/lib/botapi/guildSoundboard');
  return respond(set, await updateSoundForBot(params.guildId, params.soundId, auth.botUser.id, { name, volume, emoji_id, emoji_name }, headers));
})
.delete('/guilds/:guildId/soundboard-sounds/:soundId', async ({ headers, params, set }) => {
  const auth = await botAuth(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { deleteSoundForBot } = await import('@/lib/botapi/guildSoundboard');
  return respond(set, await deleteSoundForBot(params.guildId, params.soundId, auth.botUser.id, headers));
})

// ─── Widget image (public, like widget.json) ───────────────
.get('/guilds/:guildId/widget.png', async ({ params, query, set }) => {
  const { getWidgetPng } = await import('@/lib/botapi/guildWidget');
  const { style } = query as Record<string, unknown>;
  const res = await getWidgetPng(params.guildId, style);
  if (!res.ok) return respond(set, res.result);
  return new Response(new Uint8Array(res.png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' },
  });
});
