/**
 * Activity instances: pure rules (no I/O) shared by the instance service
 * (src/lib/services/activityInstances.ts), the SDK host and the tests.
 * Design: docs/architecture/activities.md, sections 4 and 5.
 *
 * One instance per (location, application). A location is a server channel
 * (text or voice; Discord kind "gc") or a DM / group DM (kind "pc"). An
 * instance launched from a call is voice-bound: only people in that call can
 * join, and leaving the call leaves the Activity.
 */
import { PERMISSION_BITS } from '@/lib/permissions/bits';

export type LocationKind = 'gc' | 'pc';

export interface ActivityLocation {
  kind: LocationKind;
  channelId: string;
  guildId: string | null;
  /** Voice room key (channel-<id>, dm:<a>_<b>, gdm:<id>) when launched from a call. */
  voiceRoomId: string | null;
}

export interface ActivityInstanceRecord {
  id: string;
  applicationId: string;
  launchId: string;
  location: ActivityLocation;
  launcherId: string;
  startedAt: number;
  /** The Game Invitation message (text-chat launches). */
  messageId: string | null;
  endedAt: number | null;
}

/** How long an instance may run before it is ended regardless (safety net). */
export const INSTANCE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** A participant whose frame hasn't sent a heartbeat for this long has left. */
export const PARTICIPANT_TIMEOUT_MS = 60_000;
/** How often the frame sends a heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** Hard cap on participants when the app sets none. */
export const DEFAULT_MAX_PARTICIPANTS = 100;

/** Discord's location id format, opaque to apps: `gc-<guild>-<channel>` / `pc-<channel>`. */
export function locationId(loc: Pick<ActivityLocation, 'kind' | 'channelId' | 'guildId'>): string {
  return loc.kind === 'gc' ? `gc-${loc.guildId}-${loc.channelId}` : `pc-${loc.channelId}`;
}

/** A new opaque instance id (`i-<random>`), like Discord's. */
export function newInstanceId(random: () => string): string {
  return `i-${random()}`;
}

const INSTANCE_ID_RE = /^i-[A-Za-z0-9_-]{8,64}$/;
export function isInstanceId(v: unknown): v is string {
  return typeof v === 'string' && INSTANCE_ID_RE.test(v);
}

export type ChannelLike = {
  id: string;
  type: string;
  serverId?: string | null;
  nsfw?: boolean | null;
  recipientIds?: string[] | null;
};

const VOICE_TYPES = new Set(['voice', 'stage']);
const TEXT_TYPES = new Set(['text', 'announcement', 'public_thread', 'private_thread', 'forum']);

export type LaunchDenied =
  | 'not_configured' | 'not_enabled' | 'no_access' | 'missing_permissions' | 'not_in_call'
  | 'age_restricted' | 'platform' | 'channel_type' | 'full';

export interface LaunchCheckInput {
  channel: ChannelLike;
  /** The user's permissions in a server channel (bitfield); ignored in DMs. */
  permissions: bigint;
  /** Whether the user is in the voice room the launch/join is bound to. */
  inVoiceRoom: boolean;
  /** Launch from a call (voice room) rather than the text chat. */
  voice: boolean;
  /** Server is age-gated (18+). */
  serverAgeGated: boolean;
  app: { enabled: boolean; ageGated: boolean; supportedPlatforms: string[] };
  /** The client's platform family (web, desktop, ios, android). */
  platform: string;
  domainConfigured: boolean;
}

/**
 * Whether a user may launch (or join) an Activity here. Server channels need
 * USE_EMBEDDED_ACTIVITIES (plus CONNECT for calls, SEND_MESSAGES for text
 * chats, where a Game Invitation is posted); DMs need only membership.
 * Age-gated Activities run only in NSFW channels or age-gated servers (we have
 * no per-user age), never in DMs.
 */
