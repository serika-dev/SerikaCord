/**
 * GET /guilds/{id}/new-member-welcome (Discord's Server Guide / "home
 * settings") from Serika's Server Guide (src/lib/servers/onboarding.ts
 * `guide`). Pure; tested in tests/guildparity-welcome.test.ts.
 *
 *   welcome message      -> welcome_message { author_ids: [owner], message }
 *   to-dos "read"/"chat" -> new_member_actions (action_type VIEW 0 / TALK 1)
 *   resources            -> resource_channels (cards that link a channel)
 *
 * To-dos without a channel ("pick roles", "set up your profile") have no
 * Discord counterpart and are left out, as are resources without a channel.
 */
import { isGuideVisible, type ServerGuide } from '@/lib/servers/onboarding';
import { toDiscordEmoji } from '@/lib/servers/communityEmoji';

export const NEW_MEMBER_ACTION = { VIEW: 0, TALK: 1 } as const;

export function toDiscordNewMemberWelcome(
  guildId: string,
  guide: ServerGuide,
  opts: { ownerId?: string | null; decode?: (s: string) => string } = {},
) {
  const decode = opts.decode ?? ((s: string) => s);
  const emoji = (v: string | null) => {
    const e = toDiscordEmoji(v);
    return e ? { emoji: e } : {};
  };
  return {
    guild_id: guildId,
    enabled: isGuideVisible(guide),
    ...(guide.welcomeMessage
      ? { welcome_message: { author_ids: opts.ownerId ? [opts.ownerId] : [], message: decode(guide.welcomeMessage) } }
      : {}),
    new_member_actions: guide.todos
      .filter((t) => (t.kind === 'read' || t.kind === 'chat') && t.channelId)
      .map((t) => ({
        channel_id: t.channelId as string,
        action_type: t.kind === 'chat' ? NEW_MEMBER_ACTION.TALK : NEW_MEMBER_ACTION.VIEW,
        title: decode(t.title),
        description: decode(t.description),
        ...emoji(t.emoji),
      })),
    resource_channels: guide.resources
      .filter((r) => r.channelId)
      .map((r) => ({
        channel_id: r.channelId as string,
        title: decode(r.title),
        description: decode(r.description),
        ...emoji(r.emoji),
      })),
  };
}
