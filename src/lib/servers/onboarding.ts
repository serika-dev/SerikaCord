// Discord-style Server Onboarding and Server Guide as pure rules (no DB).
//
//   questions   "Which games do you play?" — each option grants roles; the
//               member's picks can be changed later and roles follow them.
//   guide       the Server Guide page: welcome message, new-member to-dos and
//               resource cards that link to channels.
//
// Storage: services/serverCommunity.ts. Routes: api/community.ts.
// Tests: tests/server-onboarding.test.ts.
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { stableId } from '@/lib/servers/community';

export const ONBOARDING_QUESTIONS_MAX = 8;
export const ONBOARDING_OPTIONS_MAX = 12;
export const ONBOARDING_ROLES_PER_OPTION = 5;
export const ONBOARDING_TITLE_MAX = 100;
export const ONBOARDING_DESCRIPTION_MAX = 150;
export const GUIDE_WELCOME_MAX = 500;
export const GUIDE_TODOS_MAX = 5;
export const GUIDE_RESOURCES_MAX = 7;
export const LINKED_CONNECTIONS_MAX = 8;

export interface OnboardingOption {
  id: string;
  title: string;
  description: string;
  /** A unicode emoji shown on the option card. */
  emoji: string | null;
  roleIds: string[];
}

export interface OnboardingQuestion {
  id: string;
  title: string;
  description: string;
  /** Allow picking more than one option. */
  multiple: boolean;
  /** Must be answered before finishing onboarding. */
  required: boolean;
  options: OnboardingOption[];
}

export type GuideTodoKind = 'read' | 'chat' | 'roles' | 'profile';

export interface GuideTodo {
  id: string;
  kind: GuideTodoKind;
  title: string;
  description: string;
  /** read / chat: the channel the to-do points at. */
  channelId: string | null;
  emoji: string | null;
}

export interface GuideResource {
  id: string;
  title: string;
  description: string;
  channelId: string | null;
  emoji: string | null;
}

export interface ServerGuide {
  enabled: boolean;
  welcomeMessage: string;
  todos: GuideTodo[];
  resources: GuideResource[];
}

export interface OnboardingConfig {
  /** Ask the questions to people who join. */
  enabled: boolean;
  questions: OnboardingQuestion[];
  guide: ServerGuide;
}

export const EMPTY_GUIDE: ServerGuide = { enabled: false, welcomeMessage: '', todos: [], resources: [] };
export const EMPTY_ONBOARDING: OnboardingConfig = { enabled: false, questions: [], guide: EMPTY_GUIDE };

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function multiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function emoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t && t.length <= 16 && !/\s/.test(t) ? t : null;
}

function channelRef(value: unknown, valid?: ReadonlySet<string>): string | null {
  if (typeof value !== 'string' || !value || value.length > 64) return null;
  return !valid || valid.has(value) ? value : null;
}

export interface OnboardingContext {
  /** Channels that exist (to-dos and resources pointing elsewhere are dropped). */
  channelIds?: ReadonlySet<string>;
  /** Roles an option may grant; others are dropped. */
  roleIds?: ReadonlySet<string>;
}

/** Normalizes a stored or submitted onboarding config against the server's channels and roles. */
/**
 * Questions that were started but can't be saved: they have some text but no
 * title, or no option with a title. normalizeOnboardingConfig drops those, so
 * the editor and the API refuse them instead of losing them silently
 * (CORD-68). Completely blank questions aren't listed (they're just dropped).
 * Returns their indexes in `questions`.
 */
export function incompleteOnboardingQuestions(questions: unknown): number[] {
  if (!Array.isArray(questions)) return [];
  const out: number[] = [];
  questions.forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    const qr = q as Record<string, unknown>;
    const options = (Array.isArray(qr.options) ? qr.options : [])
      .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object');
    const title = str(qr.title, ONBOARDING_TITLE_MAX);
    const titledOptions = options.filter((o) => str(o.title, ONBOARDING_TITLE_MAX));
    const hasAnyText = Boolean(title || str(qr.description, ONBOARDING_DESCRIPTION_MAX)
      || options.some((o) => str(o.title, ONBOARDING_TITLE_MAX) || str(o.description, ONBOARDING_DESCRIPTION_MAX)));
    if (hasAnyText && (!title || titledOptions.length === 0)) out.push(i);
  });
  return out;
}

