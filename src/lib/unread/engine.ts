/**
 * Unread / mention engine as a pure reducer.
 *
 * Every input the app sees (startup seeds, live messages from the activity
 * stream and the DM list, read acks from this or another device, deletions,
 * reconnect re-seeds) is an event; the state is a function of the sequence.
 * UnreadContext owns one instance and renders from the selectors below, the
 * Inbox reads the same state, and `tests/unread-engine.test.ts` drives it
 * with event sequences to pin the Discord semantics down:
 *
 *  - A conversation is unread while its newest known message is newer than
 *    the read marker. The marker only ever moves forward.
 *  - Badges count individual messages (mentions in servers, every message in
 *    DMs) by id, so the same message reaching us twice (activity stream + DM
 *    list stream, a reconnect re-seed) counts once, and a read marker or a
 *    deletion removes exactly the messages it covers.
 *  - Server counts that come without ids (`/api/dms` unread counts) are kept
 *    as an anonymous `extra`, reconciled against what arrived since the
 *    request was issued.
 *  - Your own message reads the conversation up to it (Discord: sending
 *    marks the channel read), on every device.
 *
 * Times are epoch milliseconds. `rx` is the local receive time of an event,
 * used only to order local events against server snapshots.
 */

/** Past this the UI shows "99+"; counts never climb higher. */
export const MAX_UNREAD_BADGE = 100;

/** How long a local read may take to reach the server's counts. */
export const ACK_GRACE_MS = 10_000;

export interface BadgeEntry {
  /** createdAt of the message (server time, ms). */
  at: number;
  /** Local time it was counted (0 for seeded entries). */
  rx: number;
}

export interface Badge {
  ids: Readonly<Record<string, BadgeEntry>>;
  /** Count known only as a number (server unread counts), on top of `ids`. */
  extra: number;
}

export interface UnreadState {
  /** Newest known message per conversation (ms). */
  activity: Readonly<Record<string, number>>;
  /** Id of that newest message, when known. */
  activityIds: Readonly<Record<string, string>>;
  /** Read marker: createdAt of the last read message (ms). */
  read: Readonly<Record<string, number>>;
  /** Exact last read message, when known. */
  readIds: Readonly<Record<string, string>>;
  /** Local time the read marker last moved forward. */
  readRx: Readonly<Record<string, number>>;
  badges: Readonly<Record<string, Badge>>;
}

export const EMPTY_UNREAD_STATE: UnreadState = Object.freeze({
  activity: {},
  activityIds: {},
  read: {},
  readIds: {},
  readRx: {},
  badges: {},
}) as UnreadState;

export type TimeInput = number | string | null | undefined;

/** ms from an ISO string / number; 0 when missing or invalid. */
export function toMs(value: TimeInput): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

export interface SeedConversation {
  channelId: string;
  /** Newest message time (ms or ISO). */
  lastMessageAt?: TimeInput;
  lastMessageId?: string | null;
  /** The newest message is the user's own: the conversation is read up to it. */
  lastMessageIsOwn?: boolean;
  /** Authoritative unread count from the server (DMs), when the seed carries one. */
  unread?: number;
}

