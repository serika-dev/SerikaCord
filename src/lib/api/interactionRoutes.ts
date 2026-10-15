/**
 * User-side interaction routes (the web client, session auth):
 *
 *   POST /api/interactions/commands      run an app command from the picker /
 *                                        a context menu (typed options, target)
 *   POST /api/interactions/autocomplete  ask the app for option choices
 *   POST /api/interactions/components    click a button / pick in a select
 *   POST /api/interactions/modals/:id    submit a modal the app opened
 *
 * The services re-check everything (channel access, command permissions,
 * that the component exists and is enabled, modal field limits), so these
 * routes only authenticate and shape the request. The app's response arrives
 * over the normal message streams; ack / failure / modal notices and
 * ephemeral messages arrive on the user's own activity stream.
 */
import { Elysia, t } from 'elysia';
import { User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { isValidObjectId } from '@/lib/security';
import type { IncomingAttachment } from '@/lib/chat/attachmentPolicy';

type Cookie = Record<string, { value?: unknown }>;

async function sessionUser(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  const { user } = await authenticateRequest(authHeader, cookies);
  if (!user) return null;
  // Bots act through the bot API, never through these routes.
  const row = await User.findById(user.id);
  return row && !row.isBot ? row : null;
}

function fail(set: { status?: number | string }, r: { status: number; error: string; code: string; field?: string }) {
  set.status = r.status;
  return { error: r.error, code: r.code, ...(r.field ? { field: r.field } : {}) };
}

const ID = t.String({ minLength: 1, maxLength: 64 });

export const interactionRoutes = new Elysia({ prefix: '/interactions' })
  .post('/commands', async ({ headers, cookie, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isValidObjectId(body.channelId) || !isValidObjectId(body.commandId)) { set.status = 400; return { error: 'Invalid ID format', code: 'bad_request' }; }
    const { invokeApplicationCommand } = await import('@/lib/services/interactions');
    const r = await invokeApplicationCommand({
      user,
      channelId: body.channelId,
      commandId: body.commandId,
      options: body.options,
      targetId: body.targetId ?? null,
      attachments: (body.attachments ?? []) as IncomingAttachment[],
    });
    if (!r.ok) return fail(set, r);
    return { ok: true, interactionId: r.interactionId };
  }, {
    body: t.Object({
      channelId: ID,
      commandId: ID,
      options: t.Optional(t.Array(t.Any(), { maxItems: 25 })),
      targetId: t.Optional(t.Union([ID, t.Null()])),
      attachments: t.Optional(t.Array(t.Object({
        id: t.String({ maxLength: 64 }),
        url: t.String({ maxLength: 2048 }),
        filename: t.String({ maxLength: 255 }),
        contentType: t.String({ maxLength: 255 }),
        size: t.Optional(t.Number()),
        width: t.Optional(t.Number()),
        height: t.Optional(t.Number()),
      }), { maxItems: 10 })),
    }),
  })
  .post('/autocomplete', async ({ headers, cookie, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isValidObjectId(body.channelId) || !isValidObjectId(body.commandId)) { set.status = 400; return { error: 'Invalid ID format', code: 'bad_request' }; }
    const { invokeAutocomplete } = await import('@/lib/services/interactions');
    const r = await invokeAutocomplete({ user, channelId: body.channelId, commandId: body.commandId, options: body.options });
    if (!r.ok) return fail(set, r);
    return { choices: r.choices };
  }, {
    body: t.Object({
      channelId: ID,
      commandId: ID,
      options: t.Array(t.Any(), { maxItems: 25 }),
    }),
  })
  .post('/components', async ({ headers, cookie, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!isValidObjectId(body.channelId) || !isValidObjectId(body.messageId)) { set.status = 400; return { error: 'Invalid ID format', code: 'bad_request' }; }
    const { invokeComponent } = await import('@/lib/services/interactions');
    const r = await invokeComponent({
      user,
      channelId: body.channelId,
      messageId: body.messageId,
      customId: body.customId,
      componentType: body.componentType,
      values: body.values,
    });
    if (!r.ok) return fail(set, r);
    return { ok: true, interactionId: r.interactionId };
  }, {
    body: t.Object({
      channelId: ID,
      messageId: ID,
      customId: t.String({ minLength: 1, maxLength: 100 }),
      componentType: t.Integer({ minimum: 2, maximum: 8 }),
      values: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 25 })),
    }),
  })
  .post('/modals/:modalId', async ({ headers, cookie, params, body, set }) => {
    const user = await sessionUser(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(params.modalId)) { set.status = 404; return { error: 'This form has expired', code: 'unknown_modal' }; }
    const { submitModal } = await import('@/lib/services/interactions');
    const r = await submitModal({ user, modalId: params.modalId, components: body.components });
    if (!r.ok) return fail(set, r as { status: number; error: string; code: string; field?: string });
    return { ok: true, interactionId: r.interactionId };
  }, {
    params: t.Object({ modalId: t.String({ maxLength: 80 }) }),
    body: t.Object({
      components: t.Array(t.Object({
        custom_id: t.String({ minLength: 1, maxLength: 100 }),
        value: t.Optional(t.Union([t.String({ maxLength: 4000 }), t.Boolean()])),
        values: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 25 })),
      }), { maxItems: 25 }),
    }),
  });
