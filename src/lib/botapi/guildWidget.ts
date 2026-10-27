/**
 * Public guild widget for the Discord-compatible bot API: GET
 * /guilds/{id}/widget.json and /guilds/{id}/widget.png. No authentication,
 * like Discord, but only while the owner has the widget enabled (403 50004
 * otherwise). Shapes: ./guildWidgetRules.ts, image: ./guildWidgetImage.ts.
 * Results are cached per guild for a minute (the endpoints are public).
 *
 * instant_invite: the partnered vanity link, else an existing permanent,
 * unlimited invite to the widget channel (never created on the fly), and none
 * while invites are paused (incident actions).
 */
import { and, asc, eq, gt, gte, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { config } from '@/lib/config';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared } from '@/lib/realtime/processShared';
import { Channel, Role, Server } from '@/lib/models';
import type { IServerSettings } from '@/lib/models';
import { isValidObjectId } from '@/lib/security';
import { PRESENCE_TIMEOUT_MS, resolveEffectiveStatus } from '@/lib/services/presence';
import { invitesPaused } from './guildIncidentRules';
import { buildWidget, publicVoiceChannels, WIDGET_MEMBER_LIMIT, type WidgetMemberLike } from './guildWidgetRules';
import { renderWidgetImage, widgetStyleOf } from './guildWidgetImage';

type Result = { status: number; body: unknown; headers?: Record<string, string> };

const TTL_MS = 60_000;
const jsonCache = processShared('botWidgetJson', () => new BoundedMap<string, { at: number; body: unknown }>(2000));
const pngCache = processShared('botWidgetPng', () => new BoundedMap<string, { at: number; png: Buffer }>(2000));

const UNKNOWN_GUILD = { code: 10004, message: 'Unknown Guild' };
const WIDGET_DISABLED = { code: 50004, message: 'Widget Disabled' };

function defaultAvatar(): string {
  return `${config.FRONTEND_URL || 'https://serika.chat'}/serika-avatar.png`;
}

/** Drop cached widget output after a settings change. */
export function invalidateWidgetCache(guildId: string) {
  const id = normalizeId(guildId);
  jsonCache.delete(id);
  for (const style of ['shield', 'banner1', 'banner2', 'banner3', 'banner4']) pngCache.delete(`${id}:${style}`);
}

async function loadEnabledServer(guildId: string): Promise<{ ok: true; server: NonNullable<Awaited<ReturnType<typeof Server.findById>>> } | { ok: false; result: Result }> {
  if (!isValidObjectId(guildId)) return { ok: false, result: { status: 404, body: UNKNOWN_GUILD } };
  const server = await Server.findById(guildId);
  if (!server) return { ok: false, result: { status: 404, body: UNKNOWN_GUILD } };
  if (((server.settings ?? {}) as IServerSettings).widget?.enabled !== true) return { ok: false, result: { status: 403, body: WIDGET_DISABLED } };
  return { ok: true, server };
}

/** Online members (status online / idle / dnd, recent heartbeat), by name, at most 100. */
async function onlineMembers(guildId: string): Promise<WidgetMemberLike[]> {
  const u = schema.users;
  const since = new Date(Date.now() - PRESENCE_TIMEOUT_MS);
  const rows = await db
    .select({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, status: u.status, presenceLastHeartbeatAt: u.presenceLastHeartbeatAt, isSystem: u.isSystem })
    .from(schema.serverMembers)
    .innerJoin(u, eq(u.id, schema.serverMembers.userId))
    .where(and(
      eq(schema.serverMembers.serverId, normalizeId(guildId)),
      notInArray(u.status, ['offline', 'invisible']),
      gte(u.presenceLastHeartbeatAt, since),
    ))
    .orderBy(asc(sql`lower(coalesce(${u.displayName}, ${u.username}))`))
    .limit(WIDGET_MEMBER_LIMIT);
  const out: WidgetMemberLike[] = [];
  for (const r of rows) {
    const status = resolveEffectiveStatus(r);
    if (status === 'offline') continue;
    out.push({ userId: r.id, username: r.username, displayName: r.displayName, avatarUrl: r.avatar || defaultAvatar(), status });
  }
  return out;
}

async function instantInvite(server: { id: string; isPartnered?: boolean | null; vanityUrlCode?: string | null; settings?: unknown }): Promise<string | null> {
  if (invitesPaused(server.settings)) return null;
  const base = config.FRONTEND_URL || 'https://serika.chat';
  if (server.isPartnered && server.vanityUrlCode) return `${base}/invite/${server.vanityUrlCode}`;
  const channelId = ((server.settings ?? {}) as IServerSettings).widget?.channelId;
  if (!channelId || !isValidObjectId(channelId)) return null;
  const i = schema.invites;
  const [row] = await db.select({ code: i.code }).from(i).where(and(
    eq(i.serverId, normalizeId(server.id)),
    eq(i.channelId, normalizeId(channelId)),
    sql`${i.isVanity} IS NOT TRUE`,
    or(isNull(i.maxUses), eq(i.maxUses, 0)),
    or(isNull(i.expiresAt), gt(i.expiresAt, new Date())),
  )).limit(1);
  return row ? `${base}/invite/${row.code}` : null;
}

export async function getWidgetJson(guildId: string): Promise<Result> {
  const loaded = await loadEnabledServer(guildId);
  if (!loaded.ok) return loaded.result;
  const server = loaded.server;
  const key = normalizeId(server.id);
  const hit = jsonCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { status: 200, body: hit.body };

  const [channels, everyone, members, invite, presenceCount] = await Promise.all([
    Channel.find({ serverId: server.id }),
    Role.findOne({ serverId: server.id, isDefault: true }),
    onlineMembers(server.id),
    instantInvite(server),
    import('@/lib/api/servers').then((m) => m.computeOnlineCount(server.id)).catch(() => 0),
  ]);
  let everyonePermissions: bigint | null = null;
  try { everyonePermissions = everyone?.permissions ? BigInt(everyone.permissions) : null; } catch { everyonePermissions = null; }
  const listed = publicVoiceChannels(channels, { serverId: server.id, everyoneRoleId: everyone?.id ?? null, everyonePermissions });
  let voiceStates: Awaited<ReturnType<typeof import('@/lib/services/voiceStates').listGuildVoiceStates>> = [];
  if (listed.length > 0) {
    try {
      const { listGuildVoiceStates } = await import('@/lib/services/voiceStates');
      voiceStates = await listGuildVoiceStates(server.id);
    } catch { /* voice mirror unavailable */ }
  }
  const body = buildWidget({ id: server.id, name: server.name, instantInvite: invite, channels: listed, members, voiceStates, presenceCount });
  jsonCache.set(key, { at: Date.now(), body });
  return { status: 200, body };
}

/** The widget image (PNG bytes) or the error to answer. */
export async function getWidgetPng(guildId: string, styleParam: unknown): Promise<{ ok: true; png: Buffer } | { ok: false; result: Result }> {
  const loaded = await loadEnabledServer(guildId);
  if (!loaded.ok) return loaded;
  const style = widgetStyleOf(styleParam);
  const key = `${normalizeId(loaded.server.id)}:${style}`;
  const hit = pngCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, png: hit.png };
  const { computeOnlineCount } = await import('@/lib/api/servers');
  const online = await computeOnlineCount(loaded.server.id).catch(() => 0);
  const img = renderWidgetImage(style, { name: loaded.server.name, online });
  const { default: sharp } = await import('sharp');
  const png = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  pngCache.set(key, { at: Date.now(), png });
  return { ok: true, png };
}
