/**
 * Stage instances (a live stage's topic and privacy) for the
 * Discord-compatible bot API. Pure; tested in tests/guildparity-stage.test.ts.
 */
import type { FieldError } from './guildSearchRules';

export const STAGE_TOPIC_MIN = 1;
export const STAGE_TOPIC_MAX = 120;
/** Discord: 1 PUBLIC (deprecated, refused), 2 GUILD_ONLY. */
export const STAGE_PRIVACY_GUILD_ONLY = 2;

export interface StageInstanceRow {
  id: string;
  serverId: string;
  channelId: string;
  topic: string;
  privacyLevel: number;
  discoverableDisabled: boolean;
  guildScheduledEventId: string | null;
}

export function toDiscordStageInstance(r: StageInstanceRow) {
  return {
    id: r.id,
    guild_id: r.serverId,
    channel_id: r.channelId,
    topic: r.topic,
    privacy_level: r.privacyLevel,
    discoverable_disabled: r.discoverableDisabled,
    guild_scheduled_event_id: r.guildScheduledEventId,
  };
}

export interface StageInstanceFields {
  channelId?: string;
  topic?: string;
  privacyLevel?: number;
  sendStartNotification?: boolean;
  guildScheduledEventId?: string | null;
}

/** POST /stage-instances (create) or PATCH /stage-instances/{channel.id} body. */
export function parseStageInstanceBody(body: unknown, opts: { create: boolean }): { ok: true; fields: StageInstanceFields } | { ok: false; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const fields: StageInstanceFields = {};
  if (opts.create) {
    if (typeof b.channel_id !== 'string' || !b.channel_id) errors.push({ path: 'channel_id', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' });
    else fields.channelId = b.channel_id;
  }
  if (b.topic !== undefined || opts.create) {
    if (typeof b.topic !== 'string' || !b.topic.trim()) errors.push({ path: 'topic', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' });
    else if (b.topic.trim().length < STAGE_TOPIC_MIN || b.topic.trim().length > STAGE_TOPIC_MAX) {
      errors.push({ path: 'topic', code: 'BASE_TYPE_BAD_LENGTH', message: `Must be between ${STAGE_TOPIC_MIN} and ${STAGE_TOPIC_MAX} in length.` });
    } else fields.topic = b.topic.trim();
  }
  if (b.privacy_level !== undefined && b.privacy_level !== null) {
    if (b.privacy_level !== STAGE_PRIVACY_GUILD_ONLY) errors.push({ path: 'privacy_level', code: 'BASE_TYPE_CHOICES', message: 'Value must be one of {2}.' });
    else fields.privacyLevel = STAGE_PRIVACY_GUILD_ONLY;
  }
  if (opts.create) {
    if (b.send_start_notification !== undefined && b.send_start_notification !== null) {
      if (typeof b.send_start_notification !== 'boolean') errors.push({ path: 'send_start_notification', code: 'BASE_TYPE_BAD_TYPE', message: 'Must be either true or false.' });
      else fields.sendStartNotification = b.send_start_notification;
    }
    if (b.guild_scheduled_event_id !== undefined) {
      if (b.guild_scheduled_event_id !== null && typeof b.guild_scheduled_event_id !== 'string') errors.push({ path: 'guild_scheduled_event_id', code: 'NUMBER_TYPE_COERCE', message: 'Value is not snowflake.' });
      else fields.guildScheduledEventId = (b.guild_scheduled_event_id as string | null) || null;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}
