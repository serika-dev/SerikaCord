/**
 * Snowflake boundary for the Discord-compatible bot API: the only place that
 * knows public ids differ from internal UUIDs. Route handlers, serializers and
 * gateway emitters keep working with UUIDs.
 *
 * REST (Elysia hooks, mounted once at the top of botApiRoutes):
 *  - parse: JSON bodies keep 64-bit integer ids exact (discord.py sends some
 *    ids as JSON numbers).
 *  - transform: snowflakes in path params, id query params, body id fields and
 *    content tokens become UUIDs (UUIDs are accepted unchanged). An unknown
 *    snowflake in a path param answers the matching "Unknown X" 404.
 *  - afterHandle: for applications with `api_id_format = 'snowflake'`, every
 *    UUID id in the JSON response becomes a snowflake. Applications without
 *    the setting (NULL, all apps created before it existed) see UUIDs, exactly
 *    as before.
 *
 * Gateway: GatewayHub calls `resolveOutbound` once per dispatch and
 * `rewriteOutbound` per connection variant (src/lib/gateway/core.ts).
 */
import { Elysia, ParseError } from 'elysia';
import {
  emojiParamId, ID_QUERY_KEYS, isIdParam, isRoleParam, parseJsonBig, rewriteInbound, rewriteOutbound,
  scanInbound, scanOutbound, unknownIdError, type InboundContext, type OutboundLookup,
} from './idTranslate';
import { isSnowflake } from './snowflake';
import {
  applicationByClientId, everyoneRoleOf, snowflakesForUuids, SF_KIND, uuidsForSnowflakes,
} from './snowflakeStore';

export type IdFormat = 'uuid' | 'snowflake';

/** The id format an application's bot sees. NULL / anything else = legacy UUIDs. */
export function idFormatOf(app: { apiIdFormat?: string | null } | null | undefined): IdFormat {
  return app?.apiIdFormat === 'snowflake' ? 'snowflake' : 'uuid';
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

/** Resolve every UUID in `payload` (one batched lookup) into a reusable lookup. */
export async function resolveOutbound(payload: unknown): Promise<OutboundLookup | null> {
  const scan = scanOutbound(payload);
  if (scan.uuids.size === 0) return null;
  const res = await snowflakesForUuids(scan.uuids, scan.hints);
  return { get: (u) => res.map.get(u), everyoneRoles: res.everyone };
}

/** `payload` with its UUID ids replaced by snowflakes. */
export async function toSnowflakes<T>(payload: T): Promise<T> {
  const lookup = await resolveOutbound(payload);
  return lookup ? rewriteOutbound(payload, lookup) : payload;
}

export { rewriteOutbound };

// ─── Inbound ──────────────────────────────────────────────────────────────────

export interface InboundRequest {
  params?: Record<string, string | undefined> | null;
  query?: Record<string, unknown> | null;
  body?: unknown;
}

export interface InboundResult {
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Set when a path param names an unknown snowflake. */
  error?: { status: number; body: { code: number; message: string } };
}

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
  for (const k of ID_QUERY_KEYS) for (const sf of querySnowflakes(query[k])) all.add(sf);
  const scanBody = bodyForScan(req.body);
  const bodyScan = scanBody && typeof scanBody === 'object' ? scanInbound(scanBody) : null;
  if (bodyScan) {
    for (const sf of bodyScan.snowflakes) all.add(sf);
    for (const sf of bodyScan.roleSnowflakes) roleSfs.add(sf);
  }
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
      if (!uuid) { out.error ??= unknownIdError(k); continue; }
      newParams[k] = uuid; paramsChanged = true;
    } else if (k === 'emoji') {
      const e = emojiParamId(v);
      const uuid = e ? get(e.id, 'any') : undefined;
      if (e && uuid) { newParams[k] = `${e.name}:${uuid}`; paramsChanged = true; }
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

const inboundErrors = new WeakMap<Request, { status: number; body: { code: number; message: string } }>();
const formatMemo = new WeakMap<Request, Promise<IdFormat>>();

function botTokenOf(authorization: string | null): string | null {
  if (!authorization) return null;
  const t = authorization.startsWith('Bot ') ? authorization.slice(4).trim() : authorization.trim();
  return t && !/\s/.test(t) && !/^Bearer$/i.test(t) ? t : null;
}

/** The id format of the application a bot API request acts as. */
function requestFormat(request: Request, params: Record<string, string | undefined> | undefined): Promise<IdFormat> {
  const memo = formatMemo.get(request);
  if (memo) return memo;
  const p = (async (): Promise<IdFormat> => {
    const token = botTokenOf(request.headers.get('authorization'));
    if (token) {
      const { resolveBotToken } = await import('@/lib/services/botTokens');
      const app = await resolveBotToken(token).catch(() => null);
      if (app) return idFormatOf(app);
    }
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
  .onTransform({ as: 'scoped' }, async (ctx) => {
    const c = ctx as unknown as {
      request: Request;
      params?: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    try {
      const res = await translateInbound({ params: c.params, query: c.query, body: c.body });
      if (res.params && c.params) Object.assign(c.params, res.params);
      if (res.query && c.query) Object.assign(c.query, res.query);
      if (res.body !== undefined) c.body = res.body;
      if (res.error) inboundErrors.set(c.request, res.error);
    } catch (err) {
      console.error('[bot-api] inbound id translation failed:', (err as Error)?.message ?? err);
    }
  })
  .onBeforeHandle({ as: 'scoped' }, ({ request, set }) => {
    const err = inboundErrors.get(request);
    if (err) { set.status = err.status; return err.body; }
  })
  .onAfterHandle({ as: 'scoped' }, async (ctx) => {
    const c = ctx as unknown as { request: Request; params?: Record<string, string | undefined>; responseValue?: unknown; response?: unknown };
    const value = 'responseValue' in c ? c.responseValue : c.response;
    if (!value || typeof value !== 'object' || value instanceof Response || value instanceof Blob) return;
    try {
      if ((await requestFormat(c.request, c.params)) !== 'snowflake') return;
      return await toSnowflakes(value);
    } catch (err) {
      console.error('[bot-api] outbound id translation failed:', (err as Error)?.message ?? err);
    }
  });
