/**
 * Discord voice states for the bot API (WP7): who is in which server voice
 * channel, from the voice room mirror in src/lib/api/voice.ts (synced across
 * instances over Redis). Used by VOICE_STATE_UPDATE, GUILD_CREATE
 * `voice_states` and GET /guilds/{id}/voice-states/{user}. DM and group DM
 * calls are never exposed (Discord has no bot-visible voice state for them).
 *
 * Bots also join voice / stage channels themselves with gateway op 4
 * (docs/architecture/voice-sfu.md); their own state comes from botVoiceState.
 */
import { createHash } from 'crypto';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';

export interface ParticipantLike {
  userId: string;
  audio?: boolean;
  video?: boolean;
  deafened?: boolean;
  sessionId?: string;
  serverMute?: boolean;
  serverDeaf?: boolean;
  screenShare?: boolean;
  /** Muted because they lack SPEAK in the channel (src/lib/voice/permissions.ts). */
  suppress?: boolean;
  /** Stage audience: a raised hand (ISO time). */
  requestToSpeakAt?: string | null;
}

/** A stable, opaque voice session id (the client's tab id is never exposed). */
export function voiceSessionId(raw: string | undefined, userId: string): string {
  return createHash('sha256').update(`voice:${raw || userId}`).digest('hex').slice(0, 32);
}

/** Discord voice state object for a participant (`channelId` null = left voice). */
export function voiceStateOf(p: ParticipantLike, channelId: string | null, extra: { guildId?: string; member?: unknown } = {}) {
  return {
    ...(extra.guildId ? { guild_id: extra.guildId } : {}),
    channel_id: channelId,
    user_id: p.userId,
    ...(extra.member ? { member: extra.member } : {}),
    session_id: voiceSessionId(p.sessionId, p.userId),
    deaf: p.serverDeaf === true,
    // Stage audience is `suppress`, not muted (Discord); a moderator's mute stays.
    mute: p.serverMute === true && p.suppress !== true,
    self_deaf: p.deafened === true,
    self_mute: p.audio === false,
    self_stream: p.screenShare === true,
    self_video: p.video === true,
    suppress: p.suppress === true,
    request_to_speak_timestamp: p.requestToSpeakAt ?? null,
  };
}

/** The bot's own voice state in answer to op 4. */
export function botVoiceState(o: { guildId: string; channelId: string | null; botId: string; sessionId: string; selfMute: boolean; selfDeaf: boolean }) {
  return {
    guild_id: o.guildId,
    channel_id: o.channelId,
    user_id: o.botId,
    session_id: o.sessionId,
    deaf: false,
    mute: false,
    self_deaf: o.selfDeaf,
    self_mute: o.selfMute,
    self_stream: false,
    self_video: false,
    suppress: false,
    request_to_speak_timestamp: null,
  };
}

/** The channel id of a server voice room id (`channel-<uuid>`), else null. */
export function channelIdOfVoiceRoom(roomId: string): string | null {
  const m = /^channel-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(roomId);
  return m ? m[1].toLowerCase() : null;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

const channelServer = processShared('voiceStates:channelServer', () => new BoundedMap<string, { serverId: string | null; at: number }>(5000));
const CHANNEL_TTL_MS = 5 * 60_000;

async function serverOfChannel(channelId: string): Promise<string | null> {
  const hit = channelServer.get(channelId);
  if (hit && Date.now() - hit.at < CHANNEL_TTL_MS) return hit.serverId;
  const { Channel } = await import('@/lib/models');
  const ch = await Channel.findById(channelId).catch(() => null);
  const serverId = ch?.serverId ?? null;
  channelServer.set(channelId, { serverId, at: Date.now() });
  return serverId;
}

async function memberObject(serverId: string, userId: string) {
  const { db, schema } = await import('@/lib/db/postgres');
  const { and, eq } = await import('drizzle-orm');
  const { toDiscordGuildMember } = await import('./gatewayEvents');
  const [member] = await db.select().from(schema.serverMembers)
    .where(and(eq(schema.serverMembers.serverId, serverId), eq(schema.serverMembers.userId, userId))).limit(1);
  if (!member) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const [everyone] = await db.select({ id: schema.roles.id }).from(schema.roles)
    .where(and(eq(schema.roles.serverId, serverId), eq(schema.roles.isDefault, true))).limit(1);
  return toDiscordGuildMember(member, user ?? { id: userId }, everyone?.id ?? null);
}

/**
 * VOICE_STATE_UPDATE for a change in a server voice room. `participant` null
 * means `userId` left the room. Called by the instance where the change
 * happened (never for mirror updates from other instances).
 */
export async function emitVoiceStateFor(roomId: string, userId: string, participant: ParticipantLike | null): Promise<void> {
  const channelId = channelIdOfVoiceRoom(roomId);
  if (!channelId) return;
  try {
    const serverId = await serverOfChannel(channelId);
    if (!serverId) return;
    const member = await memberObject(serverId, userId).catch(() => null);
    const state = voiceStateOf(participant ?? { userId }, participant ? channelId : null, { member: member ?? undefined });
    const { emitVoiceStateUpdate } = await import('./gatewayEvents');
    await emitVoiceStateUpdate(serverId, channelId, state);
  } catch {
    // Best-effort: voice must never fail because the gateway bus is down.
  }
}

/** Every voice state in a server's voice channels (from this instance's synced mirror). */
export async function listGuildVoiceStates(serverId: string): Promise<Array<ReturnType<typeof voiceStateOf>>> {
  const { channelRoomParticipants } = await import('@/lib/api/voice');
  const rooms = channelRoomParticipants();
  if (rooms.length === 0) return [];
  const { db, schema } = await import('@/lib/db/postgres');
  const { eq } = await import('drizzle-orm');
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.serverId, serverId));
  const mine = new Set(channels.map((c) => c.id.toLowerCase()));
  const out: Array<ReturnType<typeof voiceStateOf>> = [];
  for (const { channelId, participants } of rooms) {
    if (!mine.has(channelId)) continue;
    for (const p of participants) out.push(voiceStateOf(p, channelId));
  }
  return out;
}