export function checkLaunch(input: LaunchCheckInput, mode: 'launch' | 'join'): { ok: true } | { ok: false; reason: LaunchDenied } {
  if (!input.domainConfigured) return { ok: false, reason: 'not_configured' };
  if (!input.app.enabled) return { ok: false, reason: 'not_enabled' };
  const ch = input.channel;
  const isDm = ch.type === 'dm' || ch.type === 'group_dm';
  if (!isDm && !ch.serverId) return { ok: false, reason: 'channel_type' };
  if (input.voice) {
    if (!isDm && !VOICE_TYPES.has(ch.type)) return { ok: false, reason: 'channel_type' };
    if (!input.inVoiceRoom) return { ok: false, reason: 'not_in_call' };
  } else if (!isDm && !TEXT_TYPES.has(ch.type) && !VOICE_TYPES.has(ch.type)) {
    return { ok: false, reason: 'channel_type' };
  }
  if (!isDm) {
    const p = input.permissions;
    const has = (bit: bigint) => (p & PERMISSION_BITS.ADMINISTRATOR) !== 0n || (p & bit) !== 0n;
    if (!has(PERMISSION_BITS.VIEW_CHANNEL)) return { ok: false, reason: 'no_access' };
    if (!has(PERMISSION_BITS.USE_EMBEDDED_ACTIVITIES)) return { ok: false, reason: 'missing_permissions' };
    if (input.voice && !has(PERMISSION_BITS.CONNECT)) return { ok: false, reason: 'missing_permissions' };
    if (mode === 'launch' && !input.voice && !has(PERMISSION_BITS.SEND_MESSAGES)) return { ok: false, reason: 'missing_permissions' };
  }
  if (input.app.ageGated && (isDm || !(ch.nsfw || input.serverAgeGated))) return { ok: false, reason: 'age_restricted' };
  if (!input.app.supportedPlatforms.includes(input.platform)) return { ok: false, reason: 'platform' };
  return { ok: true };
}

/** User-facing English text for a refusal (the client maps codes to translated strings). */
export const LAUNCH_DENIED_MESSAGES: Record<LaunchDenied, string> = {
  not_configured: 'Activities are not available on this server.',
  not_enabled: 'This Activity is not available.',
  no_access: 'You do not have access to this channel.',
  missing_permissions: 'You do not have permission to start Activities here.',
  not_in_call: 'Join the call to play this Activity.',
  age_restricted: 'This Activity is age-restricted and can only be played in age-restricted channels.',
  platform: 'This Activity is not available on this device.',
  channel_type: 'Activities can not be started here.',
  full: 'This Activity is full.',
};

/** Platform family from a client hint (Capacitor apps say ios/android, the Qt shell desktop). */
export function platformFamily(hint: unknown): 'web' | 'desktop' | 'ios' | 'android' {
  return hint === 'desktop' || hint === 'ios' || hint === 'android' ? hint : 'web';
}

/** The SDK's `platform` query param: desktop for web + desktop app, mobile for the phone apps. */
export function sdkPlatform(family: string): 'desktop' | 'mobile' {
  return family === 'ios' || family === 'android' ? 'mobile' : 'desktop';
}

export interface CardState {
  ended: boolean;
  participantCount: number;
}

/** The Game Invitation card's status line key (the client translates it). */
export function cardStatus(state: CardState | null): 'ended' | 'waiting' | 'playing' {
  if (!state || state.ended) return 'ended';
  return state.participantCount > 0 ? 'playing' : 'waiting';
}

/** Participants left after dropping heartbeats older than the timeout. */
export function liveParticipants(scores: Array<{ userId: string; seenAt: number }>, now: number, timeoutMs = PARTICIPANT_TIMEOUT_MS): { live: string[]; stale: string[] } {
  const live: string[] = [];
  const stale: string[] = [];
  for (const s of scores) (now - s.seenAt > timeoutMs ? stale : live).push(s.userId);
  return { live, stale };
}

