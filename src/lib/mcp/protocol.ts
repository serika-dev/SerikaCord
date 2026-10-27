/**
 * MCP protocol versions for the SerikaCord docs MCP server (src/lib/api/mcp.ts).
 *
 * The server is "dual-era" (spec 2026-07-28, basic/versioning):
 *  - Modern requests (2026-07-28) carry their version, client info and client
 *    capabilities in `params._meta`; each request is served on its own, with
 *    the Streamable HTTP header checks (MCP-Protocol-Version, Mcp-Method,
 *    Mcp-Name) and the modern error codes (-32020 HeaderMismatch, -32022
 *    UnsupportedProtocolVersion).
 *  - Legacy clients (2025-11-25 and earlier) open with `initialize`; the
 *    server negotiates a version there and, being stateless, reads it back
 *    from the MCP-Protocol-Version header on later requests (2025-06-18+), or
 *    treats a request without one as 2025-03-26 (as the spec allows).
 *  - `?v=<version>` on the endpoint pins it to that one version.
 *
 * Everything here is pure; tested in tests/mcp-protocol.test.ts.
 */

export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** Newest first. The first entry is the default. */
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];
export const LATEST_LEGACY_VERSION = LEGACY_VERSIONS[0];
/** What a legacy request without MCP-Protocol-Version is treated as (spec 2026-07-28, Streamable HTTP). */
export const HEADERLESS_LEGACY_VERSION = '2025-03-26';

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** Legacy (2025-11-25 and earlier) "resource not found". */
  legacyResourceNotFound: -32002,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

export const isSupported = (v: unknown): v is string => typeof v === 'string' && SUPPORTED_VERSIONS.includes(v);
export const isModern = (v: string) => (MODERN_VERSIONS as readonly string[]).includes(v);
export const isLegacy = (v: string) => (LEGACY_VERSIONS as readonly string[]).includes(v);

/** Version order helper: true when `v` is the same as or newer than `than`. */
export const atLeast = (v: string, than: string) => v >= than;

/** Versions whose JSON-RPC allows batches (arrays of messages). */
export const allowsBatch = (v: string) => v === '2024-11-05' || v === '2025-03-26';

