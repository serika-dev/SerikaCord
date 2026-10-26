/**
 * Pure model of a server's Discord bridge configuration (no DB, no network),
 * shared by the bridge bot (inbound), the outbound replicator, the bridge API
 * and its tests.
 *
 * Storage lives in `servers.settings.integrations`:
 *   discordGuildId         linked Discord guild
 *   discord                bridge switched on
 *   discordChannelsMap     Discord channel id -> SerikaCord channel id (legacy
 *                          maps also hold category ids; a value may be a plain
 *                          id or an object carrying `serikaChannelId`/`channelId`)
 *   discordWebhooks        SerikaCord channel id -> sealed Discord webhook URL
 *                          (encrypted at rest; older rows hold plaintext)
 *   discordLinkOptions     SerikaCord channel id -> per-link option overrides
 *   discordBridgeDefaults  server-wide option defaults every link inherits
 *   discordLinkedAt / discordLinkedBy / discordGuildName / discordGuildIcon
 *
 * Options are stored as partial overrides: a link resolves to
 * BUILTIN <- server defaults <- link overrides, so changing a default
 * reaches every link that did not override it.
 */

export type BridgeDirection = 'both' | 'to_serika' | 'to_discord';

export interface BridgeLinkOptions {
  /** Which way messages flow. */
  direction: BridgeDirection;
  /** Mirror message edits (both directions). */
  mirrorEdits: boolean;
  /** Mirror message deletions (both directions). */
  mirrorDeletes: boolean;
  /** Carry attachments, stickers and spoilered images across. */
  attachments: boolean;
  /** SerikaCord -> Discord: post as the author's name and avatar (else as the bridge webhook with a bold name). */
  showIdentity: boolean;
  /** Discord -> SerikaCord: mirror messages written by Discord bots. */
  includeBots: boolean;
  /** Text added before / after every mirrored message (both directions). */
  prefix: string;
  suffix: string;
  /** Temporarily stop mirroring without losing the link. */
  paused: boolean;
}

export const BRIDGE_DIRECTIONS: readonly BridgeDirection[] = ['both', 'to_serika', 'to_discord'];
export const AFFIX_MAX = 64;

export const BUILTIN_LINK_OPTIONS: Readonly<BridgeLinkOptions> = Object.freeze({
  direction: 'both',
  mirrorEdits: true,
  mirrorDeletes: true,
  attachments: true,
  showIdentity: true,
  includeBots: true,
  prefix: '',
  suffix: '',
  paused: false,
});

const BOOLEAN_KEYS = ['mirrorEdits', 'mirrorDeletes', 'attachments', 'showIdentity', 'includeBots', 'paused'] as const;

const SNOWFLAKE = /^\d{17,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** One line of plain text, control and bidi characters stripped, capped at AFFIX_MAX. */
export function sanitizeAffix(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, AFFIX_MAX).trim();
}

/**
 * Keep only known option keys with valid values. Used for stored rows (which
 * may be stale or hand-edited) and for client input, so it never throws.
 */
export function sanitizeLinkOptions(input: unknown): Partial<BridgeLinkOptions> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: Partial<BridgeLinkOptions> = {};
  if (typeof src.direction === 'string' && (BRIDGE_DIRECTIONS as readonly string[]).includes(src.direction)) {
    out.direction = src.direction as BridgeDirection;
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  if ('prefix' in src) out.prefix = sanitizeAffix(src.prefix);
  if ('suffix' in src) out.suffix = sanitizeAffix(src.suffix);
  return out;
}

/** Server defaults never carry `paused` (a paused default would silently stop every new link). */
export function sanitizeBridgeDefaults(input: unknown): Partial<BridgeLinkOptions> {
  const out = sanitizeLinkOptions(input);
  delete out.paused;
  return out;
}

export function resolveLinkOptions(
  defaults: Partial<BridgeLinkOptions> | undefined,
  overrides: Partial<BridgeLinkOptions> | undefined,
): BridgeLinkOptions {
  return { ...BUILTIN_LINK_OPTIONS, ...sanitizeBridgeDefaults(defaults), ...sanitizeLinkOptions(overrides) };
}

