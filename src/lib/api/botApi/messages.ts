// Discord v10 bot routes: channels, messages, threads, pins and webhooks.
// Mounted at the end of botApiRoutes (src/lib/api/botApi.ts), so the id
// boundary, per-bot rate limits and the guild/channel access guard registered
// there run for every route here too. Same conventions as botApi.ts.
//
// The helpers come from botApi.ts (a circular import: they are only called at
// request time, never while the modules load).
import { Elysia } from 'elysia';
import { authenticateBot, botChannelPermissions, respond } from '../botApi';
import { invalidFormBody } from '@/lib/botapi/errors';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { getClientIP, isValidObjectId } from '@/lib/security';
import type { IServerSettings } from '@/lib/models';

const UNAUTHORIZED = { code: 0, message: '401: Unauthorized' };
const UNKNOWN_CHANNEL = { code: 10003, message: 'Unknown Channel' };
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const WRONG_CHANNEL_TYPE = { code: 50024, message: 'Cannot execute action on this channel type' };
const UNKNOWN_SOUND = { code: 10097, message: 'Unknown Sound' };

const isVoiceChannel = (c: { type?: string | null; serverId?: string | null }) => Boolean(c.serverId) && c.type === 'voice';
const can = (perms: bigint, bits: bigint) => hasPermission(perms, P.ADMINISTRATOR) || (perms & bits) === bits;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

type SoundRow = { id?: string; name?: string; url?: string; emoji?: string; volume?: unknown };

export const messagesBotRoutes = new Elysia()

// ─── Voice channel status ──────────────────────────────────
// { status } (≤ 500 characters, null clears). SET_VOICE_CHANNEL_STATUS, plus
// MANAGE_CHANNELS when not connected to the channel, which bots never are on
// SerikaCord (they can't join voice). 204, VOICE_CHANNEL_STATUS_UPDATE.
.put('/channels/:channelId/voice-status', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { status } = (body ?? {}) as { status?: unknown };
  const { parseVoiceStatus, setVoiceChannelStatus } = await import('@/lib/botapi/voiceChannelStatus');
  const parsed = parseVoiceStatus(status);
  if (!parsed.ok) { set.status = 400; return invalidFormBody([parsed.error]); }

  const { Channel } = await import('@/lib/models');
  const channel = isValidObjectId(params.channelId) ? await Channel.findById(params.channelId) : null;
  if (!channel) { set.status = 404; return UNKNOWN_CHANNEL; }
  if (!isVoiceChannel(channel)) { set.status = 400; return WRONG_CHANNEL_TYPE; }
  const perms = await botChannelPermissions(auth.botUser.id, channel);
  if (!can(perms, P.VIEW_CHANNEL | P.SET_VOICE_CHANNEL_STATUS | P.MANAGE_CHANNELS)) { set.status = 403; return MISSING_PERMISSIONS; }

  if (await setVoiceChannelStatus(channel.id, parsed.status)) {
    const { emitVoiceChannelStatusUpdate } = await import('@/lib/services/gatewayEvents');
    void emitVoiceChannelStatusUpdate({ channelId: channel.id, guildId: channel.serverId!, status: parsed.status });
  }
  set.status = 204;
  return '';
})

