// Discord's Welcome Screen, Rules Screening and Server Templates as pure rules
// (no DB). The routes in src/lib/api/community.ts and the services in
// src/lib/services/serverCommunity.ts / serverTemplates.ts use them, and the
// tests in tests/server-community.test.ts pin them down.
import { normalizeWelcomeEmoji, type ServerEmojiLookup } from '@/lib/servers/communityEmoji';

// ─── Welcome screen ───────────────────────────────────────────────────────────

export const WELCOME_DESCRIPTION_MAX = 140;
export const WELCOME_CHANNEL_DESCRIPTION_MAX = 50;
export const WELCOME_CHANNELS_MAX = 5;

export interface WelcomeChannel {
  channelId: string;
  description: string;
  /** Unicode emoji, or a custom emoji's name when emojiId is set. */
  emojiName: string | null;
  /** One of the server's custom emojis. */
  emojiId: string | null;
}

export interface WelcomeScreen {
  enabled: boolean;
  description: string;
  welcomeChannels: WelcomeChannel[];
}

export const EMPTY_WELCOME_SCREEN: WelcomeScreen = { enabled: false, description: '', welcomeChannels: [] };

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function multiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/**
 * Normalizes a stored or submitted welcome screen. With `validChannelIds`,
 * recommended channels that no longer exist (or aren't eligible) are dropped.
 * Duplicates are removed and at most 5 kept, as on Discord. With `emojis` (on
 * save), a custom emoji must be one of the server's own (CORD-71).
 */
export function normalizeWelcomeScreen(input: unknown, validChannelIds?: ReadonlySet<string>, emojis?: ServerEmojiLookup): WelcomeScreen {
  if (!input || typeof input !== 'object') return { ...EMPTY_WELCOME_SCREEN, welcomeChannels: [] };
  const raw = input as Record<string, unknown>;
  const seen = new Set<string>();
  const channels: WelcomeChannel[] = [];
  const list = Array.isArray(raw.welcomeChannels) ? raw.welcomeChannels : Array.isArray(raw.welcome_channels) ? raw.welcome_channels : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const channelId = typeof e.channelId === 'string' ? e.channelId : typeof e.channel_id === 'string' ? e.channel_id : '';
    if (!channelId || seen.has(channelId)) continue;
    if (validChannelIds && !validChannelIds.has(channelId)) continue;
    seen.add(channelId);
    const emoji = normalizeWelcomeEmoji(e.emojiId ?? e.emoji_id, e.emojiName ?? e.emoji_name, emojis);
    channels.push({
      channelId,
      description: str(e.description, WELCOME_CHANNEL_DESCRIPTION_MAX),
      emojiName: emoji.emojiName,
      emojiId: emoji.emojiId,
    });
    if (channels.length >= WELCOME_CHANNELS_MAX) break;
  }
  return {
    enabled: raw.enabled === true,
    description: str(raw.description, WELCOME_DESCRIPTION_MAX),
    welcomeChannels: channels,
  };
}

/** The welcome screen is only shown when it is on and has something to show. */
export function isWelcomeScreenVisible(screen: WelcomeScreen): boolean {
  return screen.enabled && (screen.description.length > 0 || screen.welcomeChannels.length > 0);
}

/** Channel types a welcome screen may recommend (Discord: text-like channels). */
export const WELCOME_CHANNEL_TYPES = new Set(['text', 'announcement', 'forum', 'voice', 'stage']);

// ─── Rules screening ──────────────────────────────────────────────────────────

export const SCREENING_DESCRIPTION_MAX = 300;
export const SCREENING_RULE_MAX = 300;
export const SCREENING_RULES_MAX = 16;

export const APPLICATION_QUESTIONS_MAX = 5;
export const APPLICATION_LABEL_MAX = 150;
export const APPLICATION_CHOICES_MAX = 8;
export const APPLICATION_CHOICE_MAX = 80;
export const APPLICATION_SHORT_MAX = 150;
export const APPLICATION_PARAGRAPH_MAX = 1000;
export const ACCESSIBLE_CHANNELS_MAX = 25;

export type ApplicationQuestionType = 'short' | 'paragraph' | 'choice';

/** A question asked with the rules when manual approval is on (Discord's membership screening fields). */
export interface ApplicationQuestion {
  id: string;
  type: ApplicationQuestionType;
  label: string;
  required: boolean;
  /** `choice` only. */
  choices: string[];
}

