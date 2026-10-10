/**
 * Server-side name lookup for mention markup in previews (Inbox, activity
 * notifications, the DM list), so clients show "@Alice" instead of "@user".
 * One small query per kind of mention, only when the text contains any.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { hasMentionTokens, mentionTokens, type MentionNames } from '@/lib/chat/mentionText';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;

function uuids(ids: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (UUID_RE.test(id)) out.push(id.toLowerCase());
    if (out.length >= MAX_IDS) break;
  }
  return [...new Set(out)];
}

/**
 * Resolve the mentions found in `texts`. `serverId` (when every text comes
 * from one server) prefers server nicknames; `serverIdByIndex` does the same
 * per text for mixed lists.
 */
export async function lookupMentionNames(
  texts: Array<string | null | undefined>,
  opts: { serverId?: string | null; serverIds?: Array<string | null | undefined> } = {},
): Promise<MentionNames> {
  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  const channelIds = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    // Stored content is HTML-escaped; mention markup survives as &lt;@id&gt;.
    const decoded = text.includes('&lt;') ? text.replace(/&lt;/g, '<').replace(/&gt;/g, '>') : text;
    const t = mentionTokens(decoded);
    if (!hasMentionTokens(t)) continue;
    t.userIds.forEach((id) => userIds.add(id));
    t.roleIds.forEach((id) => roleIds.add(id));
    t.channelIds.forEach((id) => channelIds.add(id));
  }
  const names: Required<MentionNames> = { users: {}, roles: {}, channels: {} };
  const uIds = uuids(userIds);
  const rIds = uuids(roleIds);
  const cIds = uuids(channelIds);
  if (uIds.length + rIds.length + cIds.length === 0) return {};

  const serverIds = uuids(
    [opts.serverId, ...(opts.serverIds ?? [])].filter((s): s is string => typeof s === 'string' && s.length > 0),
  );

  try {
    const [users, nicknames, roles, channels] = await Promise.all([
      uIds.length
        ? db
            .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName })
            .from(schema.users)
            .where(inArray(schema.users.id, uIds))
        : Promise.resolve([]),
      uIds.length && serverIds.length === 1
        ? db
            .select({ userId: schema.serverMembers.userId, nickname: schema.serverMembers.nickname })
            .from(schema.serverMembers)
            .where(and(eq(schema.serverMembers.serverId, serverIds[0]), inArray(schema.serverMembers.userId, uIds)))
        : Promise.resolve([] as Array<{ userId: string; nickname: string | null }>),
      rIds.length
        ? db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).where(inArray(schema.roles.id, rIds))
        : Promise.resolve([]),
      cIds.length
        ? db.select({ id: schema.channels.id, name: schema.channels.name }).from(schema.channels).where(inArray(schema.channels.id, cIds))
        : Promise.resolve([]),
    ]);
    for (const u of users) names.users[u.id] = u.displayName || u.username;
    for (const n of nicknames) if (n.nickname) names.users[n.userId] = n.nickname;
    for (const r of roles) names.roles[r.id] = r.name;
    for (const c of channels) names.channels[c.id] = c.name;
  } catch (err) {
    console.error('Mention name lookup failed:', (err as Error).message);
  }
  return names;
}
