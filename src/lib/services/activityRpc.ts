/**
 * The server side of the Embedded App SDK (CORD-92). The SerikaCord window
 * hosting an Activity (src/components/activities/ActivityFrame.tsx) forwards
 * the SDK commands that need data or change state here, with the user's own
 * session; the Activity's frame never sees that session.
 *
 * Every command re-checks that the user is a participant of the instance, and
 * the commands Discord gates by OAuth2 scope check the scopes the app proved
 * with authenticate() (a real access token of this app for this user).
 * Ids are converted to the app's id format (snowflakes for snowflake apps).
 */
import { Channel, ServerMember, User } from '@/lib/models';
import { RpcError, discordChannelType, parseAuthorizeScopes, sdkUser } from '@/lib/activities/instances';
import {
  getInstance, instanceAuthScopes, instanceParticipants, loadActivityApp, publicIdsFor, recordInstanceAuth, setSdkActivity,
  type ActivityApp,
} from '@/lib/services/activityInstances';
import type { ActivityInstanceRecord } from '@/lib/activities/instances';

export type RpcResult = { ok: true; data: unknown } | { ok: false; code: number; message: string };

const err = (code: number, message: string): RpcResult => ({ ok: false, code, message });

type U = { id: string; username: string; displayName?: string | null; avatar?: string | null; isBot?: boolean | null; isVerified?: boolean | null };

async function requireScope(rec: ActivityInstanceRecord, userId: string, scope: string): Promise<RpcResult | null> {
  const scopes = await instanceAuthScopes(rec.id, userId);
  return scopes.includes(scope) ? null : err(RpcError.INVALID_PERMISSIONS, `Missing scope: ${scope}`);
}

async function userView(app: ActivityApp, u: U) {
  const ids = await publicIdsFor(app, [u.id]);
  return sdkUser(u, ids.get(u.id.toLowerCase()) ?? u.id);
}