export type UnreadEvent =
  /** Channel lists / activity seeds (no badge change). */
  | { type: "seed_conversations"; conversations: SeedConversation[]; issuedAt?: number; now?: number }
  /**
   * A live message from someone (or yourself on another device).
   * `counts`: it badges (a mention, or any DM message).
   * `viewing`: the user is reading it live right now (on screen, attending,
   * at the bottom): it is not counted, the list's ack reads it.
   */
  | {
      type: "message";
      channelId: string;
      messageId?: string | null;
      at: TimeInput;
      own?: boolean;
      counts?: boolean;
      viewing?: boolean;
      now?: number;
    }
  /** A read marker (local ack, another device, or a startup seed). Never moves backwards. */
  | { type: "read"; channelId: string; at: TimeInput; messageId?: string | null; now?: number }
  /** "Mark as read" with no exact message: read everything known. */
  | { type: "read_all"; channelId: string; now?: number }
  /** Mention ids from the mentions API (union; already filtered by settings). */
  | { type: "seed_mentions"; mentions: Array<{ id: string; channelId: string; createdAt: TimeInput }> }
  /**
   * Messages were deleted. `lastMessageAt` is the newest remaining message
   * (null if the conversation is now empty); `deleted` the removed messages.
   */
  | {
      type: "reset";
      channelId: string;
      lastMessageAt: TimeInput;
      deleted?: Array<{ id: string; at?: TimeInput }>;
    }
  /** A message no longer pings the user (edited, mention removed). */
  | { type: "retract"; channelId: string; messageId: string }
  /** Forget a conversation's badge (left server, deleted channel). */
  | { type: "forget"; channelId: string };

function withKey<V>(map: Readonly<Record<string, V>>, key: string, value: V): Record<string, V> {
  return { ...map, [key]: value };
}

function withoutKey<V>(map: Readonly<Record<string, V>>, key: string): Readonly<Record<string, V>> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

function badgeSize(b: Badge | undefined): number {
  if (!b) return 0;
  return b.extra + Object.keys(b.ids).length;
}

function setBadge(state: UnreadState, channelId: string, badge: Badge | null): UnreadState {
  const prev = state.badges[channelId];
  if (!badge || badgeSize(badge) === 0) {
    if (!prev) return state;
    return { ...state, badges: withoutKey(state.badges, channelId) };
  }
  if (prev === badge) return state;
  return { ...state, badges: withKey(state.badges, channelId, badge) };
}

/** Advance the newest-message stamp (never backwards). */
function touch(state: UnreadState, channelId: string, at: number, messageId?: string | null): UnreadState {
  if (!at) return state;
  const cur = state.activity[channelId] ?? 0;
  if (at < cur) return state;
  if (at === cur) {
    if (!messageId || state.activityIds[channelId] === messageId) return state;
    return { ...state, activityIds: withKey(state.activityIds, channelId, messageId) };
  }
  return {
    ...state,
    activity: withKey(state.activity, channelId, at),
    activityIds: messageId ? withKey(state.activityIds, channelId, messageId) : withoutKey(state.activityIds, channelId),
  };
}

/** Whether a specific message is covered by the read marker. */
export function isMessageRead(state: UnreadState, channelId: string, messageId: string | null | undefined, at: TimeInput): boolean {
  if (messageId && state.readIds[channelId] === messageId) return true;
  const t = toMs(at);
  const r = state.read[channelId] ?? 0;
  return t > 0 && r > 0 && t <= r;
}

/** Everything known in the conversation is read. */
function coversActivity(state: UnreadState, channelId: string): boolean {
  const act = state.activity[channelId] ?? 0;
  if (!act) return true;
  const id = state.activityIds[channelId];
  if (id && state.readIds[channelId] === id) return true;
  return (state.read[channelId] ?? 0) >= act;
}

/** Drop badge entries the read marker now covers. */
function pruneRead(state: UnreadState, channelId: string): UnreadState {
  const b = state.badges[channelId];
  if (!b) return state;
  // Only a known newest message can prove everything is read; a badge seeded
  // before its conversation's activity is known stays until then.
  if ((state.activity[channelId] ?? 0) > 0 && coversActivity(state, channelId)) return setBadge(state, channelId, null);
  const r = state.read[channelId] ?? 0;
  const rid = state.readIds[channelId];
  let changed = false;
  const ids: Record<string, BadgeEntry> = {};
  for (const [id, e] of Object.entries(b.ids)) {
    if (id === rid || e.at <= r) {
      changed = true;
      continue;
    }
    ids[id] = e;
  }
  return changed ? setBadge(state, channelId, { ids, extra: b.extra }) : state;
}

