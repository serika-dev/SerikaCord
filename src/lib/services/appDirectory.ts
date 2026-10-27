// App Directory data: the public bot library (/bots), Server Settings → App
// Discovery and the staff app tools. Rules live in src/lib/appDirectory/
// (listing.ts: who is visible; paging.ts: search, sort, cursors).
//
// The listed set is small, so it is loaded with ONE query (server counts via
// an index-backed correlated count on server_members.user_id) and cached per
// process for a minute; search, category filters, sorting and paging run in
// memory over that snapshot. Only public fields are ever selected here: never
// tokens, secrets, keys or owner emails.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { processShared } from '@/lib/realtime/processShared';
import { BoundedMap } from '@/lib/utils/boundedMap';
import {
  buildInstallUrl, isAppCategory, isDirectoryPageVisible, isPublicBot, LISTING_LIMITS, safeHttpUrlOrNull,
} from '@/lib/appDirectory/listing';
import { pageDirectory, type DirectoryEntry, type DirectoryQuery, type DirectoryPage } from '@/lib/appDirectory/paging';
import { serikaToDiscord } from '@/lib/botapi/permissionBits';

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] })?.rows ?? (Array.isArray(r) ? (r as Row[]) : []));

export interface PublicDirectoryApp extends DirectoryEntry {
  icon: string | null;
  coverImage: string | null;
  /** OAuth2 "Add to Server" link (no server preselected); null when the bot is private. */
  installUrl: string | null;
}

export interface PublicAppCommand {
  name: string;
  description: string;
  type: number;
}

export interface PublicDirectoryAppDetail extends PublicDirectoryApp {
  longDescription: string;
  website: string | null;
  supportUrl: string | null;
  termsOfServiceUrl: string | null;
  privacyPolicyUrl: string | null;
  /** Anyone can add it (bot_public). When false, installUrl is null. */
  installable: boolean;
  commands: PublicAppCommand[];
  createdAt: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const ms = (v: unknown): number => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
};
const iso = (v: unknown): string | null => (ms(v) ? new Date(ms(v)).toISOString() : null);

function toPublicApp(r: Row): PublicDirectoryApp {
  return {
    id: str(r.id),
    // Capped again here (defence in depth: older rows and other writers).
    name: str(r.name).slice(0, 64),
    shortDescription: str(r.description).slice(0, LISTING_LIMITS.shortDescription),
    categories: strArray(r.directory_categories).filter(isAppCategory).slice(0, LISTING_LIMITS.categories),
    tags: strArray(r.tags).filter((t) => t.length <= LISTING_LIMITS.tagLength).slice(0, LISTING_LIMITS.tags),
    verified: r.verified === true,
    featured: r.directory_featured === true,
    serverCount: Number(r.server_count) || 0,
    listedAtMs: ms(r.directory_listed_at) || ms(r.created_at),
    icon: safeHttpUrlOrNull(r.icon) ?? safeHttpUrlOrNull(r.bot_avatar),
    coverImage: safeHttpUrlOrNull(r.cover_image),
    installUrl: r.client_id
      ? buildInstallUrl(
          { clientId: str(r.client_id), installParams: r.install_params, apiIdFormat: r.api_id_format as string | null },
          { toDiscordBits: (bits) => serikaToDiscord(bits) },
        )
      : null,
  };
}

// Apps whose owner or bot user is suspended never show.
const NOT_SUSPENDED_SQL = sql`
  NOT EXISTS (SELECT 1 FROM users o WHERE o.id = a.owner_id AND o.is_banned = true)
  AND NOT EXISTS (SELECT 1 FROM users b WHERE b.id = a.bot_id AND b.is_banned = true)
`;

// Mirrors isDirectoryVisible() in src/lib/appDirectory/listing.ts (the bot is
// public here, so "never chose + verified" counts as listed), plus suspensions.
const VISIBLE_SQL = sql`
  a.bot_id IS NOT NULL
  AND COALESCE(a.bot_public, true) = true
  AND COALESCE(a.directory_listed, a.verified, false) = true
  AND COALESCE(a.directory_delisted, false) = false
  AND ${NOT_SUSPENDED_SQL}
`;

const SERVER_COUNT_SQL = sql`(SELECT count(*)::int FROM server_members sm WHERE sm.user_id = a.bot_id)`;

// ─── Listed apps snapshot ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const snapshot = processShared('appDirectory:snapshot', () => ({
  at: 0,
  data: null as PublicDirectoryApp[] | null,
  pending: null as Promise<PublicDirectoryApp[]> | null,
}));

