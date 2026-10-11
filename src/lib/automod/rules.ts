// AutoMod (Discord-style) pure rules: rule shape + validation, keyword
// wildcard matching with allow lists, mention spam, suspected spam and link /
// invite detection, and the Discord v10 wire shapes for bots. No DB, no
// network: the server side lives in src/lib/services/automod.ts, the routes
// in src/lib/api/automod.ts and the settings UI in
// src/components/dialogs/ServerAutoModPanel.tsx.

export type AutoModTriggerType = 'keyword' | 'spam' | 'mention_spam' | 'links';

export const AUTOMOD_TRIGGER_TYPES: readonly AutoModTriggerType[] = ['keyword', 'spam', 'mention_spam', 'links'];

export interface AutoModTriggerMetadata {
  /** keyword: words / phrases to block, with `*` wildcards. */
  keywordFilter?: string[];
  /** keyword: words that never trigger the rule, same wildcard syntax. */
  allowList?: string[];
  /** mention_spam: unique user + role mentions allowed in one message. */
  mentionTotalLimit?: number;
  /** links: only block invite links (to this or other chat platforms). */
  invitesOnly?: boolean;
  /** links: domains that are always allowed (subdomains included). */
  allowedDomains?: string[];
}

export type AutoModAction =
  | { type: 'block_message'; customMessage?: string | null }
  | { type: 'send_alert'; channelId: string }
  | { type: 'timeout'; durationSeconds: number };

export type AutoModActionType = AutoModAction['type'];

export interface AutoModRule {
  id: string;
  serverId: string;
  name: string;
  creatorId: string | null;
  enabled: boolean;
  triggerType: AutoModTriggerType;
  triggerMetadata: AutoModTriggerMetadata;
  actions: AutoModAction[];
  exemptRoles: string[];
  exemptChannels: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** The editable part of a rule (what the settings UI / API sends). */
export type AutoModRuleInput = Pick<
  AutoModRule,
  'name' | 'enabled' | 'triggerType' | 'triggerMetadata' | 'actions' | 'exemptRoles' | 'exemptChannels'
>;

// ─── Limits (Discord's, where Discord has one) ────────────────────────────────
export const AUTOMOD_LIMITS = {
  nameLength: 100,
  keywordCount: 1000,
  keywordLength: 60,
  allowListCount: 100,
  allowListLength: 60,
  allowedDomainCount: 100,
  customMessageLength: 150,
  mentionLimitMin: 1,
  mentionLimitMax: 50,
  timeoutMaxSeconds: 28 * 24 * 60 * 60,
  exemptRoles: 20,
  exemptChannels: 50,
  /** Rules per server, per trigger type. */
  perType: { keyword: 6, spam: 1, mention_spam: 1, links: 1 } as Record<AutoModTriggerType, number>,
} as const;

/** Timeout lengths offered in the UI (seconds), like Discord's picker. */
export const AUTOMOD_TIMEOUT_CHOICES = [60, 300, 600, 3600, 86_400, 604_800] as const;

/** Discord's JSON error code for "Message was blocked by automatic moderation". */
export const AUTOMOD_BLOCK_CODE = 200000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Validation ───────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function cleanList(raw: unknown, max: number, maxLen: number, transform: (s: string) => string = (s) => s): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const v = transform(item.trim()).slice(0, maxLen).trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function cleanIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const id of raw) {
    if (typeof id === 'string' && UUID_RE.test(id)) out.add(id.toLowerCase());
    if (out.size >= max) break;
  }
  return [...out];
}

/** A domain as typed ("https://www.Example.com/path") -> "example.com", or "" when not a domain. */
export function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  s = s.replace(/^\*\./, '').replace(/^www\./, '').replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