function applyRead(state: UnreadState, channelId: string, atInput: TimeInput, messageId: string | null | undefined, now: number): UnreadState {
  let at = toMs(atInput);
  // Acking the newest known message reads the whole conversation, even when
  // its stamp is a touch later (server clocks, activity bumped after insert).
  if (messageId && state.activityIds[channelId] === messageId) at = Math.max(at, state.activity[channelId] ?? 0);
  if (!at) return state;
  const cur = state.read[channelId] ?? 0;
  if (at < cur) return state;
  let next = state;
  if (at === cur) {
    if (!messageId || state.readIds[channelId] === messageId) return state;
    next = { ...state, readIds: withKey(state.readIds, channelId, messageId) };
  } else {
    next = {
      ...state,
      read: withKey(state.read, channelId, at),
      // A marker without a message id must not keep pointing at an older
      // message (the "NEW" line would be drawn in the wrong place).
      readIds: messageId ? withKey(state.readIds, channelId, messageId) : withoutKey(state.readIds, channelId),
      readRx: withKey(state.readRx, channelId, now),
    };
  }
  return pruneRead(next, channelId);
}

export function reduceUnread(state: UnreadState, event: UnreadEvent): UnreadState {
  switch (event.type) {
    case "seed_conversations": {
      let next = state;
      const issuedAt = event.issuedAt ?? 0;
      const now = event.now ?? Date.now();
      for (const c of event.conversations) {
        if (!c.channelId) continue;
        const at = toMs(c.lastMessageAt);
        next = touch(next, c.channelId, at, c.lastMessageId ?? null);
        if (c.lastMessageIsOwn && at) next = applyRead(next, c.channelId, at, c.lastMessageId ?? null, now);
        if (typeof c.unread === "number") next = seedCount(next, c.channelId, c.unread, issuedAt);
      }
      return next;
    }

    case "message": {
      const at = toMs(event.at);
      if (!event.channelId || !at) return state;
      const now = event.now ?? Date.now();
      let next = touch(state, event.channelId, at, event.messageId ?? null);
      if (event.own) return applyRead(next, event.channelId, at, event.messageId ?? null, now);
      if (!event.counts || event.viewing || !event.messageId) return next;
      // The ack for this message may have beaten its activity event here.
      if (isMessageRead(next, event.channelId, event.messageId, at)) return next;
      const b = next.badges[event.channelId] ?? { ids: {}, extra: 0 };
      if (event.messageId in b.ids) return next;
      if (badgeSize(b) >= MAX_UNREAD_BADGE) return next;
      next = setBadge(next, event.channelId, { ids: withKey(b.ids, event.messageId, { at, rx: now }), extra: b.extra });
      return next;
    }

    case "read":
      return applyRead(state, event.channelId, event.at, event.messageId, event.now ?? Date.now());

    case "read_all": {
      const ch = event.channelId;
      const b = state.badges[ch];
      let newest = state.activity[ch] ?? 0;
      if (b) for (const e of Object.values(b.ids)) newest = Math.max(newest, e.at);
      let next = state;
      if (newest) next = applyRead(state, ch, newest, state.activityIds[ch] ?? null, event.now ?? Date.now());
      // Counts known only as a number go too: the user asked for "read".
      return setBadge(next, ch, null);
    }

    case "seed_mentions": {
      let next = state;
      for (const m of event.mentions) {
        const at = toMs(m.createdAt);
        if (!m.id || !m.channelId || !at) continue;
        next = touch(next, m.channelId, at, null);
        if (isMessageRead(next, m.channelId, m.id, at)) continue;
        const b = next.badges[m.channelId] ?? { ids: {}, extra: 0 };
        if (m.id in b.ids || badgeSize(b) >= MAX_UNREAD_BADGE) continue;
        next = setBadge(next, m.channelId, { ids: withKey(b.ids, m.id, { at, rx: 0 }), extra: b.extra });
      }
      return next;
    }

    case "reset": {
      const ch = event.channelId;
      const last = toMs(event.lastMessageAt);
      // A reset never introduces a conversation (it's fanned out server-wide,
      // including to members who can't see the channel).
      if (!(ch in state.activity) && !state.badges[ch]) return state;
      let next: UnreadState = state;
      // Roll the newest-message stamp back to what remains (deletions are the
      // one case it may move backwards).
      if (last) {
        if ((next.activity[ch] ?? 0) !== last) {
          next = { ...next, activity: withKey(next.activity, ch, last), activityIds: withoutKey(next.activityIds, ch) };
        }
      } else if (ch in next.activity) {
        next = { ...next, activity: withoutKey(next.activity, ch), activityIds: withoutKey(next.activityIds, ch) };
      }
      const b = next.badges[ch];
      if (!b) return next;
      const deleted = new Set((event.deleted ?? []).map((d) => d.id));
      const ids: Record<string, BadgeEntry> = {};
      for (const [id, e] of Object.entries(b.ids)) {
        if (deleted.has(id)) continue;
        if (!last || e.at > last) continue; // newer than anything left: gone
        ids[id] = e;
      }
      let extra = b.extra;
      // A deleted message we only knew as part of the server count.
      const r = next.read[ch] ?? 0;
      for (const d of event.deleted ?? []) {
        if (d.id in b.ids) continue;
        const dAt = toMs(d.at);
        if (dAt && dAt > r && extra > 0) extra -= 1;
      }
      if (!last || last <= r) extra = 0;
      next = setBadge(next, ch, { ids, extra });
      return pruneRead(next, ch);
    }

    case "retract": {
      const b = state.badges[event.channelId];
      if (!b || !(event.messageId in b.ids)) return state;
      return setBadge(state, event.channelId, { ids: withoutKey(b.ids, event.messageId), extra: b.extra });
    }

    case "forget": {
      const ch = event.channelId;
      let next = setBadge(state, ch, null);
      if (ch in next.activity) {
        next = { ...next, activity: withoutKey(next.activity, ch), activityIds: withoutKey(next.activityIds, ch) };
      }
      return next;
    }
  }
}