async function loadListedApps(): Promise<PublicDirectoryApp[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.name, a.description, a.icon, a.cover_image, a.tags, a.verified,
           a.client_id, a.install_params, a.api_id_format,
           a.directory_categories, a.directory_featured, a.directory_listed_at, a.created_at,
           u.avatar AS bot_avatar,
           ${SERVER_COUNT_SQL} AS server_count
    FROM applications a
    LEFT JOIN users u ON u.id = a.bot_id
    WHERE ${VISIBLE_SQL}
    LIMIT 5000
  `));
  return rows.map(toPublicApp);
}

/** Every visible app, cached for a minute per process (shared by the Bun and Next module copies). */
export async function getListedApps(): Promise<PublicDirectoryApp[]> {
  if (snapshot.data && Date.now() - snapshot.at < CACHE_TTL_MS) return snapshot.data;
  if (!snapshot.pending) {
    snapshot.pending = loadListedApps()
      .then((data) => {
        snapshot.data = data;
        snapshot.at = Date.now();
        return data;
      })
      .finally(() => {
        snapshot.pending = null;
      });
  }
  try {
    return await snapshot.pending;
  } catch (err) {
    // Serve the last good snapshot through a database hiccup.
    if (snapshot.data) return snapshot.data;
    throw err;
  }
}

/** Drop this process's caches after an owner or staff change (other instances catch up within a minute). */
export function invalidateAppDirectory(): void {
  snapshot.at = 0;
  detailCache.clear();
}

export async function listDirectoryApps(query: DirectoryQuery): Promise<DirectoryPage<PublicDirectoryApp>> {
  return pageDirectory(await getListedApps(), query);
}

// ─── One app ─────────────────────────────────────────────────────────────────

async function publicCommands(appId: string): Promise<PublicAppCommand[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT name, description, type FROM app_commands
    WHERE application_id = ${appId}::uuid AND guild_id IS NULL
    ORDER BY type ASC, name ASC
    LIMIT 100
  `));
  return rows.map((r) => ({ name: str(r.name), description: str(r.description), type: Number(r.type) || 1 }));
}

/**
 * The public page of one app, or null when it isn't listed (or is delisted,
 * or its owner is suspended). A listed app that was made private still
 * resolves, with `installable: false`.
 */
export async function getDirectoryApp(appId: string): Promise<PublicDirectoryAppDetail | null> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.name, a.description, a.icon, a.cover_image, a.tags, a.verified, a.bot_id, a.bot_public,
           a.client_id, a.install_params, a.api_id_format,
           a.directory_listed, a.directory_delisted, a.directory_categories, a.directory_featured,
           a.directory_listed_at, a.directory_long_description, a.directory_website, a.directory_support_url,
           a.terms_of_service_url, a.privacy_policy_url, a.created_at,
           u.avatar AS bot_avatar,
           ${SERVER_COUNT_SQL} AS server_count
    FROM applications a
    LEFT JOIN users u ON u.id = a.bot_id
    WHERE a.id = ${appId}::uuid
      AND ${NOT_SUSPENDED_SQL}
    LIMIT 1
  `));
  const r = rows[0];
  if (!r) return null;
  const flags = {
    botId: r.bot_id as string | null,
    botPublic: r.bot_public as boolean | null,
    verified: r.verified as boolean | null,
    directoryListed: r.directory_listed as boolean | null,
    directoryDelisted: r.directory_delisted as boolean | null,
  };
  if (!isDirectoryPageVisible(flags)) return null;
  const installable = isPublicBot(flags);
  const commands = await publicCommands(str(r.id));
  const base = toPublicApp(r);
  return {
    ...base,
    longDescription: str(r.directory_long_description).slice(0, LISTING_LIMITS.longDescription),
    website: safeHttpUrlOrNull(r.directory_website),
    supportUrl: safeHttpUrlOrNull(r.directory_support_url),
    termsOfServiceUrl: safeHttpUrlOrNull(r.terms_of_service_url),
    privacyPolicyUrl: safeHttpUrlOrNull(r.privacy_policy_url),
    installable,
    installUrl: installable ? base.installUrl : null,
    commands,
    createdAt: iso(r.created_at),
  };
}

// One app's public page, cached per process for a minute, including "not
// found" (so unknown ids can't hammer the database through /bots/:id).
const DETAIL_TTL_MS = 60_000;
const detailCache = processShared('appDirectory:detail', () => new BoundedMap<string, { at: number; app: PublicDirectoryAppDetail | null }>(2_000));

export async function getDirectoryAppCached(appId: string): Promise<PublicDirectoryAppDetail | null> {
  const key = appId.toLowerCase();
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.app;
  const app = await getDirectoryApp(key);
  detailCache.set(key, { at: Date.now(), app });
  return app;
}

// ─── Server counts / installed apps ──────────────────────────────────────────

/** Servers a bot user is in (one indexed count). */
export async function countBotServers(botId: string | null | undefined): Promise<number> {
  if (!botId) return 0;
  const rows = rowsOf(await db.execute(sql`SELECT count(*)::int AS c FROM server_members WHERE user_id = ${botId}::uuid`));
  return Number(rows[0]?.c) || 0;
}

export interface InstalledApp {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  verified: boolean;
  /** Has a public /bots page. */
  listed: boolean;
}

/** Apps whose bot is a member of `serverId`. Callers check the viewer is a member first. */
export async function installedAppsForServer(serverId: string): Promise<InstalledApp[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.name, a.description, a.icon, a.verified, a.bot_id, a.bot_public,
           a.directory_listed, a.directory_delisted, u.avatar AS bot_avatar
    FROM server_members sm
    JOIN applications a ON a.bot_id = sm.user_id
    LEFT JOIN users u ON u.id = a.bot_id
    WHERE sm.server_id = ${serverId}::uuid
    ORDER BY lower(a.name) ASC
    LIMIT 200
  `));
  return rows.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    icon: safeHttpUrlOrNull(r.icon) ?? safeHttpUrlOrNull(r.bot_avatar),
    shortDescription: str(r.description),
    verified: r.verified === true,
    listed: isDirectoryPageVisible({
      botId: r.bot_id as string | null,
      botPublic: r.bot_public as boolean | null,
      verified: r.verified as boolean | null,
      directoryListed: r.directory_listed as boolean | null,
      directoryDelisted: r.directory_delisted as boolean | null,
    }),
  }));
}

