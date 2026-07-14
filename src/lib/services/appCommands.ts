import { Application, ServerMember, User } from '@/lib/models';
import { AppCommand } from '@/lib/models/AppCommand';

/**
 * A single application command option, mirroring Discord's option schema with a
 * couple of SerikaCord extensions (choice `description`/`emoji`) so the composer
 * can render the rich pickers shown in the palette UI.
 */
export interface AppCommandOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: { name: string; value: string | number; description?: string; emoji?: string }[];
  /** Nested options for SUB_COMMAND (1) and SUB_COMMAND_GROUP (2) types. */
  options?: AppCommandOption[];
  min_value?: number;
  max_value?: number;
}

export interface ResolvedAppCommand {
  id: string;
  name: string;
  description: string;
  type: number;
  guildId: string | null;
  options: AppCommandOption[];
}

export interface AppCommandGroup {
  application: {
    id: string;
    name: string;
    icon: string | null;
    botId: string | null;
    clientId: string;
  };
  commands: ResolvedAppCommand[];
}

/** Discord option type constants. */
export const OPTION_TYPES = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
} as const;

/**
 * Resolve the set of bot user IDs that are reachable in a channel — either the
 * bots that are members of the channel's guild, or the bot recipients of a DM.
 */
async function getChannelBotIds(channel: {
  serverId?: string | null;
  recipientIds?: string[] | null;
}): Promise<string[]> {
  if (channel.serverId) {
    const members = await ServerMember.find({ serverId: channel.serverId });
    const memberIds = members.map((m: { userId: string }) => m.userId);
    if (memberIds.length === 0) return [];
    const bots = await User.find({ id: { in: memberIds }, isBot: true });
    return bots.map((u: { id: string }) => u.id);
  }
  const recipientIds = channel.recipientIds ?? [];
  if (recipientIds.length === 0) return [];
  const bots = await User.find({ id: { in: recipientIds }, isBot: true });
  return bots.map((u: { id: string }) => u.id);
}

/**
 * Build the grouped list of application commands available in a channel: for
 * every bot present, its global commands plus any guild-scoped commands for the
 * current guild. Guild commands override global commands of the same name.
 */
export async function getChannelAppCommands(channel: {
  serverId?: string | null;
  recipientIds?: string[] | null;
}): Promise<AppCommandGroup[]> {
  const botIds = await getChannelBotIds(channel);
  if (botIds.length === 0) return [];

  const guildId = channel.serverId ?? null;
  const groups: AppCommandGroup[] = [];

  for (const botId of botIds) {
    const app = await Application.findOne({ botId });
    if (!app) continue;

    const all = await AppCommand.find({ applicationId: app.id });
    // Keep global + this-guild commands; drop commands scoped to other guilds.
    const relevant = all.filter(
      (c: { guildId: string | null }) => !c.guildId || (guildId && c.guildId === guildId),
    );
    if (relevant.length === 0) continue;

    // Guild-scoped command of a given name shadows the global one.
    const byName = new Map<string, (typeof relevant)[number]>();
    for (const c of relevant) {
      const existing = byName.get(c.name);
      if (!existing || (c.guildId && !existing.guildId)) byName.set(c.name, c);
    }

    const botUser = await User.findById(botId);
    groups.push({
      application: {
        id: app.id,
        name: app.name,
        icon: app.icon ?? (botUser as { avatar?: string } | null)?.avatar ?? null,
        botId: app.botId ?? null,
        clientId: app.clientId,
      },
      commands: Array.from(byName.values()).map((c: {
        id: string;
        name: string;
        description: string;
        type: number | null;
        guildId: string | null;
        options: unknown;
      }) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type ?? 1,
        guildId: c.guildId,
        options: (c.options as AppCommandOption[]) ?? [],
      })),
    });
  }

  return groups;
}
