// AutoMod (Discord-style), server side: the automod_rules table, rule CRUD
// with a short Redis cache, and enforceAutoMod() which the message write
// routes call (send, edit, thread start, forum post). Matching rules are pure
// (src/lib/automod/rules.ts); this file runs their actions:
//
//   block_message ─▶ the route rejects the write with code 200000 and the
//                    rule's custom response (shown to the sender only)
//   send_alert    ─▶ an alert message from the system user in the alert channel
//   timeout       ─▶ communication_disabled_until on the member
//
// Every action is audit-logged (AuditLogEvent 143 / 144 / 145) and sent to
// bots as AUTO_MODERATION_ACTION_EXECUTION. Enforcement is best-effort except
// for the block itself: a failing alert or timeout never lets a blocked
// message through, and never fails an allowed one.
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db/redis';
import { normalizeId } from '@/lib/db/normalizeId';
import { Channel, Message, Server, ServerMember } from '@/lib/models';
import { decryptFromStorage, encryptForStorage } from '@/lib/security';
import { getRolePermissions } from '@/lib/permissions/serverPermissions';
import { PERMISSION_BITS, hasPermission } from '@/lib/permissions/bits';
import { AuditLogEvent } from '@/lib/audit/auditLog';
import { audit } from '@/lib/services/auditLog';
import { SYSTEM_USERS } from '@/lib/services/systemUsers';
import {
  AUTOMOD_BLOCK_CODE,
  DISCORD_ACTION_TYPE,
  DISCORD_TRIGGER_TYPE,
  blockResponse,
  evaluateAutoMod,
  ruleNeedsRecentMessages,
  toDiscordAction,
  toDiscordRule,
  type AutoModAction,
  type AutoModMatch,
  type AutoModRule,
  type AutoModRuleInput,
  type AutoModTriggerType,
  type RecentMessage,
} from '@/lib/automod/rules';

const table = schema.automodRules;
const g = globalThis as unknown as { __automodSchema?: Promise<void> | null };

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_automod_rules.sql. Additive + idempotent; a new table
// takes no locks on shared tables, but keep the lock_timeout guard like the
// other boot DDL so a stuck catalog lock can never stall startup.
export function ensureAutoModSchema(): Promise<void> {
  if (g.__automodSchema) return g.__automodSchema;
  g.__automodSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "automod_rules" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            "server_id" uuid NOT NULL,
            "name" text NOT NULL,
            "creator_id" uuid,
            "enabled" boolean DEFAULT true NOT NULL,
            "trigger_type" text NOT NULL,
            "trigger_metadata" jsonb DEFAULT '{}'::jsonb,
            "actions" jsonb DEFAULT '[]'::jsonb,
            "exempt_roles" jsonb DEFAULT '[]'::jsonb,
            "exempt_channels" jsonb DEFAULT '[]'::jsonb,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "automod_rules_server_idx" ON "automod_rules" ("server_id", "created_at")`);
        });
        return;
      } catch (err) {
        console.error(`[automod] Ensuring automod_rules schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__automodSchema = null;
  })();
  return g.__automodSchema;
}

// ─── Rules CRUD ───────────────────────────────────────────────────────────────
const RULES_CACHE_TTL = 120;
const rulesKey = (serverId: string) => `automod:rules:${normalizeId(serverId)}`;

function rowToRule(row: typeof table.$inferSelect): AutoModRule {
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []);
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    creatorId: row.creatorId ?? null,
    enabled: row.enabled !== false,
    triggerType: row.triggerType as AutoModTriggerType,
    triggerMetadata: (row.triggerMetadata && typeof row.triggerMetadata === 'object' ? row.triggerMetadata : {}) as AutoModRule['triggerMetadata'],
    actions: (Array.isArray(row.actions) ? row.actions : []) as AutoModAction[],
    exemptRoles: list(row.exemptRoles),
    exemptChannels: list(row.exemptChannels),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/** Every rule of a server, oldest first (straight from the database). */
export async function listAutoModRules(serverId: string): Promise<AutoModRule[]> {
  await ensureAutoModSchema();
  const rows = await db.select().from(table)
    .where(eq(table.serverId, normalizeId(serverId)))
    .orderBy(asc(table.createdAt));
  return rows.map(rowToRule);
}

