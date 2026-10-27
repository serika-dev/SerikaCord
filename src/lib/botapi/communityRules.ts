/**
 * Discord v10 shapes for Serika's onboarding, welcome screen and server
 * templates, both ways. Pure; tested in tests/bot-community.test.ts.
 *
 * Onboarding prompt / option ids are Serika strings ("q0", "q0_o1"); bots get
 * them as stable numeric ids (discord.py parses ids as integers) and a PUT
 * maps known numeric ids back to the stored ones.
 */
import type { OnboardingConfig } from '@/lib/servers/onboarding';
import type { ServerSnapshot, WelcomeScreen } from '@/lib/servers/community';
import { CHANNEL_TYPE_NUMBERS, toDiscordGuildBase } from '@/lib/services/gatewayEvents';
import { fromDiscordEmoji, toDiscordEmoji } from '@/lib/servers/communityEmoji';

/** A stable 19-digit numeric id for a Serika onboarding id (FNV-1a 64, top bit cleared). */
export function numericOnboardingId(id: string): string {
  if (/^\d{17,20}$/.test(id)) return id;
  let h = 0xcbf29ce484222325n;
  for (const ch of id) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // Keep it in snowflake range (19 digits, positive int64).
  const v = (h & 0x7fffffffffffffffn) | 0x1000000000000000n;
  return v.toString();
}

const isPlainId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

/** GET /guilds/{id}/onboarding. */
export function toDiscordOnboarding(guildId: string, cfg: OnboardingConfig) {
  return {
    guild_id: guildId,
    prompts: cfg.questions.map((q) => ({
      id: numericOnboardingId(q.id),
      type: 0,
      title: q.title,
      single_select: !q.multiple,
      required: q.required,
      in_onboarding: true,
      options: q.options.map((o) => {
        // Unicode: { id: null, name: "🎮" }; the server's custom emoji: { id, name, animated } (CORD-71).
        const emoji = toDiscordEmoji(o.emoji);
        return {
          id: numericOnboardingId(o.id),
          title: o.title,
          description: o.description || null,
          channel_ids: [],
          role_ids: o.roleIds,
          emoji,
          emoji_id: emoji?.id ?? null,
          emoji_name: emoji?.name ?? null,
          emoji_animated: emoji?.animated ?? false,
        };
      }),
    })),
    default_channel_ids: [],
    enabled: cfg.enabled,
    mode: 0,
  };
}

/**
 * PUT /guilds/{id}/onboarding body -> Serika config input (for
 * normalizeOnboardingConfig). The Server Guide part is kept from `current`.
 * Option channels and default channels have no Serika counterpart and are ignored.
 */
export function fromDiscordOnboarding(body: unknown, current: OnboardingConfig, clean: (s: string) => string = (s) => s): Record<string, unknown> {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const known = new Map<string, string>();
  for (const q of current.questions) {
    known.set(numericOnboardingId(q.id), q.id);
    for (const o of q.options) known.set(numericOnboardingId(o.id), o.id);
  }
  const idFor = (raw: unknown) => {
    const s = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    return known.get(s) ?? (isPlainId(s) ? s : undefined);
  };
  const text = (v: unknown) => (typeof v === 'string' ? clean(v) : '');
  const prompts = Array.isArray(b.prompts) ? b.prompts : undefined;
  return {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : current.enabled,
    questions: prompts
      ? prompts.map((p) => {
        const pr = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
        return {
          id: idFor(pr.id),
          title: text(pr.title),
          description: '',
          multiple: pr.single_select === false,
          required: pr.required === true,
          options: (Array.isArray(pr.options) ? pr.options : []).map((o) => {
            const or = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
            // `<:name:id>` for a custom emoji; normalizeOnboardingConfig keeps it only if it is the guild's own.
            const emoji = fromDiscordEmoji(or);
            return {
              id: idFor(or.id),
              title: text(or.title),
              description: text(or.description),
              emoji,
              roleIds: Array.isArray(or.role_ids) ? or.role_ids.filter((r) => typeof r === 'string') : [],
            };
          }),
        };
      })
      : current.questions,
    guide: current.guide,
  };
}

/** GET /guilds/{id}/welcome-screen. */
export function toDiscordWelcomeScreen(screen: WelcomeScreen) {
  return {
    description: screen.description || null,
    welcome_channels: screen.welcomeChannels.map((c) => ({
      channel_id: c.channelId,
      description: c.description,
      emoji_id: c.emojiId,
      emoji_name: c.emojiName,
    })),
  };
}

/** Discord's serialized_source_guild for a Serika template snapshot. */
export function toDiscordSerializedGuild(s: ServerSnapshot) {
  const base = toDiscordGuildBase({
    id: '',
    name: s.name,
    description: s.description,
    verificationLevel: s.verificationLevel,
    explicitContentFilter: s.explicitContentFilter,
    defaultNotifications: s.defaultNotifications,
    afkTimeout: s.afkTimeout,
  });
  return {
    name: s.name,
    description: s.description,
    region: null,
    verification_level: base.verification_level,
    default_message_notifications: base.default_message_notifications,
    explicit_content_filter: base.explicit_content_filter,
    preferred_locale: 'en-US',
    afk_channel_id: s.afkChannelId,
    afk_timeout: s.afkTimeout,
    system_channel_id: s.systemChannelId,
    system_channel_flags: 0,
    icon_hash: null,
    roles: s.roles.map((r) => ({
      id: r.id,
      name: r.id === 0 ? '@everyone' : r.name,
      color: r.color,
      colors: { primary_color: r.color, secondary_color: null, tertiary_color: null },
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions,
      icon: null,
      unicode_emoji: r.unicodeEmoji,
    })),
    channels: s.channels.map((c) => ({
      id: c.id,
      type: CHANNEL_TYPE_NUMBERS[c.type] ?? 0,
      name: c.name,
      position: c.position,
      topic: c.topic,
      bitrate: c.bitrate,
      user_limit: c.userLimit,
      nsfw: c.nsfw,
      rate_limit_per_user: c.rateLimitPerUser,
      parent_id: c.parentId,
      default_auto_archive_duration: c.defaultAutoArchiveDuration,
      permission_overwrites: c.permissionOverwrites.map((o) => ({ id: o.id, type: 0, allow: o.allow, deny: o.deny })),
      available_tags: Array.isArray(c.availableTags) ? c.availableTags : [],
      template: '',
      default_reaction_emoji: null,
      default_thread_rate_limit_per_user: null,
      default_sort_order: null,
      default_forum_layout: null,
      icon_emoji: null,
      theme_color: null,
    })),
  };
}

/** Template name 1-100, description 0-120 (Discord's limits); null when the field is fine. */
export function templateFieldError(body: Record<string, unknown>, create: boolean): { path: string; code: string; message: string } | null {
  if (body.name !== undefined || create) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { path: 'name', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' };
    if (body.name.length > 100) return { path: 'name', code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 100 in length.' };
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return { path: 'description', code: 'BASE_TYPE_STRING', message: 'Must be a string.' };
    if (body.description.length > 120) return { path: 'description', code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 120 or fewer in length.' };
  }
  return null;
}