function cleanActions(raw: unknown, triggerType: AutoModTriggerType): Result<AutoModAction[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'A rule needs at least one action' };
  const out: AutoModAction[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const type = (a as { type?: unknown }).type;
    if (typeof type !== 'string' || seen.has(type)) continue;
    if (type === 'block_message') {
      const msg = (a as { customMessage?: unknown }).customMessage;
      const customMessage = typeof msg === 'string' ? msg.trim().slice(0, AUTOMOD_LIMITS.customMessageLength) : '';
      out.push({ type, customMessage: customMessage || null });
    } else if (type === 'send_alert') {
      const channelId = (a as { channelId?: unknown }).channelId;
      if (typeof channelId !== 'string' || !UUID_RE.test(channelId)) return { ok: false, error: 'Pick a channel for alerts' };
      out.push({ type, channelId: channelId.toLowerCase() });
    } else if (type === 'timeout') {
      if (triggerType === 'spam') return { ok: false, error: 'Timeout is not available for the spam filter' };
      const seconds = Math.floor(Number((a as { durationSeconds?: unknown }).durationSeconds));
      if (!Number.isFinite(seconds) || seconds < 1) return { ok: false, error: 'Pick a timeout length' };
      out.push({ type, durationSeconds: Math.min(seconds, AUTOMOD_LIMITS.timeoutMaxSeconds) });
    } else {
      continue;
    }
    seen.add(type);
  }
  if (out.length === 0) return { ok: false, error: 'A rule needs at least one action' };
  return { ok: true, value: out };
}

function cleanMetadata(raw: unknown, triggerType: AutoModTriggerType): Result<AutoModTriggerMetadata> {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (triggerType) {
    case 'keyword': {
      const keywordFilter = cleanList(m.keywordFilter, AUTOMOD_LIMITS.keywordCount, AUTOMOD_LIMITS.keywordLength, (s) => s.toLowerCase())
        .filter((k) => k.replace(/\*/g, '').trim().length > 0);
      const allowList = cleanList(m.allowList, AUTOMOD_LIMITS.allowListCount, AUTOMOD_LIMITS.allowListLength, (s) => s.toLowerCase())
        .filter((k) => k.replace(/\*/g, '').trim().length > 0);
      if (keywordFilter.length === 0) return { ok: false, error: 'Add at least one keyword' };
      return { ok: true, value: { keywordFilter, allowList } };
    }
    case 'mention_spam': {
      const n = Math.floor(Number(m.mentionTotalLimit));
      if (!Number.isFinite(n) || n < AUTOMOD_LIMITS.mentionLimitMin || n > AUTOMOD_LIMITS.mentionLimitMax) {
        return { ok: false, error: `Mention limit must be between ${AUTOMOD_LIMITS.mentionLimitMin} and ${AUTOMOD_LIMITS.mentionLimitMax}` };
      }
      return { ok: true, value: { mentionTotalLimit: n } };
    }
    case 'links': {
      const allowedDomains = cleanList(m.allowedDomains, AUTOMOD_LIMITS.allowedDomainCount, 253, normalizeDomain);
      return { ok: true, value: { invitesOnly: m.invitesOnly === true, allowedDomains } };
    }
    case 'spam':
    default:
      return { ok: true, value: {} };
  }
}

export function isAutoModTriggerType(v: unknown): v is AutoModTriggerType {
  return typeof v === 'string' && (AUTOMOD_TRIGGER_TYPES as readonly string[]).includes(v);
}

/**
 * Validates and cleans a rule from the API. With `existing`, fields left out
 * of `raw` keep their stored value (PATCH); the trigger type never changes
 * after creation (Discord).
 */
export function normalizeRuleInput(raw: unknown, existing?: AutoModRuleInput | null): Result<AutoModRuleInput> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const triggerType = existing ? existing.triggerType : r.triggerType;
  if (!isAutoModTriggerType(triggerType)) return { ok: false, error: 'Unknown trigger type' };

  const nameRaw = r.name !== undefined ? r.name : existing?.name;
  const name = typeof nameRaw === 'string' ? nameRaw.trim().slice(0, AUTOMOD_LIMITS.nameLength) : '';
  if (!name) return { ok: false, error: 'Rule name is required' };

  const meta = cleanMetadata(r.triggerMetadata !== undefined ? r.triggerMetadata : existing?.triggerMetadata, triggerType);
  if (!meta.ok) return meta;
  const actions = cleanActions(r.actions !== undefined ? r.actions : existing?.actions, triggerType);
  if (!actions.ok) return actions;

  const enabled = r.enabled !== undefined ? r.enabled === true : existing ? existing.enabled : true;
  const exemptRoles = cleanIds(r.exemptRoles !== undefined ? r.exemptRoles : existing?.exemptRoles, AUTOMOD_LIMITS.exemptRoles);
  const exemptChannels = cleanIds(r.exemptChannels !== undefined ? r.exemptChannels : existing?.exemptChannels, AUTOMOD_LIMITS.exemptChannels);

  return {
    ok: true,
    value: { name, enabled, triggerType, triggerMetadata: meta.value, actions: actions.value, exemptRoles, exemptChannels },
  };
}