export interface ScreeningConfig {
  enabled: boolean;
  description: string;
  rules: string[];
  /** Pending members only see `accessibleChannelIds` (and their children) until they're let in. */
  restrictChannels: boolean;
  /** Channels or categories readable before accepting the rules. */
  accessibleChannelIds: string[];
  /** Submitting the rules queues an application a moderator must approve. */
  manualApproval: boolean;
  questions: ApplicationQuestion[];
}

export const EMPTY_SCREENING: ScreeningConfig = {
  enabled: false,
  description: '',
  rules: [],
  restrictChannels: false,
  accessibleChannelIds: [],
  manualApproval: false,
  questions: [],
};

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** A client-supplied stable id, or a positional fallback. */
export function stableId(value: unknown, fallback: string): string {
  return typeof value === 'string' && ID_RE.test(value) ? value : fallback;
}

export function normalizeApplicationQuestions(input: unknown): ApplicationQuestion[] {
  const out: ApplicationQuestion[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of (Array.isArray(input) ? input : []).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = str(e.label, APPLICATION_LABEL_MAX);
    if (!label) continue;
    let id = stableId(e.id, `q${i}`);
    if (seen.has(id)) id = `q${i}_${out.length}`;
    seen.add(id);
    const type: ApplicationQuestionType = e.type === 'paragraph' || e.type === 'choice' ? e.type : 'short';
    const choices = type === 'choice'
      ? [...new Set((Array.isArray(e.choices) ? e.choices : []).map((c) => str(c, APPLICATION_CHOICE_MAX)).filter(Boolean))].slice(0, APPLICATION_CHOICES_MAX)
      : [];
    // A multiple-choice question needs at least two answers to pick from.
    if (type === 'choice' && choices.length < 2) continue;
    out.push({ id, type, label, required: e.required !== false, choices });
    if (out.length >= APPLICATION_QUESTIONS_MAX) break;
  }
  return out;
}

export function normalizeScreeningConfig(input: unknown, validChannelIds?: ReadonlySet<string>): ScreeningConfig {
  if (!input || typeof input !== 'object') return { ...EMPTY_SCREENING, rules: [], accessibleChannelIds: [], questions: [] };
  const raw = input as Record<string, unknown>;
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .map((r) => multiline(r, SCREENING_RULE_MAX))
    .filter((r) => r.length > 0)
    .slice(0, SCREENING_RULES_MAX);
  const accessibleChannelIds = [...new Set((Array.isArray(raw.accessibleChannelIds) ? raw.accessibleChannelIds : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
    .filter((id) => !validChannelIds || validChannelIds.has(id)))]
    .slice(0, ACCESSIBLE_CHANNELS_MAX);
  // Screening without a single rule would gate members behind nothing.
  return {
    enabled: raw.enabled === true && rules.length > 0,
    description: multiline(raw.description, SCREENING_DESCRIPTION_MAX),
    rules,
    restrictChannels: raw.restrictChannels === true,
    accessibleChannelIds,
    manualApproval: raw.manualApproval === true,
    questions: normalizeApplicationQuestions(raw.questions),
  };
}

export interface ApplicationAnswer {
  questionId: string;
  question: string;
  answer: string;
}

/**
 * Validates answers against the questions: required ones must be filled,
 * choices must be one of the options, text is trimmed to the field's limit.
 * Returns the answers in question order (with the label snapshotted, so an
 * edited question doesn't rewrite old applications) or an error.
 */
export function validateApplicationAnswers(
  questions: readonly ApplicationQuestion[],
  input: unknown,
): { answers: ApplicationAnswer[] } | { error: string; questionId: string } {
  const byId = new Map<string, unknown>();
  for (const entry of Array.isArray(input) ? input : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.questionId === 'string') byId.set(e.questionId, e.answer ?? e.value);
  }
  const answers: ApplicationAnswer[] = [];
  for (const q of questions) {
    const rawAnswer = byId.get(q.id);
    let answer = '';
    if (q.type === 'choice') {
      answer = typeof rawAnswer === 'string' && q.choices.includes(rawAnswer.trim()) ? rawAnswer.trim() : '';
    } else {
      answer = q.type === 'paragraph'
        ? multiline(rawAnswer, APPLICATION_PARAGRAPH_MAX)
        : str(rawAnswer, APPLICATION_SHORT_MAX);
    }
    if (!answer && q.required) return { error: `Please answer: ${q.label}`, questionId: q.id };
    answers.push({ questionId: q.id, question: q.label, answer });
  }
  return { answers };
}