export async function getAutoModRule(serverId: string, ruleId: string): Promise<AutoModRule | null> {
  await ensureAutoModSchema();
  const [row] = await db.select().from(table)
    .where(and(eq(table.serverId, normalizeId(serverId)), eq(table.id, normalizeId(ruleId))))
    .limit(1);
  return row ? rowToRule(row) : null;
}

/** Rules for enforcement: cached briefly in Redis (dropped on every change). */
async function cachedRules(serverId: string): Promise<AutoModRule[]> {
  const key = rulesKey(serverId);
  const hit = await cache.get<AutoModRule[]>(key).catch(() => null);
  if (Array.isArray(hit)) return hit;
  const rules = await listAutoModRules(serverId);
  await cache.set(key, rules, RULES_CACHE_TTL).catch(() => {});
  return rules;
}

async function dropRulesCache(serverId: string) {
  await cache.del(rulesKey(serverId)).catch(() => {});
}

function emitRuleEvent(t: 'AUTO_MODERATION_RULE_CREATE' | 'AUTO_MODERATION_RULE_UPDATE' | 'AUTO_MODERATION_RULE_DELETE', rule: AutoModRule) {
  void import('@/lib/services/gatewayEvents')
    .then(({ emitAutoModRuleEvent }) => emitAutoModRuleEvent(t, rule.serverId, toDiscordRule(rule)))
    .catch(() => {});
}

function ruleSnapshot(rule: AutoModRuleInput) {
  return {
    name: rule.name,
    enabled: rule.enabled,
    trigger_type: DISCORD_TRIGGER_TYPE[rule.triggerType],
    trigger_metadata: rule.triggerMetadata,
    actions: rule.actions.map(toDiscordAction),
    exempt_roles: rule.exemptRoles,
    exempt_channels: rule.exemptChannels,
  } as Record<string, unknown>;
}

export async function createAutoModRule(serverId: string, creatorId: string | null, input: AutoModRuleInput, reason?: string | null): Promise<AutoModRule> {
  await ensureAutoModSchema();
  const [row] = await db.insert(table).values({
    serverId: normalizeId(serverId),
    creatorId: creatorId ? normalizeId(creatorId) : null,
    name: input.name,
    enabled: input.enabled,
    triggerType: input.triggerType,
    triggerMetadata: input.triggerMetadata,
    actions: input.actions,
    exemptRoles: input.exemptRoles,
    exemptChannels: input.exemptChannels,
  }).returning();
  const rule = rowToRule(row);
  await dropRulesCache(serverId);
  const snap = ruleSnapshot(input);
  audit({
    serverId,
    userId: creatorId,
    actionType: AuditLogEvent.AUTO_MODERATION_RULE_CREATE,
    targetId: rule.id,
    changes: Object.entries(snap).map(([key, value]) => ({ key, new: value })),
    options: { auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(DISCORD_TRIGGER_TYPE[rule.triggerType]) },
    reason: reason ?? null,
  });
  emitRuleEvent('AUTO_MODERATION_RULE_CREATE', rule);
  return rule;
}

export async function updateAutoModRule(
  serverId: string,
  actorId: string,
  before: AutoModRule,
  input: AutoModRuleInput,
  reason?: string | null,
): Promise<AutoModRule | null> {
  await ensureAutoModSchema();
  const [row] = await db.update(table).set({
    name: input.name,
    enabled: input.enabled,
    triggerMetadata: input.triggerMetadata,
    actions: input.actions,
    exemptRoles: input.exemptRoles,
    exemptChannels: input.exemptChannels,
    updatedAt: new Date(),
  }).where(and(eq(table.serverId, normalizeId(serverId)), eq(table.id, normalizeId(before.id)))).returning();
  if (!row) return null;
  const rule = rowToRule(row);
  await dropRulesCache(serverId);
  const oldSnap = ruleSnapshot(before);
  const newSnap = ruleSnapshot(input);
  const changes = Object.keys(newSnap)
    .filter((k) => JSON.stringify(oldSnap[k]) !== JSON.stringify(newSnap[k]))
    .map((key) => ({ key, old: oldSnap[key], new: newSnap[key] }));
  audit({
    serverId,
    userId: actorId,
    actionType: AuditLogEvent.AUTO_MODERATION_RULE_UPDATE,
    targetId: rule.id,
    changes,
    options: { auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(DISCORD_TRIGGER_TYPE[rule.triggerType]) },
    reason: reason ?? null,
  });
  emitRuleEvent('AUTO_MODERATION_RULE_UPDATE', rule);
  return rule;
}