/** Run one server-side SDK command for `userId` in `instanceId`. */
export async function handleActivityRpc(userId: string, instanceId: string, cmd: string, args: Record<string, unknown>): Promise<RpcResult> {
  const rec = await getInstance(instanceId);
  if (!rec || rec.endedAt) return err(RpcError.INVALID_CHANNEL, 'This Activity has ended.');
  const participants = await instanceParticipants(rec.id);
  if (!participants.some((p) => p.toLowerCase() === userId.toLowerCase())) return err(RpcError.INVALID_USER, 'Not in this Activity.');
  const app = await loadActivityApp(rec.applicationId);
  if (!app) return err(RpcError.INVALID_CLIENTID, 'Unknown application');
  const me = await User.findById(userId) as U | null;
  if (!me) return err(RpcError.INVALID_USER, 'Unknown user');

  switch (cmd) {
    case 'AUTHORIZE': {
      // The user already agreed in SerikaCord's own consent dialog (the frame can't reach this route).
      const scopes = parseAuthorizeScopes(args.scopes);
      if (!scopes.ok) return err(RpcError.INVALID_PAYLOAD, scopes.message);
      const { parsePkceChallenge } = await import('@/lib/oauth/scopes');
      const pkce = parsePkceChallenge(args.code_challenge, args.code_challenge_method);
      if (!pkce.ok) return err(RpcError.INVALID_PAYLOAD, pkce.error);
      const { issueAuthorizationCode } = await import('@/lib/services/oauth2Tokens');
      await recordConsent(app, userId, scopes.scopes);
      const code = await issueAuthorizationCode({
        applicationId: app.id, userId, scopes: scopes.scopes, redirectUri: null, codeChallenge: pkce.challenge,
        authTime: Math.floor(Date.now() / 1000),
      });
      return { ok: true, data: { code } };
    }
    case 'AUTHENTICATE': {
      const token = typeof args.access_token === 'string' ? args.access_token : '';
      const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
      const grant = token ? await resolveBearerToken(token) : null;
      if (!grant || grant.applicationId.toLowerCase() !== app.id.toLowerCase() || grant.userId.toLowerCase() !== userId.toLowerCase()) {
        return err(RpcError.INVALID_TOKEN, 'Invalid access token');
      }
      const expires = grant.expiresAt ? new Date(grant.expiresAt) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
      if (expires.getTime() <= Date.now()) return err(RpcError.INVALID_TOKEN, 'Access token expired');
      await recordInstanceAuth(rec.id, userId, grant.scopes);
      const user = await userView(app, me);
      return {
        ok: true,
        data: {
          access_token: token,
          user: { username: user.username, discriminator: '0', id: user.id, avatar: user.avatar, public_flags: 0, global_name: user.global_name },
          scopes: grant.scopes,
          expires: expires.toISOString(),
          application: { id: app.clientId, name: app.name, icon: app.icon, description: '', rpc_origins: [] },
        },
      };
    }
    case 'GET_CHANNEL': {
      const channel = await Channel.findById(rec.location.channelId);
      if (!channel) return err(RpcError.INVALID_CHANNEL, 'Unknown channel');
      const ids = await publicIdsFor(app, [channel.id, channel.serverId]);
      const pubChannel = ids.get(channel.id.toLowerCase()) ?? channel.id;
      if (typeof args.channel_id === 'string' && args.channel_id !== pubChannel && args.channel_id.toLowerCase() !== channel.id.toLowerCase()) {
        return err(RpcError.INVALID_CHANNEL, 'Activities can only read their own channel.');
      }
      if (channel.serverId) { const denied = await requireScope(rec, userId, 'guilds'); if (denied) return denied; }
      return {
        ok: true,
        data: {
          id: pubChannel,
          type: discordChannelType(channel.type),
          guild_id: channel.serverId ? ids.get(channel.serverId.toLowerCase()) ?? channel.serverId : null,
          name: channel.serverId ? channel.name ?? null : null,
          topic: channel.serverId ? (channel as { topic?: string | null }).topic ?? null : null,
          bitrate: null,
          user_limit: (channel as { userLimit?: number | null }).userLimit ?? null,
          position: (channel as { position?: number | null }).position ?? null,
          voice_states: rec.location.voiceRoomId ? await voiceStates(app, rec) : [],
          messages: [],
        },
      };
    }
    case 'GET_CHANNEL_PERMISSIONS': {
      const denied = await requireScope(rec, userId, 'guilds.members.read');
      if (denied) return denied;
      const channel = await Channel.findById(rec.location.channelId);
      if (!channel?.serverId) return { ok: true, data: { permissions: '0' } };
      const { getMemberChannelPermissions } = await import('@/lib/api/channels');
      const perms = await getMemberChannelPermissions(userId, channel as typeof channel & { serverId: string });
      return { ok: true, data: { permissions: perms.toString() } };
    }
    case 'GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS':
      return { ok: true, data: { participants: await participantViews(app, rec, participants) } };
    case 'GET_USER': {
      const raw = typeof args.id === 'string' ? args.id.slice(0, 64) : '';
      const list = await participantViews(app, rec, participants);
      const hit = list.find((p) => p.id === raw);
      return { ok: true, data: hit ?? null };
    }
    case 'SET_ACTIVITY': {
      const denied = await requireScope(rec, userId, 'rpc.activities.write');
      if (denied) return denied;
      const activity = args.activity && typeof args.activity === 'object' ? args.activity as Record<string, unknown> : null;
      if (!activity) return err(RpcError.INVALID_PAYLOAD, 'activity is required');
      const stored = await setSdkActivity(userId, rec, activity);
      if (!stored) return err(RpcError.INVALID_PAYLOAD, 'Invalid activity');
      return { ok: true, data: stored };
    }
    case 'GET_RELATIONSHIPS': {
      const denied = await requireScope(rec, userId, 'relationships.read');
      if (denied) return denied;
      return { ok: true, data: { relationships: [] } };
    }
    // ─── Serika-internal helpers for the host's event payloads ─────────
    case 'SERIKA_CURRENT_USER': {
      const denied = await requireScope(rec, userId, 'identify');
      if (denied) return denied;
      return { ok: true, data: await userView(app, me) };
    }
    case 'SERIKA_GUILD_MEMBER': {
      const denied = await requireScope(rec, userId, 'identify');
      if (denied) return denied;
      if (!rec.location.guildId) return err(RpcError.INVALID_GUILD, 'Not in a server');
      const member = await ServerMember.findOne({ serverId: rec.location.guildId, userId });
      const ids = await publicIdsFor(app, [userId, rec.location.guildId]);
      return {
        ok: true,
        data: {
          user_id: ids.get(userId.toLowerCase()) ?? userId,
          nick: (member as { nickname?: string | null } | null)?.nickname ?? null,
          guild_id: ids.get(rec.location.guildId.toLowerCase()) ?? rec.location.guildId,
          avatar: null,
          avatar_decoration_data: null,
          color_string: null,
        },
      };
    }
    case 'SERIKA_VOICE_STATES': {
      const denied = await requireScope(rec, userId, 'rpc.voice.read');
      if (denied) return denied;
      return { ok: true, data: rec.location.voiceRoomId ? await voiceStates(app, rec) : [] };
    }
    case 'SERIKA_PUBLIC_IDS': {
      // Speaking events name users by id: only people in this Activity's call.
      const want = Array.isArray(args.userIds) ? args.userIds.filter((u): u is string => typeof u === 'string').slice(0, 50) : [];
      const { voiceRoomMemberIds } = await import('@/lib/api/voice');
      const allowed = new Set([...participants, ...(rec.location.voiceRoomId ? voiceRoomMemberIds(rec.location.voiceRoomId) : [])].map((u) => u.toLowerCase()));
      const ids = await publicIdsFor(app, want.filter((u) => allowed.has(u.toLowerCase())));
      return { ok: true, data: Object.fromEntries(ids) };
    }
    default:
      return err(RpcError.INVALID_COMMAND, `Invalid command: ${cmd}`);
  }
}