/** Whether an instance has to end now (nobody left, or past its maximum age). */
export function shouldEnd(rec: Pick<ActivityInstanceRecord, 'startedAt' | 'endedAt'>, liveCount: number, now: number, graceMs = 15_000): boolean {
  if (rec.endedAt) return false;
  if (now - rec.startedAt > INSTANCE_MAX_AGE_MS) return true;
  // A fresh launch gets a short grace period for the launcher's frame to connect.
  return liveCount === 0 && now - rec.startedAt > graceMs;
}

/** Discord channel type numbers for the SDK's getChannel(). */
export function discordChannelType(type: string): number {
  switch (type) {
    case 'text': return 0;
    case 'dm': return 1;
    case 'voice': return 2;
    case 'group_dm': return 3;
    case 'category': return 4;
    case 'announcement': return 5;
    case 'public_thread': return 11;
    case 'private_thread': return 12;
    case 'stage': return 13;
    case 'forum': return 15;
    default: return -1;
  }
}

/** The Embedded App SDK user object (ids already in the app's id format). */
export function sdkUser(u: { id: string; username: string; displayName?: string | null; avatar?: string | null; isBot?: boolean | null }, publicId: string) {
  return {
    id: publicId,
    username: u.username,
    discriminator: '0',
    global_name: u.displayName ?? null,
    avatar: u.avatar ?? null,
    avatar_decoration_data: null,
    bot: Boolean(u.isBot),
    flags: 0,
    premium_type: 0,
  };
}

/** Discord's EmbeddedActivityInstance (GET /applications/{id}/activity-instances/{id}, GUILD_CREATE). */
export function discordInstance(
  rec: ActivityInstanceRecord,
  ids: { applicationId: string; channelId: string; guildId: string | null; users: string[] },
) {
  const location = rec.location.kind === 'gc'
    ? { id: locationId({ kind: 'gc', guildId: ids.guildId, channelId: ids.channelId }), kind: 'gc' as const, channel_id: ids.channelId, guild_id: ids.guildId }
    : { id: locationId({ kind: 'pc', guildId: null, channelId: ids.channelId }), kind: 'pc' as const, channel_id: ids.channelId };
  return {
    application_id: ids.applicationId,
    instance_id: rec.id,
    launch_id: rec.launchId,
    location,
    users: ids.users,
  };
}

// ─── SDK protocol frames ────────────────────────────────────

export const Opcode = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, HELLO: 3 } as const;

export const RpcError = {
  INVALID_PAYLOAD: 4000,
  INVALID_COMMAND: 4002,
  INVALID_GUILD: 4003,
  INVALID_EVENT: 4004,
  INVALID_CHANNEL: 4005,
  INVALID_PERMISSIONS: 4006,
  INVALID_CLIENTID: 4007,
  INVALID_ORIGIN: 4008,
  INVALID_TOKEN: 4009,
  INVALID_USER: 4010,
} as const;

export const RpcClose = { NORMAL: 1000, UNSUPPORTED: 1003, ABNORMAL: 1006, INVALID_CLIENTID: 4000, INVALID_ORIGIN: 4001, RATELIMITED: 4002, TOKEN_REVOKED: 4003, INVALID_VERSION: 4004, INVALID_ENCODING: 4005 } as const;

export type InboundFrame =
  | { op: 0; handshake: { v: number; encoding?: string; client_id: string; frame_id: string; sdk_version?: string } }
  | { op: 1; frame: { cmd: string; args: Record<string, unknown>; nonce: string; evt?: string | null } }
  | { op: 2; close: { code: number; message?: string } }
  | { op: 3 };