// ─── Soundboard ────────────────────────────────────────────
// Play a server soundboard sound to everyone in a voice channel. Bots can't
// join SerikaCord voice, so unlike Discord the bot need not be connected; it
// needs VIEW_CHANNEL + SPEAK + USE_SOUNDBOARD in the channel, and
// USE_EXTERNAL_SOUNDS (and membership) for another server's sound.
.post('/channels/:channelId/send-soundboard-sound', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return UNAUTHORIZED; }
  const { sound_id, source_guild_id } = (body ?? {}) as { sound_id?: unknown; source_guild_id?: unknown };
  if (sound_id === undefined || sound_id === null || sound_id === '') {
    set.status = 400; return invalidFormBody([{ path: 'sound_id', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]);
  }
  const soundId = String(sound_id);
  if (source_guild_id !== undefined && source_guild_id !== null && (typeof source_guild_id !== 'string' || !isValidObjectId(source_guild_id))) {
    set.status = 400; return invalidFormBody([{ path: 'source_guild_id', code: 'NUMBER_TYPE_COERCE', message: 'Value is not snowflake.' }]);
  }

  const { Channel, Server, ServerMember } = await import('@/lib/models');
  const channel = isValidObjectId(params.channelId) ? await Channel.findById(params.channelId) : null;
  if (!channel) { set.status = 404; return UNKNOWN_CHANNEL; }
  if (!isVoiceChannel(channel)) { set.status = 400; return WRONG_CHANNEL_TYPE; }
  const perms = await botChannelPermissions(auth.botUser.id, channel);
  if (!can(perms, P.VIEW_CHANNEL | P.SPEAK | P.USE_SOUNDBOARD)) { set.status = 403; return MISSING_PERMISSIONS; }

  const sourceId = typeof source_guild_id === 'string' && source_guild_id ? source_guild_id : channel.serverId!;
  const external = !same(sourceId, channel.serverId);
  if (external) {
    if (!can(perms, P.USE_EXTERNAL_SOUNDS)) { set.status = 403; return MISSING_PERMISSIONS; }
    if (!(await ServerMember.findOne({ serverId: sourceId, userId: auth.botUser.id }))) { set.status = 404; return UNKNOWN_SOUND; }
  }
  const [target, source] = await Promise.all([
    Server.findById(channel.serverId!),
    external ? Server.findById(sourceId) : Promise.resolve(null),
  ]);
  const home = source ?? target;
  if (!target || !home) { set.status = 404; return UNKNOWN_SOUND; }
  if ((target.settings as IServerSettings | undefined)?.soundboard?.enabled === false) { set.status = 403; return MISSING_PERMISSIONS; }
  const sound = ((home.soundboardSounds as SoundRow[] | undefined) ?? []).find((s) => same(s.id, soundId));
  if (!sound?.url) { set.status = 404; return UNKNOWN_SOUND; }

  const { effectiveSoundPercent } = await import('@/lib/servers/soundboardVolume');
  const volume = effectiveSoundPercent((target.settings as IServerSettings | undefined)?.soundboard?.volume, sound);
  const { playSoundboardInChannel } = await import('../voice');
  playSoundboardInChannel(channel.id, {
    from: { id: auth.botUser.id, name: auth.botUser.displayName || auth.botUser.username },
    soundUrl: sound.url,
    soundName: String(sound.name ?? 'Sound').slice(0, 100),
    volume,
  });
  const { emitVoiceChannelEffectSend } = await import('@/lib/services/gatewayEvents');
  void emitVoiceChannelEffectSend({
    channelId: channel.id,
    guildId: channel.serverId!,
    userId: auth.botUser.id,
    soundId: sound.id ?? soundId,
    soundVolume: Math.max(0, Math.min(1, volume / 100)),
    emoji: sound.emoji ? { id: null, name: sound.emoji } : null,
  });
  set.status = 204;
  return '';
})

// ─── Slack / GitHub compatible webhooks ────────────────────
// Token-authenticated like execute. ?wait=true returns the message; ?thread_id posts in a thread.
.post('/webhooks/:webhookId/:webhookToken/slack', async ({ params, body, query, request, set }) => {
  const { parseCompatBody } = await import('@/lib/botapi/webhookCompat');
  const parsed = parseCompatBody(body);
  const { text, username, icon_url, attachments } = parsed.payload;
  const { wait, thread_id } = query as Record<string, string | undefined>;
  const { executeSlackWebhook } = await import('@/lib/services/webhookCompatExecute');
  return respond(set, await executeSlackWebhook(params.webhookId, params.webhookToken, { text, username, icon_url, attachments }, { wait, thread_id }, getClientIP(request)));
})
.post('/webhooks/:webhookId/:webhookToken/github', async ({ params, body, query, request, set }) => {
  const { parseCompatBody } = await import('@/lib/botapi/webhookCompat');
  const parsed = parseCompatBody(body);
  const {
    action, answer, check_run, check_suite, comment, commits, compare, discussion, forced, forkee,
    head_commit, issue, member, pull_request, ref, ref_type, release, repository, review, sender,
  } = parsed.payload;
  const { wait, thread_id } = query as Record<string, string | undefined>;
  const { executeGithubWebhook } = await import('@/lib/services/webhookCompatExecute');
  return respond(set, await executeGithubWebhook(params.webhookId, params.webhookToken, request.headers.get('x-github-event'), {
    action, answer, check_run, check_suite, comment, commits, compare, discussion, forced, forkee,
    head_commit, issue, member, pull_request, ref, ref_type, release, repository, review, sender,
  }, { wait, thread_id }, getClientIP(request)));
});