/** Drop overrides equal to what the link would inherit anyway, so "reset" is just an empty object. */
export function compactOverrides(
  defaults: Partial<BridgeLinkOptions> | undefined,
  overrides: Partial<BridgeLinkOptions>,
): Partial<BridgeLinkOptions> {
  const inherited = resolveLinkOptions(defaults, undefined);
  const out: Partial<BridgeLinkOptions> = {};
  for (const [key, value] of Object.entries(sanitizeLinkOptions(overrides)) as Array<[keyof BridgeLinkOptions, never]>) {
    if (inherited[key] !== value) out[key] = value;
  }
  return out;
}

export function isInboundActive(options: BridgeLinkOptions): boolean {
  return !options.paused && options.direction !== 'to_discord';
}

export function isOutboundActive(options: BridgeLinkOptions): boolean {
  return !options.paused && options.direction !== 'to_serika';
}

/** Whether messages sent in this SerikaCord channel go out to Discord (drives the sender consent prompt). */
export function isOutboundBridgedChannel(integrations: unknown, serikaChannelId: string): boolean {
  const bridge = normalizeBridge(integrations);
  if (!bridge.enabled) return false;
  const link = bridge.links.find((l) => l.serikaChannelId === serikaChannelId.toLowerCase());
  return Boolean(link?.webhook) && isOutboundActive(resolveLinkOptions(bridge.defaults, link?.overrides));
}

/** Prefix/suffix around non-empty text; attachment-only messages stay untouched. */
export function applyAffixes(content: string, options: Pick<BridgeLinkOptions, 'prefix' | 'suffix'>, maxLength = Infinity): string {
  if (!content) return content;
  const prefix = sanitizeAffix(options.prefix);
  const suffix = sanitizeAffix(options.suffix);
  if (!prefix && !suffix) return content.slice(0, maxLength);
  const tail = suffix ? ` ${suffix}` : '';
  const head = prefix ? `${prefix} ` : '';
  const room = Math.max(0, maxLength - head.length - tail.length);
  return `${head}${content.slice(0, room)}${tail}`;
}

export interface NormalizedBridgeLink {
  discordChannelId: string;
  serikaChannelId: string;
  /** Sealed (or legacy plaintext) webhook URL; never sent to clients. */
  webhook: string | null;
  overrides: Partial<BridgeLinkOptions>;
}

export interface NormalizedBridge {
  enabled: boolean;
  guildId: string | null;
  restrictUnconsented: boolean;
  defaults: Partial<BridgeLinkOptions>;
  links: NormalizedBridgeLink[];
  linkedAt: string | null;
  linkedBy: string | null;
  guildName: string | null;
  guildIcon: string | null;
}

function mapValueToChannelId(value: unknown): string | null {
  if (typeof value === 'string') return isUuid(value) ? value.toLowerCase() : null;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return mapValueToChannelId(v.serikaChannelId ?? v.channelId ?? v.id);
  }
  return null;
}