export function normalizeOnboardingConfig(input: unknown, ctx: OnboardingContext = {}): OnboardingConfig {
  if (!input || typeof input !== 'object') return { ...EMPTY_ONBOARDING, questions: [], guide: { ...EMPTY_GUIDE, todos: [], resources: [] } };
  const raw = input as Record<string, unknown>;

  const questions: OnboardingQuestion[] = [];
  const seenQ = new Set<string>();
  const seenO = new Set<string>();
  for (const [qi, q] of (Array.isArray(raw.questions) ? raw.questions : []).entries()) {
    if (!q || typeof q !== 'object') continue;
    const qr = q as Record<string, unknown>;
    const title = str(qr.title, ONBOARDING_TITLE_MAX);
    if (!title) continue;
    let qid = stableId(qr.id, `q${qi}`);
    if (seenQ.has(qid)) qid = `q${qi}_${questions.length}`;
    seenQ.add(qid);
    const options: OnboardingOption[] = [];
    for (const [oi, o] of (Array.isArray(qr.options) ? qr.options : []).entries()) {
      if (!o || typeof o !== 'object') continue;
      const or = o as Record<string, unknown>;
      const otitle = str(or.title, ONBOARDING_TITLE_MAX);
      if (!otitle) continue;
      let oid = stableId(or.id, `${qid}_o${oi}`);
      if (seenO.has(oid)) oid = `${qid}_o${oi}_${options.length}`;
      seenO.add(oid);
      const roleIds = [...new Set((Array.isArray(or.roleIds) ? or.roleIds : [])
        .filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 64)
        .filter((r) => !ctx.roleIds || ctx.roleIds.has(r)))]
        .slice(0, ONBOARDING_ROLES_PER_OPTION);
      options.push({ id: oid, title: otitle, description: str(or.description, ONBOARDING_DESCRIPTION_MAX), emoji: emoji(or.emoji), roleIds });
      if (options.length >= ONBOARDING_OPTIONS_MAX) break;
    }
    if (options.length === 0) continue;
    questions.push({
      id: qid,
      title,
      description: str(qr.description, ONBOARDING_DESCRIPTION_MAX),
      multiple: qr.multiple === true,
      required: qr.required === true,
      options,
    });
    if (questions.length >= ONBOARDING_QUESTIONS_MAX) break;
  }

  const g = (raw.guide && typeof raw.guide === 'object' ? raw.guide : {}) as Record<string, unknown>;
  const todos: GuideTodo[] = [];
  for (const [i, t] of (Array.isArray(g.todos) ? g.todos : []).entries()) {
    if (!t || typeof t !== 'object') continue;
    const tr = t as Record<string, unknown>;
    const title = str(tr.title, ONBOARDING_TITLE_MAX);
    if (!title) continue;
    const kind: GuideTodoKind = tr.kind === 'chat' || tr.kind === 'roles' || tr.kind === 'profile' ? tr.kind : 'read';
    const channelId = kind === 'read' || kind === 'chat' ? channelRef(tr.channelId, ctx.channelIds) : null;
    if ((kind === 'read' || kind === 'chat') && !channelId) continue;
    todos.push({ id: stableId(tr.id, `t${i}`), kind, title, description: str(tr.description, ONBOARDING_DESCRIPTION_MAX), channelId, emoji: emoji(tr.emoji) });
    if (todos.length >= GUIDE_TODOS_MAX) break;
  }
  const resources: GuideResource[] = [];
  for (const [i, r] of (Array.isArray(g.resources) ? g.resources : []).entries()) {
    if (!r || typeof r !== 'object') continue;
    const rr = r as Record<string, unknown>;
    const title = str(rr.title, ONBOARDING_TITLE_MAX);
    if (!title) continue;
    resources.push({ id: stableId(rr.id, `r${i}`), title, description: str(rr.description, ONBOARDING_DESCRIPTION_MAX), channelId: channelRef(rr.channelId, ctx.channelIds), emoji: emoji(rr.emoji) });
    if (resources.length >= GUIDE_RESOURCES_MAX) break;
  }

  return {
    enabled: raw.enabled === true && questions.length > 0,
    questions,
    guide: {
      enabled: g.enabled === true,
      welcomeMessage: multiline(g.welcomeMessage, GUIDE_WELCOME_MAX),
      todos,
      resources,
    },
  };
}

export function isOnboardingVisible(config: OnboardingConfig): boolean {
  return config.enabled && config.questions.length > 0;
}

export function isGuideVisible(guide: ServerGuide): boolean {
  return guide.enabled && (guide.welcomeMessage.length > 0 || guide.todos.length > 0 || guide.resources.length > 0);
}

/**
 * Checks a member's picks: unknown options are dropped, single-choice
 * questions keep one pick, and every required question needs an answer.
 */
export function validateOnboardingSelection(
  config: OnboardingConfig,
  optionIds: unknown,
): { optionIds: string[] } | { error: string; questionId: string } {
  const picked = new Set((Array.isArray(optionIds) ? optionIds : []).filter((id): id is string => typeof id === 'string'));
  const out: string[] = [];
  for (const q of config.questions) {
    const chosen = q.options.filter((o) => picked.has(o.id)).map((o) => o.id);
    if (chosen.length === 0 && q.required) return { error: `Please answer: ${q.title}`, questionId: q.id };
    out.push(...(q.multiple ? chosen : chosen.slice(0, 1)));
  }
  return { optionIds: out };
}