// ─── Keyword matching ─────────────────────────────────────────────────────────
// Discord semantics: `cat` matches the whole word only, `cat*` words starting
// with it, `*cat` words ending with it, `*cat*` anywhere inside a word. Spaces
// inside a keyword match a phrase. Case-insensitive.

const WORD = '[\\p{L}\\p{N}_]';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The regex body for one wildcard keyword (no flags, no anchors). */
function keywordBody(keyword: string): string | null {
  const k = keyword.trim().toLowerCase();
  const leading = k.startsWith('*');
  const trailing = k.endsWith('*') && k.length > 1;
  const core = k.replace(/^\*+/, '').replace(/\*+$/, '');
  if (!core) return null;
  const coreRe = core.split(/\*+/).map((part) => escapeRe(part).replace(/\s+/g, '\\s+')).join(`${WORD}*`);
  const start = leading ? `${WORD}*` : `(?<!${WORD})`;
  const end = trailing ? `${WORD}*` : `(?!${WORD})`;
  return `${start}${coreRe}${end}`;
}

const compiledCache = new Map<string, RegExp | null>();

function compileKeyword(keyword: string, anchored: boolean): RegExp | null {
  const key = `${anchored ? 'a' : 'g'}:${keyword}`;
  if (compiledCache.has(key)) return compiledCache.get(key) ?? null;
  const body = keywordBody(keyword);
  let re: RegExp | null = null;
  if (body) {
    try {
      re = anchored ? new RegExp(`^(?:${body})$`, 'iu') : new RegExp(body, 'giu');
    } catch {
      re = null;
    }
  }
  if (compiledCache.size > 5000) compiledCache.clear();
  compiledCache.set(key, re);
  return re;
}

/** Whether a matched piece of text is covered by an allow-list entry. */
function isAllowed(matched: string, allowList: string[] | undefined): boolean {
  if (!allowList?.length) return false;
  const text = matched.trim().toLowerCase();
  return allowList.some((entry) => compileKeyword(entry, true)?.test(text) ?? false);
}

/** The first keyword (and the text it matched) found in `content`, honouring the allow list. */
export function matchKeywords(
  content: string,
  keywords: string[] | undefined,
  allowList?: string[],
): { keyword: string; matchedContent: string } | null {
  if (!content || !keywords?.length) return null;
  for (const keyword of keywords) {
    const re = compileKeyword(keyword, false);
    if (!re) continue;
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      const matched = m[0];
      if (!matched) continue;
      if (isAllowed(matched, allowList)) continue;
      return { keyword, matchedContent: matched };
    }
  }
  return null;
}

// ─── Mentions ─────────────────────────────────────────────────────────────────
const MENTION_RE = /<@(!|&)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

/** Unique user + role mentions in raw message text (Discord's mention_total_limit count). */
export function countUniqueMentions(content: string): number {
  if (!content) return 0;
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    seen.add(`${m[1] === '&' ? 'r' : 'u'}:${m[2].toLowerCase()}`);
  }
  return seen.size;
}

// ─── Links / invites ──────────────────────────────────────────────────────────
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const BARE_INVITE_RE = /\b(?:discord\.gg|discord(?:app)?\.com\/invite|serika\.chat\/invite|dsc\.gg|guilded\.gg|t\.me|chat\.whatsapp\.com)\/[A-Za-z0-9_-]+/gi;
const INVITE_URL_RE = /^(?:discord\.gg|dsc\.gg|guilded\.gg|t\.me|chat\.whatsapp\.com)\/|\/invite\//i;