function mapValueOverrides(value: unknown): Partial<BridgeLinkOptions> {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  return sanitizeLinkOptions(v.options ?? v);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Read whatever shape is stored into one list of 1:1 links. Accepts the
 * legacy maps (plain ids, plaintext or sealed webhook URLs, category ids) and
 * object-valued map entries. When two Discord channels point at the same
 * SerikaCord channel, the first (by Discord id order) wins, so the result is
 * deterministic.
 */
export function normalizeBridge(integrations: unknown): NormalizedBridge {
  const integ = readRecord(integrations);
  const map = readRecord(integ.discordChannelsMap);
  const webhooks = readRecord(integ.discordWebhooks);
  const optionsMap = readRecord(integ.discordLinkOptions);
  const webhookByChannel = new Map<string, string>();
  for (const [channelId, url] of Object.entries(webhooks)) {
    if (typeof url === 'string' && url && isUuid(channelId)) webhookByChannel.set(channelId.toLowerCase(), url);
  }
  const optionsByChannel = new Map<string, Partial<BridgeLinkOptions>>();
  for (const [channelId, opts] of Object.entries(optionsMap)) {
    if (isUuid(channelId)) optionsByChannel.set(channelId.toLowerCase(), sanitizeLinkOptions(opts));
  }

  const links: NormalizedBridgeLink[] = [];
  const takenSerika = new Set<string>();
  const discordIds = Object.keys(map).filter(isSnowflake).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  for (const discordChannelId of discordIds) {
    const raw = map[discordChannelId];
    const serikaChannelId = mapValueToChannelId(raw);
    if (!serikaChannelId || takenSerika.has(serikaChannelId)) continue;
    takenSerika.add(serikaChannelId);
    links.push({
      discordChannelId,
      serikaChannelId,
      webhook: webhookByChannel.get(serikaChannelId) ?? null,
      overrides: { ...mapValueOverrides(raw), ...(optionsByChannel.get(serikaChannelId) ?? {}) },
    });
  }

  const guildId = typeof integ.discordGuildId === 'string' && isSnowflake(integ.discordGuildId) ? integ.discordGuildId : null;
  return {
    enabled: integ.discord === true,
    guildId,
    restrictUnconsented: integ.discordRestrictUnconsented === true,
    defaults: sanitizeBridgeDefaults(integ.discordBridgeDefaults),
    links,
    linkedAt: typeof integ.discordLinkedAt === 'string' ? integ.discordLinkedAt : null,
    linkedBy: typeof integ.discordLinkedBy === 'string' ? integ.discordLinkedBy : null,
    guildName: typeof integ.discordGuildName === 'string' ? integ.discordGuildName : null,
    guildIcon: typeof integ.discordGuildIcon === 'string' ? integ.discordGuildIcon : null,
  };
}

/** The storage keys for a set of links, in the plain shape older code reads. */
export function serializeLinks(links: readonly NormalizedBridgeLink[]): {
  discordChannelsMap: Record<string, string>;
  discordWebhooks: Record<string, string>;
  discordLinkOptions: Record<string, Partial<BridgeLinkOptions>>;
} {
  const discordChannelsMap: Record<string, string> = {};
  const discordWebhooks: Record<string, string> = {};
  const discordLinkOptions: Record<string, Partial<BridgeLinkOptions>> = {};
  for (const link of links) {
    discordChannelsMap[link.discordChannelId] = link.serikaChannelId;
    if (link.webhook) discordWebhooks[link.serikaChannelId] = link.webhook;
    const overrides = sanitizeLinkOptions(link.overrides);
    if (Object.keys(overrides).length > 0) discordLinkOptions[link.serikaChannelId] = overrides;
  }
  return { discordChannelsMap, discordWebhooks, discordLinkOptions };
}

/**
 * Put `discordChannelId <-> serikaChannelId` into `links`, keeping the 1:1
 * rule: any other link using either side is removed. A link that already
 * pairs the same two channels keeps its webhook and overrides.
 */
export function upsertLink(
  links: readonly NormalizedBridgeLink[],
  next: { discordChannelId: string; serikaChannelId: string; webhook?: string | null; overrides?: Partial<BridgeLinkOptions> },
): NormalizedBridgeLink[] {
  const serikaId = next.serikaChannelId.toLowerCase();
  const same = links.find((l) => l.discordChannelId === next.discordChannelId && l.serikaChannelId === serikaId);
  const rest = links.filter((l) => l.discordChannelId !== next.discordChannelId && l.serikaChannelId !== serikaId);
  rest.push({
    discordChannelId: next.discordChannelId,
    serikaChannelId: serikaId,
    webhook: next.webhook !== undefined ? next.webhook : same?.webhook ?? null,
    overrides: next.overrides ?? same?.overrides ?? {},
  });
  return rest;
}

/** Channel name key for auto-matching: case, spaces, dashes and underscores ignored. */
export function channelMatchKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s\-_]+/g, '');
}

/**
 * Pair unlinked Discord channels with unlinked SerikaCord channels of the same
 * name. Each side is used at most once; ambiguous names (two candidates on
 * either side) are skipped rather than guessed.
 */
