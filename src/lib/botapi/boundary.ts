/**
 * Snowflake boundary for the Discord-compatible bot API: the only place that
 * knows public ids differ from internal UUIDs. Route handlers, serializers and
 * gateway emitters keep working with UUIDs.
 *
 * REST (Elysia hooks, mounted once at the top of botApiRoutes):
 *  - parse: JSON bodies keep 64-bit integer ids exact (discord.py sends some
 *    ids as JSON numbers).
 *  - beforeHandle (first hook of the group, after the per-IP limiter):
 *    snowflakes in path params, id query params, body id fields and content
 *    tokens become UUIDs (UUIDs are accepted unchanged). Query and body are
 *    translated only for a valid bot token, at most MAX_INBOUND_IDS ids
 *    (50035 beyond); without a token only the (few) path params are, so
 *    token-less interaction routes still work. With a token, an unknown
 *    snowflake in a path param answers the matching "Unknown X" 404.
 *  - afterHandle: for applications with `api_id_format = 'snowflake'`, every
 *    UUID id in the JSON response becomes a snowflake. Applications without
 *    the setting (NULL, all apps created before it existed) see UUIDs, exactly
 *    as before.
 *  - Permission bitfields: snowflake-format apps also see Discord v10 bit
 *    numbering (./permissionBits.ts), in both directions (beforeHandle turns
 *    request bitfields back into Serika numbering). Legacy apps keep Serika's.
 *
 * Gateway: GatewayHub calls `resolveOutbound` once per dispatch and
 * `rewriteOutbound` per connection variant (src/lib/gateway/core.ts).
 */
import { Elysia, ParseError } from 'elysia';
import {
  emojiParamId, ID_QUERY_KEYS, isIdParam, isRoleParam, MAX_INBOUND_IDS, parseJsonBig, rewriteInbound, rewriteOutbound,
  scanInbound, scanOutbound, unknownIdError, type InboundContext, type OutboundLookup,
} from './idTranslate';
import { isPublicSnowflake as isSnowflake } from './snowflake';
import { invalidFormBody, type DiscordError } from './errors';
import { toCdnHashes } from './cdnCompat';
import { permissionsToDiscord, permissionsToSerika } from './permissionBits';
import { processShared } from '@/lib/realtime/processShared';
import {
  applicationByClientId, cachedSnowflakeOf, everyoneRoleOf, isCachedEveryoneRole, snowflakesForUuids, SF_KIND,
  uuidsForSnowflakes,
} from './snowflakeStore';

export type IdFormat = 'uuid' | 'snowflake';

