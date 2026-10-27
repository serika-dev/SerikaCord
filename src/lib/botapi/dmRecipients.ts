/**
 * DM / group DM channel objects for the bot API with real `recipients`
 * (Discord user objects, the calling bot itself left out, like Discord).
 * toDiscordChannel (src/lib/services/gatewayEvents.ts) only knows the ids.
 */
import { User } from '@/lib/models';
import { toDiscordUserRow } from '@/lib/services/gatewayEvents';

type ChannelObject = Record<string, unknown>;
type DmRow = { type?: string | null; recipientIds?: string[] | null };

const isDm = (c: DmRow) => c.type === 'dm' || c.type === 'group_dm';

/** Recipient ids of a DM row other than `viewerId` (de-duplicated, case-insensitive). */
export function otherRecipientIds(row: DmRow, viewerId: string): string[] {
  const me = viewerId.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of row.recipientIds ?? []) {
    const k = String(id).toLowerCase();
    if (k === me || seen.has(k)) continue;
    seen.add(k);
    out.push(String(id));
  }
  return out;
}

/**
 * `objects[i]` is the Discord channel object of `rows[i]`. DM ones get
 * `recipients` as full user objects (one user lookup for the whole batch);
 * other channel types are returned unchanged.
 */
export async function withRecipientUsers<T extends ChannelObject>(objects: T[], rows: DmRow[], viewerId: string): Promise<T[]> {
  const wanted = new Set<string>();
  rows.forEach((r) => { if (isDm(r)) for (const id of otherRecipientIds(r, viewerId)) wanted.add(id.toLowerCase()); });
  if (wanted.size === 0) return objects.map((o, i) => (isDm(rows[i]) ? { ...o, recipients: [] } : o));
  const users = await User.find({ id: { in: [...wanted] } }).catch(() => []);
  const byId = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  return objects.map((o, i) => {
    const row = rows[i];
    if (!isDm(row)) return o;
    const recipients = otherRecipientIds(row, viewerId)
      .map((id) => byId.get(id.toLowerCase()))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => toDiscordUserRow(u as Parameters<typeof toDiscordUserRow>[0]));
    return { ...o, recipients };
  });
}