/** Validate a message the app sent through the relay. Null when it is malformed (ignored, like Discord). */
export function parseInboundFrame(raw: unknown): InboundFrame | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [op, payload] = raw as [unknown, unknown];
  if (op === Opcode.HELLO) return { op: 3 };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (op === Opcode.HANDSHAKE) {
    if (typeof p.v !== 'number' || typeof p.client_id !== 'string' || typeof p.frame_id !== 'string') return null;
    if (p.client_id.length > 64 || p.frame_id.length > 128) return null;
    return { op: 0, handshake: { v: p.v, encoding: typeof p.encoding === 'string' ? p.encoding : undefined, client_id: p.client_id, frame_id: p.frame_id, sdk_version: typeof p.sdk_version === 'string' ? p.sdk_version.slice(0, 32) : undefined } };
  }
  if (op === Opcode.FRAME) {
    if (typeof p.cmd !== 'string' || p.cmd.length > 64 || !/^[A-Z_]+$/.test(p.cmd)) return null;
    if (typeof p.nonce !== 'string' || p.nonce.length > 64) return null;
    const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? (p.args as Record<string, unknown>) : {};
    return { op: 1, frame: { cmd: p.cmd, args, nonce: p.nonce, evt: typeof p.evt === 'string' ? p.evt : null } };
  }
  if (op === Opcode.CLOSE) {
    return { op: 2, close: { code: typeof p.code === 'number' ? p.code : RpcClose.NORMAL, message: typeof p.message === 'string' ? p.message.slice(0, 200) : undefined } };
  }
  return null;
}

/** A command reply frame. */
export function replyFrame(cmd: string, nonce: string, data: unknown): [1, Record<string, unknown>] {
  return [Opcode.FRAME, { cmd, evt: null, nonce, data: data === undefined ? null : data }];
}

/** A command error frame (Discord: evt "ERROR" with { code, message }). */
export function errorFrame(cmd: string, nonce: string | null, code: number, message: string): [1, Record<string, unknown>] {
  return [Opcode.FRAME, { cmd, evt: 'ERROR', nonce, data: { code, message } }];
}

/** An event dispatch frame. */
export function dispatchFrame(evt: string, data: unknown): [1, Record<string, unknown>] {
  return [Opcode.FRAME, { cmd: 'DISPATCH', evt, nonce: null, data }];
}

/** The host closing the SDK. */
export function closeFrame(code: number, message: string): [2, Record<string, unknown>] {
  return [Opcode.CLOSE, { code, message }];
}

/** Events the SDK can subscribe to, with the OAuth2 scope Discord requires (null = none). */
export const SUBSCRIBABLE_EVENTS: Record<string, string | null> = {
  VOICE_STATE_UPDATE: 'rpc.voice.read',
  SPEAKING_START: 'rpc.voice.read',
  SPEAKING_STOP: 'rpc.voice.read',
  ACTIVITY_LAYOUT_MODE_UPDATE: null,
  ORIENTATION_UPDATE: null,
  CURRENT_USER_UPDATE: 'identify',
  CURRENT_GUILD_MEMBER_UPDATE: 'identify',
  ENTITLEMENT_CREATE: null,
  THERMAL_STATE_UPDATE: null,
  ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE: null,
  RELATIONSHIP_UPDATE: 'relationships.read',
  ACTIVITY_JOIN: null,
  QUEST_ENROLLMENT_STATUS_UPDATE: null,
};

/** Scopes an app may request through the SDK's authorize(). */
export const SDK_AUTHORIZE_SCOPES = new Set([
  'identify', 'email', 'guilds', 'guilds.members.read', 'rpc.voice.read', 'rpc.activities.write', 'applications.commands',
  'relationships.read', 'activities.read', 'activities.write', 'connections', 'openid', 'role_connections.write', 'dm_channels.read',
]);

/** Validate authorize() scopes: a non-empty list of known scopes (unknown ones are an error, like Discord). */
export function parseAuthorizeScopes(raw: unknown): { ok: true; scopes: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return { ok: false, message: 'scopes must be a non-empty list' };
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string' || !SDK_AUTHORIZE_SCOPES.has(s)) return { ok: false, message: `Invalid scope: ${String(s).slice(0, 40)}` };
    if (!out.includes(s)) out.push(s);
  }
  return { ok: true, scopes: out };
}

/** Only https links (and a few safe app schemes are refused): what openExternalLink may open. */
export function safeExternalLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
