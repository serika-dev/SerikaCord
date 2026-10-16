/**
 * Discord guild scheduled event bodies -> the field names
 * normalizeEventInput (src/lib/chat/scheduledEvents.ts) validates. Pure;
 * tested in tests/bot-scheduled-events.test.ts.
 */
import { FormErrors, type DiscordFormError } from './formErrors';
import type { EventEntityType, EventStatus } from '@/lib/chat/scheduledEvents';

const ENTITY_TYPES: Record<number, EventEntityType> = { 1: 'stage', 2: 'voice', 3: 'external' };
const STATUSES: Record<number, EventStatus> = { 1: 'scheduled', 2: 'active', 3: 'completed', 4: 'canceled' };

export type EventFields = Record<string, unknown> & { status?: EventStatus };

/**
 * Map a POST / PATCH body. Only fields present in the body are returned
 * (PATCH keeps the rest). `image` stays the raw data URI (or null) for the
 * caller to upload. Serika events are guild-only (privacy_level 2) and have
 * no recurrence.
 */
export function fromDiscordEventBody(
  body: unknown,
  opts: { create: boolean; existingEntityType?: EventEntityType },
): { ok: true; fields: EventFields } | { ok: false; error: DiscordFormError } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = new FormErrors();
  const out: EventFields = {};
  const has = (k: string) => b[k] !== undefined;

  if (has('name') || opts.create) {
    if (typeof b.name !== 'string' || !b.name.trim()) errors.add(['name'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else if (b.name.length > 100) errors.add(['name'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 100 in length.');
    else out.name = b.name;
  }
  if (has('description')) {
    if (b.description !== null && typeof b.description !== 'string') errors.add(['description'], 'BASE_TYPE_STRING', 'Must be a string.');
    else if (typeof b.description === 'string' && b.description.length > 1000) errors.add(['description'], 'BASE_TYPE_MAX_LENGTH', 'Must be 1000 or fewer in length.');
    else out.description = b.description;
  }
  if (has('privacy_level') && b.privacy_level !== 2) errors.add(['privacy_level'], 'BASE_TYPE_CHOICES', 'Value must be one of {2}.');
  else if (opts.create && !has('privacy_level')) errors.add(['privacy_level'], 'BASE_TYPE_REQUIRED', 'This field is required');
  if (has('recurrence_rule') && b.recurrence_rule !== null) errors.add(['recurrence_rule'], 'GUILD_SCHEDULED_EVENT_RECURRENCE_UNSUPPORTED', 'Recurring events are not supported.');

  let entityType = opts.existingEntityType;
  if (has('entity_type') || opts.create) {
    const t = ENTITY_TYPES[Number(b.entity_type)];
    if (!t || !Number.isInteger(b.entity_type)) errors.add(['entity_type'], 'BASE_TYPE_CHOICES', 'Value must be one of {1, 2, 3}.');
    else { out.entityType = t; entityType = t; }
  }
  if (has('channel_id')) {
    if (b.channel_id !== null && typeof b.channel_id !== 'string') errors.add(['channel_id'], 'SNOWFLAKE_TYPE_INVALID', 'Value is not snowflake.');
    else out.channelId = b.channel_id;
  }
  if (has('entity_metadata')) {
    const m = b.entity_metadata;
    if (m !== null && (typeof m !== 'object' || Array.isArray(m))) errors.add(['entity_metadata'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    else {
      const loc = m ? (m as { location?: unknown }).location : undefined;
      if (loc !== undefined && loc !== null && typeof loc !== 'string') errors.add(['entity_metadata', 'location'], 'BASE_TYPE_STRING', 'Must be a string.');
      else if (typeof loc === 'string' && loc.length > 100) errors.add(['entity_metadata', 'location'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 100 in length.');
      else if (loc !== undefined) out.location = loc;
    }
  }
  if (entityType === 'external' && out.entityType === 'external' && b.channel_id !== undefined && b.channel_id !== null) {
    errors.add(['channel_id'], 'GUILD_SCHEDULED_EVENT_CHANNEL_INVALID', 'External events cannot have a channel.');
  }
  if (has('scheduled_start_time') || opts.create) {
    if (typeof b.scheduled_start_time !== 'string' || !Number.isFinite(new Date(b.scheduled_start_time).getTime())) errors.add(['scheduled_start_time'], 'DATE_TYPE_PARSE', 'Could not parse date.');
    else out.startAt = b.scheduled_start_time;
  }
  if (has('scheduled_end_time')) {
    if (b.scheduled_end_time !== null && (typeof b.scheduled_end_time !== 'string' || !Number.isFinite(new Date(b.scheduled_end_time).getTime()))) errors.add(['scheduled_end_time'], 'DATE_TYPE_PARSE', 'Could not parse date.');
    else out.endAt = b.scheduled_end_time;
  }
  if (has('image')) {
    if (b.image !== null && typeof b.image !== 'string') errors.add(['image'], 'IMAGE_INVALID', 'Invalid image data');
    else out.image = b.image;
  }
  if (has('status')) {
    if (opts.create) errors.add(['status'], 'BASE_TYPE_INVALID', 'Not allowed on create.');
    else {
      const s = STATUSES[Number(b.status)];
      if (!s || !Number.isInteger(b.status)) errors.add(['status'], 'BASE_TYPE_CHOICES', 'Value must be one of {1, 2, 3, 4}.');
      else out.status = s;
    }
  }
  if (!errors.ok) return { ok: false, error: errors.toBody() };
  return { ok: true, fields: out };
}
