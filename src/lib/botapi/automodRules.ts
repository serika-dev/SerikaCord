/**
 * Discord v10 AutoMod rule bodies -> the input Serika's rule validator takes
 * (normalizeRuleInput in src/lib/automod/rules.ts). Pure; tested in
 * tests/bot-automod.test.ts.
 *
 * Supported: MESSAGE_SEND rules with KEYWORD (1), SPAM (3) and MENTION_SPAM
 * (5) triggers; BLOCK_MESSAGE (1), SEND_ALERT_MESSAGE (2) and TIMEOUT (3)
 * actions. KEYWORD_PRESET, MEMBER_PROFILE, regex patterns and
 * BLOCK_MEMBER_INTERACTION have no Serika counterpart and answer 50035.
 * Serika's link filter shows up as a KEYWORD rule; its allow_list is the list
 * of allowed domains.
 */
import { FormErrors, type DiscordFormError } from './formErrors';
import type { AutoModTriggerType } from '@/lib/automod/rules';

const TRIGGERS: Record<number, AutoModTriggerType> = { 1: 'keyword', 3: 'spam', 5: 'mention_spam' };

export function fromDiscordRuleBody(
  body: unknown,
  existing?: { triggerType: AutoModTriggerType } | null,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: DiscordFormError } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = new FormErrors();
  const out: Record<string, unknown> = {};
  const create = !existing;

  if (b.name !== undefined || create) {
    if (typeof b.name !== 'string' || !b.name.trim()) errors.add(['name'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else if (b.name.length > 100) errors.add(['name'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 100 in length.');
    else out.name = b.name;
  }
  if (b.event_type !== undefined || create) {
    if (b.event_type !== 1) errors.add(['event_type'], 'BASE_TYPE_CHOICES', 'Value must be one of {1}.');
  }
  let triggerType: AutoModTriggerType | undefined = existing?.triggerType;
  if (create) {
    const t = TRIGGERS[Number(b.trigger_type)];
    if (!t || !Number.isInteger(b.trigger_type)) errors.add(['trigger_type'], 'BASE_TYPE_CHOICES', 'Value must be one of {1, 3, 5}.');
    else { triggerType = t; out.triggerType = t; }
  } else if (b.trigger_type !== undefined && TRIGGERS[Number(b.trigger_type)] !== existing?.triggerType && !(existing?.triggerType === 'links' && b.trigger_type === 1)) {
    errors.add(['trigger_type'], 'AUTO_MODERATION_TRIGGER_TYPE_IMMUTABLE', 'The trigger type of a rule cannot be changed.');
  }

  if (b.trigger_metadata !== undefined && b.trigger_metadata !== null) {
    const m = b.trigger_metadata as Record<string, unknown>;
    if (typeof m !== 'object' || Array.isArray(m)) errors.add(['trigger_metadata'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    else {
      if (Array.isArray(m.regex_patterns) && m.regex_patterns.length > 0) errors.add(['trigger_metadata', 'regex_patterns'], 'AUTO_MODERATION_REGEX_UNSUPPORTED', 'Regex patterns are not supported.');
      if (Array.isArray(m.presets) && m.presets.length > 0) errors.add(['trigger_metadata', 'presets'], 'AUTO_MODERATION_PRESETS_UNSUPPORTED', 'Keyword presets are not supported.');
      const meta: Record<string, unknown> = {};
      if (triggerType === 'keyword') {
        if (m.keyword_filter !== undefined) meta.keywordFilter = m.keyword_filter;
        if (m.allow_list !== undefined) meta.allowList = m.allow_list;
      } else if (triggerType === 'links') {
        if (m.allow_list !== undefined) meta.allowedDomains = m.allow_list;
      } else if (triggerType === 'mention_spam') {
        if (m.mention_total_limit !== undefined) meta.mentionTotalLimit = m.mention_total_limit;
      }
      out.triggerMetadata = meta;
    }
  }

  if (b.actions !== undefined || create) {
    if (!Array.isArray(b.actions)) errors.add(['actions'], 'BASE_TYPE_REQUIRED', 'This field is required');
    else {
      const actions: Array<Record<string, unknown>> = [];
      b.actions.forEach((a, i) => {
        const act = (a && typeof a === 'object' ? a : {}) as { type?: unknown; metadata?: Record<string, unknown> | null };
        const meta = (act.metadata && typeof act.metadata === 'object' ? act.metadata : {}) as Record<string, unknown>;
        if (act.type === 1) actions.push({ type: 'block_message', customMessage: typeof meta.custom_message === 'string' ? meta.custom_message : null });
        else if (act.type === 2) {
          if (typeof meta.channel_id !== 'string') errors.add(['actions', i, 'metadata', 'channel_id'], 'BASE_TYPE_REQUIRED', 'This field is required');
          else actions.push({ type: 'send_alert', channelId: meta.channel_id });
        } else if (act.type === 3) {
          const s = Number(meta.duration_seconds);
          if (!Number.isInteger(s) || s < 0 || s > 2419200) errors.add(['actions', i, 'metadata', 'duration_seconds'], 'NUMBER_TYPE_MAX', 'int value should be less than or equal to 2419200.');
          else actions.push({ type: 'timeout', durationSeconds: s });
        } else errors.add(['actions', i, 'type'], 'BASE_TYPE_CHOICES', 'Value must be one of {1, 2, 3}.');
      });
      out.actions = actions;
    }
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') errors.add(['enabled'], 'BASE_TYPE_BOOLEAN', 'Must be either true or false.');
    else out.enabled = b.enabled;
  }
  for (const [key, field, max] of [['exempt_roles', 'exemptRoles', 20], ['exempt_channels', 'exemptChannels', 50]] as const) {
    if (b[key] === undefined) continue;
    if (!Array.isArray(b[key])) errors.add([key], 'BASE_TYPE_ARRAY', 'Must be an array.');
    else if ((b[key] as unknown[]).length > max) errors.add([key], 'BASE_TYPE_MAX_LENGTH', `Must be ${max} or fewer in length.`);
    else out[field] = b[key];
  }
  if (!errors.ok) return { ok: false, error: errors.toBody() };
  return { ok: true, input: out };
}

/** Whether a rule's actions include a timeout (needs MODERATE_MEMBERS, like Discord). */
export function hasTimeoutAction(input: { actions?: Array<{ type: string }> }): boolean {
  return (input.actions ?? []).some((a) => a.type === 'timeout');
}