export async function deleteAutoModRule(serverId: string, actorId: string, rule: AutoModRule, reason?: string | null): Promise<void> {
  await ensureAutoModSchema();
  await db.delete(table).where(and(eq(table.serverId, normalizeId(serverId)), eq(table.id, normalizeId(rule.id))));
  await dropRulesCache(serverId);
  audit({
    serverId,
    userId: actorId,
    actionType: AuditLogEvent.AUTO_MODERATION_RULE_DELETE,
    targetId: rule.id,
    changes: [{ key: 'name', old: rule.name }],
    options: { auto_moderation_rule_name: rule.name, auto_moderation_rule_trigger_type: String(DISCORD_TRIGGER_TYPE[rule.triggerType]) },
    reason: reason ?? null,
  });
  emitRuleEvent('AUTO_MODERATION_RULE_DELETE', rule);
}

// ─── Enforcement ──────────────────────────────────────────────────────────────
export type AutoModSource = 'send' | 'edit' | 'thread' | 'forum';

export interface EnforceAutoModInput {
  serverId: string | null | undefined;
  channel: { id: string; name?: string | null; parentId?: string | null; type?: string | null };
  user: { id: string; username?: string | null; displayName?: string | null; avatar?: string | null };
  membership: { id?: string; roles?: string[] | null; nickname?: string | null; communicationDisabledUntil?: Date | string | null } | null | undefined;
  /** The raw text the user typed (before sanitizing). */
  content: string | null | undefined;
  source: AutoModSource;
  /** Thread / forum post title, checked by keyword + link rules too. */
  title?: string | null;
}

export type AutoModDenial = { status: number; body: Record<string, unknown> };

/** Owner, ADMINISTRATOR and MANAGE_GUILD are never moderated (Discord). */
async function isPermissionExempt(serverId: string, userId: string, roles: string[]): Promise<boolean> {
  try {
    const cacheKey = `server:owner:${serverId}`;
    let ownerId = await cache.get<string>(cacheKey).catch(() => null);
    if (!ownerId) {
      const server = await Server.findById(serverId);
      ownerId = server?.ownerId ?? null;
      if (ownerId) await cache.set(cacheKey, ownerId, 3600).catch(() => {});
    }
    if (ownerId && normalizeId(ownerId) === normalizeId(userId)) return true;
    if (!roles.length) return false;
    const perms = await getRolePermissions(roles, serverId);
    for (const [, p] of perms) {
      if (hasPermission(p, PERMISSION_BITS.ADMINISTRATOR) || hasPermission(p, PERMISSION_BITS.MANAGE_SERVER)) return true;
    }
  } catch {
    /* fall through: not exempt */
  }
  return false;
}

async function recentMessagesFor(channelId: string, userId: string): Promise<RecentMessage[]> {
  try {
    const rows = await Message.find({ channelId, authorId: userId, isDeleted: false, _limit: 5 });
    const texts = await Promise.all(rows.map((m) => (m.content ? decryptFromStorage(m.content) : Promise.resolve(''))));
    const { decodeHtmlEntities } = await import('@/lib/chat/messages');
    return rows.map((m, i) => ({ content: decodeHtmlEntities(texts[i] ?? ''), at: new Date(m.createdAt ?? 0).getTime() }));
  } catch {
    return [];
  }
}

function quote(text: string, max = 1000): string {
  const clipped = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return clipped.split('\n').map((l) => `> ${l}`).join('\n');
}

const TRIGGER_LABEL: Record<AutoModTriggerType, string> = {
  keyword: 'Custom keyword',
  spam: 'Suspected spam',
  mention_spam: 'Mention spam',
  links: 'Links',
};