// ─── Staff views ─────────────────────────────────────────────────────────────

export interface StaffAppRow {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  categories: string[];
  botId: string | null;
  botPublic: boolean;
  verified: boolean;
  verificationStatus: string;
  verificationRequestedAt: string | null;
  verificationReviewedAt: string | null;
  verificationNote: string | null;
  directoryListed: boolean | null;
  directoryFeatured: boolean;
  directoryDelisted: boolean;
  directoryDelistedReason: string | null;
  serverCount: number;
  createdAt: string | null;
  owner: { id: string; username: string | null; displayName: string | null; avatar: string | null; isBanned: boolean };
}

function toStaffRow(r: Row): StaffAppRow {
  return {
    id: str(r.id),
    name: str(r.name),
    icon: safeHttpUrlOrNull(r.icon) ?? safeHttpUrlOrNull(r.bot_avatar),
    shortDescription: str(r.description),
    categories: strArray(r.directory_categories).filter(isAppCategory),
    botId: (r.bot_id as string | null) ?? null,
    botPublic: r.bot_public !== false,
    verified: r.verified === true,
    verificationStatus: str(r.verification_status) || 'none',
    verificationRequestedAt: iso(r.verification_requested_at),
    verificationReviewedAt: iso(r.verification_reviewed_at),
    verificationNote: (r.verification_note as string | null) ?? null,
    directoryListed: (r.directory_listed as boolean | null) ?? null,
    directoryFeatured: r.directory_featured === true,
    directoryDelisted: r.directory_delisted === true,
    directoryDelistedReason: (r.directory_delisted_reason as string | null) ?? null,
    serverCount: Number(r.server_count) || 0,
    createdAt: iso(r.created_at),
    owner: {
      id: str(r.owner_id),
      username: (r.owner_username as string | null) ?? null,
      displayName: (r.owner_display_name as string | null) ?? null,
      avatar: safeHttpUrlOrNull(r.owner_avatar),
      isBanned: r.owner_is_banned === true,
    },
  };
}

const STAFF_SELECT = sql`
  SELECT a.id, a.name, a.description, a.icon, a.bot_id, a.bot_public, a.verified, a.verification_status,
         a.verification_requested_at, a.verification_reviewed_at, a.verification_note,
         a.directory_listed, a.directory_featured, a.directory_delisted, a.directory_delisted_reason,
         a.directory_categories, a.created_at, a.owner_id,
         u.avatar AS bot_avatar,
         o.username AS owner_username, o.display_name AS owner_display_name, o.avatar AS owner_avatar,
         o.is_banned AS owner_is_banned,
         ${SERVER_COUNT_SQL} AS server_count
  FROM applications a
  LEFT JOIN users u ON u.id = a.bot_id
  LEFT JOIN users o ON o.id = a.owner_id
`;

