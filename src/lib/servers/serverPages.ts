/**
 * Pure rules behind the server pages under the server header (Discord's
 * "Channels & Roles" and "Members"): who sees them, how an onboarding pick
 * toggles, the Browse Channels grouping and the member table cells.
 * Rendered by src/components/server/community/{ChannelsRolesView,ServerMembersView}.tsx.
 * Tests: tests/server-pages.test.ts.
 */

// ── Routes ───────────────────────────────────────────────────────────────────

/** /channels/:serverId/<slug> pages that are not channels. */
export const SERVER_PAGE_SLUGS: ReadonlySet<string> = new Set(['guide', 'customize', 'members', 'onboarding']);

/** The channel id in /channels/:serverId/:segment, or null when the segment is a server page. */
export function channelIdFromSegment(segment: string | null | undefined): string | null {
  if (!segment || SERVER_PAGE_SLUGS.has(segment)) return null;
  return segment;
}

// ── Who sees what ────────────────────────────────────────────────────────────

export type MembersPagePermission = 'MANAGE_SERVER' | 'KICK_MEMBERS' | 'BAN_MEMBERS' | 'MODERATE_MEMBERS';

/**
 * The Members page is a moderation tool (Discord shows it to members who can
 * manage the server or kick / ban / time out members). The owner always can.
 */
export function canViewMembersPage(can: (key: MembersPagePermission) => boolean, isOwner = false): boolean {
  return isOwner || can('MANAGE_SERVER') || can('KICK_MEMBERS') || can('BAN_MEMBERS') || can('MODERATE_MEMBERS');
}

// ── Customization questions ──────────────────────────────────────────────────

export interface PickQuestion {
  id: string;
  multiple: boolean;
  required: boolean;
  options: ReadonlyArray<{ id: string }>;
}

export interface PickToggle {
  next: string[];
  /** Set when the click was refused: a required question can't be left empty. */
  blocked: 'required' | null;
}

/**
 * Clicking an option tile. Multiple choice toggles it; single choice switches
 * to it (clicking the picked one clears it, unless the question is required).
 * A required question never loses its last pick, as on Discord.
 */
export function toggleOnboardingPick(question: PickQuestion, selected: readonly string[], optionId: string): PickToggle {
  const own = new Set(question.options.map((o) => o.id));
  if (!own.has(optionId)) return { next: [...selected], blocked: null };
  const isOn = selected.includes(optionId);
  const picksHere = selected.filter((id) => own.has(id));
  if (isOn) {
    if (question.required && picksHere.length <= 1) return { next: [...selected], blocked: 'required' };
    return { next: selected.filter((id) => id !== optionId), blocked: null };
  }
  if (question.multiple) return { next: [...selected, optionId], blocked: null };
  return { next: [...selected.filter((id) => !own.has(id)), optionId], blocked: null };
}

/** Required questions without a pick (the server refuses to save until they have one). */
export function unansweredRequired(questions: readonly PickQuestion[], selected: readonly string[]): string[] {
  const picked = new Set(selected);
  return questions.filter((q) => q.required && !q.options.some((o) => picked.has(o.id))).map((q) => q.id);
}