interface ChannelNode { id: string; parentId?: string | null; type?: string | null }

/**
 * Whether a pending member may open `channel` while access is restricted:
 * it, its category, or (threads) its parent channel / parent's category is
 * listed. Categories are allowed when listed or when any listed channel is in them.
 */
export function isChannelAccessibleWhilePending(
  channel: ChannelNode,
  parent: ChannelNode | null | undefined,
  allowed: ReadonlySet<string>,
  allChannels?: readonly ChannelNode[],
): boolean {
  if (allowed.has(channel.id)) return true;
  if (channel.parentId && allowed.has(channel.parentId)) return true;
  if (parent) {
    if (allowed.has(parent.id)) return true;
    if (parent.parentId && allowed.has(parent.parentId)) return true;
  }
  if (channel.type === 'category' && allChannels) {
    return allChannels.some((c) => c.parentId === channel.id && allowed.has(c.id));
  }
  return false;
}

export interface ScreeningGateInput {
  enabled: boolean;
  /** server_members.pending: joined while screening was on and hasn't accepted. */
  pending: boolean;
  /** Owner, bot or system user. */
  exempt?: boolean;
  /** Roles held other than @everyone; a moderator granting a role lets them in. */
  roleCount: number;
}

/** Whether rules screening stops this member from talking (send, react, join voice). */
export function isScreeningBlocked(input: ScreeningGateInput): boolean {
  if (!input.enabled || !input.pending) return false;
  if (input.exempt || input.roleCount > 0) return false;
  return true;
}

export const SCREENING_ERROR = 'You must accept the server rules before you can talk here';

// ─── Server templates ─────────────────────────────────────────────────────────

export const TEMPLATE_NAME_MAX = 100;
export const TEMPLATE_DESCRIPTION_MAX = 120;
const TEMPLATE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const TEMPLATE_CODE_LENGTH = 12;

/** Channel types a template copies. Threads, DMs and group DMs never are. */
export const TEMPLATE_CHANNEL_TYPES = new Set(['text', 'voice', 'category', 'announcement', 'stage', 'forum']);

export interface TemplateRole {
  /** Template-local id; 0 is @everyone. */
  id: number;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  unicodeEmoji: string | null;
  position: number;
}

export interface TemplateOverwrite {
  /** Template-local role id. Member overwrites are not copied. */
  id: number;
  allow: string;
  deny: string;
}

export interface TemplateChannel {
  id: number;
  name: string;
  type: string;
  topic: string | null;
  position: number;
  parentId: number | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number;
  userLimit: number;
  forumMode: string | null;
  availableTags: unknown[];
  defaultAutoArchiveDuration: number | null;
  permissionOverwrites: TemplateOverwrite[];
}

export interface ServerSnapshot {
  name: string;
  description: string | null;
  verificationLevel: string;
  explicitContentFilter: string;
  defaultNotifications: string;
  afkTimeout: number;
  systemChannelId: number | null;
  afkChannelId: number | null;
  roles: TemplateRole[];
  channels: TemplateChannel[];
}

export interface SourceServer {
  id: string;
  name: string;
  description?: string | null;
  verificationLevel?: string | null;
  explicitContentFilter?: string | null;
  defaultNotifications?: string | null;
  afkTimeout?: number | null;
  systemChannelId?: string | null;
  afkChannelId?: string | null;
}

export interface SourceRole {
  id: string;
  name: string;
  color?: number | null;
  hoist?: boolean | null;
  mentionable?: boolean | null;
  permissions?: string | null;
  unicodeEmoji?: string | null;
  position?: number | null;
  managed?: boolean | null;
  isDefault?: boolean | null;
}

export interface SourceChannel {
  id: string;
  name: string;
  type: string;
  topic?: string | null;
  position?: number | null;
  parentId?: string | null;
  nsfw?: boolean | null;
  rateLimitPerUser?: number | null;
  bitrate?: number | null;
  userLimit?: number | null;
  forumMode?: string | null;
  availableTags?: unknown;
  defaultAutoArchiveDuration?: number | null;
  permissionOverwrites?: unknown;
}