export type VerificationQueueStatus = 'pending' | 'approved' | 'rejected';

/** Verification applications in one state; pending ones oldest first (FIFO review). */
export async function listVerificationQueue(status: VerificationQueueStatus, limit = 100): Promise<StaffAppRow[]> {
  const order = status === 'pending'
    ? sql`ORDER BY COALESCE(a.verification_requested_at, a.updated_at, a.created_at) ASC`
    : sql`ORDER BY COALESCE(a.verification_reviewed_at, a.updated_at) DESC NULLS LAST`;
  const rows = rowsOf(await db.execute(sql`
    ${STAFF_SELECT}
    WHERE a.verification_status = ${status}
    ${order}
    LIMIT ${Math.min(200, Math.max(1, limit))}
  `));
  return rows.map(toStaffRow);
}

export type StaffDirectoryFilter = 'listed' | 'featured' | 'delisted' | 'verified' | 'all';

/** Staff directory moderation search over all applications (name, app id or client id). */
export async function searchAppsForStaff(opts: { search?: string | null; filter: StaffDirectoryFilter; page: number; limit: number }): Promise<{ apps: StaffAppRow[]; total: number }> {
  const conditions = [sql`TRUE`];
  const search = (opts.search ?? '').trim().slice(0, 100);
  if (search) {
    const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
    conditions.push(isUuid
      ? sql`(a.id = ${search}::uuid OR a.bot_id = ${search}::uuid OR a.owner_id = ${search}::uuid)`
      : sql`(a.name ILIKE ${`%${escaped}%`} OR a.client_id = ${search})`);
  }
  switch (opts.filter) {
    case 'listed':
      conditions.push(sql`a.bot_id IS NOT NULL AND COALESCE(a.bot_public, true) = true AND COALESCE(a.directory_listed, a.verified, false) = true AND COALESCE(a.directory_delisted, false) = false`);
      break;
    case 'featured': conditions.push(sql`a.directory_featured = true`); break;
    case 'delisted': conditions.push(sql`a.directory_delisted = true`); break;
    case 'verified': conditions.push(sql`a.verified = true`); break;
    default: break;
  }
  const where = sql.join(conditions, sql` AND `);
  const limit = Math.min(50, Math.max(1, opts.limit));
  const offset = Math.max(0, (Math.max(1, opts.page) - 1) * limit);
  const [rows, countRows] = await Promise.all([
    db.execute(sql`${STAFF_SELECT} WHERE ${where} ORDER BY a.directory_featured DESC NULLS LAST, lower(a.name) ASC, a.id ASC LIMIT ${limit} OFFSET ${offset}`),
    db.execute(sql`SELECT count(*)::int AS c FROM applications a WHERE ${where}`),
  ]);
  return { apps: rowsOf(rows).map(toStaffRow), total: Number(rowsOf(countRows)[0]?.c) || 0 };
}

export async function getAppForStaff(appId: string): Promise<StaffAppRow | null> {
  const rows = rowsOf(await db.execute(sql`${STAFF_SELECT} WHERE a.id = ${appId}::uuid LIMIT 1`));
  return rows[0] ? toStaffRow(rows[0]) : null;
}

export interface AppDirectoryOverview {
  pending: number;
  verified: number;
  listed: number;
  featured: number;
  delisted: number;
  publicBots: number;
  total: number;
}

export async function appDirectoryOverview(): Promise<AppDirectoryOverview> {
  const rows = rowsOf(await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE a.verification_status = 'pending')::int AS pending,
      count(*) FILTER (WHERE a.verified = true)::int AS verified,
      count(*) FILTER (WHERE a.bot_id IS NOT NULL AND COALESCE(a.bot_public, true) = true
                         AND COALESCE(a.directory_listed, a.verified, false) = true
                         AND COALESCE(a.directory_delisted, false) = false)::int AS listed,
      count(*) FILTER (WHERE a.directory_featured = true)::int AS featured,
      count(*) FILTER (WHERE a.directory_delisted = true)::int AS delisted,
      count(*) FILTER (WHERE a.bot_id IS NOT NULL AND COALESCE(a.bot_public, true) = true)::int AS public_bots,
      count(*)::int AS total
    FROM applications a
  `));
  const r = rows[0] ?? {};
  return {
    pending: Number(r.pending) || 0,
    verified: Number(r.verified) || 0,
    listed: Number(r.listed) || 0,
    featured: Number(r.featured) || 0,
    delisted: Number(r.delisted) || 0,
    publicBots: Number(r.public_bots) || 0,
    total: Number(r.total) || 0,
  };
}
