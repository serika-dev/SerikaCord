#!/usr/bin/env bun
/**
 * Discord API v10 parity checker.
 *
 * Compares SerikaCord's bot surface (REST routes mounted under /api/v10 or
 * /api/v9, the gateway hub, the gateway event emitters and the Discord-shaped
 * serializers) against Discord's official OpenAPI spec and API docs, then
 * writes:
 *
 *   docs/architecture/discord-parity.json   machine data (stable, no timestamps)
 *   docs/architecture/discord-parity.md     the block between the
 *                                           `parity:generated` markers only;
 *                                           the hand-written plan around it is
 *                                           left untouched.
 *
 * Usage:
 *   bun scripts/discord-parity.ts              offline, uses scripts/discord-spec/discord-api.json
 *   bun scripts/discord-parity.ts --refresh    re-download the spec + docs from GitHub and rebuild that cache
 *   bun scripts/discord-parity.ts --stdout     print the summary, write nothing
 *   bun scripts/discord-parity.ts --check      exit 1 if any coverage number dropped below the committed JSON
 *   PARITY_DUMP=/tmp/x.json bun scripts/discord-parity.ts --stdout   also dump the full JSON somewhere else
 *
 * Nothing here touches a database, Redis or the network (except --refresh,
 * which only GETs public files from raw.githubusercontent.com / api.github.com).
 *
 * How SerikaCord is read (static analysis, no imports):
 *   - REST: every `new Elysia({ prefix })` under src/lib/api/** (recursive),
 *     its chained `.get/.post/.put/.patch/.delete('/path'` calls and its
 *     `.use(child)` mounts, resolved from the root `api` (prefix /api).
 *     Splitting botApi.ts into several files keeps working as long as the
 *     groups are mounted with `.use(name)`.
 *   - Params: `query.x` / `body.x` / destructuring of `body` (or `x.payload`) inside a route's
 *     handler text, compared with the spec's query params / JSON body fields.
 *   - Gateway: event-name string literals in server code (the Discord bridge
 *     in src/lib/discord/ and the docs are excluded), emitter functions in
 *     gatewayEvents.ts and whether anything calls them, `case OP.X` handlers,
 *     close codes and the READY / IDENTIFY / GUILD_CREATE object literals.
 *   - Objects: top-level keys of the serializer functions listed in
 *     OBJECT_CHECKS (found by function name anywhere under src/lib).
 *   - Features: regex probes in FEATURES. When you implement one, keep the
 *     probe in sync (or adjust it) so the report flips to "yes".
 *   - KNOWN_GAPS: hand-maintained notes for routes that exist but are
 *     known to be incomplete. Delete an entry when it is fixed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dir, '..');
const CACHE = join(ROOT, 'scripts/discord-spec/discord-api.json');
const OUT_JSON = join(ROOT, 'docs/architecture/discord-parity.json');
const OUT_MD = join(ROOT, 'docs/architecture/discord-parity.md');
const MARK_START = '<!-- parity:generated:start (bun scripts/discord-parity.ts rewrites this block) -->';
const MARK_END = '<!-- parity:generated:end -->';

const SPEC_REPO = 'discord/discord-api-spec';
const DOCS_REPO = 'discord/discord-api-docs';
const RAW = 'https://raw.githubusercontent.com';

const args = new Set(process.argv.slice(2));

// ─── Types ──────────────────────────────────────────────────

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface SpecOp {
  method: Method;
  path: string;
  operationId: string;
  source: 'openapi' | 'docs';
  /** 'bot' = callable with a Bot token, 'oauth2' = bearer-only, 'public' = no auth needed. */
  auth: Array<'bot' | 'oauth2' | 'public'>;
  oauth2Scopes: string[];
  deprecated: boolean;
  query: string[];
  body: string[];
  multipart: boolean;
  response: string | null;
}

interface GatewayCache {
  opcodes: Array<{ code: number; name: string; action: string }>;
  closeCodes: Array<{ code: number; description: string }>;
  sendEvents: string[];
  receiveEvents: string[];
  intents: Array<{ name: string; bit: number; privileged: boolean; events: string[] }>;
  structures: Record<string, string[]>;
}

interface Cache {
  meta: { spec: { repo: string; sha: string; date: string }; docs: { repo: string; sha: string; date: string } };
  rest: SpecOp[];
  objects: Record<string, string[]>;
  gateway: GatewayCache;
}

// ─── Refresh: build the compact cache from upstream ─────────

const OBJECT_SCHEMAS = [
  'UserResponse', 'UserPIIResponse', 'MessageResponse', 'GuildResponse', 'GuildWithCountsResponse',
  'GuildChannelResponse', 'PrivateChannelResponse', 'ThreadResponse', 'GuildRoleResponse',
  'GuildMemberResponse', 'GuildInviteResponse', 'EmojiResponse', 'GuildIncomingWebhookResponse',
  'PrivateApplicationResponse', 'ApplicationCommandResponse', 'GatewayBotResponse',
  'GuildStickerResponse', 'MessageAttachmentResponse', 'MessageReactionResponse',
];
const DOC_ROUTE_FILES = [
  'resources/application', 'resources/application-role-connection-metadata', 'resources/audit-log',
  'resources/auto-moderation', 'resources/channel', 'resources/emoji', 'resources/entitlement',
  'resources/guild-scheduled-event', 'resources/guild-template', 'resources/guild', 'resources/invite',
  'resources/lobby', 'resources/message', 'resources/poll', 'resources/sku', 'resources/soundboard',
  'resources/stage-instance', 'resources/sticker', 'resources/subscription', 'resources/user',
  'resources/voice', 'resources/webhook', 'interactions/application-commands',
  'interactions/receiving-and-responding',
];
/** OAuth2 endpoints the docs describe in prose rather than <Route> tags. */
const OAUTH2_EXTRAS: Array<Pick<SpecOp, 'method' | 'path' | 'operationId'>> = [
  { method: 'GET', path: '/oauth2/authorize', operationId: 'oauth2_authorize' },
  { method: 'POST', path: '/oauth2/token', operationId: 'oauth2_token' },
  { method: 'POST', path: '/oauth2/token/revoke', operationId: 'oauth2_token_revoke' },
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'serikacord-discord-parity' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

/** Pin the upstream commit. Uses the GitHub API (GITHUB_TOKEN optional), falling back to `git ls-remote` when rate-limited. */
async function latestCommit(repo: string): Promise<{ sha: string; date: string }> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'serikacord-discord-parity' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { sha: string; commit?: { committer?: { date?: string } } };
    return { sha: j.sha, date: j.commit?.committer?.date ?? '' };
  } catch {
    const { execFileSync } = await import('child_process');
    const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, 'refs/heads/main'], { encoding: 'utf8' });
    const sha = out.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Could not resolve ${repo}@main`);
    return { sha, date: '' };
  }
}

/** Parse markdown tables that follow a `###### Title` heading. */
function mdTables(md: string): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{3,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (!h) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('|') && !/^#{1,6}\s/.test(lines[j]) && j - i < 12) j++;
    if (j >= lines.length || !lines[j].startsWith('|')) continue;
    const rows: string[][] = [];
    for (let k = j + 2; k < lines.length && lines[k].startsWith('|'); k++) {
      rows.push(lines[k].split('|').slice(1, -1).map((c) => c.trim()));
    }
    if (!out[h[1]]) out[h[1]] = rows;
  }
  return out;
}

