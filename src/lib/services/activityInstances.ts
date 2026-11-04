/**
 * Activity instances (CORD-92): launch, join, heartbeat, leave, end, and what
 * everyone sees of them. Rules are pure in src/lib/activities/instances.ts;
 * this file is the Redis state, the Game Invitation message, live updates,
 * "Playing <Activity>" presence and the launch log.
 *
 * Redis (shared by every instance of the app):
 *   act:inst:<id>              JSON ActivityInstanceRecord (TTL 13 h)
 *   act:loc:<channel>:<app>    the running instance of an app at a location (SET NX)
 *   act:users:<id>             ZSET user id -> last heartbeat (ms)
 *   act:active                 SET of running instance ids (the sweeper walks it)
 *   act:chan:<channel>         SET of running instance ids at a channel
 *   act:guild:<guild>          SET of running instance ids in a server (GUILD_CREATE)
 *   act:auth:<id>:<user>       the scopes the app authenticated with (SDK host)
 *
 * Design: docs/architecture/activities.md, section 4.
 */
import { randomBytes, randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import { config } from '@/lib/config';
import { Application, Channel, Server, User, type IChannel } from '@/lib/models';
import { processShared } from '@/lib/realtime/processShared';
import {
  DEFAULT_MAX_PARTICIPANTS, INSTANCE_MAX_AGE_MS, LAUNCH_DENIED_MESSAGES, PARTICIPANT_TIMEOUT_MS, checkLaunch, isInstanceId,
  liveParticipants, newInstanceId, shouldEnd, type ActivityInstanceRecord, type ActivityLocation, type LaunchDenied,
} from '@/lib/activities/instances';
import { activityHostLabel } from '@/lib/activities/settings';
import { snowflakeNow } from '@/lib/botapi/commands';

const TTL_S = Math.ceil((INSTANCE_MAX_AGE_MS + 60 * 60 * 1000) / 1000);
const PRESENCE_TYPE = 'activity';

const kInst = (id: string) => `act:inst:${id}`;
const kLoc = (channelId: string, appId: string) => `act:loc:${channelId.toLowerCase()}:${appId.toLowerCase()}`;
const kUsers = (id: string) => `act:users:${id}`;
const kChan = (channelId: string) => `act:chan:${channelId.toLowerCase()}`;
const kGuild = (guildId: string) => `act:guild:${guildId.toLowerCase()}`;
const kAuth = (id: string, userId: string) => `act:auth:${id}:${userId.toLowerCase()}`;
const ACTIVE = 'act:active';

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ─── Launch log (Postgres) ──────────────────────────────────

const g = globalThis as unknown as { __activityLaunchSchema?: Promise<void> | null };

/** activity_launches: one row per launch (audit / analytics). drizzle/manual_activities.sql. */
export function ensureActivityLaunchSchema(): Promise<void> {
  if (g.__activityLaunchSchema) return g.__activityLaunchSchema;
  g.__activityLaunchSchema = ensureSchema(
    'activity-launches',
    { tables: { activity_launches: ['instance_id', 'application_id', 'launch_id', 'location_kind', 'channel_id', 'guild_id', 'voice', 'launcher_id', 'message_id', 'started_at', 'ended_at', 'peak_participants'] } },
    () => withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS activity_launches (
        instance_id text PRIMARY KEY,
        application_id uuid NOT NULL,
        launch_id text NOT NULL,
        location_kind text NOT NULL,
        channel_id uuid NOT NULL,
        guild_id uuid,
        voice boolean NOT NULL DEFAULT false,
        launcher_id uuid NOT NULL,
        message_id uuid,
        started_at timestamp NOT NULL DEFAULT now(),
        ended_at timestamp,
        peak_participants integer NOT NULL DEFAULT 0
      )`,
      sql`CREATE INDEX IF NOT EXISTS activity_launches_application_id_idx ON activity_launches (application_id, started_at)`,
      sql`CREATE INDEX IF NOT EXISTS activity_launches_channel_id_idx ON activity_launches (channel_id, started_at)`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__activityLaunchSchema = null;
    throw err;
  });
  return g.__activityLaunchSchema;
}

async function logLaunch(rec: ActivityInstanceRecord): Promise<void> {
  try {
    await ensureActivityLaunchSchema();
    await db.insert(schema.activityLaunches).values({
      instanceId: rec.id,
      applicationId: rec.applicationId,
      launchId: rec.launchId,
      locationKind: rec.location.kind,
      channelId: rec.location.channelId,
      guildId: rec.location.guildId,
      voice: Boolean(rec.location.voiceRoomId),
      launcherId: rec.launcherId,
      messageId: rec.messageId,
      startedAt: new Date(rec.startedAt),
    }).onConflictDoNothing();
  } catch (err) {
    console.error('[activities] launch log failed:', (err as Error)?.message ?? err);
  }
}

async function logUpdate(id: string, patch: { messageId?: string; endedAt?: Date; peak?: number }): Promise<void> {
  try {
    await ensureActivityLaunchSchema();
    const set: Record<string, unknown> = {};
    if (patch.messageId) set.messageId = patch.messageId;
    if (patch.endedAt) set.endedAt = patch.endedAt;
    if (patch.peak !== undefined) set.peakParticipants = sql`GREATEST(${schema.activityLaunches.peakParticipants}, ${patch.peak})`;
    if (Object.keys(set).length) await db.update(schema.activityLaunches).set(set).where(eq(schema.activityLaunches.instanceId, id));
  } catch { /* best-effort */ }
}

// ─── Records ────────────────────────────────────────────────

function redisOrThrow() {
  const r = getRedis();
  if (!r) throw new Error('Redis unavailable');
  return r;
}

export async function getInstance(id: string): Promise<ActivityInstanceRecord | null> {
  if (!isInstanceId(id)) return null;
  const raw = await redisOrThrow().get(kInst(id));
  if (!raw) return null;
  try { return JSON.parse(raw) as ActivityInstanceRecord; } catch { return null; }
}

async function saveInstance(rec: ActivityInstanceRecord): Promise<void> {
  await redisOrThrow().set(kInst(rec.id), JSON.stringify(rec), 'EX', TTL_S);
}

async function participantIds(id: string, now = Date.now()): Promise<string[]> {
  const r = redisOrThrow();
  const raw = await r.zrange(kUsers(id), 0, -1, 'WITHSCORES');
  const scores: Array<{ userId: string; seenAt: number }> = [];
  for (let i = 0; i < raw.length; i += 2) scores.push({ userId: raw[i], seenAt: Number(raw[i + 1]) });
  return liveParticipants(scores, now).live;
}

// ─── Location + permission checks ───────────────────────────

export type ActivityApp = {
  id: string;
  clientId: string;
  name: string;
  icon: string | null;
  botId: string | null;
  apiIdFormat: string | null;
  imageUrl: string | null;
  maxParticipants: number;
  settings: Awaited<ReturnType<typeof import('@/lib/services/activitySettings').getActivitySettings>>;
};

export async function loadActivityApp(applicationId: string): Promise<ActivityApp | null> {
  const app = await Application.findById(applicationId).catch(() => null);
  if (!app) return null;
  const { getActivitySettings } = await import('@/lib/services/activitySettings');
  const { getAppApiExtras } = await import('@/lib/services/applicationApiSettings');
  const [settings, extras] = await Promise.all([getActivitySettings(app.id), getAppApiExtras(app.id)]);
  return {
    id: app.id,
    clientId: app.clientId,
    name: settings.displayName || app.name,
    icon: app.icon ?? null,
    botId: app.botId ?? null,
    apiIdFormat: (app as { apiIdFormat?: string | null }).apiIdFormat ?? null,
    imageUrl: settings.imageUrl ?? app.coverImage ?? null,
    maxParticipants: Math.min(extras.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS, DEFAULT_MAX_PARTICIPANTS),
    settings,
  };
}

/** The voice room a call launch at this channel is bound to. */
export function voiceRoomFor(channel: Pick<IChannel, 'id' | 'type' | 'recipientIds'>): string | null {
  if (channel.type === 'voice' || channel.type === 'stage') return `channel-${channel.id.toLowerCase()}`;
  if (channel.type === 'group_dm') return `gdm:${channel.id.toLowerCase()}`;
  if (channel.type === 'dm' && channel.recipientIds && channel.recipientIds.length === 2) {
    const [a, b] = channel.recipientIds.map((x) => x.toLowerCase()).sort();
    return `dm:${a}_${b}`;
  }
  return null;
}

async function inVoiceRoom(roomId: string | null, userId: string): Promise<boolean> {
  if (!roomId) return false;
  const { voiceRoomMemberIds } = await import('@/lib/api/voice');
  return voiceRoomMemberIds(roomId).some((u) => same(u, userId));
}

type Access = { ok: true; channel: IChannel; permissions: bigint; serverAgeGated: boolean } | { ok: false; reason: LaunchDenied };

async function channelAccess(userId: string, channelId: string): Promise<Access> {
  const { checkChannelAccess, getMemberChannelPermissions } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(userId, channelId);
  if (!access.hasAccess || !access.channel) return { ok: false, reason: 'no_access' };
  const channel = access.channel as IChannel;
  if (!channel.serverId) return { ok: true, channel, permissions: 0n, serverAgeGated: false };
  const [permissions, server] = await Promise.all([
    getMemberChannelPermissions(userId, channel as IChannel & { serverId: string }, access.membership ?? null),
    Server.findById(channel.serverId),
  ]);
  return { ok: true, channel, permissions, serverAgeGated: Boolean((server as { isAgeGated?: boolean } | null)?.isAgeGated) };
}

export type ActivityResult<T> = { ok: true } & T | { ok: false; status: number; reason: LaunchDenied | 'not_found' | 'unavailable' | 'rate_limited'; error: string };

function denied(reason: LaunchDenied, status = 403): { ok: false; status: number; reason: LaunchDenied; error: string } {
  return { ok: false, status, reason, error: LAUNCH_DENIED_MESSAGES[reason] };
}

// ─── Launch / join / heartbeat / leave ──────────────────────

export interface LaunchOptions {
  user: { id: string; username: string };
  applicationId: string;
  channelId: string;
  /** Launch into the call at this channel (voice-bound) instead of the text chat. */
  voice: boolean;
  platform: string;
  /** Text-chat launches post a Game Invitation; this names the command that did it. */
  commandName?: string;
  /** Tell the launcher's clients to open the Activity (launches from a command / interaction). */
  openFor?: boolean;
}

/**
 * Launch an Activity at a location, or join the one already running there.
 * Text-chat launches post the Game Invitation message (from the app's bot).
 */
export async function launchActivity(opts: LaunchOptions): Promise<ActivityResult<{ instance: ActivityInstanceRecord; created: boolean }>> {
  const app = await loadActivityApp(opts.applicationId);
  if (!app) return { ok: false, status: 404, reason: 'not_found', error: 'Unknown application' };
  const access = await channelAccess(opts.user.id, opts.channelId);
  if (!access.ok) return denied(access.reason);
  const channel = access.channel;
  const roomId = opts.voice ? voiceRoomFor(channel) : null;
  const check = checkLaunch({
    channel,
    permissions: access.permissions,
    inVoiceRoom: await inVoiceRoom(roomId, opts.user.id),
    voice: opts.voice,
    serverAgeGated: access.serverAgeGated,
    app: { enabled: app.settings.enabled, ageGated: app.settings.ageGated, supportedPlatforms: app.settings.supportedPlatforms },
    // 'any': an interaction launch (the server doesn't know the device); joining re-checks it.
    platform: opts.platform === 'any' ? app.settings.supportedPlatforms[0] ?? 'web' : opts.platform,
    domainConfigured: Boolean(config.ACTIVITIES_DOMAIN) && Boolean(activityHostLabel(app.clientId)),
  }, 'launch');
  if (!check.ok) return denied(check.reason);

  const r = redisOrThrow();
  const locKey = kLoc(channel.id, app.id);
  const existingId = await r.get(locKey);
  if (existingId) {
    const existing = await getInstance(existingId);
    if (existing && !existing.endedAt) {
      const joined = await joinActivity(opts.user, existing.id, opts.platform === 'any' ? app.settings.supportedPlatforms[0] ?? 'web' : opts.platform);
      if (!joined.ok) return joined;
      if (opts.openFor) void openFor(opts.user.id, existing.id);
      return { ok: true, instance: existing, created: false };
    }
    await r.del(locKey);
  }

  const rec: ActivityInstanceRecord = {
    id: newInstanceId(() => randomBytes(12).toString('base64url')),
    applicationId: app.id,
    launchId: snowflakeNow(),
    location: {
      kind: channel.serverId ? 'gc' : 'pc',
      channelId: channel.id,
      guildId: channel.serverId ?? null,
      voiceRoomId: roomId,
    } satisfies ActivityLocation,
    launcherId: opts.user.id,
    startedAt: Date.now(),
    messageId: null,
    endedAt: null,
  };
  const won = await r.set(locKey, rec.id, 'EX', TTL_S, 'NX');
  if (!won) {
    // Someone launched at the same moment: join theirs.
    const otherId = await r.get(locKey);
    const other = otherId ? await getInstance(otherId) : null;
    if (other && !other.endedAt) {
      const joined = await joinActivity(opts.user, other.id, opts.platform === 'any' ? app.settings.supportedPlatforms[0] ?? 'web' : opts.platform);
      if (!joined.ok) return joined;
      if (opts.openFor) void openFor(opts.user.id, other.id);
      return { ok: true, instance: other, created: false };
    }
    return { ok: false, status: 409, reason: 'unavailable', error: 'Try again.' };
  }
  await saveInstance(rec);
  const multi = r.multi();
  multi.sadd(ACTIVE, rec.id);
  multi.sadd(kChan(channel.id), rec.id);
  multi.expire(kChan(channel.id), TTL_S);
  if (channel.serverId) { multi.sadd(kGuild(channel.serverId), rec.id); multi.expire(kGuild(channel.serverId), TTL_S); }
  multi.zadd(kUsers(rec.id), Date.now(), opts.user.id.toLowerCase());
  multi.expire(kUsers(rec.id), TTL_S);
  await multi.exec();
  ensureSweeper();

  if (!opts.voice) {
    const messageId = await postInvitation(app, channel, rec, opts.user, opts.commandName ?? null);
    if (messageId) {
      rec.messageId = messageId;
      await saveInstance(rec);
    }
  }
  void logLaunch(rec);
  void setPlayingPresence(opts.user.id, app, rec);
  await broadcast(rec, app);
  if (opts.openFor) void openFor(opts.user.id, rec.id);
  return { ok: true, instance: rec, created: true };
}

/** Ask a user's clients to open an Activity frame (launched by a command, not a click). */
async function openFor(userId: string, instanceId: string): Promise<void> {
  try {
    const { fanoutToUsers } = await import('@/lib/api/activity');
    await fanoutToUsers({ userIds: [userId] }, { type: 'activity_open', instanceId });
  } catch { /* best-effort */ }
}

/** Join a running instance (re-checked against the location every time). */
export async function joinActivity(user: { id: string }, instanceId: string, platform: string): Promise<ActivityResult<{ instance: ActivityInstanceRecord }>> {
  const rec = await getInstance(instanceId);
  if (!rec || rec.endedAt) return { ok: false, status: 404, reason: 'not_found', error: 'This Activity has ended.' };
  const app = await loadActivityApp(rec.applicationId);
  if (!app) return { ok: false, status: 404, reason: 'not_found', error: 'Unknown application' };
  const access = await channelAccess(user.id, rec.location.channelId);
  if (!access.ok) return denied(access.reason);
  const check = checkLaunch({
    channel: access.channel,
    permissions: access.permissions,
    inVoiceRoom: await inVoiceRoom(rec.location.voiceRoomId, user.id),
    voice: Boolean(rec.location.voiceRoomId),
    serverAgeGated: access.serverAgeGated,
    app: { enabled: app.settings.enabled, ageGated: app.settings.ageGated, supportedPlatforms: app.settings.supportedPlatforms },
    platform,
    domainConfigured: Boolean(config.ACTIVITIES_DOMAIN),
  }, 'join');
  if (!check.ok) return denied(check.reason);
  const r = redisOrThrow();
  const already = await r.zscore(kUsers(rec.id), user.id.toLowerCase());
  if (already === null) {
    const live = await participantIds(rec.id);
    if (live.length >= app.maxParticipants) return denied('full', 409);
  }
  await r.zadd(kUsers(rec.id), Date.now(), user.id.toLowerCase());
  if (already === null) {
    void setPlayingPresence(user.id, app, rec);
    await broadcast(rec, app);
  }
  return { ok: true, instance: rec };
}

/** A participant's frame is still open. False when they're not (or no longer) in it. */
export async function heartbeatActivity(user: { id: string }, instanceId: string): Promise<boolean> {
  const rec = await getInstance(instanceId);
  if (!rec || rec.endedAt) return false;
  const r = redisOrThrow();
  if ((await r.zscore(kUsers(rec.id), user.id.toLowerCase())) === null) return false;
  if (rec.location.voiceRoomId && !(await inVoiceRoom(rec.location.voiceRoomId, user.id))) {
    await leaveActivity(user, instanceId);
    return false;
  }
  await r.zadd(kUsers(rec.id), Date.now(), user.id.toLowerCase());
  void refreshPlayingPresence(user.id, rec.applicationId);
  return true;
}

export async function leaveActivity(user: { id: string }, instanceId: string): Promise<void> {
  const rec = await getInstance(instanceId);
  if (!rec) return;
  const removed = await redisOrThrow().zrem(kUsers(rec.id), user.id.toLowerCase());
  await r2ClearAuth(rec.id, user.id);
  void clearPlayingPresence(user.id, rec.applicationId);
  if (removed && !rec.endedAt) {
    const live = await participantIds(rec.id);
    if (live.length === 0) await endInstance(rec.id);
    else {
      const app = await loadActivityApp(rec.applicationId);
      if (app) await broadcast(rec, app);
    }
  }
}

async function r2ClearAuth(id: string, userId: string) {
  try { await redisOrThrow().del(kAuth(id, userId)); } catch { /* ignore */ }
}

/** A user left a call: they leave every Activity bound to it. */
export async function onVoiceRoomLeave(roomId: string, userId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const ids = await r.smembers(ACTIVE);
  for (const id of ids) {
    const rec = await getInstance(id);
    if (rec && !rec.endedAt && rec.location.voiceRoomId === roomId) {
      if ((await r.zscore(kUsers(id), userId.toLowerCase())) !== null) await leaveActivity({ id: userId }, id);
    }
  }
}

/** End an instance: nobody can join any more, the card flips to "ended". */
export async function endInstance(id: string): Promise<void> {
  const rec = await getInstance(id);
  if (!rec || rec.endedAt) return;
  const r = redisOrThrow();
  rec.endedAt = Date.now();
  await saveInstance(rec);
  const users = await r.zrange(kUsers(id), 0, -1);
  const multi = r.multi();
  multi.srem(ACTIVE, id);
  multi.srem(kChan(rec.location.channelId), id);
  if (rec.location.guildId) multi.srem(kGuild(rec.location.guildId), id);
  multi.del(kUsers(id));
  await multi.exec();
  const loc = kLoc(rec.location.channelId, rec.applicationId);
  if ((await r.get(loc)) === id) await r.del(loc);
  for (const u of users) void clearPlayingPresence(u, rec.applicationId);
  void logUpdate(id, { endedAt: new Date(rec.endedAt) });
  const app = await loadActivityApp(rec.applicationId);
  if (app) await broadcast(rec, app, []);
}

// ─── Sweeper ────────────────────────────────────────────────

/** Drop participants whose frame stopped sending heartbeats, end empty or expired instances. */
export async function sweepActivities(now = Date.now()): Promise<void> {
  const r = getRedis();
  if (!r) return;
  // One sweeper at a time across instances.
  const lock = await r.set('act:sweep-lock', String(process.pid), 'PX', 25_000, 'NX');
  if (!lock) return;
  const ids = await r.smembers(ACTIVE);
  for (const id of ids) {
    const rec = await getInstance(id);
    if (!rec) { await r.srem(ACTIVE, id); continue; }
    if (rec.endedAt) { await r.srem(ACTIVE, id); continue; }
    const stale = await r.zrangebyscore(kUsers(id), 0, now - PARTICIPANT_TIMEOUT_MS);
    if (stale.length) {
      await r.zremrangebyscore(kUsers(id), 0, now - PARTICIPANT_TIMEOUT_MS);
      for (const u of stale) { void clearPlayingPresence(u, rec.applicationId); await r2ClearAuth(id, u); }
    }
    const live = await participantIds(id, now);
    if (shouldEnd(rec, live.length, now)) await endInstance(id);
    else if (stale.length) {
      const app = await loadActivityApp(rec.applicationId);
      if (app) await broadcast(rec, app, live);
    }
  }
}

function ensureSweeper(): void {
  processShared('activities:sweeper', () => {
    const t = setInterval(() => { void sweepActivities().catch(() => {}); }, 20_000);
    (t as { unref?: () => void }).unref?.();
    return t;
  });
}

/** Start the sweeper at boot when instances may be running (another process may have launched them). */
export function startActivitySweeper(): void {
  if (config.ACTIVITIES_DOMAIN) ensureSweeper();
}

// ─── Views ──────────────────────────────────────────────────

export interface InstanceView {
  id: string;
  applicationId: string;
  launchId: string;
  app: { id: string; clientId: string; name: string; icon: string | null; imageUrl: string | null; botId: string | null };
  location: { kind: 'gc' | 'pc'; channelId: string; guildId: string | null; voice: boolean };
  launcherId: string;
  startedAt: number;
  endedAt: number | null;
  participants: Array<{ id: string; username: string; displayName: string | null; avatar: string | null }>;
}

async function viewOf(rec: ActivityInstanceRecord, app: ActivityApp, participants?: string[]): Promise<InstanceView> {
  const ids = rec.endedAt ? [] : participants ?? await participantIds(rec.id);
  const users = ids.length ? await User.find({ id: { in: ids } }).catch(() => []) : [];
  return {
    id: rec.id,
    applicationId: rec.applicationId,
    launchId: rec.launchId,
    app: { id: app.id, clientId: app.clientId, name: app.name, icon: app.icon, imageUrl: app.imageUrl, botId: app.botId },
    location: { kind: rec.location.kind, channelId: rec.location.channelId, guildId: rec.location.guildId, voice: Boolean(rec.location.voiceRoomId) },
    launcherId: rec.launcherId,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    participants: (users as Array<{ id: string; username: string; displayName?: string | null; avatar?: string | null }>).map((u) => ({
      id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null,
    })),
  };
}

/** An instance as a location member sees it (null when they can't see the location). */
export async function instanceViewFor(userId: string, instanceId: string): Promise<InstanceView | null> {
  const rec = await getInstance(instanceId);
  if (!rec) return null;
  const access = await channelAccess(userId, rec.location.channelId);
  if (!access.ok) return null;
  const app = await loadActivityApp(rec.applicationId);
  if (!app) return null;
  return viewOf(rec, app);
}

/** Running instances at a channel the user can see (for the shelf and call bars). */
export async function channelInstances(userId: string, channelId: string): Promise<InstanceView[]> {
  const access = await channelAccess(userId, channelId);
  if (!access.ok) return [];
  const ids = await redisOrThrow().smembers(kChan(channelId));
  const out: InstanceView[] = [];
  for (const id of ids.slice(0, 25)) {
    const rec = await getInstance(id);
    if (!rec || rec.endedAt) continue;
    const app = await loadActivityApp(rec.applicationId);
    if (app) out.push(await viewOf(rec, app));
  }
  return out;
}

/** Running instances in a server (bot API / GUILD_CREATE). */
export async function guildInstanceRecords(guildId: string): Promise<Array<{ rec: ActivityInstanceRecord; users: string[] }>> {
  const r = getRedis();
  if (!r) return [];
  const ids = await r.smembers(kGuild(guildId)).catch(() => [] as string[]);
  const out: Array<{ rec: ActivityInstanceRecord; users: string[] }> = [];
  for (const id of ids.slice(0, 50)) {
    const rec = await getInstance(id).catch(() => null);
    if (rec && !rec.endedAt) out.push({ rec, users: await participantIds(id) });
  }
  return out;
}

export async function instanceParticipants(id: string): Promise<string[]> {
  return participantIds(id);
}

// ─── SDK authentication per participant ─────────────────────

export async function recordInstanceAuth(instanceId: string, userId: string, scopes: string[]): Promise<void> {
  await redisOrThrow().set(kAuth(instanceId, userId), JSON.stringify(scopes), 'EX', TTL_S);
}

export async function instanceAuthScopes(instanceId: string, userId: string): Promise<string[]> {
  const raw = await redisOrThrow().get(kAuth(instanceId, userId));
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; } catch { return []; }
}

// ─── Game Invitation message + live updates ─────────────────

async function postInvitation(app: ActivityApp, channel: IChannel, rec: ActivityInstanceRecord, user: { id: string; username: string }, commandName: string | null): Promise<string | null> {
  try {
    let botId = app.botId;
    if (!botId) {
      const full = await Application.findById(app.id);
      if (full) {
        const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
        const provisioned = await ensureBotProvisioned(full) as { botId?: string | null } | null;
        botId = provisioned?.botId ?? (await Application.findById(app.id))?.botId ?? null;
      }
    }
    if (!botId) return null;
    const { createAppMessage } = await import('@/lib/services/appMessages');
    const created = await createAppMessage({
      author: { kind: 'bot', botId, applicationId: app.id },
      channel,
      body: { content: '', embeds: [], components: null, attachments: [], flags: 0, mentionedUserIds: [] },
      interaction: {
        id: randomUUID(),
        type: 2,
        name: commandName ?? 'launch',
        user: { id: user.id, username: user.username },
        applicationId: app.id,
        activity: { instanceId: rec.id, launchId: rec.launchId, applicationId: app.id },
      },
    });
    if (!created.ephemeral) void logUpdate(rec.id, { messageId: created.id });
    return created.ephemeral ? null : created.id;
  } catch (err) {
    console.error('[activities] invitation message failed:', (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Tell everyone who can see the location (the chat's stream, so the card
 * updates) and every participant (their own stream, so open frames get
 * ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE).
 */
async function broadcast(rec: ActivityInstanceRecord, app: ActivityApp, participants?: string[]): Promise<void> {
  try {
    const view = await viewOf(rec, app, participants);
    const payload = { type: 'activity_update', instance: view };
    const channel = await Channel.findById(rec.location.channelId);
    if (channel) {
      if (!channel.serverId && (channel.type === 'dm' || channel.type === 'group_dm')) {
        const { publishToDm } = await import('@/lib/api/dms');
        publishToDm(channel.id, payload);
      } else {
        const { publishToChannel } = await import('@/lib/api/channels');
        publishToChannel(channel.id, payload);
      }
    }
    const { fanoutToUsers } = await import('@/lib/api/activity');
    const userIds = new Set(view.participants.map((p) => p.id));
    if (rec.location.voiceRoomId) {
      const { voiceRoomMemberIds } = await import('@/lib/api/voice');
      for (const u of voiceRoomMemberIds(rec.location.voiceRoomId)) userIds.add(u);
    } else if (channel && !channel.serverId) {
      for (const u of channel.recipientIds ?? []) userIds.add(u);
    }
    if (userIds.size) await fanoutToUsers({ userIds: [...userIds] }, payload);
    if (participants === undefined && !rec.endedAt) void logUpdate(rec.id, { peak: view.participants.length });
  } catch (err) {
    console.error('[activities] broadcast failed:', (err as Error)?.message ?? err);
  }
}

// ─── "Playing <Activity>" presence ──────────────────────────

const PRESENCE_TTL_MS = PARTICIPANT_TIMEOUT_MS + 30_000;

async function invalidatePresence(userId: string): Promise<void> {
  try {
    const { cache } = await import('@/lib/db/redis');
    await cache.del(`activity:${userId}`);
  } catch { /* best-effort */ }
}

async function setPlayingPresence(userId: string, app: ActivityApp, rec: ActivityInstanceRecord): Promise<void> {
  try {
    const now = new Date();
    const { safeRichPresenceImageUrl } = await import('@/lib/presence/richPresenceSafety');
    const fields = {
      details: null as string | null,
      state: null as string | null,
      largeImageUrl: safeRichPresenceImageUrl(app.imageUrl) ?? null,
      applicationId: app.id,
      startedAt: new Date(rec.startedAt),
      expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
      updatedAt: now,
    };
    await db.insert(schema.richPresence)
      .values({ userId, type: PRESENCE_TYPE, name: app.name, ...fields })
      .onConflictDoUpdate({ target: [schema.richPresence.userId, schema.richPresence.type, schema.richPresence.name], set: fields });
    await invalidatePresence(userId);
  } catch (err) {
    console.error('[activities] presence failed:', (err as Error)?.message ?? err);
  }
}

async function refreshPlayingPresence(userId: string, applicationId: string): Promise<void> {
  try {
    await db.update(schema.richPresence)
      .set({ expiresAt: new Date(Date.now() + PRESENCE_TTL_MS) })
      .where(and(eq(schema.richPresence.userId, userId), eq(schema.richPresence.type, PRESENCE_TYPE), eq(schema.richPresence.applicationId, applicationId)));
  } catch { /* best-effort */ }
}

async function clearPlayingPresence(userId: string, applicationId: string): Promise<void> {
  try {
    await db.delete(schema.richPresence)
      .where(and(eq(schema.richPresence.userId, userId), eq(schema.richPresence.type, PRESENCE_TYPE), eq(schema.richPresence.applicationId, applicationId)));
    await invalidatePresence(userId);
  } catch { /* best-effort */ }
}

/**
 * The SDK's setActivity(): details / state / images / party onto the user's
 * "Playing <Activity>" row (sanitized like every rich presence). Returns the
 * stored activity in Discord's shape.
 */
export async function setSdkActivity(userId: string, rec: ActivityInstanceRecord, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const app = await loadActivityApp(rec.applicationId);
  if (!app) return null;
  const { sanitizeRichPresenceItem } = await import('@/lib/presence/richPresenceSafety');
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
  const assets = obj(input.assets);
  const timestamps = obj(input.timestamps);
  const party = obj(input.party);
  const clean = sanitizeRichPresenceItem({
    type: PRESENCE_TYPE,
    name: app.name,
    details: input.details,
    state: input.state,
    largeImageUrl: typeof assets.large_image === 'string' ? assets.large_image : app.imageUrl,
    largeImageText: assets.large_text,
    smallImageUrl: assets.small_image,
    smallImageText: assets.small_text,
    startedAt: typeof timestamps.start === 'number' ? new Date(timestamps.start).toISOString() : new Date(rec.startedAt).toISOString(),
    endsAt: typeof timestamps.end === 'number' ? new Date(timestamps.end).toISOString() : null,
    partyId: party.id,
    partySize: party.size,
  });
  if (!clean) return null;
  const now = new Date();
  const fields = {
    details: clean.details,
    state: clean.state,
    largeImageUrl: clean.largeImageUrl,
    largeImageText: clean.largeImageText,
    smallImageUrl: clean.smallImageUrl,
    smallImageText: clean.smallImageText,
    startedAt: clean.startedAt,
    endsAt: clean.endsAt,
    partyId: clean.partyId,
    partySize: clean.partySize,
    applicationId: app.id,
    expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
    updatedAt: now,
  };
  const size = clean.partySize;
  await db.insert(schema.richPresence)
    .values({ userId, type: PRESENCE_TYPE, name: app.name, ...fields })
    .onConflictDoUpdate({ target: [schema.richPresence.userId, schema.richPresence.type, schema.richPresence.name], set: fields });
  await invalidatePresence(userId);
  return {
    name: app.name,
    type: 0,
    application_id: app.clientId,
    ...(fields.details ? { details: fields.details } : {}),
    ...(fields.state ? { state: fields.state } : {}),
    ...(fields.startedAt || fields.endsAt ? { timestamps: { ...(fields.startedAt ? { start: fields.startedAt.getTime() } : {}), ...(fields.endsAt ? { end: fields.endsAt.getTime() } : {}) } } : {}),
    ...(fields.partyId || size ? { party: { ...(fields.partyId ? { id: fields.partyId } : {}), ...(size ? { size } : {}) } } : {}),
    assets: {
      ...(fields.largeImageUrl ? { large_image: fields.largeImageUrl } : {}),
      ...(fields.largeImageText ? { large_text: fields.largeImageText } : {}),
      ...(fields.smallImageUrl ? { small_image: fields.smallImageUrl } : {}),
      ...(fields.smallImageText ? { small_text: fields.smallImageText } : {}),
    },
  };
}

// ─── Public ids for the app ─────────────────────────────────

/** Map SerikaCord UUIDs to the ids this app sees (snowflakes for snowflake-format apps). */
export async function publicIdsFor(app: Pick<ActivityApp, 'apiIdFormat'>, uuids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(uuids.filter((u): u is string => !!u).map((u) => u.toLowerCase()))];
  if (app.apiIdFormat !== 'snowflake') { for (const u of list) out.set(u, u); return out; }
  const { snowflakesForUuids } = await import('@/lib/botapi/snowflakeStore');
  const { map } = await snowflakesForUuids(list);
  for (const u of list) out.set(u, map.get(u) ?? u);
  return out;
}

/** Whether a channel id belongs to a location this instance lives in (bot API checks). */
export function instanceAt(rec: ActivityInstanceRecord, channelId: string): boolean {
  return same(rec.location.channelId, channelId);
}