/** The id format an application's bot sees. NULL / anything else = legacy UUIDs. */
export function idFormatOf(app: { apiIdFormat?: string | null } | null | undefined): IdFormat {
  return app?.apiIdFormat === 'snowflake' ? 'snowflake' : 'uuid';
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

/**
 * Resolve every UUID in `payload` (one batched lookup) into a reusable lookup.
 * With `timeoutMs`, a slow resolution falls back to the ids already cached
 * (the lookup keeps running and fills the cache for the next payload).
 */
export async function resolveOutbound(payload: unknown, opts?: { timeoutMs?: number }): Promise<OutboundLookup | null> {
  const scan = scanOutbound(payload);
  if (scan.uuids.size === 0) return null;
  const full = snowflakesForUuids(scan.uuids, scan.hints, scan.kinds)
    .then((res): OutboundLookup => ({ get: (u) => res.map.get(u), everyoneRoles: res.everyone }));
  if (!opts?.timeoutMs) return full;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<OutboundLookup>((resolve) => {
    timer = setTimeout(() => {
      const everyone = new Set([...scan.uuids].filter(isCachedEveryoneRole));
      resolve({ get: (u) => cachedSnowflakeOf(u), everyoneRoles: everyone });
    }, opts.timeoutMs);
  });
  full.catch(() => {});
  try {
    return await Promise.race([full, fallback]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `payload` as a snowflake-format app sees it: UUID ids replaced by
 * snowflakes, CDN URLs by Discord image hashes (./cdn.ts; served by
 * /cdn-compat) and permission bitfields in Discord numbering. Legacy
 * UUID-format apps never pass through here, so they keep full URLs and
 * Serika's bit numbers.
 */
export async function toSnowflakes<T>(payload: T): Promise<T> {
  const lookup = await resolveOutbound(payload);
  const out = toPublicView(lookup ? rewriteOutbound(payload, lookup) : payload);
  if (out && typeof out === 'object') publicViews.add(out);
  return out;
}

/**
 * Values already in the snowflake-format view (token routes translate their
 * own results via services/interactions outboundForApp). Id and CDN rewrites
 * are idempotent, but the permission permutation is not: the afterHandle hook
 * must not run it twice.
 */
const publicViews = processShared('botApiPublicViews', () => new WeakSet<object>());
/** Request bodies already in Serika numbering (same reason, inbound). */
const serikaBodies = processShared('botApiSerikaBodies', () => new WeakSet<object>());

/**
 * The id-independent part of the snowflake-format view (REST, gateway and
 * HTTP interactions all end here): CDN URL fields -> Discord image hashes and
 * Serika permission bits -> Discord v10 bits.
 */
export function toPublicView<T>(payload: T): T {
  let out = payload;
  try {
    out = toCdnHashes(out);
  } catch (err) {
    console.error('[bot-api] cdn hash rewrite failed:', (err as Error)?.message ?? err);
  }
  try {
    out = permissionsToDiscord(out);
  } catch (err) {
    console.error('[bot-api] permission bit rewrite failed:', (err as Error)?.message ?? err);
  }
  return out;
}

/** Kept for existing callers (the gateway): the full {@link toPublicView}, not only media. */
export const toPublicMedia = toPublicView;

/** A snowflake-format app's request body in Serika numbering (permission bitfields). */
export function fromPublicView<T>(body: T): T {
  if (!body || typeof body !== 'object' || serikaBodies.has(body)) return body;
  try {
    const out = permissionsToSerika(body);
    serikaBodies.add(out as object);
    return out;
  } catch (err) {
    console.error('[bot-api] inbound permission bit rewrite failed:', (err as Error)?.message ?? err);
    return body;
  }
}

export { rewriteOutbound };

// ─── Inbound ──────────────────────────────────────────────────────────────────

export interface InboundRequest {
  params?: Record<string, string | undefined> | null;
  query?: Record<string, unknown> | null;
  body?: unknown;
  /** Answer an unknown path snowflake with "Unknown X" (only for authenticated bots). Default true. */
  reportUnknown?: boolean;
}

export interface InboundResult {
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Unknown path snowflake (404) or too many ids (400 / 50035). */
  error?: { status: number; body: DiscordError };
}

const TOO_MANY_IDS = {
  status: 400,
  body: invalidFormBody([{ path: '_ids', code: 'BASE_TYPE_MAX_LENGTH', message: `Must reference ${MAX_INBOUND_IDS} or fewer ids.` }]),
};

function querySnowflakes(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    for (const s of p.split(',')) if (isSnowflake(s.trim())) out.push(s.trim());
  }
  return out;
}

function bodyForScan(body: unknown): unknown {
  if (!body || typeof body !== 'object' || body instanceof Blob) return body;
  const pj = (body as Record<string, unknown>).payload_json;
  if (typeof pj === 'string') {
    try { return { ...(body as object), payload_json: parseJsonBig(pj) }; } catch { return body; }
  }
  return body;
}

/** Translate snowflakes in a request's params, query and body into UUIDs. */
export async function translateInbound(req: InboundRequest): Promise<InboundResult> {
  const params = req.params ?? {};
  const query = req.query ?? {};
  const all = new Set<string>();
  const roleSfs = new Set<string>();

  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string') continue;
    if (isIdParam(k) && isSnowflake(v)) { all.add(v); if (isRoleParam(k)) roleSfs.add(v); }
    else if (k === 'emoji') { const e = emojiParamId(v); if (e) all.add(e.id); }
  }
  for (const k of ID_QUERY_KEYS) {
    for (const sf of querySnowflakes(query[k])) {
      all.add(sf);
      if (all.size > MAX_INBOUND_IDS) return { error: TOO_MANY_IDS };
    }
  }
  const scanBody = bodyForScan(req.body);
  const bodyScan = scanBody && typeof scanBody === 'object' ? scanInbound(scanBody, { snowflakes: new Set(), roleSnowflakes: new Set(), limit: MAX_INBOUND_IDS - all.size }) : null;
  if (bodyScan?.overflow) return { error: TOO_MANY_IDS };
  if (bodyScan) {
    for (const sf of bodyScan.snowflakes) all.add(sf);
    for (const sf of bodyScan.roleSnowflakes) roleSfs.add(sf);
  }
  if (all.size > MAX_INBOUND_IDS) return { error: TOO_MANY_IDS };
  if (all.size === 0) return {};

  const { map } = await uuidsForSnowflakes(all);

  // Application ids that were never exposed resolve through their client id.
  for (const k of ['appId', 'applicationId']) {
    const v = params[k];
    if (typeof v === 'string' && isSnowflake(v) && !map.has(v)) {
      const id = await applicationByClientId(v);
      if (id) map.set(v, { uuid: id, kind: SF_KIND.application });
    }
  }

  // The guild id in a role position means the @everyone role.
  const everyone = new Map<string, string>();
  for (const sf of roleSfs) {
    const hit = map.get(sf);
    if (hit?.kind === SF_KIND.guild) {
      const role = await everyoneRoleOf(hit.uuid);
      if (role) everyone.set(sf, role);
    }
  }
  const get = (sf: string, ctx: InboundContext) => (ctx === 'role' ? everyone.get(sf) : undefined) ?? map.get(sf)?.uuid;

  const out: InboundResult = {};
  // Params.
  let paramsChanged = false;
  const newParams: Record<string, string | undefined> = { ...params };
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string') continue;
    if (isIdParam(k) && isSnowflake(v)) {
      const uuid = get(v, isRoleParam(k) ? 'role' : 'any');
      if (!uuid) { if (req.reportUnknown !== false) out.error ??= unknownIdError(k); continue; }
      newParams[k] = uuid; paramsChanged = true;
    } else if (k === 'emoji') {
      const e = emojiParamId(v);
      const uuid = e ? get(e.id, 'any') : undefined;
      if (e && uuid) { newParams[k] = `${e.prefix}${uuid}${e.suffix}`; paramsChanged = true; }
    }
  }
  if (paramsChanged) out.params = newParams;

  // Query.
  let queryChanged = false;
  const newQuery: Record<string, unknown> = { ...query };
  for (const k of ID_QUERY_KEYS) {
    const v = query[k];
    if (v === undefined) continue;
    const mapOne = (s: string) => s.split(',').map((p) => {
      const t = p.trim();
      return isSnowflake(t) ? (get(t, k === 'role_ids' ? 'role' : 'any') ?? t) : t;
    }).join(',');
    if (typeof v === 'string') { const nv = mapOne(v); if (nv !== v) { newQuery[k] = nv; queryChanged = true; } }
    else if (Array.isArray(v)) { newQuery[k] = v.map((x) => (typeof x === 'string' ? mapOne(x) : x)); queryChanged = true; }
  }
  if (queryChanged) out.query = newQuery;

  // Body.
  if (bodyScan && bodyScan.snowflakes.size > 0) {
    const rewritten = rewriteInbound(scanBody, { get }) as Record<string, unknown>;
    const original = req.body as Record<string, unknown>;
    if (typeof original?.payload_json === 'string' && rewritten && typeof rewritten.payload_json === 'object') {
      out.body = { ...original, payload_json: JSON.stringify(rewritten.payload_json) };
    } else {
      out.body = rewritten;
    }
  }
  return out;
}

// ─── Elysia plugin ────────────────────────────────────────────────────────────

const formatMemo = new WeakMap<Request, Promise<IdFormat>>();

/** A syntactically valid bot token from `Authorization: Bot <token>` (or a bare token), else null. */
export function botTokenOf(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const t = authorization.startsWith('Bot ') ? authorization.slice(4).trim() : authorization.trim();
  return /^[A-Za-z0-9._-]{20,512}$/.test(t) ? t : null;
}

const appMemo = new WeakMap<Request, Promise<IApplicationLike | null>>();
type IApplicationLike = { apiIdFormat?: string | null };

/** The application a request acts as (bot token or OAuth2 Bearer), memoized per request. */
function botAppOf(request: Request): Promise<IApplicationLike | null> {
  const memo = appMemo.get(request);
  if (memo) return memo;
  const p = resolveRequestApp(request).catch(() => null);
  appMemo.set(request, p);
  return p;
}

async function resolveRequestApp(request: Request): Promise<IApplicationLike | null> {
  const authorization = request.headers.get('authorization');
  // OAuth2 Bearer: the app the token was granted to (its id format applies).
  if (authorization && /^Bearer\s/i.test(authorization)) {
    const { parseBearer } = await import('@/lib/oauth/scopes');
    const bearer = parseBearer(authorization);
    if (!bearer) return null;
    const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
    const grant = await resolveBearerToken(bearer).catch(() => null);
    if (!grant) return null;
    const { Application } = await import('@/lib/models');
    return Application.findById(grant.applicationId).catch(() => null);
  }
  const token = botTokenOf(authorization);
  if (!token) return null;
  const { resolveBotToken } = await import('@/lib/services/botTokens');
  return resolveBotToken(token).catch(() => null);
}

/** The id format of the application a bot API request acts as. */
function requestFormat(request: Request, params: Record<string, string | undefined> | undefined): Promise<IdFormat> {
  const memo = formatMemo.get(request);
  if (memo) return memo;
  const p = (async (): Promise<IdFormat> => {
    const app = await botAppOf(request);
    if (app) return idFormatOf(app);
    // Token-less routes (interaction callbacks / follow-ups) act for the app in the path.
    const appId = params?.applicationId ?? params?.appId;
    if (appId && /^[0-9a-f-]{36}$/i.test(appId)) {
      const { Application } = await import('@/lib/models');
      const app = await Application.findById(appId).catch(() => null);
      return idFormatOf(app);
    }
    return 'uuid';
  })();
  formatMemo.set(request, p);
  return p;
}

/**
 * Hooks for the bot API group. `.use()` it before any route of the group:
 * the hooks are `scoped`, so they apply to the routes of the instance that
 * uses this plugin.
 */
export const botIdBoundary = new Elysia({ name: 'botIdBoundary' })
  .onParse({ as: 'scoped' }, async ({ request, contentType }) => {
    if (!contentType || !contentType.toLowerCase().startsWith('application/json')) return;
    const text = await request.text();
    if (!text.trim()) return {};
    try {
      return parseJsonBig(text);
    } catch (err) {
      throw new ParseError(err as Error);
    }
  })
  // Runs after the global per-IP limiter (index.ts) and before the group's
  // per-bot limiter and access guard, which then see UUIDs.
  .onBeforeHandle({ as: 'scoped' }, async (ctx) => {
    const c = ctx as unknown as {
      request: Request;
      set: { status?: number | string };
      params?: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    try {
      const authed = !!(await botAppOf(c.request));
      const res = await translateInbound({
        params: c.params,
        // Unauthenticated callers get no lookups beyond the path's own ids.
        query: authed ? c.query : undefined,
        body: authed ? c.body : undefined,
        reportUnknown: authed,
      });
      if (res.error && (authed || res.error.status === 400)) { c.set.status = res.error.status; return res.error.body; }
      if (res.params && c.params) Object.assign(c.params, res.params);
      if (res.query && c.query) Object.assign(c.query, res.query);
      if (res.body !== undefined) c.body = res.body;
    } catch (err) {
      console.error('[bot-api] inbound id translation failed:', (err as Error)?.message ?? err);
    }
    // Discord-numbered permission bitfields (roles, overwrites, commands,
    // install params) -> Serika numbering, for snowflake-format apps only.
    try {
      if (c.body && typeof c.body === 'object' && idFormatOf(await botAppOf(c.request)) === 'snowflake') {
        c.body = fromPublicView(c.body);
      }
    } catch (err) {
      console.error('[bot-api] inbound permission translation failed:', (err as Error)?.message ?? err);
    }
  })
  .onAfterHandle({ as: 'scoped' }, async (ctx) => {
    const c = ctx as unknown as { request: Request; params?: Record<string, string | undefined>; responseValue?: unknown; response?: unknown };
    const value = 'responseValue' in c ? c.responseValue : c.response;
    if (!value || typeof value !== 'object' || value instanceof Response || value instanceof Blob) return;
    if (publicViews.has(value)) return;
    try {
      if ((await requestFormat(c.request, c.params)) !== 'snowflake') return;
      return await toSnowflakes(value);
    } catch (err) {
      console.error('[bot-api] outbound id translation failed:', (err as Error)?.message ?? err);
    }
  });
