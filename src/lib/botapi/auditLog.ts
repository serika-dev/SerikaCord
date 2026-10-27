/**
 * GET /guilds/{id}/audit-logs for the Discord-compatible bot API (WP4b): the
 * entries (src/lib/services/auditLog.ts) plus the objects Discord ships next
 * to them so libraries can resolve targets without extra requests: users
 * (actors and user targets), webhooks, threads, integrations (added bots),
 * AutoMod rules, scheduled events (entries 100-102) and application commands
 * (permission updates, 121). Deleted events / commands are no longer listed.
 */
import { Application, Channel, ChannelWebhook, User } from '@/lib/models';
import { auditTargetKind, AuditLogEvent, type AuditEntryShape } from '@/lib/audit/auditLog';
import { toDiscordChannel, toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { isValidObjectId } from '@/lib/security';

const uniq = (ids: Array<string | null | undefined>) => [...new Set(ids.filter((id): id is string => !!id && isValidObjectId(id)).map((id) => id.toLowerCase()))];

/** Commands named by command-permission entries: the guild's or global ones, Discord-shaped. */
async function auditedCommands(guildId: string, ids: string[]) {
  const { db, schema } = await import('@/lib/db/postgres');
  const { inArray } = await import('drizzle-orm');
  const { serializeCommand } = await import('@/lib/services/appCommands');
  const rows = await db.select().from(schema.appCommands).where(inArray(schema.appCommands.id, ids)).catch(() => []);
  return rows
    .filter((r) => !r.guildId || r.guildId.toLowerCase() === guildId.toLowerCase())
    .map((r) => serializeCommand(r, r.applicationId));
}

/** The audit log response for a page of entries. */
export async function auditLogResponse(guildId: string, entries: AuditEntryShape[]) {
  const { toDiscordEntry } = await import('@/lib/services/auditLog');
  const byKind = (kind: ReturnType<typeof auditTargetKind>) => uniq(entries.filter((e) => auditTargetKind(e.actionType) === kind).map((e) => e.targetId));

  const userIds = uniq([...entries.map((e) => e.userId), ...byKind('user')]);
  const webhookIds = byKind('webhook');
  const threadIds = byKind('thread');
  const ruleIds = byKind('automod_rule');
  const botIds = uniq(entries.filter((e) => e.actionType === AuditLogEvent.BOT_ADD).map((e) => e.targetId));
  const eventIds = byKind('scheduled_event');
  const commandIds = byKind('application_command');

  const [users, webhooks, threads, rules, apps] = await Promise.all([
    userIds.length ? User.find({ id: { in: userIds } }).catch(() => []) : Promise.resolve([]),
    Promise.all(webhookIds.map((id) => ChannelWebhook.findById(id).catch(() => null))),
    threadIds.length ? Channel.find({ id: { in: threadIds } }).catch(() => []) : Promise.resolve([]),
    ruleIds.length
      ? import('@/lib/services/automod').then((m) => Promise.all(ruleIds.map((id) => m.getAutoModRule(guildId, id).catch(() => null))))
      : Promise.resolve([]),
    Promise.all(botIds.map((id) => Application.findOne({ botId: id }).catch(() => null))),
  ]);
  const [events, commands] = await Promise.all([
    eventIds.length
      ? import('./scheduledEvents').then((m) => Promise.all(eventIds.map((id) => m.loadDiscordScheduledEvent(guildId, id).catch(() => null))))
      : Promise.resolve([]),
    commandIds.length ? auditedCommands(guildId, commandIds) : Promise.resolve([]),
  ]);
  const { toDiscordRule } = await import('@/lib/automod/rules');
  const sameGuild = (sid?: string | null) => !!sid && sid.toLowerCase() === guildId.toLowerCase();

  return {
    audit_log_entries: entries.map(toDiscordEntry),
    users: users.map((u) => toDiscordUserRow(u)),
    webhooks: webhooks
      .filter((w): w is NonNullable<typeof w> => !!w && sameGuild((w as { serverId?: string | null }).serverId))
      .map((w) => {
        const hook = w as { id: string; name?: string | null; avatar?: string | null; channelId?: string | null; serverId?: string | null; applicationId?: string | null };
        return { id: hook.id, type: hook.applicationId ? 3 : 1, guild_id: hook.serverId ?? guildId, channel_id: hook.channelId ?? null, name: hook.name ?? null, avatar: hook.avatar ?? null, application_id: hook.applicationId ?? null };
      }),
    threads: threads.filter((t) => sameGuild(t.serverId)).map((t) => toDiscordChannel(t)),
    integrations: apps
      .filter((a): a is NonNullable<typeof a> => !!a && !!a.botId)
      .map((a) => ({ id: a.id, name: a.name, type: 'discord', account: { id: a.botId, name: a.name }, application_id: a.id })),
    application_commands: commands,
    auto_moderation_rules: rules.filter((r): r is NonNullable<typeof r> => !!r).map(toDiscordRule),
    guild_scheduled_events: events.filter((e): e is NonNullable<typeof e> => !!e),
  };
}