/**
 * Reconcile an authoritative server count (issued at `issuedAt`, local ms)
 * with what this device already knows:
 *  - read here after the request went out: the server can't know yet, so
 *    only messages counted since then stay;
 *  - otherwise the server number wins, plus messages that arrived after the
 *    request (which it may not include) when they exceed it.
 */
function seedCount(state: UnreadState, channelId: string, count: number, issuedAt: number): UnreadState {
  const b = state.badges[channelId] ?? { ids: {}, extra: 0 };
  const recent: Record<string, BadgeEntry> = {};
  for (const [id, e] of Object.entries(b.ids)) if (e.rx >= issuedAt && e.rx > 0) recent[id] = e;
  const recentCount = Object.keys(recent).length;
  // A read shortly before the request may still be on its way to the server.
  if (issuedAt > 0 && (state.readRx[channelId] ?? 0) >= issuedAt - ACK_GRACE_MS) {
    return setBadge(state, channelId, { ids: recent, extra: 0 });
  }
  if (count <= 0) return setBadge(state, channelId, { ids: recent, extra: 0 });
  const capped = Math.min(count, MAX_UNREAD_BADGE);
  return pruneRead(setBadge(state, channelId, { ids: recent, extra: Math.max(0, capped - recentCount) }), channelId);
}

// ── Selectors ────────────────────────────────────────────────────────────

/** Badge number for a conversation (mentions in servers, messages in DMs). */
export function badgeCount(state: UnreadState, channelId: string): number {
  return Math.min(badgeSize(state.badges[channelId]), MAX_UNREAD_BADGE);
}

/** The conversation has messages newer than the read marker. */
export function hasUnread(state: UnreadState, channelId: string): boolean {
  return !coversActivity(state, channelId);
}

