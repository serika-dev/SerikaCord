// Server templates (Discord-style): one template per server holding a
// snapshot of its structure (src/lib/servers/community.ts ServerSnapshot),
// shared by code/link, used to create new servers, and re-synced on demand.
import { randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { Channel, Role, Server, ServerMember } from '@/lib/models';
import {
  generateTemplateCode,
  isTemplateDirty,
  parseServerSnapshot,
  remapTemplateOverwrites,
  serializeServerTemplate,
  summarizeSnapshot,
  type ServerSnapshot,
  type SourceChannel,
  type SourceRole,
} from '@/lib/servers/community';

export type TemplateRow = typeof schema.serverTemplates.$inferSelect;

/** Snapshot of a server as it is right now, or null when it doesn't exist. */
export async function snapshotServer(serverId: string): Promise<ServerSnapshot | null> {
  const server = await Server.findById(serverId);
  if (!server) return null;
  const [roles, channels] = await Promise.all([
    Role.find({ serverId: server.id }),
    Channel.find({ serverId: server.id }),
  ]);
  return serializeServerTemplate(
    server,
    roles as unknown as SourceRole[],
    channels as unknown as SourceChannel[],
  );
}

export async function getTemplateForServer(serverId: string): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(schema.serverTemplates)
    .where(eq(schema.serverTemplates.serverId, normalizeId(serverId)))
    .limit(1);
  return row ?? null;
}

export async function getTemplateByCode(code: string): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(schema.serverTemplates)
    .where(eq(schema.serverTemplates.code, code))
    .limit(1);
  return row ?? null;
}

/** The API shape of a template (Discord's template object, camelCased). */
export function templateDto(row: TemplateRow, opts: { isDirty?: boolean | null; creator?: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null; sourceServer?: { id: string; name: string; icon?: string | null } | null } = {}) {
  const snapshot = parseServerSnapshot(row.serialized);
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    usageCount: row.usageCount,
    creatorId: row.creatorId,
    creator: opts.creator ?? null,
    sourceServerId: row.serverId,
    sourceServer: opts.sourceServer ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDirty: opts.isDirty ?? null,
    summary: snapshot ? summarizeSnapshot(snapshot) : null,
    serializedSourceServer: snapshot,
  };
}

export async function templateDirty(row: TemplateRow): Promise<boolean | null> {
  const current = await snapshotServer(row.serverId).catch(() => null);
  if (!current) return null;
  return isTemplateDirty(row.serialized, current);
}

export async function createTemplate(serverId: string, creatorId: string, meta: { name: string; description: string | null }): Promise<TemplateRow | null> {
  const snapshot = await snapshotServer(serverId);
  if (!snapshot) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateTemplateCode((n) => randomBytes(n));
    const [row] = await db
      .insert(schema.serverTemplates)
      .values({
        code,
        serverId: normalizeId(serverId),
        creatorId: normalizeId(creatorId),
        name: meta.name,
        description: meta.description,
        serialized: snapshot,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    // Either the code collided or the server already has a template.
    const existing = await getTemplateForServer(serverId);
    if (existing) return existing;
  }
  return null;
}

export async function syncTemplate(row: TemplateRow): Promise<TemplateRow | null> {
  const snapshot = await snapshotServer(row.serverId);
  if (!snapshot) return null;
  const [updated] = await db
    .update(schema.serverTemplates)
    .set({ serialized: snapshot, updatedAt: new Date() })
    .where(eq(schema.serverTemplates.code, row.code))
    .returning();
  return updated ?? null;
}

export async function updateTemplateMeta(row: TemplateRow, meta: { name: string; description: string | null }): Promise<TemplateRow | null> {
  const [updated] = await db
    .update(schema.serverTemplates)
    .set({ name: meta.name, description: meta.description, updatedAt: new Date() })
    .where(eq(schema.serverTemplates.code, row.code))
    .returning();
  return updated ?? null;
}

export async function deleteTemplate(row: TemplateRow): Promise<void> {
  await db.delete(schema.serverTemplates).where(eq(schema.serverTemplates.code, row.code));
}

type ChannelType = typeof schema.channels.$inferInsert.type;
type ForumMode = NonNullable<typeof schema.channels.$inferInsert.forumMode>;

/**
 * Builds a new server owned by `ownerId` from a template snapshot: settings,
 * roles, categories, channels and role overwrites. Returns the new server id.
 */
export async function createServerFromSnapshot(
  snapshot: ServerSnapshot,
  ownerId: string,
  opts: { name: string; icon?: string | null; templateCode?: string | null },
): Promise<string> {
  const everyoneTemplate = snapshot.roles.find((r) => r.id === 0);
  const server = await Server.create({
    name: opts.name,
    icon: opts.icon ?? null,
    description: snapshot.description,
    ownerId,
    memberCount: 1,
    verificationLevel: snapshot.verificationLevel,
    explicitContentFilter: snapshot.explicitContentFilter,
    defaultNotifications: snapshot.defaultNotifications,
    afkTimeout: snapshot.afkTimeout,
    templateId: opts.templateCode ?? null,
  });

  const roleIdMap = new Map<number, string>();
  const everyone = await Role.create({
    serverId: server.id,
    name: '@everyone',
    position: 0,
    permissions: everyoneTemplate?.permissions ?? '0',
    isDefault: true,
  });
  roleIdMap.set(0, everyone.id);
  const others = snapshot.roles.filter((r) => r.id !== 0).sort((a, b) => a.position - b.position);
  for (const r of others) {
    const created = await Role.create({
      serverId: server.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions,
      unicodeEmoji: r.unicodeEmoji,
      position: r.position,
    });
    roleIdMap.set(r.id, created.id);
  }

  // Categories first (snapshot order), so children can point at them.
  const channelIdMap = new Map<number, string>();
  const ordered = [...snapshot.channels].sort((a, b) => (a.type === 'category' ? 0 : 1) - (b.type === 'category' ? 0 : 1));
  for (const c of ordered) {
    const parentId = c.parentId != null ? channelIdMap.get(c.parentId) ?? null : null;
    const created = await Channel.create({
      serverId: server.id,
      name: c.name,
      type: c.type as ChannelType,
      topic: c.topic,
      position: c.position,
      parentId,
      nsfw: c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser,
      bitrate: c.bitrate,
      userLimit: c.userLimit,
      ...(c.type === 'forum' ? { forumMode: (c.forumMode === 'tickets' ? 'tickets' : 'posts') as ForumMode, availableTags: c.availableTags } : {}),
      ...(c.defaultAutoArchiveDuration != null ? { defaultAutoArchiveDuration: c.defaultAutoArchiveDuration } : {}),
      permissionOverwrites: remapTemplateOverwrites(c.permissionOverwrites, roleIdMap),
    });
    channelIdMap.set(c.id, created.id);
  }

  const systemChannelId = snapshot.systemChannelId != null ? channelIdMap.get(snapshot.systemChannelId) ?? null : null;
  const afkChannelId = snapshot.afkChannelId != null ? channelIdMap.get(snapshot.afkChannelId) ?? null : null;
  if (systemChannelId || afkChannelId) {
    await Server.updateById(server.id, { systemChannelId, afkChannelId });
  }

  await ServerMember.create({ serverId: server.id, userId: ownerId, roles: [everyone.id] });
  return server.id;
}

export async function bumpTemplateUsage(code: string): Promise<void> {
  await db
    .update(schema.serverTemplates)
    .set({ usageCount: sql`${schema.serverTemplates.usageCount} + 1` })
    .where(eq(schema.serverTemplates.code, code));
}