/** Posts the "AutoMod flagged / blocked a message" alert into a server channel. */
async function postAlert(opts: {
  serverId: string;
  alertChannelId: string;
  match: AutoModMatch;
  input: EnforceAutoModInput;
  text: string;
  blocked: boolean;
}): Promise<string | null> {
  const { serverId, alertChannelId, match, input, text, blocked } = opts;
  const alertChannel = await Channel.findById(alertChannelId).catch(() => null);
  if (!alertChannel || !alertChannel.serverId || normalizeId(alertChannel.serverId) !== normalizeId(serverId)) return null;
  if (!['text', 'announcement', 'public_thread', 'private_thread'].includes(String(alertChannel.type))) return null;

  const { sanitizeMessageContent, publishToChannel } = await import('@/lib/api/channels');
  const verb = blocked ? 'blocked a message' : 'flagged a message';
  const raw = `**AutoMod** ${verb} from <@${input.user.id}> in <#${input.channel.id}>\n${quote(text)}`;
  const content = sanitizeMessageContent(raw);
  const embeds = [{
    type: 'rich',
    color: 0xED4245,
    fields: [
      { name: 'Rule', value: match.rule.name.slice(0, 256), inline: true },
      { name: 'Filter', value: TRIGGER_LABEL[match.rule.triggerType], inline: true },
      ...(match.keyword ? [{ name: 'Keyword', value: match.keyword.slice(0, 256), inline: true }] : []),
    ],
  }];
  const message = await Message.create({
    channelId: alertChannel.id,
    serverId,
    authorId: SYSTEM_USERS.SERIKA_SYSTEM,
    content: await encryptForStorage(content),
    type: 'default',
    attachments: [],
    embeds,
    mentionEveryone: false,
    mentionedUserIds: [],
    mentionedRoleIds: [],
    mentionedChannelIds: [],
  });
  void Channel.updateById(alertChannel.id, { lastMessageId: message.id }).catch(() => {});

  const payload = {
    id: message.id,
    content,
    authorId: SYSTEM_USERS.SERIKA_SYSTEM,
    author: {
      id: SYSTEM_USERS.SERIKA_SYSTEM,
      username: 'automod',
      displayName: 'AutoMod',
      avatar: '/logo-icon.svg',
      badges: [],
      isSystem: true,
      isBot: true,
      isVerified: true,
    },
    channelId: alertChannel.id,
    serverId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    type: 'default',
    attachments: [],
    embeds,
    reactions: [],
    pinned: false,
    mentionEveryone: false,
    mentionedUserIds: [],
    mentionedRoleIds: [],
    mentionedChannelIds: [],
  };
  publishToChannel(alertChannel.id, { type: 'message', message: payload });
  void import('@/lib/services/messageSignals')
    .then(({ signalChannelMessage }) => signalChannelMessage({
      channel: alertChannel,
      messageId: message.id,
      authorId: SYSTEM_USERS.SERIKA_SYSTEM,
      authorName: 'AutoMod',
      content: `AutoMod ${verb}`,
      createdAt: message.createdAt,
    }))
    .catch(() => {});
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageCreate }) => emitMessageCreate(payload as never))
    .catch(() => {});
  return message.id;
}

async function applyTimeout(serverId: string, userId: string, seconds: number, membership: EnforceAutoModInput['membership']): Promise<string | null> {
  const member = membership?.id ? membership : await ServerMember.findOne({ serverId, userId });
  if (!member?.id) return null;
  const until = new Date(Date.now() + seconds * 1000);
  const current = member.communicationDisabledUntil ? new Date(member.communicationDisabledUntil).getTime() : 0;
  if (current >= until.getTime()) return null; // already timed out for longer
  await ServerMember.updateById(member.id, { communicationDisabledUntil: until });
  return until.toISOString();
}

/**
 * Runs the server's AutoMod rules against a message write. Returns null when
 * the write may go ahead (possibly after alerting / timing out), or the 400
 * to reply with when a rule blocks it.
 */
