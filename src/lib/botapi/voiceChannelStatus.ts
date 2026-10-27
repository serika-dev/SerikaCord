/**
 * Voice channel status (Discord's PUT /channels/{id}/voice-status): a short
 * line of text shown on a voice channel while people are in it, cleared when
 * the last one leaves (src/lib/api/voice.ts evictFromRoom). Kept in Redis
 * (`voice:status:<channelId>`), like the rest of live voice state; changes
 * emit VOICE_CHANNEL_STATUS_UPDATE to bots that can see the channel.
 */
import { getRedis } from '@/lib/db/redis';

export const MAX_VOICE_STATUS = 500;
const key = (channelId: string) => `voice:status:${channelId.toLowerCase()}`;
/** A status outlives an emptied channel only if the clear was missed (e.g. a crash). */
const STATUS_TTL_S = 7 * 86_400;

export type VoiceStatusInput = { ok: true; status: string | null } | { ok: false; error: { path: string; code: string; message: string } };

/** Validate the `status` body field: a string up to 500 characters, or null / "" to clear. */
export function parseVoiceStatus(raw: unknown): VoiceStatusInput {
  if (raw === undefined) return { ok: false, error: { path: 'status', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' } };
  if (raw === null) return { ok: true, status: null };
  if (typeof raw !== 'string') return { ok: false, error: { path: 'status', code: 'BASE_TYPE_STRING', message: 'Must be a string.' } };
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (text.length > MAX_VOICE_STATUS) return { ok: false, error: { path: 'status', code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${MAX_VOICE_STATUS} or fewer in length.` } };
  return { ok: true, status: text || null };
}

export async function getVoiceChannelStatus(channelId: string): Promise<string | null> {
  try {
    return (await getRedis()?.get(key(channelId))) ?? null;
  } catch {
    return null;
  }
}

/** Store (or clear, with null) a channel's status. Returns whether it changed. */
export async function setVoiceChannelStatus(channelId: string, status: string | null): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const before = await redis.get(key(channelId)).catch(() => null);
  if ((before ?? null) === status) return false;
  if (status === null) await redis.del(key(channelId));
  else await redis.set(key(channelId), status, 'EX', STATUS_TTL_S);
  return true;
}

/** The last member left the voice channel: drop its status and tell bots. */
export async function clearVoiceChannelStatus(channelId: string): Promise<void> {
  try {
    if (!(await setVoiceChannelStatus(channelId, null))) return;
    const { Channel } = await import('@/lib/models');
    const channel = await Channel.findById(channelId).catch(() => null);
    if (!channel?.serverId) return;
    const { emitVoiceChannelStatusUpdate } = await import('@/lib/services/gatewayEvents');
    await emitVoiceChannelStatusUpdate({ channelId: channel.id, guildId: channel.serverId, status: null });
  } catch { /* best-effort */ }
}