function int(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function bits(value: unknown): string {
  try {
    const n = BigInt(typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? value : 0);
    return n < 0n ? '0' : n.toString();
  } catch {
    return '0';
  }
}

/**
 * Snapshot a server's structure for a template: settings, roles (no managed
 * bot roles) and channels with role overwrites, all re-keyed to small local
 * ids. Members, messages, emojis, member overwrites and threads are left out.
 */
export function serializeServerTemplate(server: SourceServer, roles: SourceRole[], channels: SourceChannel[]): ServerSnapshot {
  const everyone = roles.find((r) => r.isDefault);
  const roleIds = new Map<string, number>();
  roleIds.set(server.id, 0);
  if (everyone) roleIds.set(everyone.id, 0);
  const outRoles: TemplateRole[] = [{
    id: 0,
    name: '@everyone',
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: bits(everyone?.permissions ?? '0'),
    unicodeEmoji: null,
    position: 0,
  }];
  const otherRoles = roles
    .filter((r) => !r.isDefault && !r.managed)
    .sort((a, b) => int(a.position) - int(b.position) || a.id.localeCompare(b.id));
  otherRoles.forEach((r, i) => {
    const id = i + 1;
    roleIds.set(r.id, id);
    outRoles.push({
      id,
      name: str(r.name, 100) || 'role',
      color: int(r.color),
      hoist: Boolean(r.hoist),
      mentionable: Boolean(r.mentionable),
      permissions: bits(r.permissions),
      unicodeEmoji: r.unicodeEmoji ? String(r.unicodeEmoji) : null,
      position: id,
    });
  });

  const kept = channels
    .filter((c) => TEMPLATE_CHANNEL_TYPES.has(String(c.type)))
    .sort((a, b) => {
      // Categories first so parents always precede children.
      const ca = a.type === 'category' ? 0 : 1;
      const cb = b.type === 'category' ? 0 : 1;
      return ca - cb || int(a.position) - int(b.position) || a.id.localeCompare(b.id);
    });
  const channelIds = new Map<string, number>();
  kept.forEach((c, i) => channelIds.set(c.id, i + 1));

  const outChannels: TemplateChannel[] = kept.map((c) => {
    const overwrites: TemplateOverwrite[] = [];
    const seenRoles = new Map<number, TemplateOverwrite>();
    for (const o of Array.isArray(c.permissionOverwrites) ? c.permissionOverwrites : []) {
      if (!o || typeof o !== 'object') continue;
      const ow = o as Record<string, unknown>;
      if (ow.type !== 'role' && ow.type !== 0 && ow.type !== '0') continue;
      const roleId = roleIds.get(String(ow.id ?? ''));
      if (roleId === undefined) continue;
      // The @everyone overwrite may be stored twice (server id and role id).
      const prev = seenRoles.get(roleId);
      if (prev) {
        prev.allow = (BigInt(prev.allow) | BigInt(bits(ow.allow))).toString();
        prev.deny = (BigInt(prev.deny) | BigInt(bits(ow.deny))).toString();
        continue;
      }
      const entry = { id: roleId, allow: bits(ow.allow), deny: bits(ow.deny) };
      seenRoles.set(roleId, entry);
      overwrites.push(entry);
    }
    const parent = c.parentId && c.type !== 'category' ? channelIds.get(c.parentId) ?? null : null;
    return {
      id: channelIds.get(c.id)!,
      name: str(c.name, 100) || 'channel',
      type: String(c.type),
      topic: typeof c.topic === 'string' && c.topic ? c.topic.slice(0, 1024) : null,
      position: int(c.position),
      parentId: parent,
      nsfw: Boolean(c.nsfw),
      rateLimitPerUser: Math.max(0, int(c.rateLimitPerUser)),
      bitrate: Math.max(8000, int(c.bitrate, 64000)),
      userLimit: Math.max(0, int(c.userLimit)),
      forumMode: c.type === 'forum' && c.forumMode ? String(c.forumMode) : null,
      availableTags: c.type === 'forum' && Array.isArray(c.availableTags) ? c.availableTags.slice(0, 20) : [],
      defaultAutoArchiveDuration: c.defaultAutoArchiveDuration == null ? null : int(c.defaultAutoArchiveDuration),
      permissionOverwrites: overwrites.sort((a, b) => a.id - b.id),
    };
  });

  return {
    name: str(server.name, 100),
    description: server.description ? String(server.description).slice(0, 1000) : null,
    verificationLevel: server.verificationLevel || 'none',
    explicitContentFilter: server.explicitContentFilter || 'disabled',
    defaultNotifications: server.defaultNotifications || 'only_mentions',
    afkTimeout: int(server.afkTimeout, 300),
    systemChannelId: server.systemChannelId ? channelIds.get(server.systemChannelId) ?? null : null,
    afkChannelId: server.afkChannelId ? channelIds.get(server.afkChannelId) ?? null : null,
    roles: outRoles,
    channels: outChannels,
  };
}

/** Reads a stored snapshot defensively (it is JSON from the DB). */
export function parseServerSnapshot(input: unknown): ServerSnapshot | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<ServerSnapshot>;
  if (!Array.isArray(raw.roles) || !Array.isArray(raw.channels)) return null;
  return {
    name: str(raw.name, 100),
    description: typeof raw.description === 'string' ? raw.description : null,
    verificationLevel: typeof raw.verificationLevel === 'string' ? raw.verificationLevel : 'none',
    explicitContentFilter: typeof raw.explicitContentFilter === 'string' ? raw.explicitContentFilter : 'disabled',
    defaultNotifications: typeof raw.defaultNotifications === 'string' ? raw.defaultNotifications : 'only_mentions',
    afkTimeout: int(raw.afkTimeout, 300),
    systemChannelId: typeof raw.systemChannelId === 'number' ? raw.systemChannelId : null,
    afkChannelId: typeof raw.afkChannelId === 'number' ? raw.afkChannelId : null,
    roles: raw.roles.filter((r): r is TemplateRole => Boolean(r) && typeof r === 'object' && typeof (r as TemplateRole).id === 'number'),
    channels: raw.channels.filter((c): c is TemplateChannel => Boolean(c) && typeof c === 'object' && typeof (c as TemplateChannel).id === 'number' && TEMPLATE_CHANNEL_TYPES.has(String((c as TemplateChannel).type))),
  };
}

