import { BoundedMap } from '@/lib/utils/boundedMap';
import { isSnowflake } from './bridgeConfig';

/**
 * Discord REST calls made with the bridge bot's token: guild lookups for the
 * link picker and control checks, channel lists for the mapping editor, and
 * the per-channel "SerikaBridge" webhooks. Results that many requests share
 * (bot guild list, guild info, member permissions, channel lists) are cached
 * briefly in-process so the settings UI never fans out to Discord per render.
 */

export const DISCORD_API = 'https://discord.com/api/v10';
export const BRIDGE_WEBHOOK_NAME = 'SerikaBridge';
export const BRIDGE_BOT_ID = process.env.SERIKA_DISCORD_ID || '1524469730256355421';

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export function bridgeBotToken(): string | null {
  return process.env.SERIKA_DISCORD_TOKEN || null;
}

export interface DiscordResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Discord JSON error code (e.g. 10003 Unknown Channel, 50013 Missing Permissions). */
  code?: number;
}

/**
 * One bot-authenticated call. A 429 is retried once when Discord asks for a
 * short wait; anything longer comes back as a 429 for the caller to report.
 */
export async function discordBot<T>(
  path: string,
  init: { method?: string; body?: unknown; auditReason?: string } = {},
): Promise<DiscordResult<T>> {
  const token = bridgeBotToken();
  if (!token) return { ok: false, status: 503, data: null };
  const headers: Record<string, string> = { Authorization: `Bot ${token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auditReason) headers['X-Audit-Log-Reason'] = encodeURIComponent(init.auditReason.slice(0, 200));
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${DISCORD_API}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { ok: false, status: 504, data: null };
    }
    if (res.status === 429 && attempt === 0) {
      const wait = parseFloat(res.headers.get('Retry-After') || '1') * 1000;
      if (wait <= 5000) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
    if (res.status === 204) return { ok: res.ok, status: res.status, data: null };
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'number' ? (body as { code: number }).code : undefined;
      return { ok: false, status: res.status, data: null, code };
    }
    return { ok: true, status: res.status, data: body as T };
  }
  return { ok: false, status: 429, data: null };
}

/**
 * One GET made with somebody else's bot token (proving ownership of a Discord
 * bot, src/lib/services/applicationDiscordLink.ts). No retries, short
 * timeout, and the token never leaves this call: it is not logged and not
 * kept. status 0 = Discord could not be reached.
 */
export async function discordGetWithToken<T>(token: string, path: string, timeoutMs = 8_000): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    const data = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function cached<V>(map: BoundedMap<string, { at: number; value: V }>, key: string, ttlMs: number): V | undefined {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return undefined;
}

// ── Guilds ──────────────────────────────────────────────────────────────────

export interface DiscordGuildInfo {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  memberCount: number | null;
  roles: Array<{ id: string; permissions: string }>;
}

const guildInfoCache = new BoundedMap<string, { at: number; value: DiscordGuildInfo | null }>(500);
const botGuildsCache = new BoundedMap<string, { at: number; value: string[] }>(1);
const memberPermsCache = new BoundedMap<string, { at: number; value: bigint | null }>(2000);
const manageableCache = new BoundedMap<string, { at: number; value: DiscordGuildInfo[] }>(500);

export function guildIconUrl(guildId: string, icon: string | null | undefined, size = 128): string | null {
  if (!icon) return null;
  const ext = icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=${size}`;
}

/** Guild name/icon/owner/roles/member count, or null when the bot is not in it. Cached 2 minutes. */
export async function getGuildInfo(guildId: string, opts: { fresh?: boolean } = {}): Promise<DiscordGuildInfo | null> {
  if (!isSnowflake(guildId)) return null;
  if (!opts.fresh) {
    const hit = cached(guildInfoCache, guildId, 120_000);
    if (hit !== undefined) return hit;
  }
  const res = await discordBot<{ id: string; name: string; icon: string | null; owner_id?: string; approximate_member_count?: number; roles?: Array<{ id: string; permissions: string }> }>(
    `/guilds/${guildId}?with_counts=true`,
  );
  // Only a definite answer is cached; outages and rate limits are retried next time.
  if (!res.ok && res.status !== 403 && res.status !== 404) return null;
  const value: DiscordGuildInfo | null = res.data
    ? {
        id: res.data.id,
        name: res.data.name,
        icon: res.data.icon ?? null,
        ownerId: res.data.owner_id ?? null,
        memberCount: typeof res.data.approximate_member_count === 'number' ? res.data.approximate_member_count : null,
        roles: Array.isArray(res.data.roles) ? res.data.roles.map((r) => ({ id: r.id, permissions: r.permissions })) : [],
      }
    : null;
  guildInfoCache.set(guildId, { at: Date.now(), value });
  return value;
}

/** Ids of the guilds the bridge bot is in (up to 1000). Cached 1 minute. */
export async function getBotGuildIds(): Promise<string[]> {
  const hit = cached(botGuildsCache, 'all', 60_000);
  if (hit) return hit;
  const ids: string[] = [];
  let after = '0';
  for (let page = 0; page < 5; page++) {
    const res = await discordBot<Array<{ id: string }>>(`/users/@me/guilds?limit=200&after=${after}`);
    if (!res.ok || !Array.isArray(res.data)) break;
    for (const g of res.data) if (isSnowflake(g.id)) ids.push(g.id);
    if (res.data.length < 200) break;
    after = res.data[res.data.length - 1].id;
  }
  botGuildsCache.set('all', { at: Date.now(), value: ids });
  return ids;
}

/**
 * The member's effective guild permissions (owner = everything), or null when
 * they are not in the guild. Cached 1 minute per guild+user.
 */
export async function getMemberGuildPermissions(guild: DiscordGuildInfo, discordUserId: string, opts: { fresh?: boolean } = {}): Promise<bigint | null> {
  if (guild.ownerId === discordUserId) return ADMINISTRATOR | MANAGE_GUILD;
  const key = `${guild.id}:${discordUserId}`;
  if (!opts.fresh) {
    const hit = cached(memberPermsCache, key, 60_000);
    if (hit !== undefined) return hit;
  }
  const member = await discordBot<{ roles?: string[] }>(`/guilds/${guild.id}/members/${discordUserId}`);
  if (!member.ok && member.status !== 404) return null;
  let value: bigint | null = null;
  if (member.data) {
    const memberRoles = new Set(member.data.roles ?? []);
    let perms = 0n;
    for (const role of guild.roles) {
      // @everyone's role id is the guild id.
      if (role.id === guild.id || memberRoles.has(role.id)) perms |= BigInt(role.permissions || '0');
    }
    value = perms;
  }
  memberPermsCache.set(key, { at: Date.now(), value });
  return value;
}

export function canManageGuild(perms: bigint | null): boolean {
  return perms !== null && ((perms & ADMINISTRATOR) !== 0n || (perms & MANAGE_GUILD) !== 0n);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Guilds the bot is in where this Discord user is the owner or holds
 * Administrator / Manage Server: the choices for the link picker. Checks at
 * most 200 guilds; cached 1 minute per user (`fresh` skips the cache).
 */
export async function listManageableGuilds(discordUserId: string, opts: { fresh?: boolean } = {}): Promise<DiscordGuildInfo[]> {
  if (!opts.fresh) {
    const hit = cached(manageableCache, discordUserId, 60_000);
    if (hit) return hit;
  }
  const ids = (await getBotGuildIds()).slice(0, 200);
  const results = await mapLimit(ids, 4, async (id) => {
    const info = await getGuildInfo(id);
    if (!info) return null;
    const perms = await getMemberGuildPermissions(info, discordUserId, opts);
    return canManageGuild(perms) ? info : null;
  });
  const value = results.filter((g): g is DiscordGuildInfo => g !== null).sort((a, b) => a.name.localeCompare(b.name));
  manageableCache.set(discordUserId, { at: Date.now(), value });
  return value;
}

// ── Channels ────────────────────────────────────────────────────────────────

export type DiscordChannelKind = 'text' | 'announcement' | 'voice' | 'category' | 'forum' | 'stage';

export interface DiscordChannelInfo {
  id: string;
  name: string;
  kind: DiscordChannelKind;
  position: number;
  parentId: string | null;
  topic: string;
  nsfw: boolean;
  permissionOverwrites: Array<{ id: string; type: number | string; allow?: string; deny?: string }>;
}

const KIND_BY_TYPE: Record<number, DiscordChannelKind> = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum' };
const channelsCache = new BoundedMap<string, { at: number; value: DiscordChannelInfo[] | null }>(500);

/** The guild's channels the bridge knows about, or null when Discord would not list them. Cached 20 seconds. */
export async function getGuildChannels(guildId: string, opts: { fresh?: boolean } = {}): Promise<DiscordChannelInfo[] | null> {
  if (!isSnowflake(guildId)) return null;
  if (!opts.fresh) {
    const hit = cached(channelsCache, guildId, 20_000);
    if (hit !== undefined) return hit;
  }
  const res = await discordBot<Array<{ id: string; name: string; type: number; position?: number; parent_id?: string | null; topic?: string | null; nsfw?: boolean; permission_overwrites?: DiscordChannelInfo['permissionOverwrites'] }>>(
    `/guilds/${guildId}/channels`,
  );
  if (!res.ok || !Array.isArray(res.data)) return null;
  const value = res.data
    .filter((c) => KIND_BY_TYPE[c.type] !== undefined)
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: KIND_BY_TYPE[c.type],
      position: c.position ?? 0,
      parentId: c.parent_id ?? null,
      topic: c.topic ?? '',
      nsfw: Boolean(c.nsfw),
      permissionOverwrites: Array.isArray(c.permission_overwrites) ? c.permission_overwrites : [],
    }));
  channelsCache.set(guildId, { at: Date.now(), value });
  return value;
}

