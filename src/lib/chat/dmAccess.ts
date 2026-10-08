import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
// Pure DM access rules shared by the DM routes (src/lib/api/dms.ts), the raw
// SSE fast path (server.ts) and the generic channel send route (channels.ts).
// No DB access here so the rules can be unit-tested.
import { normalizeId } from '@/lib/db/normalizeId';

export type DmPrivacy = 'everyone' | 'friends' | 'servers';

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeId(a) === normalizeId(b);
}

/**
 * The effective "who can DM me" setting. `users.settings` defaults to `{}` and
 * is only filled with the full defaults once the user saves a setting, so a
 * missing value must resolve to the same default `getDefaultUserSettings()`
 * reports to the client ('everyone').
 */
export function dmPrivacy(settings: unknown): DmPrivacy {
  const value = (settings as { privacy?: { directMessages?: unknown } } | null | undefined)?.privacy?.directMessages;
  return value === 'friends' || value === 'servers' || value === 'everyone' ? value : 'everyone';
}

export interface DmParty {
  id: string;
  friends?: string[] | null;
  blockedUsers?: string[] | null;
  settings?: unknown;
  isSystem?: boolean | null;
}

/** True when either side has blocked the other. */
export function isDmBlocked(a: DmParty, b: DmParty): boolean {
  return (a.blockedUsers || []).some((id) => sameId(id, b.id))
    || (b.blockedUsers || []).some((id) => sameId(id, a.id));
}

/**
 * Whether `sender` may message `recipient` under the recipient's privacy
 * setting (blocks are checked separately so callers can return distinct
 * errors). System users are always reachable.
 */
export function dmPrivacyAllows(sender: DmParty, recipient: DmParty, recipientIsSystem = false): boolean {
  if (recipientIsSystem || recipient.isSystem) return true;
  if ((sender.friends || []).some((id) => sameId(id, recipient.id))) return true;
  return acceptsDmsFromNonFriends(recipient.settings as Parameters<typeof acceptsDmsFromNonFriends>[0]);
}

/** Whether `sender` may open a brand-new DM with `recipient`. */
export function canStartDm(sender: DmParty, recipient: DmParty, recipientIsSystem = false): boolean {
  if (isDmBlocked(sender, recipient)) return false;
  return dmPrivacyAllows(sender, recipient, recipientIsSystem);
}

export interface DmChannelLike {
  id: string;
  type?: string | null;
  recipientIds?: string[] | null;
  createdAt?: Date | string | number | null;
}

function createdAtMs(c: DmChannelLike): number {
  const t = c.createdAt ? new Date(c.createdAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Pick THE 1:1 DM channel between two users out of candidate rows. Requires
 * exactly two recipients that are {a, b} (an `@>` query alone also matches a
 * self-DM [a, a] against any channel containing a). When duplicates already
 * exist, the oldest one wins so every route resolves to the same channel.
 */
export function pickDmChannel<T extends DmChannelLike>(channels: readonly T[], a: string, b: string): T | null {
  const matches = channels.filter((c) => {
    const r = c.recipientIds;
    if (!r || r.length !== 2) return false;
    if (c.type && c.type !== 'dm') return false;
    return (sameId(r[0], a) && sameId(r[1], b)) || (sameId(r[0], b) && sameId(r[1], a));
  });
  if (matches.length === 0) return null;
  return matches.reduce((best, c) => {
    const diff = createdAtMs(c) - createdAtMs(best);
    if (diff < 0) return c;
    if (diff === 0 && String(c.id) < String(best.id)) return c;
    return best;
  });
}

/** Order-independent key for the pair of users in a 1:1 DM. */
export function dmPairKey(a: string, b: string): string {
  const [x, y] = [normalizeId(a), normalizeId(b)].sort();
  return `${x}:${y}`;
}

/**
 * Whether a channel should appear in `viewerId`'s DM list. An empty 1:1 DM
 * (no message yet) is only listed for the user who opened it — the creator is
 * always `recipientIds[0]` — so merely opening, streaming or typing at
 * someone never puts you in their sidebar.
 */
export function isDmListedFor(channel: { type?: string | null; recipientIds?: string[] | null; lastMessageId?: string | null }, viewerId: string): boolean {
  if (channel.type !== 'dm') return true;
  if (channel.lastMessageId) return true;
  return sameId(channel.recipientIds?.[0], viewerId);
}