function hostOf(url: string): string {
  const stripped = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return normalizeDomain(stripped.split(/[/?#]/)[0] ?? '');
}

function domainAllowed(host: string, allowed: string[] | undefined): boolean {
  if (!host || !allowed?.length) return false;
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The first blocked link in `content`, or null. */
export function findBlockedLink(content: string, meta: AutoModTriggerMetadata): string | null {
  if (!content) return null;
  const candidates: string[] = [];
  for (const m of content.matchAll(URL_RE)) candidates.push(m[0]);
  for (const m of content.matchAll(BARE_INVITE_RE)) candidates.push(m[0]);
  for (const raw of candidates) {
    const url = raw.replace(/[),.!?;:]+$/, '');
    const host = hostOf(url);
    if (domainAllowed(host, meta.allowedDomains)) continue;
    if (meta.invitesOnly) {
      const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
      if (!INVITE_URL_RE.test(path)) continue;
    }
    return url;
  }
  return null;
}

// ─── Suspected spam ───────────────────────────────────────────────────────────
export interface RecentMessage {
  content: string;
  at: number;
}

/** Whitespace / case / punctuation-insensitive fingerprint for repeat detection. */
export function spamFingerprint(content: string): string {
  return content.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export const SPAM_REPEAT_WINDOW_MS = 2 * 60_000;

/**
 * Heuristic "suspected spam" check: the same text sent three times within two
 * minutes, a wall of one repeated character / word / line, or a flood of empty
 * lines. Deliberately conservative so normal chatter never trips it.
 */
export function looksLikeSpam(content: string, recent: RecentMessage[] = [], now = Date.now()): string | null {
  const text = content.trim();
  if (!text) return null;
  const fp = spamFingerprint(text);
  if (fp.length >= 2) {
    const repeats = recent.filter((r) => now - r.at <= SPAM_REPEAT_WINDOW_MS && spamFingerprint(r.content) === fp).length;
    if (repeats >= 2) return 'repeated message';
  }
  const compact = text.replace(/\s+/g, '');
  if (compact.length >= 40) {
    const counts = new Map<string, number>();
    for (const ch of compact) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const top = Math.max(...counts.values());
    if (top / compact.length >= 0.9) return 'repeated characters';
  }
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 15) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const top = Math.max(...counts.values());
    if (top / words.length >= 0.8) return 'repeated words';
  }
  const lines = content.split('\n');
  if (lines.length >= 8) {
    const nonEmpty = lines.map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (nonEmpty.length >= 8 && new Set(nonEmpty).size === 1) return 'repeated lines';
    if (lines.length >= 30 && nonEmpty.length / lines.length < 0.2) return 'empty lines';
  }
  return null;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────
export interface AutoModContext {
  content: string;
  channelId: string;
  /** For threads and forum posts: the parent channel (its exemption applies too). */
  parentChannelId?: string | null;
  memberRoleIds: string[];
  /** The author's recent messages in this channel (spam filter only). */
  recentMessages?: RecentMessage[];
  now?: number;
}

export interface AutoModMatch {
  rule: AutoModRule;
  /** The keyword / reason that matched (Discord's matched_keyword). */
  keyword: string | null;
  /** The text that matched (Discord's matched_content). */
  matchedContent: string | null;
}

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase();

export function isRuleExempt(rule: AutoModRule, ctx: Pick<AutoModContext, 'channelId' | 'parentChannelId' | 'memberRoleIds'>): boolean {
  const channels = new Set(rule.exemptChannels.map(lower));
  if (channels.has(lower(ctx.channelId)) || (ctx.parentChannelId && channels.has(lower(ctx.parentChannelId)))) return true;
  const roles = new Set(rule.exemptRoles.map(lower));
  return ctx.memberRoleIds.some((r) => roles.has(lower(r)));
}

export function ruleNeedsRecentMessages(rules: AutoModRule[]): boolean {
  return rules.some((r) => r.enabled && r.triggerType === 'spam');
}

/** Every enabled, non-exempt rule the content trips, in rule order. */
export function evaluateAutoMod(rules: AutoModRule[], ctx: AutoModContext): AutoModMatch[] {
  const matches: AutoModMatch[] = [];
  const content = ctx.content ?? '';
  if (!content.trim()) return matches;
  for (const rule of rules) {
    if (!rule.enabled || isRuleExempt(rule, ctx)) continue;
    const meta = rule.triggerMetadata || {};
    switch (rule.triggerType) {
      case 'keyword': {
        const hit = matchKeywords(content, meta.keywordFilter, meta.allowList);
        if (hit) matches.push({ rule, keyword: hit.keyword, matchedContent: hit.matchedContent });
        break;
      }
      case 'mention_spam': {
        const limit = meta.mentionTotalLimit ?? 0;
        if (limit > 0 && countUniqueMentions(content) > limit) {
          matches.push({ rule, keyword: null, matchedContent: null });
        }
        break;
      }
      case 'links': {
        const link = findBlockedLink(content, meta);
        if (link) matches.push({ rule, keyword: link, matchedContent: link });
        break;
      }
      case 'spam': {
        const reason = looksLikeSpam(content, ctx.recentMessages ?? [], ctx.now);
        if (reason) matches.push({ rule, keyword: null, matchedContent: null });
        break;
      }
    }
  }
  return matches;
}

/** What to tell the sender when a message is blocked: the first custom response, if any. */
export function blockResponse(matches: AutoModMatch[]): { blocked: boolean; customMessage: string | null; rule: AutoModRule | null } {
  for (const m of matches) {
    const block = m.rule.actions.find((a) => a.type === 'block_message');
    if (block) {
      const custom = matches
        .map((x) => x.rule.actions.find((a) => a.type === 'block_message'))
        .find((a): a is { type: 'block_message'; customMessage?: string | null } => !!a && !!a.customMessage);
      return { blocked: true, customMessage: custom?.customMessage ?? null, rule: m.rule };
    }
  }
  return { blocked: false, customMessage: null, rule: null };
}

// ─── Discord v10 wire shapes ──────────────────────────────────────────────────
export const DISCORD_TRIGGER_TYPE: Record<AutoModTriggerType, number> = {
  keyword: 1,
  links: 1,
  spam: 3,
  mention_spam: 5,
};

export const DISCORD_ACTION_TYPE: Record<AutoModActionType, number> = {
  block_message: 1,
  send_alert: 2,
  timeout: 3,
};

export function toDiscordAction(a: AutoModAction) {
  switch (a.type) {
    case 'block_message':
      return { type: 1, metadata: a.customMessage ? { custom_message: a.customMessage } : {} };
    case 'send_alert':
      return { type: 2, metadata: { channel_id: a.channelId } };
    case 'timeout':
      return { type: 3, metadata: { duration_seconds: a.durationSeconds } };
  }
}

export function toDiscordRule(rule: AutoModRule) {
  const meta = rule.triggerMetadata || {};
  const trigger_metadata: Record<string, unknown> = {};
  if (rule.triggerType === 'keyword') {
    trigger_metadata.keyword_filter = meta.keywordFilter ?? [];
    trigger_metadata.regex_patterns = [];
    trigger_metadata.allow_list = meta.allowList ?? [];
  } else if (rule.triggerType === 'mention_spam') {
    trigger_metadata.mention_total_limit = meta.mentionTotalLimit ?? 0;
    trigger_metadata.mention_raid_protection_enabled = false;
  } else if (rule.triggerType === 'links') {
    trigger_metadata.keyword_filter = [];
    trigger_metadata.allow_list = meta.allowedDomains ?? [];
  }
  return {
    id: rule.id,
    guild_id: rule.serverId,
    name: rule.name,
    creator_id: rule.creatorId,
    event_type: 1,
    trigger_type: DISCORD_TRIGGER_TYPE[rule.triggerType],
    trigger_metadata,
    actions: rule.actions.map(toDiscordAction),
    enabled: rule.enabled,
    exempt_roles: rule.exemptRoles,
    exempt_channels: rule.exemptChannels,
  };
}

/** Counts rules per trigger type, to enforce AUTOMOD_LIMITS.perType. */
export function canAddRule(existing: Pick<AutoModRule, 'triggerType'>[], type: AutoModTriggerType): boolean {
  return existing.filter((r) => r.triggerType === type).length < AUTOMOD_LIMITS.perType[type];
}