export interface McpError {
  status: number;
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export const unsupportedVersion = (requested: unknown, supported: readonly string[]): McpError => ({
  status: 400,
  code: ERR.unsupportedVersion,
  message: 'Unsupported protocol version',
  data: { supported: [...supported], requested: typeof requested === 'string' ? requested : null },
});

/** `?v=` on the endpoint: a pinned version, nothing, or an error. */
export function readPin(v: unknown): { pin: string | null } | { error: McpError } {
  if (v === undefined || v === null || v === '') return { pin: null };
  if (isSupported(v)) return { pin: v };
  return { error: unsupportedVersion(v, SUPPORTED_VERSIONS) };
}

/** Decode the `=?base64?...?=` sentinel used by Mcp-Name / Mcp-Param-* headers. */
export function decodeHeaderValue(raw: string): string | null {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(raw);
  if (!m) return raw;
  try {
    return Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Methods whose request carries `Mcp-Name` (params.name or params.uri). */
const NAMED: Record<string, 'name' | 'uri'> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };

export type Headers = Record<string, string | undefined>;

type Obj = Record<string, unknown>;
/** A JSON-RPC message as far as version selection cares. */
export interface RpcMessage {
  method?: unknown;
  params?: Obj & { _meta?: Obj };
}
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

export interface Era {
  era: 'modern' | 'legacy';
  version: string;
}

/**
 * Which era and version a single (non-batch) JSON-RPC message is served in,
 * or the error to answer with. `headers` keys are lower-case.
 */
export function selectVersion(msg: RpcMessage, headers: Headers, pin: string | null): Era | { error: McpError } {
  const meta = msg?.params?._meta;
  const metaVersion = meta && typeof meta === 'object' ? meta[META_VERSION] : undefined;
  const headerVersion = headers['mcp-protocol-version'];

  if (msg?.method === 'initialize') {
    // Legacy handshake. A modern-only pin can't speak it: name what we do speak.
    if (pin && isModern(pin)) return { error: unsupportedVersion(msg?.params?.protocolVersion, [pin]) };
    const requested = msg?.params?.protocolVersion;
    const version = pin ?? (typeof requested === 'string' && isLegacy(requested) ? requested : LATEST_LEGACY_VERSION);
    return { era: 'legacy', version };
  }

  if (metaVersion !== undefined) {
    const supported = pin ? [pin] : SUPPORTED_VERSIONS;
    if (typeof metaVersion !== 'string' || !isModern(metaVersion) || (pin && pin !== metaVersion)) {
      return { error: unsupportedVersion(metaVersion, supported) };
    }
    return { era: 'modern', version: metaVersion };
  }

  // Legacy request after the handshake (or a client that skipped it).
  if (headerVersion !== undefined) {
    if (!isLegacy(headerVersion) || (pin && pin !== headerVersion)) {
      return { error: unsupportedVersion(headerVersion, pin ? [pin] : SUPPORTED_VERSIONS) };
    }
    return { era: 'legacy', version: headerVersion };
  }
  if (pin && isModern(pin)) {
    return {
      error: {
        status: 400,
        code: ERR.invalidParams,
        message: `This endpoint is pinned to protocol version ${pin}: send io.modelcontextprotocol/protocolVersion in params._meta.`,
      },
    };
  }
  return { era: 'legacy', version: pin ?? HEADERLESS_LEGACY_VERSION };
}

/**
 * Modern (2026-07-28) request checks: the MCP-Protocol-Version, Mcp-Method and
 * Mcp-Name headers must be present and match the body, and the required
 * per-request `_meta` fields must be there. Null when the request is valid.
 */
export function validateModernRequest(msg: RpcMessage, headers: Headers): McpError | null {
  const method = typeof msg?.method === 'string' ? msg.method : '';
  const meta = asObj(msg?.params?._meta);
  const mismatch = (message: string): McpError => ({ status: 400, code: ERR.headerMismatch, message });

  const headerVersion = headers['mcp-protocol-version'];
  if (headerVersion === undefined) return mismatch('Header mismatch: MCP-Protocol-Version header is required');
  if (headerVersion !== meta[META_VERSION]) {
    return mismatch(`Header mismatch: MCP-Protocol-Version header value '${headerVersion}' does not match body value '${meta[META_VERSION]}'`);
  }
  const headerMethod = headers['mcp-method'];
  if (headerMethod === undefined) return mismatch('Header mismatch: Mcp-Method header is required');
  if (headerMethod !== method) return mismatch(`Header mismatch: Mcp-Method header value '${headerMethod}' does not match body value '${method}'`);

  const field = NAMED[method];
  if (field) {
    const raw = headers['mcp-name'];
    const body = msg?.params?.[field];
    if (raw === undefined) return mismatch('Header mismatch: Mcp-Name header is required');
    const decoded = decodeHeaderValue(raw);
    if (decoded === null) return mismatch('Header mismatch: Mcp-Name header value is not valid base64');
    if (decoded !== body) return mismatch(`Header mismatch: Mcp-Name header value '${decoded}' does not match body value '${String(body)}'`);
  }

  const caps = meta[META_CLIENT_CAPABILITIES];
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return { status: 400, code: ERR.invalidParams, message: `Invalid params: _meta['${META_CLIENT_CAPABILITIES}'] is required` };
  }
  return null;
}

export interface ServerIdentity {
  name: string;
  version: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
}

/** The server's Implementation object as each version knows it. */
export function serverInfoFor(version: string, id: ServerIdentity): Record<string, unknown> {
  const out: Record<string, unknown> = { name: id.name, version: id.version };
  if (atLeast(version, '2025-06-18') && id.title) out.title = id.title;
  if (atLeast(version, '2025-11-25')) {
    if (id.description) out.description = id.description;
    if (id.websiteUrl) out.websiteUrl = id.websiteUrl;
    if (id.icons?.length) out.icons = id.icons;
  }
  return out;
}

/** Capabilities: this server sends no change notifications, so nothing is listChanged. */
export function capabilitiesFor(version: string): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  };
  // logging/setLevel exists in the legacy versions; 2026-07-28 moved the level into _meta.
  if (isLegacy(version)) caps.logging = {};
  if (atLeast(version, '2025-03-26')) caps.completions = {};
  return caps;
}

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Shape a version-neutral result for `version`: tool annotations (2025-03-26+),
 * human titles (2025-06-18+), and for modern requests `resultType` and the
 * server identity in `_meta`.
 */
export function shapeResult(method: string, result: unknown, version: string, id: ServerIdentity): unknown {
  if (!result || typeof result !== 'object') return result;
  const res = result as Obj;
  let out: Obj = res;
  const list = (key: string) => (Array.isArray(res[key]) ? (res[key] as unknown[]).map(asObj) : null);
  const tools = method === 'tools/list' ? list('tools') : null;
  const prompts = method === 'prompts/list' ? list('prompts') : null;
  const resources = method === 'resources/list' ? list('resources') : null;
  if (tools) {
    out = {
      ...res,
      tools: tools.map((t) => ({
        ...t,
        ...(atLeast(version, '2025-06-18') ? { title: t.title ?? titleCase(String(t.name)) } : {}),
        ...(atLeast(version, '2025-03-26')
          ? { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.name === 'validate_bot_token', ...asObj(t.annotations) } }
          : {}),
      })),
    };
  } else if (prompts && atLeast(version, '2025-06-18')) {
    out = { ...res, prompts: prompts.map((p) => ({ ...p, title: p.title ?? titleCase(String(p.name)) })) };
  } else if (resources && atLeast(version, '2025-06-18')) {
    out = { ...res, resources: resources.map((r) => ({ ...r, title: r.title ?? r.name })) };
  }
  if (isModern(version)) {
    out = { resultType: 'complete', ...out, _meta: { ...asObj(out._meta), [META_SERVER_INFO]: serverInfoFor(version, id) } };
  }
  return out;
}

/** Version-specific error codes for a core error (e.g. legacy "resource not found" is -32002). */
export function shapeErrorCode(method: string, code: number, message: string, version: string): number {
  if (method === 'resources/read' && code === ERR.invalidParams && message.startsWith('Resource not found') && isLegacy(version)) {
    return ERR.legacyResourceNotFound;
  }
  return code;
}