/** Read marker as ISO strings (drives the "NEW" divider). */
export function readMarkerOf(state: UnreadState, channelId: string): { lastReadAt: string | null; lastReadMessageId: string | null } {
  const r = state.read[channelId];
  return { lastReadAt: r ? new Date(r).toISOString() : null, lastReadMessageId: state.readIds[channelId] ?? null };
}

/** Nothing unread and nothing badged: notifications for it can go. */
export function isCaughtUp(state: UnreadState, channelId: string): boolean {
  return !hasUnread(state, channelId) && badgeCount(state, channelId) === 0;
}

export interface ConversationInfo {
  serverId?: string | null;
}

export interface UnreadSummary {
  /** Servers with an unread, unmuted channel (white rail pill). */
  unreadServers: Set<string>;
  /** Badge sum per server. */
  serverMentions: Map<string, number>;
  /** Badge sum over every DM / group DM (unregistered conversations are DMs). */
  dmBadgeTotal: number;
  /** Same, excluding muted DMs (what the tab title / app badge shows). */
  dmBadgeUnmuted: number;
  /** Badge sum over every server channel. */
  serverMentionTotal: number;
}

/**
 * Aggregates for the server rail, mobile tabs and the tab title. `hidden`
 * conversations (muted, or not viewable any more) never glow; badges on muted
 * conversations still count (Discord keeps mention badges on muted channels).
 */
export function summarize(
  state: UnreadState,
  meta: Readonly<Record<string, ConversationInfo | undefined>>,
  muted: ReadonlySet<string>,
): UnreadSummary {
  const unreadServers = new Set<string>();
  const serverMentions = new Map<string, number>();
  let dmBadgeTotal = 0;
  let dmBadgeUnmuted = 0;
  let serverMentionTotal = 0;
  for (const channelId of Object.keys(state.activity)) {
    const serverId = meta[channelId]?.serverId;
    if (!serverId || muted.has(channelId)) continue;
    if (hasUnread(state, channelId)) unreadServers.add(serverId);
  }
  for (const channelId of Object.keys(state.badges)) {
    const n = badgeCount(state, channelId);
    if (!n) continue;
    const serverId = meta[channelId]?.serverId;
    if (serverId) {
      serverMentions.set(serverId, (serverMentions.get(serverId) ?? 0) + n);
      serverMentionTotal += n;
    } else {
      dmBadgeTotal += n;
      if (!muted.has(channelId)) dmBadgeUnmuted += n;
    }
  }
  return { unreadServers, serverMentions, dmBadgeTotal, dmBadgeUnmuted, serverMentionTotal };
}

/** "(n)" title / favicon / app badge: mentions plus unmuted DM messages. */
export function titleBadgeCount(summary: UnreadSummary): number {
  return summary.serverMentionTotal + summary.dmBadgeUnmuted;
}

/** Ids of the badged messages in a conversation (Inbox "unread" dots). */
export function badgedMessageIds(state: UnreadState, channelId: string): string[] {
  return Object.keys(state.badges[channelId]?.ids ?? {});
}

// ── Persistence (localStorage) ───────────────────────────────────────────

export interface PersistedUnread {
  read: Record<string, string>;
  readIds: Record<string, string>;
  activity: Record<string, string>;
}

/** Rebuild state from persisted ISO maps (badges are re-seeded on start). */
export function hydrateUnread(p: Partial<PersistedUnread>): UnreadState {
  const conv = (m: Record<string, string> | undefined) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m ?? {})) {
      const t = toMs(v);
      if (t) out[k] = t;
    }
    return out;
  };
  return {
    ...EMPTY_UNREAD_STATE,
    read: conv(p.read),
    readIds: { ...(p.readIds ?? {}) },
    activity: conv(p.activity),
  };
}

export function persistUnread(state: UnreadState): PersistedUnread {
  const iso = (m: Readonly<Record<string, number>>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) out[k] = new Date(v).toISOString();
    return out;
  };
  return { read: iso(state.read), readIds: { ...state.readIds }, activity: iso(state.activity) };
}