export function invalidateGuildChannels(guildId: string): void {
  channelsCache.delete(guildId);
}

/** Text and announcement channels are the ones messages can be bridged in. */
export function isBridgeableKind(kind: DiscordChannelKind): boolean {
  return kind === 'text' || kind === 'announcement';
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookError = 'missing_permissions' | 'unknown_channel' | 'too_many_webhooks' | 'rate_limited' | 'unavailable';

export function webhookUrl(id: string, token: string): string {
  return `https://discord.com/api/webhooks/${id}/${token}`;
}

/** The webhook id inside a Discord webhook URL, or null when it isn't one (checked before every fetch). */
export function webhookIdFromUrl(url: string): string | null {
  // Host pinned to Discord, nothing after the token: the bridge only ever
  // fetches (and appends to) URLs of this exact shape.
  const m = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/[\w-]{1,100}$/.exec(url);
  return m ? m[1] : null;
}

function webhookFailure(res: DiscordResult<unknown>): WebhookError {
  if (res.status === 403 || res.code === 50013) return 'missing_permissions';
  if (res.status === 404 || res.code === 10003) return 'unknown_channel';
  if (res.code === 30007) return 'too_many_webhooks';
  if (res.status === 429) return 'rate_limited';
  return 'unavailable';
}

/**
 * The bridge webhook URL for a Discord channel: an existing "SerikaBridge"
 * webhook the bot can use, else a new one. `replace` deletes the bridge's old
 * webhooks there first (the Repair action, e.g. after someone deleted or
 * reset it on Discord).
 */
export async function ensureBridgeWebhook(
  discordChannelId: string,
  opts: { replace?: boolean } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: WebhookError }> {
  if (!isSnowflake(discordChannelId)) return { ok: false, error: 'unknown_channel' };
  const list = await discordBot<Array<{ id: string; name?: string; token?: string; user?: { id?: string }; application_id?: string | null }>>(
    `/channels/${discordChannelId}/webhooks`,
  );
  if (!list.ok) return { ok: false, error: webhookFailure(list) };
  const ours = (list.data ?? []).filter((w) => w.name === BRIDGE_WEBHOOK_NAME);
  if (opts.replace) {
    for (const w of ours) {
      await discordBot(`/webhooks/${w.id}`, { method: 'DELETE', auditReason: 'SerikaCord bridge repair' });
    }
  } else {
    // Prefer one the bridge bot made; older links may use a hand-made one of the same name.
    const usable = ours.find((w) => w.token && (w.user?.id === BRIDGE_BOT_ID || w.application_id === BRIDGE_BOT_ID)) ?? ours.find((w) => w.token);
    if (usable?.token) return { ok: true, url: webhookUrl(usable.id, usable.token) };
  }
  const created = await discordBot<{ id: string; token?: string }>(`/channels/${discordChannelId}/webhooks`, {
    method: 'POST',
    body: { name: BRIDGE_WEBHOOK_NAME },
    auditReason: 'SerikaCord bridge',
  });
  if (!created.ok || !created.data?.token) return { ok: false, error: webhookFailure(created) };
  return { ok: true, url: webhookUrl(created.data.id, created.data.token) };
}

/** Whether a webhook still exists on Discord (GET with its token needs no bot auth). */
export async function webhookExists(url: string): Promise<boolean | null> {
  if (!webhookIdFromUrl(url)) return false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 401) return false;
    return null;
  } catch {
    return null;
  }
}