/** Same picks, in any order. */
export function samePicks(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// ── Browse Channels ──────────────────────────────────────────────────────────

export interface BrowseChannelLike {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId?: string | null;
}

export interface BrowseSection<T extends BrowseChannelLike> {
  /** null: channels outside any category (listed first, like the sidebar). */
  category: T | null;
  channels: T[];
}

const NOT_BROWSABLE = new Set(['category', 'public_thread', 'private_thread', 'dm', 'group_dm']);
const VOICE_LIKE = new Set(['voice', 'stage']);

function byPosition(a: BrowseChannelLike, b: BrowseChannelLike): number {
  // Discord lists text-like channels above voice ones inside a category.
  const voice = Number(VOICE_LIKE.has(a.type)) - Number(VOICE_LIKE.has(b.type));
  return voice || a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * The channels the member can see, grouped under their categories in sidebar
 * order. Threads and empty categories are left out; a channel whose category
 * is missing counts as uncategorized.
 */
export function groupBrowseChannels<T extends BrowseChannelLike>(channels: readonly T[]): BrowseSection<T>[] {
  const categories = channels.filter((c) => c.type === 'category').sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const categoryIds = new Set(categories.map((c) => c.id));
  const loose: T[] = [];
  const byCategory = new Map<string, T[]>();
  for (const channel of channels) {
    if (NOT_BROWSABLE.has(channel.type)) continue;
    const parent = channel.parentId ?? null;
    if (parent && categoryIds.has(parent)) {
      const list = byCategory.get(parent) ?? [];
      list.push(channel);
      byCategory.set(parent, list);
    } else {
      loose.push(channel);
    }
  }
  const sections: BrowseSection<T>[] = [];
  if (loose.length > 0) sections.push({ category: null, channels: loose.sort(byPosition) });
  for (const category of categories) {
    const list = byCategory.get(category.id);
    if (list && list.length > 0) sections.push({ category, channels: list.sort(byPosition) });
  }
  return sections;
}

/** Channels in the browse list (the count next to the tab). */
export function browseChannelCount(sections: ReadonlyArray<BrowseSection<BrowseChannelLike>>): number {
  return sections.reduce((n, s) => n + s.channels.length, 0);
}

// ── Members table ────────────────────────────────────────────────────────────

export interface RelativeAge {
  value: number;
  unit: 'minute' | 'hour' | 'day' | 'month' | 'year';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "21 hrs ago" / "12 days ago" / "2 years ago" as a positive amount + unit; null for no date. */
export function relativeAge(value: string | null | undefined, nowMs: number): RelativeAge | null {
  if (!value) return null;
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return null;
  const diff = Math.max(0, nowMs - then);
  if (diff < HOUR) return { value: Math.max(1, Math.floor(diff / MINUTE)), unit: 'minute' };
  if (diff < DAY) return { value: Math.floor(diff / HOUR), unit: 'hour' };
  const days = Math.floor(diff / DAY);
  if (days < 30) return { value: days, unit: 'day' };
  if (days < 365) return { value: Math.max(1, Math.floor(days / 30)), unit: 'month' };
  return { value: Math.floor(days / 365), unit: 'year' };
}

/** Accounts younger than this get the "New account" signal. */
export const NEW_ACCOUNT_DAYS = 7;

export type MemberSignal = 'new_account' | 'timed_out';

/** Moderation hints from data the member list already has. */
export function memberSignals(
  member: { accountCreatedAt?: string | null; communicationDisabledUntil?: string | null; isBot?: boolean },
  nowMs: number,
): MemberSignal[] {
  const out: MemberSignal[] = [];
  const created = member.accountCreatedAt ? Date.parse(member.accountCreatedAt) : NaN;
  if (!member.isBot && Number.isFinite(created) && nowMs - created < NEW_ACCOUNT_DAYS * DAY) out.push('new_account');
  const until = member.communicationDisabledUntil ? Date.parse(member.communicationDisabledUntil) : NaN;
  if (Number.isFinite(until) && until > nowMs) out.push('timed_out');
  return out;
}

/** The colour the API gives roles without one (Discord's default grey). */
const NO_COLOR = new Set(['#99AAB5', '#000000', '']);

/** Name colour: the highest role that has a colour of its own, else none. */
export function memberNameColor(roles: ReadonlyArray<{ color?: string | null; isDefault?: boolean; position?: number }>): string | null {
  let best: { color: string; position: number } | null = null;
  for (const role of roles) {
    if (role.isDefault) continue;
    const color = (role.color ?? '').toUpperCase();
    if (NO_COLOR.has(color)) continue;
    const position = role.position ?? 0;
    if (!best || position > best.position) best = { color: role.color as string, position };
  }
  return best?.color ?? null;
}

/** Roles shown as chips: highest first, without @everyone. */
export function visibleMemberRoles<T extends { isDefault?: boolean; position?: number }>(roles: readonly T[]): T[] {
  return roles.filter((r) => !r.isDefault).sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
}