/** Roles the picks grant, and every role onboarding manages (removed when no longer picked). */
export function onboardingRoleChanges(config: OnboardingConfig, optionIds: readonly string[]): { grant: Set<string>; managed: Set<string> } {
  const picked = new Set(optionIds);
  const grant = new Set<string>();
  const managed = new Set<string>();
  for (const q of config.questions) {
    for (const o of q.options) {
      for (const r of o.roleIds) {
        managed.add(r);
        if (picked.has(o.id)) grant.add(r);
      }
    }
  }
  return { grant, managed };
}

/** The member's new role list: onboarding roles follow the picks, every other role is kept. */
export function applyOnboardingRoles(current: readonly string[], changes: { grant: ReadonlySet<string>; managed: ReadonlySet<string> }): string[] {
  const next = current.filter((r) => !changes.managed.has(r) || changes.grant.has(r));
  for (const r of changes.grant) if (!next.includes(r)) next.push(r);
  return next;
}

/**
 * Permissions a self-assigned role must never carry: anything that moderates,
 * manages the server or pings everyone. Onboarding is self-service, so such a
 * role would let any new member escalate.
 */
export const UNSAFE_ONBOARDING_PERMISSIONS =
  PERMISSION_BITS.ADMINISTRATOR
  | PERMISSION_BITS.MANAGE_SERVER
  | PERMISSION_BITS.MANAGE_ROLES
  | PERMISSION_BITS.MANAGE_CHANNELS
  | PERMISSION_BITS.MANAGE_MESSAGES
  | PERMISSION_BITS.MANAGE_WEBHOOKS
  | PERMISSION_BITS.MANAGE_NICKNAMES
  | PERMISSION_BITS.MANAGE_EMOJIS_AND_STICKERS
  | PERMISSION_BITS.MANAGE_THREADS
  | PERMISSION_BITS.MANAGE_EVENTS
  | PERMISSION_BITS.KICK_MEMBERS
  | PERMISSION_BITS.BAN_MEMBERS
  | PERMISSION_BITS.MODERATE_MEMBERS
  | PERMISSION_BITS.MENTION_EVERYONE
  | PERMISSION_BITS.VIEW_AUDIT_LOG
  | PERMISSION_BITS.MUTE_MEMBERS
  | PERMISSION_BITS.DEAFEN_MEMBERS
  | PERMISSION_BITS.MOVE_MEMBERS
  | PERMISSION_BITS.PIN_MESSAGES;

export interface OnboardingRoleCandidate {
  id: string;
  permissions?: string | null;
  managed?: boolean | null;
  isDefault?: boolean | null;
}

function parseBits(value: unknown): bigint {
  try {
    return BigInt(typeof value === 'string' && value ? value : '0');
  } catch {
    return 0n;
  }
}

/** Whether members may pick this role for themselves through onboarding. */
export function isSafeOnboardingRole(role: OnboardingRoleCandidate): boolean {
  if (role.managed || role.isDefault) return false;
  return (parseBits(role.permissions) & UNSAFE_ONBOARDING_PERMISSIONS) === 0n;
}

/** Normalizes the list of the owner's connection ids a server shows. */
export function normalizeLinkedConnectionIds(input: unknown): string[] {
  return [...new Set((Array.isArray(input) ? input : [])
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-fA-F-]{32,36}$/.test(id)))]
    .slice(0, LINKED_CONNECTIONS_MAX);
}

/**
 * Roles that get power through channels rather than their own bitfield: ticket
 * access roles (see every private ticket) and roles a channel overwrite allows
 * something unsafe (e.g. Manage Messages in #announcements). Never offered.
 */
export function rolesWithUnsafeChannelGrants(
  channels: ReadonlyArray<{ ticketAccessRoleIds?: readonly string[] | null; permissionOverwrites?: unknown }>,
): Set<string> {
  const out = new Set<string>();
  for (const c of channels) {
    for (const r of c.ticketAccessRoleIds ?? []) out.add(r);
    for (const o of Array.isArray(c.permissionOverwrites) ? c.permissionOverwrites : []) {
      if (!o || typeof o !== 'object') continue;
      const ow = o as { id?: unknown; type?: unknown; allow?: unknown };
      if (ow.type === 'member' || ow.type === 1 || ow.type === '1' || typeof ow.id !== 'string') continue;
      if ((parseBits(ow.allow) & UNSAFE_ONBOARDING_PERMISSIONS) !== 0n) out.add(ow.id);
    }
  }
  return out;
}