export function autoMatchByName(
  discordChannels: ReadonlyArray<{ id: string; name: string }>,
  serikaChannels: ReadonlyArray<{ id: string; name: string }>,
  links: readonly NormalizedBridgeLink[],
): Array<{ discordChannelId: string; serikaChannelId: string }> {
  const linkedDiscord = new Set(links.map((l) => l.discordChannelId));
  const linkedSerika = new Set(links.map((l) => l.serikaChannelId.toLowerCase()));
  const group = <T extends { name: string }>(items: readonly T[]) => {
    const byKey = new Map<string, T[]>();
    for (const item of items) {
      const key = channelMatchKey(item.name);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
    return byKey;
  };
  const discordByKey = group(discordChannels.filter((c) => !linkedDiscord.has(c.id)));
  const serikaByKey = group(serikaChannels.filter((c) => !linkedSerika.has(c.id.toLowerCase())));
  const pairs: Array<{ discordChannelId: string; serikaChannelId: string }> = [];
  for (const [key, discord] of discordByKey) {
    const serika = serikaByKey.get(key);
    if (!serika || discord.length !== 1 || serika.length !== 1) continue;
    pairs.push({ discordChannelId: discord[0].id, serikaChannelId: serika[0].id.toLowerCase() });
  }
  return pairs;
}

/**
 * Of several SerikaCord servers storing the same guild with the bridge on
 * (links made before the one-server-per-guild rule), exactly one mirrors: the
 * earliest verified link, then the oldest server. Returns that server's id.
 */
export function pickGuildOwner(
  candidates: ReadonlyArray<{ id: string; linkedAt?: string | null; createdAt?: Date | string | null }>,
): string | null {
  if (candidates.length === 0) return null;
  const time = (v: Date | string | null | undefined) => {
    const t = v ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const sorted = [...candidates].sort((a, b) => {
    const la = time(a.linkedAt);
    const lb = time(b.linkedAt);
    if (la !== lb) return la - lb;
    const ca = time(a.createdAt);
    const cb = time(b.createdAt);
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0].id;
}

// Discord permission bits the bridge bot needs (https://discord.com/developers/docs/topics/permissions).
export const DISCORD_BRIDGE_PERMISSIONS = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_WEBHOOKS: 1n << 29n,
  /** Only used when "restrict members who haven't agreed" is on. */
  MODERATE_MEMBERS: 1n << 40n,
} as const;

export function bridgeInvitePermissions(): string {
  let bits = 0n;
  for (const bit of Object.values(DISCORD_BRIDGE_PERMISSIONS)) bits |= bit;
  return bits.toString();
}

export function bridgeInviteUrl(botId: string, guildId?: string | null): string {
  const params = new URLSearchParams({
    client_id: botId,
    permissions: bridgeInvitePermissions(),
    scope: 'bot applications.commands',
  });
  if (guildId && isSnowflake(guildId)) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params}`;
}

// ── Which integration keys general settings writers may touch ────────────────

/**
 * Bridge state (`discord`, `discordGuildId`, maps, link options, defaults,
 * linked-at/by, consent restriction, …) changes only through the bridge
 * routes (src/lib/api/discordBridge.ts) and the sync route, which check
 * Manage Server and Discord guild control. General settings writers must
 * neither accept nor rewrite these keys.
 */
export function isBridgeIntegrationKey(key: string): boolean {
  return key.startsWith('discord');
}

/** Integration keys clients may set through the general settings routes, with their type. */
export const CLIENT_INTEGRATION_KEYS: Readonly<Record<string, 'boolean' | 'string'>> = Object.freeze({
  twitch: 'boolean',
  youtube: 'boolean',
  webhooks: 'boolean',
  twitchChannel: 'string',
  twitchNotificationChannelId: 'string',
  youtubeChannel: 'string',
  youtubeNotificationChannelId: 'string',
});

/** Only the allowlisted, correctly typed integration keys from client input. */
export function pickClientIntegrations(input: unknown): Record<string, boolean | string> {
  const src = readRecord(input);
  const out: Record<string, boolean | string> = {};
  for (const [key, type] of Object.entries(CLIENT_INTEGRATION_KEYS)) {
    const value = src[key];
    if (type === 'boolean' && typeof value === 'boolean') out[key] = value;
    if (type === 'string' && typeof value === 'string') out[key] = value.slice(0, 1024);
  }
  return out;
}

/** The integrations object without any bridge key. */
export function withoutBridgeKeys(integrations: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(readRecord(integrations))) {
    if (!isBridgeIntegrationKey(key)) out[key] = value;
  }
  return out;
}