function fieldName(cell: string): string {
  return cell.replace(/\\/g, '').replace(/[?*]/g, '').replace(/`/g, '').trim();
}

function anchorToEvent(cell: string): string {
  const m = /#([a-z0-9-]+)\)/.exec(cell);
  return (m ? m[1] : cell.replace(/\[|\]|\(.*\)/g, '')).toUpperCase().replace(/[-\s]+/g, '_');
}

function buildGatewayCache(gatewayEvents: string, gateway: string, opcodes: string): GatewayCache {
  const ev = mdTables(gatewayEvents);
  const op = mdTables(opcodes);
  const structures: Record<string, string[]> = {};
  for (const [title, rows] of Object.entries(ev)) {
    if (/(Fields|Structure)$/.test(title) && rows.length && rows[0].length >= 2) {
      structures[title] = rows.map((r) => fieldName(r[0])).filter((f) => /^[a-z_0-9]+$/.test(f));
    }
  }
  // Event tables: the table right under "## Send Events" / "## Receive Events"
  // (ends at the first "#### " sub-heading).
  const sectionRows = (heading: string): string[] => {
    const from = gatewayEvents.indexOf(`\n## ${heading}`);
    if (from < 0) return [];
    const to = gatewayEvents.indexOf('\n#### ', from + 1);
    return gatewayEvents.slice(from, to > 0 ? to : gatewayEvents.length).split('\n')
      .filter((l) => l.startsWith('| [')).map((l) => anchorToEvent(l.split('|')[1]));
  };
  const sendEvents = sectionRows('Send Events');
  const receiveEvents = sectionRows('Receive Events');

  // Intents code block: "NAME (1 << n)" then "  - EVENT" lines.
  const intents: GatewayCache['intents'] = [];
  const block = /### List of Intents[\s\S]*?```\n([\s\S]*?)```/.exec(gateway)?.[1] ?? '';
  let cur: GatewayCache['intents'][number] | null = null;
  for (const line of block.split('\n')) {
    const m = /^([A-Z_]+) \(1 << (\d+)\)\s*(\*+)?/.exec(line);
    if (m) {
      cur = { name: m[1], bit: Number(m[2]), privileged: (m[3] ?? '').length === 2, events: [] };
      intents.push(cur);
      continue;
    }
    const e = /^\s+-\s+([A-Z_]+)/.exec(line);
    if (e && cur) cur.events.push(e[1]);
  }
  // MESSAGE_CONTENT is privileged too (marked *** in the docs).
  for (const i of intents) if (i.name === 'MESSAGE_CONTENT' || i.name === 'GUILD_PRESENCES' || i.name === 'GUILD_MEMBERS') i.privileged = true;

  const opRows = op['Gateway Opcodes'] ?? [];
  const closeRows = op['Gateway Close Event Codes'] ?? [];
  return {
    opcodes: opRows.map((r) => ({ code: Number(r[0]), name: r[1], action: r[2] })),
    closeCodes: closeRows.map((r) => ({ code: Number(r[0]), description: r[1].replace(/`/g, '') })),
    sendEvents,
    receiveEvents,
    intents,
    structures,
  };
}

/** The slice of OpenAPI 3.1 this script reads. */
interface OSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
  items?: OSchema;
  allOf?: OSchema[];
  oneOf?: OSchema[];
  anyOf?: OSchema[];
}
interface OParam { $ref?: string; in?: string; name?: string }
interface OMedia { schema?: OSchema }
interface OOperation {
  operationId?: string;
  deprecated?: boolean;
  parameters?: OParam[];
  security?: Array<Record<string, string[]>>;
  requestBody?: { content?: Record<string, OMedia> };
  responses?: Record<string, { content?: Record<string, OMedia> }>;
}
type OPathItem = { parameters?: OParam[] } & Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete', OOperation>>;
interface OSpec {
  paths: Record<string, OPathItem>;
  security?: Array<Record<string, string[]>>;
  components: { schemas: Record<string, OSchema>; parameters?: Record<string, OParam> };
}

async function refresh(): Promise<Cache> {
  console.log('Downloading Discord OpenAPI spec and docs...');
  const [specSha, docsSha] = await Promise.all([latestCommit(SPEC_REPO), latestCommit(DOCS_REPO)]);
  const spec = JSON.parse(await fetchText(`${RAW}/${SPEC_REPO}/${specSha.sha}/specs/openapi.json`)) as OSpec;
  const docsBase = `${RAW}/${DOCS_REPO}/${docsSha.sha}/developers`;
  const [gatewayEvents, gateway, opcodes] = await Promise.all([
    fetchText(`${docsBase}/events/gateway-events.mdx`),
    fetchText(`${docsBase}/events/gateway.mdx`),
    fetchText(`${docsBase}/topics/opcodes-and-status-codes.mdx`),
  ]);
  const docPages = await Promise.all(DOC_ROUTE_FILES.map((f) => fetchText(`${docsBase}/${f}.mdx`).catch(() => '')));

  const schemas = spec.components.schemas;
  const lastSeg = (ref: string) => ref.split('/').pop() ?? ref;
  const deref = (s: OSchema | undefined, seen = new Set<string>()): OSchema => {
    if (s?.$ref) {
      const name = lastSeg(s.$ref);
      if (seen.has(name)) return {};
      seen.add(name);
      return deref(schemas[name], seen);
    }
    return s ?? {};
  };
  const props = (s: OSchema | undefined, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    const r = deref(s, seen);
    for (const k of Object.keys(r.properties ?? {})) out.add(k);
    for (const sub of [...(r.allOf ?? []), ...(r.oneOf ?? []), ...(r.anyOf ?? [])]) {
      for (const k of props(sub, new Set(seen))) out.add(k);
    }
    return out;
  };
  const refName = (s: OSchema | undefined): string | null => {
    if (!s) return null;
    if (s.$ref) return lastSeg(s.$ref);
    if (s.items) { const n = refName(s.items); return n ? `${n}[]` : null; }
    const alts = s.oneOf ?? s.anyOf;
    if (alts) return alts.map(refName).filter(Boolean).join(' | ') || null;
    return null;
  };
  const derefParam = (p: OParam): OParam => (p.$ref ? spec.components.parameters?.[lastSeg(p.$ref)] ?? p : p);

  const rest: SpecOp[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    const shared = item.parameters ?? [];
    for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[m];
      if (!op) continue;
      const params = [...shared, ...(op.parameters ?? [])].map(derefParam);
      const sec = (op.security ?? spec.security ?? []) as Array<Record<string, string[]>>;
      const auth = new Set<'bot' | 'oauth2' | 'public'>();
      const scopes = new Set<string>();
      for (const s of sec) {
        if (Object.keys(s).length === 0) auth.add('public');
        if ('BotToken' in s) auth.add('bot');
        if ('OAuth2' in s) { auth.add('oauth2'); for (const sc of s.OAuth2) scopes.add(sc); }
      }
      const content = op.requestBody?.content ?? {};
      const bodySchema = content['application/json']?.schema ?? content['multipart/form-data']?.schema
        ?? content['application/x-www-form-urlencoded']?.schema;
      const ok = Object.entries(op.responses ?? {}).find(([c]) => c.startsWith('2'));
      const respSchema = ok?.[1]?.content?.['application/json']?.schema;
      rest.push({
        method: m.toUpperCase() as Method,
        path,
        operationId: op.operationId ?? `${m}_${path}`,
        source: 'openapi',
        auth: [...auth],
        oauth2Scopes: scopes.size > 6 ? ['(many)'] : [...scopes],
        deprecated: !!op.deprecated || /^deprecated_/.test(op.operationId ?? ''),
        query: params.filter((p) => p.in === 'query' && p.name).map((p) => p.name as string),
        body: bodySchema ? [...props(bodySchema)].filter((k) => !/^files\[\d+\]$/.test(k)).sort() : [],
        multipart: 'multipart/form-data' in content,
        response: ok ? (respSchema ? refName(respSchema) ?? 'inline' : `${ok[0]} (empty)`) : null,
      });
    }
  }

  // Routes the docs list but the spec does not (e.g. SKUs).
  const tmpl = (p: string) => p.replace(/\{[^}]+\}/g, '{}');
  const known = new Set(rest.map((r) => `${r.method} ${tmpl(r.path)}`));
  for (const page of docPages) {
    for (const m of page.matchAll(/<Route method="([A-Z]+)">(.*?)<\/Route>/g)) {
      let p = m[2].replace(/\[\\\{([^\\]+)\\\}\]\([^)]*\)/g, '{$1}').replace(/\\\{/g, '{').replace(/\\\}/g, '}');
      p = p.replace(/\?.*$/, '').trim().replace(/\{([a-z_]+)\.id\}/g, '{$1_id}');
      const key = `${m[1]} ${tmpl(p)}`;
      if (known.has(key)) continue;
      known.add(key);
      rest.push({
        method: m[1] as Method, path: p, operationId: `docs:${p}`, source: 'docs', auth: ['bot'], oauth2Scopes: [],
        deprecated: /members\/@me\/nick/.test(p), query: [], body: [], multipart: false, response: null,
      });
    }
  }
  for (const x of OAUTH2_EXTRAS) {
    if (known.has(`${x.method} ${tmpl(x.path)}`)) continue;
    rest.push({ ...x, source: 'docs', auth: ['public'], oauth2Scopes: [], deprecated: false, query: [], body: [], multipart: false, response: null });
  }
  rest.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const objects: Record<string, string[]> = {};
  for (const n of OBJECT_SCHEMAS) if (schemas[n]) objects[n] = [...props({ $ref: `#/components/schemas/${n}` })].sort();

  const cache: Cache = {
    meta: { spec: { repo: SPEC_REPO, ...specSha }, docs: { repo: DOCS_REPO, ...docsSha } },
    rest,
    objects,
    gateway: buildGatewayCache(gatewayEvents, gateway, opcodes),
  };
  mkdirSync(join(ROOT, 'scripts/discord-spec'), { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 1)}\n`);
  console.log(`Wrote ${relative(ROOT, CACHE)} (${rest.length} REST operations, spec ${specSha.sha.slice(0, 7)}, docs ${docsSha.sha.slice(0, 7)})`);
  return cache;
}

// ─── Source helpers ─────────────────────────────────────────

function walk(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const fileCache = new Map<string, string>();
function read(p: string): string {
  const abs = p.startsWith('/') ? p : join(ROOT, p);
  if (!fileCache.has(abs)) fileCache.set(abs, existsSync(abs) ? readFileSync(abs, 'utf8') : '');
  return fileCache.get(abs)!;
}

/** Blank out comments but keep offsets/line numbers (strings are left intact). */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Index of the brace matching the `{` at `open`. Skips strings. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return src.length - 1;
}

/** Top-level keys of an object literal (including keys of object literals spread at the top level). */
function objectKeys(literal: string): string[] {
  const keys = new Set<string>();
  const body = literal.slice(1, -1);
  let depth = 0;
  let quote: string | null = null;
  let segStart = 0;
  const segments: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { segments.push(body.slice(segStart, i)); segStart = i + 1; }
  }
  segments.push(body.slice(segStart));
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    if (seg.startsWith('...')) {
      // `...(cond ? { a: 1, b: 2 } : {})` or `...{ a }` → collect keys of literal objects inside.
      for (let i = 0; i < seg.length; i++) {
        if (seg[i] === '{') {
          const end = matchBrace(seg, i);
          for (const k of objectKeys(seg.slice(i, end + 1))) keys.add(k);
          i = end;
        }
      }
      continue;
    }
    const m = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*(:|$|\()/.exec(seg);
    if (m) keys.add(m[1]);
  }
  return [...keys];
}

/** Find `function name(` / `const name = (` under the given files and return the keys of its first returned object literal. */
function serializerKeys(fn: string, files: string[]): { file: string; line: number; keys: string[] } | null {
  for (const f of files) {
    const src = stripComments(read(f));
    const re = new RegExp(`(?:function\\s+${fn}\\s*\\(|const\\s+${fn}\\s*=\\s*(?:async\\s*)?\\()`);
    const m = re.exec(src);
    if (!m) continue;
    const ret = src.indexOf('return {', m.index);
    if (ret < 0) continue;
    const open = src.indexOf('{', ret);
    const close = matchBrace(src, open);
    return { file: relative(ROOT, f), line: lineOf(src, m.index), keys: objectKeys(src.slice(open, close + 1)) };
  }
  return null;
}

// ─── SerikaCord REST extraction ─────────────────────────────

interface SerikaRoute {
  method: Method;
  fullPath: string;
  file: string;
  line: number;
  handler: string;
}

function extractSerikaRoutes(): SerikaRoute[] {
  const files = walk(join(ROOT, 'src/lib/api'));
  interface Group { name: string; prefix: string; file: string; start: number; end: number; src: string; children: string[] }
  const groups = new Map<string, Group>();
  const perFile: Array<{ file: string; src: string; decls: Array<{ name: string; prefix: string; idx: number }> }> = [];
  for (const f of files) {
    const src = stripComments(read(f));
    const decls: Array<{ name: string; prefix: string; idx: number }> = [];
    const re = /(?:export\s+)?const\s+(\w+)\s*=\s*new Elysia\(\s*(\{[^)]*\})?\s*\)/g;
    for (const m of src.matchAll(re)) {
      const prefix = /prefix:\s*['"`]([^'"`]*)['"`]/.exec(m[2] ?? '')?.[1] ?? '';
      decls.push({ name: m[1], prefix, idx: m.index! });
    }
    perFile.push({ file: f, src, decls });
    decls.forEach((d, i) => {
      const end = i + 1 < decls.length ? decls[i + 1].idx : src.length;
      const chain = src.slice(d.idx, end);
      const children = [...chain.matchAll(/\.use\(\s*(\w+)\s*\)/g)].map((x) => x[1]);
      groups.set(d.name, { name: d.name, prefix: d.prefix, file: f, start: d.idx, end, src, children });
    });
  }
  // Resolve import aliases (`import { a as b }`) to the declared names.
  const alias = new Map<string, string>();
  for (const { src } of perFile) {
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const a = /(\w+)\s+as\s+(\w+)/.exec(part.trim());
        if (a) alias.set(a[2], a[1]);
      }
    }
  }
  const resolved = new Map<string, string[]>(); // group name → full prefixes
  const visit = (name: string, base: string, depth: number) => {
    const g = groups.get(alias.get(name) ?? name);
    if (!g || depth > 8) return;
    const full = base + g.prefix;
    const list = resolved.get(g.name) ?? [];
    if (list.includes(full)) return;
    list.push(full);
    resolved.set(g.name, list);
    for (const c of g.children) visit(c, full, depth + 1);
  };
  visit('api', '', 0);

  const routes: SerikaRoute[] = [];
  for (const g of groups.values()) {
    const prefixes = resolved.get(g.name);
    if (!prefixes) continue;
    const chain = g.src.slice(g.start, g.end);
    const matches = [...chain.matchAll(/\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`]*)\2/g)];
    matches.forEach((m, i) => {
      const from = g.start + m.index!;
      const to = i + 1 < matches.length ? g.start + matches[i + 1].index! : g.end;
      for (const p of prefixes) {
        routes.push({
          method: m[1].toUpperCase() as Method,
          fullPath: (p + (m[3] === '/' ? '' : m[3])) || '/',
          file: relative(ROOT, g.file),
          line: lineOf(g.src, from),
          handler: g.src.slice(from, to),
        });
      }
    });
  }
  return routes;
}

function tmpl(p: string): string {
  return p.replace(/\{[^}]+\}/g, '{}').replace(/:[A-Za-z_]\w*/g, '{}').replace(/\/+$/, '') || '/';
}

/** Would a Serika route template capture this Discord path at runtime (param eating a literal like @me)? */
function captures(serika: string, discord: string): boolean {
  const a = serika.split('/');
  const b = discord.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg === '{}');
}

function usedQuery(handler: string): Set<string> {
  const s = new Set<string>();
  for (const m of handler.matchAll(/\bquery\??\.(\w+)|\bquery\[['"](\w+)['"]\]/g)) s.add(m[1] ?? m[2]);
  for (const m of handler.matchAll(/const\s*\{([^}]*)\}\s*=\s*query\b/g)) for (const k of m[1].split(',')) s.add(k.split(':')[0].trim());
  return s;
}

function usedBody(handler: string): Set<string> {
  const s = new Set<string>();
  const aliases = new Set(['body']);
  for (const m of handler.matchAll(/const\s+(\w+)\s*=\s*\(?\s*body\b/g)) aliases.add(m[1]);
  for (const a of aliases) {
    for (const m of handler.matchAll(new RegExp(`\\b${a}\\??\\.(\\w+)`, 'g'))) s.add(m[1]);
  }
  // `body` itself, or the payload a multipart parser split out of it (`parsed.payload`).
  for (const m of handler.matchAll(/const\s*\{([^}]*)\}\s*=\s*\(?\s*(?:body|\w+\.payload)\b/g)) {
    for (const k of m[1].split(',')) { const key = k.split(':')[0].trim(); if (key) s.add(key); }
  }
  return s;
}

// ─── Areas / work packages ──────────────────────────────────

const WPS: Record<string, string> = {
  WP0: 'Foundations: snowflake ids, shared serializers, errors, rate limits, test harness',
  WP1: 'Gateway core + event plumbing',
  WP2: 'Messages, reactions, pins, polls, attachments, components',
  WP3: 'Interactions + application commands',
  WP4: 'Guild resources (guild, channels, roles, members, bans, expressions, invites, moderation, events)',
  WP5: 'Threads + forums',
  WP6: 'Webhooks, applications, OAuth2, CDN compat',
  WP7: 'Voice, stage, soundboard, monetization, Social SDK lobbies',
  WP8: 'Developer experience: docs, examples, portal, sandbox, compat CI',
};

const AREAS: Array<{ id: string; title: string; wp: string; test: RegExp }> = [
  { id: 'social-sdk', title: 'Social SDK lobbies / provisional accounts', wp: 'WP7', test: /^\/(lobbies|partner-sdk)/ },
  { id: 'oauth2', title: 'OAuth2 + linked roles', wp: 'WP6', test: /^\/oauth2|role-connection/ },
  { id: 'gateway-meta', title: 'Gateway discovery', wp: 'WP1', test: /^\/gateway/ },
  { id: 'interactions', title: 'Interaction callbacks', wp: 'WP3', test: /^\/interactions\// },
  { id: 'app-commands', title: 'Application commands', wp: 'WP3', test: /\/commands/ },
  { id: 'monetization', title: 'Monetization (entitlements, SKUs, subscriptions)', wp: 'WP7', test: /entitlements|\/skus|subscriptions/ },
  { id: 'applications', title: 'Applications (app info, app emojis, activities)', wp: 'WP6', test: /^\/applications/ },
  { id: 'webhooks', title: 'Webhooks (incl. interaction followups)', wp: 'WP6', test: /^\/webhooks|\/webhooks$/ },
  { id: 'reactions', title: 'Reactions', wp: 'WP2', test: /\/reactions/ },
  { id: 'threads', title: 'Threads + forums', wp: 'WP5', test: /thread/ },
  { id: 'messages', title: 'Messages, pins, polls, typing', wp: 'WP2', test: /^\/channels\/\{[^}]+\}\/(messages|pins|polls|typing)/ },
  { id: 'channels', title: 'Channels (settings, overwrites, invites, followers, group DM)', wp: 'WP4', test: /^\/channels/ },
  { id: 'events-stage', title: 'Scheduled events + stage instances', wp: 'WP4', test: /scheduled-events|^\/stage-instances/ },
  { id: 'voice', title: 'Voice (regions, voice states, soundboard)', wp: 'WP7', test: /^\/voice|voice-states|\/regions|soundboard/ },
  { id: 'expressions', title: 'Emojis + stickers', wp: 'WP4', test: /emojis|stickers|sticker-packs/ },
  { id: 'invites', title: 'Invites', wp: 'WP4', test: /invites/ },
  { id: 'moderation', title: 'Audit log + AutoMod', wp: 'WP4', test: /audit-logs|auto-moderation|incident-actions/ },
  { id: 'members', title: 'Members, bans, prune, join requests', wp: 'WP4', test: /\/members|\/bans|bulk-ban|\/prune|\/requests/ },
  { id: 'users', title: 'Users + DMs', wp: 'WP1', test: /^\/users/ },
  { id: 'guilds', title: 'Guild settings (guild, roles, channels list, widget, onboarding, templates, ...)', wp: 'WP4', test: /^\/guilds/ },
];

function areaOf(path: string) {
  return AREAS.find((a) => a.test.test(path)) ?? { id: 'other', title: 'Other', wp: 'WP8', test: /./ };
}

// ─── Hand-maintained knowledge ──────────────────────────────

/**
 * Routes that exist but are known to be incomplete or wrong. Key: "METHOD /discord/path".
 * Remove an entry when it is fixed; the report then counts the route as implemented.
 */
const KNOWN_GAPS: Record<string, string[]> = {
  'POST /channels/{channel_id}/messages': [
    'components are not stored or rendered yet (message components work package)',
    'sticker_ids: one sticker per message (Serika limit); shared_client_theme ignored',
  ],
  'PATCH /channels/{channel_id}/messages/{message_id}': ['components ignored (message components work package)'],
  'PUT /channels/{channel_id}/messages/pins/{message_id}': ['no system "pinned a message" (type 6) message is posted'],
  'PUT /channels/{channel_id}/pins/{message_id}': ['deprecated route; no system "pinned a message" (type 6) message is posted'],
  'PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me': ['custom emoji ids must be Serika ids until the snowflake layer resolves `name:<snowflake>` path segments'],
  'GET /channels/{channel_id}': ['DM recipients are bare ids'],
  'PATCH /guilds/{guild_id}/members/{user_id}': ['channel_id (voice move / disconnect) not supported: answers 40032'],
  'PUT /guilds/{guild_id}/members/{user_id}': ['needs an OAuth2 guilds.join access token, which SerikaCord does not issue yet: 403 50025 unless already a member'],
  'PUT /channels/{channel_id}/recipients/{user_id}': ['needs an OAuth2 gdm.join access token, which SerikaCord does not issue yet: 403 50025'],
  'GET /guilds/{guild_id}/widget.json': ['channels and members lists are empty; instant_invite only for partnered vanity links'],
  'GET /guilds/{guild_id}/audit-logs': ['application_commands / guild_scheduled_events arrays stay empty (Serika logs neither change)'],
  // WP5 threads + forums
  'POST /channels/{channel_id}/threads': ['forum posts send their first message through POST /channels/{id}/messages, so the bot also needs SEND_MESSAGES_IN_THREADS'],
  'POST /channels/{channel_id}/messages/{message_id}/threads': ['the thread gets its own id (Discord reuses the starter message id)'],
  'GET /channels/{channel_id}/thread-members': ['join_timestamp is the thread creation time (no per-member timestamp or flags)'],
  'GET /channels/{channel_id}/threads/search': ['slop and min_id / max_id ignored; relevance sorts by last activity'],
  // WP4b guild features
  'PUT /guilds/{guild_id}/onboarding': ['option channel_ids, default_channel_ids and mode are ignored (Serika options only grant roles)'],
  'POST /stage-instances': ['stage instances are not supported yet: 501'],
  'GET /stage-instances/{channel_id}': ['stage instances are not supported yet: always 10067 Unknown Stage Instance'],
  'PATCH /stage-instances/{channel_id}': ['stage instances are not supported yet: always 10067 Unknown Stage Instance'],
  'DELETE /stage-instances/{channel_id}': ['stage instances are not supported yet: always 10067 Unknown Stage Instance'],
  'GET /gateway/bot': ['always 1 shard; session_start_limit is static'],
  'POST /interactions/{interaction_id}/{interaction_token}/callback': [
    'callback types 10 (premium) and 12 (launch activity) are rejected with 50035',
  ],
  'POST /webhooks/{webhook_id}/{webhook_token}': [
    'applied_tags only used with thread_name; poll is ignored',
  ],
  'PATCH /webhooks/{webhook_id}': ['avatar takes an https URL, not image data'],
  'PATCH /webhooks/{webhook_id}/{webhook_token}': ['avatar takes an https URL, not image data'],
  'GET /voice/regions': ['static list'],
};

/** Events that are emitted, but only from some of the places that should emit them. */
const EVENT_GAPS: Record<string, string> = {
  RESUMED: 'replay buffer is per process: a RESUME that lands on another instance (or after a restart) gets op 9',
  THREAD_LIST_SYNC: 'sent by the instance that made the access change, and only when it held a recent audience snapshot of the guild',
  THREAD_MEMBER_UPDATE: 'only when the bot itself joins a thread (Serika has no per-member thread flags)',
};

/** Regex probes for protocol-level behaviour. `invert` = the regex matches the *broken* pattern. */
interface Feature { id: string; wp: string; title: string; files: string[]; re: RegExp; invert?: boolean; exclude?: string[] }
const BOTAPI = ['src/lib/api/botApi.ts', 'src/lib/api/botApi/', 'src/lib/botapi/'];
const GW = ['src/lib/gateway/', 'server.ts', 'scripts/gateway.ts'];
const FEATURES: Feature[] = [
  { id: 'ids.snowflake', wp: 'WP0', title: 'Ids exposed as numeric snowflakes (discord.py/JDA/Serenity/DSharpPlus parse ids as 64-bit ints)', files: [...BOTAPI, 'src/lib/services/gatewayEvents.ts'], re: /toSnowflake|snowflakeOf|fromSnowflake/ },
  { id: 'errors.tree', wp: 'WP0', title: 'Validation errors are 400 + code 50035 with an `errors` tree', files: BOTAPI, re: /_errors|errors:\s*\{/ },
  { id: 'ratelimit.headers', wp: 'WP0', title: 'X-RateLimit-Limit/Remaining/Reset/Reset-After/Bucket headers on bot routes', files: [...BOTAPI, 'src/lib/api/index.ts', 'src/lib/security/', 'server.ts'], re: /X-RateLimit-Bucket/i },
  { id: 'ratelimit.body', wp: 'WP0', title: '429 body is { message, retry_after, global } (+ X-RateLimit-Scope)', files: [...BOTAPI, 'src/lib/api/index.ts', 'src/lib/security/botRateLimit.ts'], re: /retry_after[\s\S]{0,120}global|X-RateLimit-Scope/i },
  { id: 'auth.bearer', wp: 'WP6', title: 'OAuth2 Bearer tokens accepted on /api/v10 (users/@me, guilds, connections)', files: BOTAPI, re: /['"`]Bearer /i },
  { id: 'perm.overwrites', wp: 'WP0', title: 'Channel permission overwrites applied to bot actions (reuse computeChannelPermissions from src/lib/permissions/channelOverwrites.ts)', files: BOTAPI, re: /computeChannelPermissions|applyChannelOverwrites|getMemberChannelPermissions/ },
  { id: 'cdn.compat', wp: 'WP6', title: 'Discord CDN path compatibility (/avatars/{user_id}/{hash}.png, /icons/, /emojis/{id}.png, /embed/avatars/)', files: [...BOTAPI, 'server.ts', 'src/lib/api/index.ts'], re: /['"`]\/(avatars|icons|emojis|embed\/avatars)\// },
  { id: 'gw.guild_create', wp: 'WP1', title: 'GUILD_CREATE sent for every guild after READY', files: GW, re: /t:\s*['"]GUILD_CREATE['"]|dispatchTo\(conn,\s*'GUILD_CREATE'/ },
  { id: 'gw.zlib', wp: 'WP1', title: 'compress=zlib-stream transport compression', files: GW, re: /zlib-stream|createDeflate|deflateRaw|Deflate\(/ },
  { id: 'gw.zstd', wp: 'WP1', title: 'compress=zstd-stream transport compression', files: GW, re: /zstd/i },
  { id: 'gw.etf', wp: 'WP1', title: 'encoding=etf (Erlang term format)', files: GW, re: /erlpack|encoding\s*===?\s*['"]etf/i },
  { id: 'gw.resume_replay', wp: 'WP1', title: 'RESUME replays missed dispatches (per-session buffer)', files: GW, re: /replay|resumeBuffer|backlog/i },
  { id: 'gw.resume_validate', wp: 'WP1', title: 'RESUME validates session_id + seq; bad resume → op 9 / 4007', files: GW, re: /4007/ },
  { id: 'gw.sharding', wp: 'WP1', title: 'IDENTIFY shard [id, n] honoured (guild_id >> 22 % n), 4010/4011', files: GW, re: /\bshard\b/ },
  { id: 'gw.op3', wp: 'WP1', title: 'Op 3 Presence Update (bot status + activities)', files: GW, re: /PRESENCE_UPDATE\s*:\s*3|case\s+3\b|case\s+OP\.PRESENCE_UPDATE/ },
  { id: 'gw.op4', wp: 'WP7', title: 'Op 4 Voice State Update → VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE', files: GW, re: /case\s+4\b|case\s+OP\.VOICE_STATE_UPDATE/ },
  { id: 'gw.op8', wp: 'WP1', title: 'Op 8 Request Guild Members → GUILD_MEMBERS_CHUNK', files: GW, re: /GUILD_MEMBERS_CHUNK/ },
  { id: 'gw.op31', wp: 'WP7', title: 'Op 31 Request Soundboard Sounds', files: GW, re: /SOUNDBOARD_SOUNDS/ },
  { id: 'gw.intents_privileged', wp: 'WP1', title: 'Privileged intents checked against app flags (close 4014)', files: GW, re: /4014/ },
  { id: 'gw.intents_invalid', wp: 'WP1', title: 'Invalid intents rejected (close 4013)', files: GW, re: /4013/ },
  { id: 'gw.message_content', wp: 'WP1', title: 'Without MESSAGE_CONTENT, content/embeds/attachments/components are blanked (except DMs, mentions, own msgs)', files: GW, re: /MESSAGE_CONTENT/ },
  { id: 'gw.dm_routing', wp: 'WP1', title: 'DM events reach only bots that are recipients (no fan-out to bots with zero DMs)', files: GW, re: /dmChannelIds\.size\s*&&/, invert: true },
  { id: 'gw.dm_tracking', wp: 'WP1', title: 'DMs opened after IDENTIFY are tracked (CHANNEL_CREATE for DMs)', files: [...GW, 'src/lib/services/gatewayEvents.ts'], re: /dmChannelIds\.add/ },
  { id: 'gw.guild_leave', wp: 'WP1', title: 'Leaving/kicked/banned guilds are dropped from the session (GUILD_DELETE)', files: GW, re: /guildIds\.delete/ },
  { id: 'gw.ratelimit', wp: 'WP1', title: 'Gateway send rate limit (120 / 60 s) with close 4008', files: GW, re: /4008/ },
  { id: 'gw.4003', wp: 'WP1', title: 'Payload before IDENTIFY closes with 4003', files: GW, re: /4003/ },
  { id: 'gw.4005', wp: 'WP1', title: 'Second IDENTIFY closes with 4005', files: GW, re: /4005/ },
  { id: 'gw.4001', wp: 'WP1', title: 'Unknown opcode closes with 4001', files: GW, re: /4001/ },
  { id: 'gw.4012', wp: 'WP1', title: 'Unsupported ?v= closes with 4012', files: GW, re: /4012/ },
  { id: 'gw.reconnect', wp: 'WP1', title: 'Op 7 RECONNECT sent before deploy/shutdown so bots resume', files: GW, re: /OP\.RECONNECT(?!\s*:)/ },
  { id: 'msg.multipart', wp: 'WP2', title: 'multipart/form-data with files[n] + payload_json', files: [...BOTAPI, 'src/lib/chat/botMultipart.ts'], re: /payload_json/ },
  { id: 'msg.allowed_mentions', wp: 'WP2', title: 'allowed_mentions honoured (parse/users/roles/replied_user)', files: [...BOTAPI, 'src/lib/chat/'], re: /allowed_mentions\s*\??\.|resolveAllowedMentions|applyAllowedMentions/ },
  { id: 'msg.reference', wp: 'WP2', title: 'message_reference on create (replies + forwards), referenced_message in responses', files: BOTAPI, re: /message_reference/ },
  { id: 'msg.components_store', wp: 'WP2', title: 'Message components persisted on messages', files: ['src/lib/db/schema.ts'], re: /components:\s*jsonb\(/ },
  { id: 'msg.components_v2', wp: 'WP2', title: 'Components v2 (IS_COMPONENTS_V2, container/section/text display/media gallery/file)', files: [...BOTAPI, 'src/lib/chat/'], re: /IS_COMPONENTS_V2/ },
  { id: 'msg.embed_limits', wp: 'WP2', title: 'Embed validation + limits (10 embeds, 6000 chars, field limits)', files: [...BOTAPI, 'src/lib/chat/'], re: /validateEmbeds|EMBED_TOTAL_LIMIT|6000/ },
  { id: 'msg.pagination', wp: 'WP2', title: 'GET messages honours before/after/around', files: BOTAPI, re: /query\??\.(before|around)/ },
  { id: 'msg.edit_event', wp: 'WP2', title: 'MESSAGE_UPDATE emitted on edits (any surface)', files: ['src/lib/', 'server.ts'], re: /emitMessageUpdate\(/, exclude: ['src/lib/services/gatewayEvents.ts'] },
  { id: 'msg.stickers', wp: 'WP2', title: 'sticker_ids on create / sticker_items in responses', files: [...BOTAPI, 'src/lib/chat/discordMessage.ts'], re: /sticker_items/ },
  { id: 'ix.signed_http', wp: 'WP3', title: 'Ed25519-signed HTTP interactions endpoint (+ PING verification)', files: ['src/lib/services/interactions.ts'], re: /X-Signature-Ed25519/ },
  { id: 'ix.cb_deferred', wp: 'WP3', title: 'Callback 5 DEFERRED_CHANNEL_MESSAGE shows "thinking…" and is completed by @original edit', files: ['src/lib/services/interactions.ts', 'src/lib/botapi/interactionState.ts', ...BOTAPI], re: /case\s+(5|CB_DEFERRED_CHANNEL_MESSAGE|CallbackType\.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE)\b|===\s*(5|CB_DEFERRED_CHANNEL_MESSAGE)\b/ },
  { id: 'ix.cb_update', wp: 'WP3', title: 'Callbacks 6/7 DEFERRED_UPDATE_MESSAGE / UPDATE_MESSAGE', files: ['src/lib/services/interactions.ts', 'src/lib/botapi/interactionState.ts', ...BOTAPI], re: /===\s*(6|7|CB_DEFERRED_UPDATE_MESSAGE|CB_UPDATE_MESSAGE)\b|case\s+(6|7|CB_DEFERRED_UPDATE_MESSAGE|CB_UPDATE_MESSAGE|CallbackType\.UPDATE_MESSAGE|CallbackType\.DEFERRED_UPDATE_MESSAGE)\b/ },
  { id: 'ix.cb_autocomplete', wp: 'WP3', title: 'Callback 8 APPLICATION_COMMAND_AUTOCOMPLETE_RESULT', files: ['src/lib/services/interactions.ts', ...BOTAPI], re: /AUTOCOMPLETE_RESULT|===\s*8\b|case\s+8\b/ },
  { id: 'ix.cb_modal', wp: 'WP3', title: 'Callback 9 MODAL', files: ['src/lib/services/interactions.ts', 'src/lib/botapi/interactionState.ts', ...BOTAPI], re: /CB_MODAL|CallbackType\.MODAL\b|===\s*9\b|case\s+9\b/ },
  { id: 'ix.type_component', wp: 'WP3', title: 'Type 3 MESSAGE_COMPONENT interactions from button/select clicks', files: ['src/lib/services/', ...BOTAPI], re: /MESSAGE_COMPONENT/ },
  { id: 'ix.type_autocomplete', wp: 'WP3', title: 'Type 4 APPLICATION_COMMAND_AUTOCOMPLETE while typing options', files: ['src/lib/services/', ...BOTAPI], re: /INTERACTION_AUTOCOMPLETE|APPLICATION_COMMAND_AUTOCOMPLETE(?!_RESULT)/ },
  { id: 'ix.type_modal', wp: 'WP3', title: 'Type 5 MODAL_SUBMIT', files: ['src/lib/services/', ...BOTAPI], re: /MODAL_SUBMIT/ },
  { id: 'ix.original', wp: 'WP3', title: 'GET/PATCH/DELETE /webhooks/{app}/{token}/messages/@original + followup edit/delete', files: BOTAPI, re: /@original/ },
  { id: 'ix.token_store', wp: 'WP3', title: 'Interaction tokens shared across instances (Redis), 15 min TTL', files: ['src/lib/services/interactions.ts'], re: /interactionStore\s*=\s*new Map/, invert: true },
  { id: 'ix.app_id', wp: 'WP3', title: 'interaction.application_id equals the id READY and the command routes use', files: ['src/lib/services/interactions.ts'], re: /application_id:\s*app\.clientId/, invert: true },
  { id: 'ix.resolved', wp: 'WP3', title: 'interaction.data.resolved (users/members/roles/channels/attachments)', files: ['src/lib/services/interactions.ts'], re: /resolved\s*:/ },
  { id: 'ix.app_permissions', wp: 'WP3', title: 'interaction.app_permissions / member.permissions / entitlements / context / authorizing_integration_owners', files: ['src/lib/services/interactions.ts'], re: /app_permissions/ },
  { id: 'ix.context_menu', wp: 'WP3', title: 'User + message context-menu commands (data.target_id) invocable from the UI', files: ['src/lib/services/interactions.ts', 'src/lib/services/appCommands.ts', 'src/hooks/useSlashCommands.ts', 'src/components/chat/'], re: /target_id/ },
  { id: 'cmd.permissions_v2', wp: 'WP3', title: 'default_member_permissions / contexts / integration_types stored and enforced', files: [...BOTAPI, 'src/lib/services/appCommands.ts', 'src/lib/db/schema.ts'], re: /default_member_permissions|defaultMemberPermissions/ },
  { id: 'cmd.localizations', wp: 'WP3', title: 'name_localizations / description_localizations', files: [...BOTAPI, 'src/lib/db/schema.ts'], re: /name_localizations|nameLocalizations/ },
  { id: 'wh.wait', wp: 'WP6', title: 'Webhook execute ?wait=true returns the message', files: [...BOTAPI, 'src/lib/api/index.ts', 'src/lib/services/channelWebhooks.ts'], re: /query\??\.wait|wait\s*===\s*['"]true/ },
  { id: 'wh.thread', wp: 'WP6', title: 'Webhook execute thread_id / thread_name (forum posts)', files: [...BOTAPI, 'src/lib/api/index.ts', 'src/lib/services/channelWebhooks.ts'], re: /thread_name/ },
  { id: 'oauth.bot_install', wp: 'WP6', title: 'OAuth2 bot install (scope=bot&permissions=…) creates the managed role and sends GUILD_CREATE', files: ['src/lib/api/developers.ts'], re: /emitGuildCreate\(/ },
  { id: 'oauth.client_credentials', wp: 'WP6', title: 'client_credentials grant', files: ['src/lib/api/developers.ts'], re: /client_credentials/ },
  { id: 'app.intent_flags', wp: 'WP6', title: 'Application flags expose GATEWAY_* intent approvals (1<<12…1<<19) and gate privileged intents', files: [...BOTAPI, 'src/lib/api/developers.ts', 'src/lib/gateway/'], re: /GATEWAY_MESSAGE_CONTENT|GATEWAY_GUILD_MEMBERS/ },
  { id: 'voice.gateway', wp: 'WP7', title: 'Voice gateway for bots (VOICE_SERVER_UPDATE + voice WS v8 / UDP RTP Opus / DAVE)', files: ['src/lib/', 'server.ts'], re: /VOICE_SERVER_UPDATE/, exclude: ['src/lib/discord/', 'src/lib/constants/'] },
  { id: 'dx.discordpy_example', wp: 'WP8', title: 'discord.py quick-start example in the docs is valid Python', files: ['src/lib/constants/docs-content.ts'], re: /^\s*async on_\w+\(/m, invert: true },
  // The docs describe X-RateLimit-* headers; they are truthful only while the bot API really sends them.
  { id: 'dx.ratelimit_docs_truthful', wp: 'WP8', title: 'Docs only promise rate-limit headers the API actually sends', files: [...BOTAPI, 'src/lib/security/botRateLimit.ts'], re: /X-RateLimit-Bucket/ },
];

function probeFiles(spec: string[], exclude: string[] = []): string[] {
  const out: string[] = [];
  for (const s of spec) {
    const abs = join(ROOT, s);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out.filter((f) => !exclude.some((e) => relative(ROOT, f).startsWith(e)));
}

// ─── Analysis ───────────────────────────────────────────────

type Status = 'implemented' | 'partial' | 'missing';

function analyze(cache: Cache) {
  const serika = extractSerikaRoutes();
  const versioned = serika.filter((r) => /^\/api\/v(9|10)\//.test(r.fullPath));
  const vt = (r: SerikaRoute) => tmpl(r.fullPath.replace(/^\/api\/v(9|10)/, ''));
  const unversioned = serika.filter((r) => !/^\/api\/v(9|10)\//.test(r.fullPath));

  const rest = cache.rest.map((op) => {
    const t = tmpl(op.path);
    const area = areaOf(op.path);
    const exact = versioned.find((r) => r.method === op.method && vt(r) === t);
    const notes: string[] = [];
    let status: Status = 'missing';
    let where: { file: string; line: number; path: string } | null = null;
    let query = { spec: op.query, used: [] as string[] };
    let body = { spec: op.body, used: [] as string[] };
    if (exact) {
      status = 'implemented';
      where = { file: exact.file, line: exact.line, path: exact.fullPath };
      const q = usedQuery(exact.handler);
      const b = usedBody(exact.handler);
      query = { spec: op.query, used: op.query.filter((x) => q.has(x)) };
      body = { spec: op.body, used: op.body.filter((x) => b.has(x)) };
      const gaps = KNOWN_GAPS[`${op.method} ${op.path}`];
      if (gaps) { status = 'partial'; notes.push(...gaps); }
      if (op.body.length >= 3 && body.used.length / op.body.length < 0.4) {
        status = 'partial';
        notes.push(`reads ${body.used.length}/${op.body.length} body fields`);
      }
      if (op.query.length >= 2 && query.used.length / op.query.length < 0.5) {
        status = 'partial';
        notes.push(`reads ${query.used.length}/${op.query.length} query params`);
      }
    } else {
      const unv = unversioned.find((r) => r.method === op.method && tmpl(r.fullPath.replace(/^\/api/, '')) === t);
      if (unv && /^\/(oauth2|webhooks)\//.test(op.path)) {
        // Public, token-in-URL / client-credential routes: callable, just not under /v10.
        status = 'partial';
        where = { file: unv.file, line: unv.line, path: unv.fullPath };
        notes.push(`only reachable without the /v10 prefix (${unv.fullPath})`);
        const gaps = KNOWN_GAPS[`${op.method} ${op.path}`];
        if (gaps) notes.push(...gaps);
      } else if (unv) {
        // A web-session (cookie/JWT) route with the same shape: not callable with a bot token,
        // but its logic is the thing to reuse.
        notes.push(`web-session route exists: ${unv.method} ${unv.fullPath} (${unv.file}:${unv.line}), reuse its logic`);
        const gaps = KNOWN_GAPS[`${op.method} ${op.path}`];
        if (gaps) notes.push(...gaps);
      } else {
        const cap = versioned.find((r) => r.method === op.method && captures(vt(r), t));
        if (cap) notes.push(`request is captured by ${cap.method} ${cap.fullPath} (${cap.file}:${cap.line}) and fails`);
        const gaps = KNOWN_GAPS[`${op.method} ${op.path}`];
        if (gaps) notes.push(...gaps);
      }
    }
    return {
      method: op.method, path: op.path, operationId: op.operationId, source: op.source, deprecated: op.deprecated,
      auth: op.auth, area: area.id, wp: area.wp, status, serika: where, notes, query, body, multipart: op.multipart, response: op.response,
    };
  });

  // Serika v10 routes with no Discord counterpart.
  const discordT = new Set(cache.rest.map((o) => `${o.method} ${tmpl(o.path)}`));
  const extras = versioned
    .filter((r) => !discordT.has(`${r.method} ${vt(r)}`))
    .map((r) => ({ method: r.method, path: r.fullPath, file: r.file, line: r.line }));

  // ── Gateway ──
  const gwFiles = [
    ...walk(join(ROOT, 'src/lib')).filter((f) => !/src\/lib\/(discord|constants)\//.test(relative(ROOT, f)) && !f.endsWith('api/mcp.ts')),
    join(ROOT, 'server.ts'), join(ROOT, 'scripts/gateway.ts'),
  ];
  // Comparisons like `dispatch.t === 'GUILD_CREATE'` are consumers, not emitters: drop them.
  const gwSrc = gwFiles.map((f) => ({
    f: relative(ROOT, f),
    src: stripComments(read(f)).replace(/[=!]==\s*['"`][A-Z_]+['"`]|['"`][A-Z_]+['"`]\s*[=!]==/g, ''),
  }));
  const eventsFile = 'src/lib/services/gatewayEvents.ts';
  const evSrc = gwSrc.find((x) => x.f === eventsFile)?.src ?? '';
  // Emitters and their call sites.
  const emitters = [...evSrc.matchAll(/export (?:async )?function (\w+)\s*\(/g)].map((m) => {
    const start = m.index!;
    const open = evSrc.indexOf('{', evSrc.indexOf(')', start));
    const body = evSrc.slice(start, matchBrace(evSrc, open) + 1);
    const calls = gwSrc.filter((x) => x.f !== eventsFile)
      .reduce((n, x) => n + [...x.src.matchAll(new RegExp(`\\b${m[1]}\\b\\s*\\(`, 'g'))].length, 0);
    return { name: m[1], body, calls };
  });
  const coreSrc = stripComments(read('src/lib/gateway/core.ts'));
  const opConst = /export const OP = \{([\s\S]*?)\}/.exec(coreSrc)?.[1] ?? '';
  const opByName = new Map([...opConst.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const usedOp = (name: string) => new RegExp(`OP\\.${name}\\b(?!\\s*:)`).test(coreSrc.replace(opConst, ''));

  const receive = cache.gateway.receiveEvents.map((name) => {
    const evidence: string[] = [];
    let status: 'emitted' | 'partial' | 'defined-unused' | 'missing' = 'missing';
    const special: Record<string, string> = { HELLO: 'HELLO', RECONNECT: 'RECONNECT', INVALID_SESSION: 'INVALID_SESSION' };
    if (special[name]) {
      if (usedOp(special[name])) { status = 'emitted'; evidence.push(`OP.${special[name]} in core.ts`); }
    } else {
      const lit = new RegExp(`['"\`]${name}['"\`]`);
      for (const { f, src } of gwSrc) {
        if (f === eventsFile) continue;
        if (lit.test(src)) { status = 'emitted'; evidence.push(f); }
        for (const t of src.matchAll(/`([A-Z_]+_)\$\{/g)) {
          if (name.startsWith(t[1]) && new RegExp(`['"]${name.slice(t[1].length)}['"]`).test(src)) { status = 'emitted'; evidence.push(`${f} (template)`); }
        }
      }
      for (const e of emitters) {
        if (!lit.test(e.body)) continue;
        if (e.calls > 0) { status = 'emitted'; evidence.push(`${e.name}() ×${e.calls}`); }
        else if (status === 'missing') { status = 'defined-unused'; evidence.push(`${e.name}() has no callers`); }
      }
    }
    const intent = cache.gateway.intents.filter((i) => i.events.includes(name)).map((i) => i.name);
    const note = EVENT_GAPS[name];
    if (note && status === 'emitted') status = 'partial';
    return { event: name, status, intents: intent, evidence: [...new Set(evidence)], note: note ?? null };
  });

  const handledCases = new Set<number>();
  for (const m of coreSrc.matchAll(/case\s+OP\.(\w+)\s*:/g)) { const c = opByName.get(m[1]); if (c !== undefined) handledCases.add(c); }
  for (const m of coreSrc.matchAll(/case\s+(\d+)\s*:/g)) handledCases.add(Number(m[1]));
  const opcodes = cache.gateway.opcodes.map((o) => {
    const sends = /Send/.test(o.action);
    const receives = /Receive/.test(o.action);
    const name = [...opByName.entries()].find(([, c]) => c === o.code)?.[0];
    const handled = sends ? handledCases.has(o.code) : true;
    // Send/Receive (heartbeat): the server-initiated direction is optional, so handling it is enough.
    const emitted = receives && !sends ? (o.code === 0 ? /OP\.DISPATCH/.test(coreSrc) : !!name && usedOp(name)) : true;
    return { code: o.code, name: o.name, direction: o.action, status: (handled && emitted ? 'implemented' : 'missing') as Status };
  });

  const closeUsed = new Set<number>();
  // Named close codes: `CLOSE = { NAME: 4001, ... }` in src/lib/gateway/session.ts.
  const closeNames = new Map([...(/export const CLOSE = \{([\s\S]*?)\}/.exec(read('src/lib/gateway/session.ts') ?? '')?.[1] ?? '').matchAll(/(\w+):\s*(4\d{3})/g)].map((m) => [m[1], Number(m[2])]));
  for (const { f, src } of gwSrc) {
    if (!/gateway|server\.ts/.test(f)) continue;
    for (const m of src.matchAll(/close\(\s*(4\d{3})/g)) closeUsed.add(Number(m[1]));
    for (const m of src.matchAll(/(?:close\(|close:)\s*CLOSE\.(\w+)/g)) { const c = closeNames.get(m[1]); if (c) closeUsed.add(c); }
    for (const m of src.matchAll(/close\(\s*(CLOSE_DISALLOWED_INTENTS)/g)) if (m[1]) closeUsed.add(4014);
  }
  const closeCodes = cache.gateway.closeCodes.map((c) => ({ ...c, used: closeUsed.has(c.code) }));

  const serikaIntents = new Map([...(/export const Intents = \{([\s\S]*?)\}/.exec(evSrc)?.[1] ?? '').matchAll(/(\w+):\s*1\s*<<\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const intents = cache.gateway.intents.map((i) => ({ ...i, definedInSerika: serikaIntents.get(i.name) === i.bit }));

  // READY / IDENTIFY / GUILD_CREATE shapes.
  // READY: `this.dispatchTo(conn, 'READY', { ... })` (older code: `OP.DISPATCH, { ... }, { t: 'READY' }`).
  let readyKeys: string[] = [];
  const readyCall = coreSrc.search(/'READY',\s*\{/);
  const readyIdx = coreSrc.search(/t:\s*'READY'/);
  if (readyCall > 0) {
    const open = coreSrc.indexOf('{', readyCall);
    readyKeys = objectKeys(coreSrc.slice(open, matchBrace(coreSrc, open) + 1));
  } else if (readyIdx > 0) {
    const open = coreSrc.lastIndexOf('OP.DISPATCH, {', readyIdx) + 'OP.DISPATCH, '.length;
    readyKeys = objectKeys(coreSrc.slice(open, matchBrace(coreSrc, open) + 1));
  }
  // IDENTIFY fields: `d?.x` in core.ts or `p.x` in parseIdentify (session.ts).
  const sessionSrc = stripComments(read('src/lib/gateway/session.ts') ?? '');
  const parseIdx = sessionSrc.indexOf('export function parseIdentify');
  const parseOpen = parseIdx >= 0 ? sessionSrc.indexOf('{\n', parseIdx) : -1;
  const parseBody = parseOpen >= 0 ? sessionSrc.slice(parseOpen, matchBrace(sessionSrc, parseOpen) + 1) : '';
  const identifyRead = [...new Set([...coreSrc.matchAll(/\bd\?\.(\w+)/g), ...parseBody.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))];
  // GUILD_CREATE: the object buildGuildCreate returns (src/lib/gateway/guildPayload.ts).
  const gpSrc = stripComments(read('src/lib/gateway/guildPayload.ts') ?? '');
  const gpFn = gpSrc.indexOf('export async function buildGuildCreate');
  const gpRet = gpFn >= 0 ? gpSrc.indexOf('return {', gpFn) : -1;
  let guildCreateKeys: string[] = [];
  if (gpRet > 0) {
    const open = gpSrc.indexOf('{', gpRet);
    guildCreateKeys = objectKeys(gpSrc.slice(open, matchBrace(gpSrc, open) + 1));
    // `...toDiscordGuildBase(server)` spreads the top-level guild fields.
    const evAll = stripComments(read('src/lib/services/gatewayEvents.ts') ?? '');
    const baseIdx = evAll.indexOf('export function toDiscordGuildBase');
    if (baseIdx >= 0) {
      const bOpen = evAll.indexOf('return {', baseIdx) + 'return '.length;
      guildCreateKeys = [...new Set([...guildCreateKeys, ...objectKeys(evAll.slice(bOpen, matchBrace(evAll, bOpen) + 1))])];
    }
  } else {
    const devSrc = stripComments(read('src/lib/api/developers.ts'));
    const gcIdx = devSrc.indexOf('guildCreatePayload = {');
    guildCreateKeys = gcIdx > 0 ? objectKeys(devSrc.slice(devSrc.indexOf('{', gcIdx), matchBrace(devSrc, devSrc.indexOf('{', gcIdx)) + 1)) : [];
  }
  const st = cache.gateway.structures;
  const shapes = [
    shape('READY payload', 'src/lib/gateway/core.ts', readyKeys, st['Ready Event Fields'] ?? []),
    shape('IDENTIFY fields read', 'src/lib/gateway/core.ts', identifyRead, st['Identify Structure'] ?? []),
    shape('GUILD_CREATE (after READY + on install)', 'src/lib/gateway/guildPayload.ts', guildCreateKeys, [...(cache.objects.GuildResponse ?? []), ...(st['Guild Create Extra Fields'] ?? [])]),
  ];

  // ── Objects ──
  const libFiles = walk(join(ROOT, 'src/lib'));
  const pref = (first: string) => [join(ROOT, first), ...libFiles.filter((f) => f !== join(ROOT, first))];
  const OBJECT_CHECKS: Array<{ label: string; fn: string; first: string; schema: string }> = [
    { label: 'User (REST)', fn: 'formatUser', first: 'src/lib/api/botApi.ts', schema: 'UserResponse' },
    { label: 'User (gateway)', fn: 'toDiscordUser', first: eventsFile, schema: 'UserResponse' },
    // One serializer for both (src/lib/chat/discordMessage.ts, loaded by services/botMessages.ts).
    { label: 'Message (REST)', fn: 'serializeMessage', first: 'src/lib/chat/discordMessage.ts', schema: 'MessageResponse' },
    { label: 'Message (gateway)', fn: 'serializeMessage', first: 'src/lib/chat/discordMessage.ts', schema: 'MessageResponse' },
    { label: 'Guild channel', fn: 'formatChannel', first: 'src/lib/api/botApi.ts', schema: 'GuildChannelResponse' },
    { label: 'Guild', fn: 'formatGuild', first: 'src/lib/api/botApi.ts', schema: 'GuildResponse' },
    { label: 'Role', fn: 'formatRole', first: 'src/lib/api/botApi.ts', schema: 'GuildRoleResponse' },
    { label: 'Guild member', fn: 'formatMember', first: 'src/lib/api/botApi.ts', schema: 'GuildMemberResponse' },
    { label: 'Invite', fn: 'formatInvite', first: 'src/lib/api/botApi.ts', schema: 'GuildInviteResponse' },
  ];
  const objects = OBJECT_CHECKS.map((c) => {
    const found = serializerKeys(c.fn, pref(c.first));
    return { ...shape(c.label, found ? `${found.file}:${found.line} ${c.fn}()` : `${c.fn}() not found`, found?.keys ?? [], cache.objects[c.schema] ?? []), schema: c.schema };
  });

  // ── Features ──
  const features = FEATURES.map((f) => {
    const hits = probeFiles(f.files, f.exclude).filter((p) => f.re.test(stripComments(read(p))));
    const ok = f.invert ? hits.length === 0 : hits.length > 0;
    return { id: f.id, wp: f.wp, title: f.title, status: ok ? 'yes' : 'no', evidence: hits.map((h) => relative(ROOT, h)).slice(0, 4), inverted: !!f.invert };
  });

  return { rest, extras, receive, opcodes, closeCodes, intents, shapes, objects, features };
}

function shape(label: string, where: string, have: string[], spec: string[]) {
  const specSet = [...new Set(spec)];
  const present = specSet.filter((k) => have.includes(k));
  return {
    label, where,
    coverage: specSet.length ? Math.round((present.length / specSet.length) * 100) : 0,
    present, missing: specSet.filter((k) => !have.includes(k)), extra: have.filter((k) => !specSet.includes(k)),
  };
}

// ─── Reporting ──────────────────────────────────────────────

function pct(n: number, d: number) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

function summarize(a: ReturnType<typeof analyze>) {
  const live = a.rest.filter((r) => !r.deprecated);
  const count = (rows: typeof live) => {
    const impl = rows.filter((r) => r.status === 'implemented').length;
    const part = rows.filter((r) => r.status === 'partial').length;
    return {
      total: rows.length, implemented: impl, partial: part, missing: rows.length - impl - part,
      coverage: pct(impl + part * 0.5, rows.length), reachable: pct(impl + part, rows.length),
    };
  };
  const botUsable = live.filter((r) => r.auth.includes('bot') || r.auth.includes('public'));
  const areas = AREAS.map((ar) => ({ id: ar.id, title: ar.title, wp: ar.wp, ...count(live.filter((r) => r.area === ar.id)) })).filter((x) => x.total);
  const wps = Object.keys(WPS).map((wp) => ({ wp, title: WPS[wp], ...count(live.filter((r) => r.wp === wp)) })).filter((x) => x.total);
  const recv = a.receive;
  const gw = {
    receive_events: {
      total: recv.length,
      emitted: recv.filter((e) => e.status === 'emitted' || e.status === 'partial').length,
      partial: recv.filter((e) => e.status === 'partial').length,
      defined_unused: recv.filter((e) => e.status === 'defined-unused').length,
    },
    opcodes: { total: a.opcodes.length, implemented: a.opcodes.filter((o) => o.status === 'implemented').length },
    close_codes: { total: a.closeCodes.length, used: a.closeCodes.filter((c) => c.used).length },
    intents_defined: { total: a.intents.length, defined: a.intents.filter((i) => i.definedInSerika).length },
  };
  const features = { total: a.features.length, yes: a.features.filter((f) => f.status === 'yes').length };
  return { rest_all: count(live), rest_bot: count(botUsable), deprecated_total: a.rest.length - live.length, areas, wps, gateway: gw, features };
}

function renderMarkdown(cache: Cache, a: ReturnType<typeof analyze>, s: ReturnType<typeof summarize>): string {
  const L: string[] = [];
  const sp = cache.meta.spec;
  const dc = cache.meta.docs;
  L.push(MARK_START, '');
  L.push(`Generated from \`${sp.repo}@${sp.sha.slice(0, 7)}\` (${sp.date.slice(0, 10)}) and \`${dc.repo}@${dc.sha.slice(0, 7)}\` (${dc.date.slice(0, 10)}). Coverage counts a partial route as half; "reachable" counts it as whole. Deprecated routes (${s.deprecated_total}) are excluded.`, '');
  L.push('### Headline numbers', '');
  L.push('| Surface | Total | Implemented | Partial | Missing | Coverage | Reachable |', '|---|---:|---:|---:|---:|---:|---:|');
  const row = (n: string, c: { total: number; implemented: number; partial: number; missing: number; coverage: number; reachable: number }) =>
    L.push(`| ${n} | ${c.total} | ${c.implemented} | ${c.partial} | ${c.missing} | ${c.coverage}% | ${c.reachable}% |`);
  row('REST, every operation', s.rest_all);
  row('REST, bot-token usable', s.rest_bot);
  L.push('');
  const g = s.gateway;
  L.push(`Gateway: ${g.receive_events.emitted}/${g.receive_events.total} receive events emitted (${pct(g.receive_events.emitted, g.receive_events.total)}%; ${g.receive_events.partial} of them only from some code paths), ${g.receive_events.defined_unused} more have an emitter nobody calls; ${g.opcodes.implemented}/${g.opcodes.total} opcodes; ${g.close_codes.used}/${g.close_codes.total} close codes used; ${g.intents_defined.defined}/${g.intents_defined.total} intents defined. Protocol features: ${s.features.yes}/${s.features.total}.`, '');

  L.push('### REST coverage by area', '');
  L.push('| Area | WP | Total | Impl. | Partial | Missing | Coverage |', '|---|---|---:|---:|---:|---:|---:|');
  for (const ar of s.areas) L.push(`| ${ar.title} | ${ar.wp} | ${ar.total} | ${ar.implemented} | ${ar.partial} | ${ar.missing} | ${ar.coverage}% |`);
  L.push('');
  L.push('### REST coverage by work package', '');
  L.push('| WP | Scope | Total | Impl. | Partial | Missing | Coverage |', '|---|---|---:|---:|---:|---:|---:|');
  for (const w of s.wps) L.push(`| ${w.wp} | ${w.title} | ${w.total} | ${w.implemented} | ${w.partial} | ${w.missing} | ${w.coverage}% |`);
  L.push('');

  L.push('### Protocol features', '');
  L.push('| WP | Feature | Status | Evidence |', '|---|---|---|---|');
  for (const f of a.features) L.push(`| ${f.wp} | ${f.title} | ${f.status === 'yes' ? 'yes' : '**no**'} | ${f.inverted ? (f.evidence.length ? `broken pattern in ${f.evidence.join(', ')}` : 'broken pattern gone') : f.evidence.join(', ') || '-'} |`);
  L.push('');

  L.push('### Object shapes (top-level fields vs the OpenAPI schema)', '');
  L.push('| Object | Schema | Coverage | Missing fields | Source |', '|---|---|---:|---|---|');
  for (const o of a.objects) L.push(`| ${o.label} | ${o.schema} | ${o.coverage}% | ${o.missing.join(', ') || '-'} | ${o.where} |`);
  for (const o of a.shapes) L.push(`| ${o.label} | gateway docs | ${o.coverage}% | ${o.missing.join(', ') || '-'} | ${o.where} |`);
  L.push('');

  L.push('### Gateway receive events', '');
  L.push('| Event | Intent | Status | Evidence / gap |', '|---|---|---|---|');
  const evLabel = { emitted: 'emitted', partial: 'partial', 'defined-unused': '**emitter unused**', missing: '**missing**' } as const;
  for (const e of a.receive) L.push(`| ${e.event} | ${e.intents.join(', ') || '-'} | ${evLabel[e.status]} | ${[e.evidence.join(', '), e.note].filter(Boolean).join('; ') || '-'} |`);
  L.push('');
  L.push('### Gateway opcodes and close codes', '');
  L.push('| Op | Name | Direction | Status |', '|---:|---|---|---|');
  for (const o of a.opcodes) L.push(`| ${o.code} | ${o.name} | ${o.direction} | ${o.status === 'implemented' ? 'yes' : '**no**'} |`);
  L.push('');
  L.push(`Close codes used: ${a.closeCodes.filter((c) => c.used).map((c) => c.code).join(', ') || 'none'}. Never sent: ${a.closeCodes.filter((c) => !c.used).map((c) => `${c.code} ${c.description}`).join('; ')}.`, '');
  L.push(`Intents missing from \`Intents\` in gatewayEvents.ts: ${a.intents.filter((i) => !i.definedInSerika).map((i) => `${i.name} (1<<${i.bit})`).join(', ') || 'none'}.`, '');

  L.push('### REST operations', '');
  for (const ar of s.areas) {
    L.push(`<details><summary><b>${ar.title}</b> (${ar.wp}): ${ar.implemented} implemented, ${ar.partial} partial, ${ar.missing} missing</summary>`, '');
    L.push('| Status | Method | Path | Serika | Notes |', '|---|---|---|---|---|');
    for (const r of a.rest.filter((x) => x.area === ar.id && !x.deprecated)) {
      const st = r.status === 'implemented' ? 'ok' : r.status === 'partial' ? 'partial' : '**missing**';
      const loc = r.serika ? `${r.serika.file}:${r.serika.line}` : '';
      const params: string[] = [];
      if (r.serika && r.query.spec.length) params.push(`query ${r.query.used.length}/${r.query.spec.length}`);
      if (r.serika && r.body.spec.length) params.push(`body ${r.body.used.length}/${r.body.spec.length}`);
      const notes = [...params, ...r.notes].join('; ').replace(/\|/g, '\\|');
      L.push(`| ${st} | ${r.method} | \`${r.path}\` | ${loc} | ${notes} |`);
    }
    L.push('', '</details>', '');
  }
  if (a.extras.length) {
    L.push('### SerikaCord /api/v10 routes with no Discord counterpart', '');
    for (const x of a.extras) L.push(`- \`${x.method} ${x.path}\` (${x.file}:${x.line})`);
    L.push('');
  }
  L.push(MARK_END);
  return L.join('\n');
}

const DEFAULT_MD_HEAD = `# Discord API v10 parity

The tables below are generated by \`bun scripts/discord-parity.ts\`. Edit the
hand-written sections outside the generated block.

`;

async function main() {
  const cache: Cache = args.has('--refresh') || !existsSync(CACHE) ? await refresh() : JSON.parse(read(CACHE));
  const a = analyze(cache);
  const s = summarize(a);

  const short = [
    `REST (all, non-deprecated): ${s.rest_all.implemented} implemented + ${s.rest_all.partial} partial of ${s.rest_all.total} → coverage ${s.rest_all.coverage}%`,
    `REST (bot-usable):          ${s.rest_bot.implemented} implemented + ${s.rest_bot.partial} partial of ${s.rest_bot.total} → coverage ${s.rest_bot.coverage}%`,
    `Gateway receive events:     ${s.gateway.receive_events.emitted}/${s.gateway.receive_events.total} emitted (${s.gateway.receive_events.partial} partial, ${s.gateway.receive_events.defined_unused} emitter(s) unused)`,
    `Gateway opcodes:            ${s.gateway.opcodes.implemented}/${s.gateway.opcodes.total}`,
    `Protocol features:          ${s.features.yes}/${s.features.total}`,
    '',
    ...s.areas.map((ar) => `  ${ar.wp} ${ar.title.padEnd(78)} ${String(ar.coverage).padStart(5)}%  (${ar.implemented}/${ar.partial}/${ar.missing})`),
  ].join('\n');
  console.log(short);

  const json = {
    $comment: 'Generated by scripts/discord-parity.ts. Do not edit by hand.',
    sources: cache.meta,
    summary: s,
    rest: a.rest,
    serika_only_routes: a.extras,
    gateway: { receive_events: a.receive, opcodes: a.opcodes, close_codes: a.closeCodes, intents: a.intents, shapes: a.shapes },
    objects: a.objects,
    features: a.features,
  };

  if (args.has('--check')) {
    if (!existsSync(OUT_JSON)) { console.error('No committed baseline to check against.'); process.exit(1); }
    const base = JSON.parse(read(OUT_JSON)).summary;
    const drops: string[] = [];
    if (s.rest_all.coverage < base.rest_all.coverage) drops.push(`REST coverage ${base.rest_all.coverage}% → ${s.rest_all.coverage}%`);
    if (s.gateway.receive_events.emitted < base.gateway.receive_events.emitted) drops.push('gateway events emitted dropped');
    if (s.features.yes < base.features.yes) drops.push(`features ${base.features.yes} → ${s.features.yes}`);
    if (drops.length) { console.error(`Parity regression: ${drops.join('; ')}`); process.exit(1); }
    console.log('No parity regression against the committed baseline.');
    return;
  }
  if (args.has("--stdout")) { if (process.env.PARITY_DUMP) writeFileSync(process.env.PARITY_DUMP, JSON.stringify(json, null, 1)); return; }

  writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 1)}\n`);
  const block = renderMarkdown(cache, a, s);
  const existing = existsSync(OUT_MD) ? read(OUT_MD) : DEFAULT_MD_HEAD + MARK_START + '\n' + MARK_END + '\n';
  const start = existing.indexOf(MARK_START);
  const end = existing.indexOf(MARK_END);
  const next = start >= 0 && end > start
    ? existing.slice(0, start) + block + existing.slice(end + MARK_END.length)
    : `${existing.trimEnd()}\n\n${block}\n`;
  writeFileSync(OUT_MD, next);
  console.log(`\nWrote ${relative(ROOT, OUT_JSON)} and the generated block of ${relative(ROOT, OUT_MD)}`);
}

await main();