async function participantViews(app: ActivityApp, rec: ActivityInstanceRecord, ids: string[]) {
  const users = (ids.length ? await User.find({ id: { in: ids } }).catch(() => []) : []) as U[];
  const pub = await publicIdsFor(app, users.map((u) => u.id));
  let nicks = new Map<string, string | null>();
  if (rec.location.guildId && users.length) {
    const members = await ServerMember.find({ serverId: rec.location.guildId, userId: { in: users.map((u) => u.id) } }).catch(() => []) as Array<{ userId: string; nickname?: string | null }>;
    nicks = new Map(members.map((m) => [m.userId.toLowerCase(), m.nickname ?? null]));
  }
  return users.map((u) => ({
    ...sdkUser(u, pub.get(u.id.toLowerCase()) ?? u.id),
    ...(nicks.get(u.id.toLowerCase()) ? { nickname: nicks.get(u.id.toLowerCase()) } : {}),
  }));
}

async function voiceStates(app: ActivityApp, rec: ActivityInstanceRecord) {
  if (!rec.location.voiceRoomId) return [];
  const { voiceRoomStates } = await import('@/lib/api/voice');
  const states = voiceRoomStates(rec.location.voiceRoomId).slice(0, 50);
  const users = (states.length ? await User.find({ id: { in: states.map((s) => s.userId) } }).catch(() => []) : []) as U[];
  const byId = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  const pub = await publicIdsFor(app, states.map((s) => s.userId));
  return states.flatMap((s) => {
    const u = byId.get(s.userId.toLowerCase());
    if (!u) return [];
    return [{
      mute: false,
      nick: u.displayName ?? u.username,
      user: sdkUser(u, pub.get(u.id.toLowerCase()) ?? u.id),
      voice_state: { mute: s.mute, deaf: s.deaf, self_mute: s.selfMute, self_deaf: s.selfDeaf, suppress: s.suppress },
      volume: 100,
    }];
  });
}

/** authorize() consent shows up under Settings → Authorized Apps like any OAuth2 grant. */
async function recordConsent(app: ActivityApp, userId: string, scopes: string[]): Promise<void> {
  try {
    const { AuthorizedApp } = await import('@/lib/models');
    const existing = await AuthorizedApp.findOne({ userId, applicationId: app.id });
    if (existing) {
      await AuthorizedApp.updateById(existing.id, { scopes: Array.from(new Set([...(existing.scopes || []), ...scopes])), lastUsedAt: new Date() });
    } else {
      await AuthorizedApp.create({ userId, name: app.name, description: '', icon: app.icon || '', scopes, applicationId: app.id, lastUsedAt: new Date() });
    }
  } catch { /* best-effort */ }
}

/** Whether the user already granted every scope (lets authorize() skip the dialog with prompt "none"). */
export async function alreadyAuthorized(userId: string, applicationId: string, scopes: string[]): Promise<boolean> {
  try {
    const { AuthorizedApp } = await import('@/lib/models');
    const existing = await AuthorizedApp.findOne({ userId, applicationId });
    return !!existing && scopes.every((s) => (existing.scopes || []).includes(s));
  } catch {
    return false;
  }
}