export async function enforceAutoMod(input: EnforceAutoModInput): Promise<AutoModDenial | null> {
  const serverId = input.serverId;
  const text = [input.title, input.content].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).join('\n');
  if (!serverId || !text) return null;

  let rules: AutoModRule[];
  try {
    rules = (await cachedRules(serverId)).filter((r) => r.enabled);
  } catch {
    return null; // never block messages because AutoMod storage is down
  }
  if (rules.length === 0) return null;

  const roles = ((input.membership?.roles || []) as string[]).map((r) => String(r));
  const recentMessages = input.source === 'send' && ruleNeedsRecentMessages(rules)
    ? await recentMessagesFor(input.channel.id, input.user.id)
    : [];
  const isThread = input.channel.type === 'public_thread' || input.channel.type === 'private_thread';
  const matches = evaluateAutoMod(rules, {
    content: text,
    channelId: input.channel.id,
    parentChannelId: isThread ? input.channel.parentId ?? null : null,
    memberRoleIds: roles,
    // An edit isn't a new message: the repeat check only applies to sends.
    recentMessages,
  }).filter((m) => input.source === 'send' || m.rule.triggerType !== 'spam');
  if (matches.length === 0) return null;
  if (await isPermissionExempt(serverId, input.user.id, roles)) return null;

  const block = blockResponse(matches);
  const sid = normalizeId(serverId);

  // Side effects run in the background: the sender gets their answer at once.
  void (async () => {
    const { emitAutoModActionExecution } = await import('@/lib/services/gatewayEvents');
    let timedOut = false;
    for (const match of matches) {
      const ruleMeta = {
        auto_moderation_rule_name: match.rule.name,
        auto_moderation_rule_trigger_type: String(DISCORD_TRIGGER_TYPE[match.rule.triggerType]),
        channel_id: input.channel.id,
      };
      for (const action of match.rule.actions) {
        try {
          let alertMessageId: string | null = null;
          if (action.type === 'block_message') {
            audit({ serverId: sid, userId: null, actionType: AuditLogEvent.AUTO_MODERATION_BLOCK_MESSAGE, targetId: input.user.id, options: ruleMeta });
          } else if (action.type === 'send_alert') {
            alertMessageId = await postAlert({ serverId: sid, alertChannelId: action.channelId, match, input, text, blocked: block.blocked });
            audit({ serverId: sid, userId: null, actionType: AuditLogEvent.AUTO_MODERATION_FLAG_TO_CHANNEL, targetId: input.user.id, options: ruleMeta });
          } else if (action.type === 'timeout') {
            if (timedOut) continue;
            const until = await applyTimeout(sid, input.user.id, action.durationSeconds, input.membership);
            if (!until) continue;
            timedOut = true;
            audit({
              serverId: sid,
              userId: null,
              actionType: AuditLogEvent.AUTO_MODERATION_USER_COMMUNICATION_DISABLED,
              targetId: input.user.id,
              changes: [{ key: 'communication_disabled_until', new: until }],
              options: ruleMeta,
              reason: `AutoMod: ${match.rule.name}`,
            });
          }
          await emitAutoModActionExecution(sid, {
            action: { type: DISCORD_ACTION_TYPE[action.type], metadata: toDiscordAction(action).metadata },
            rule_id: match.rule.id,
            rule_trigger_type: DISCORD_TRIGGER_TYPE[match.rule.triggerType],
            user_id: input.user.id,
            channel_id: input.channel.id,
            ...(alertMessageId ? { alert_system_message_id: alertMessageId } : {}),
            // Blocked text stays out of the bot bus (Discord gates it behind
            // MESSAGE_CONTENT + MANAGE_GUILD, which this gateway can't check).
            content: '',
            matched_keyword: match.keyword,
            matched_content: '',
          });
        } catch (err) {
          console.error('[automod] action failed:', (err as Error)?.message ?? err);
        }
      }
    }
  })().catch(() => {});

  if (!block.blocked || !block.rule) return null;
  return {
    status: 400,
    body: {
      error: block.customMessage || 'Your message was blocked by this server’s AutoMod.',
      code: AUTOMOD_BLOCK_CODE,
      automod: {
        ruleId: block.rule.id,
        ruleName: block.rule.name,
        customMessage: block.customMessage,
      },
    },
  };
}