/**
 * Rewrites template-local overwrites to real role ids once the new server's
 * roles exist. `roleIdMap` maps template role id -> new role id (0 -> @everyone).
 */
export function remapTemplateOverwrites(
  overwrites: readonly TemplateOverwrite[],
  roleIdMap: ReadonlyMap<number, string>,
): Array<{ id: string; type: 'role'; allow: string; deny: string }> {
  const out: Array<{ id: string; type: 'role'; allow: string; deny: string }> = [];
  for (const o of overwrites) {
    const id = roleIdMap.get(o.id);
    if (!id) continue;
    out.push({ id, type: 'role', allow: bits(o.allow), deny: bits(o.deny) });
  }
  return out;
}

/** Stable JSON (sorted keys) so two snapshots can be compared for "unsynced changes". */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether the server changed since the template was last synced. */
export function isTemplateDirty(stored: unknown, current: ServerSnapshot): boolean {
  return stableStringify(stored) !== stableStringify(current);
}

export function generateTemplateCode(random: (n: number) => Uint8Array): string {
  const bytes = random(TEMPLATE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < TEMPLATE_CODE_LENGTH; i++) code += TEMPLATE_CODE_ALPHABET[bytes[i] % TEMPLATE_CODE_ALPHABET.length];
  return code;
}

const CODE_RE = /^[A-Za-z0-9]{4,32}$/;

/**
 * Accepts a bare code or a share link (https://serika.chat/template/CODE,
 * .../server-templates/CODE) and returns the code, or null.
 */
export function parseTemplateCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  const match = value.match(/(?:^|\/)(?:template|templates|server-templates)\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  if (match) value = match[1];
  return CODE_RE.test(value) ? value : null;
}

export function normalizeTemplateMeta(input: { name?: unknown; description?: unknown }, fallbackName: string): { name: string; description: string | null } {
  const name = str(input.name, TEMPLATE_NAME_MAX) || str(fallbackName, TEMPLATE_NAME_MAX) || 'Template';
  const description = str(input.description, TEMPLATE_DESCRIPTION_MAX);
  return { name, description: description || null };
}

/** Short human summary counts for the template preview. */
export function summarizeSnapshot(snapshot: ServerSnapshot): { categories: number; textChannels: number; voiceChannels: number; roles: number } {
  let categories = 0;
  let textChannels = 0;
  let voiceChannels = 0;
  for (const c of snapshot.channels) {
    if (c.type === 'category') categories++;
    else if (c.type === 'voice' || c.type === 'stage') voiceChannels++;
    else textChannels++;
  }
  return { categories, textChannels, voiceChannels, roles: Math.max(0, snapshot.roles.length - 1) };
}
