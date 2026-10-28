// Server side of DM privacy: the servers two users share, looked up only when
// the recipient's setting needs them ("server members" mode or per-server
// overrides). The decision itself is pure: lib/settings/privacy.ts
// (dmAllowedFromNonFriend), used through lib/chat/dmAccess.ts and dmPolicy.ts.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { dmNeedsSharedServers } from '@/lib/settings/privacy';
import { isSystemUser } from '@/lib/services/systemUsers';

type Sender = { id: string; friends?: string[] | null };
type Recipient = { id: string; settings?: unknown; isSystem?: boolean | null };

/** Server ids both users are members of. Fails closed (empty) on errors. */
export async function sharedServerIds(a: string, b: string): Promise<string[]> {
  try {
    const theirs = db
      .select({ serverId: schema.serverMembers.serverId })
      .from(schema.serverMembers)
      .where(eq(schema.serverMembers.userId, normalizeId(b)));
    const rows = await db
      .select({ serverId: schema.serverMembers.serverId })
      .from(schema.serverMembers)
      .where(and(eq(schema.serverMembers.userId, normalizeId(a)), inArray(schema.serverMembers.serverId, theirs)));
    return rows.map((r) => r.serverId);
  } catch {
    return [];
  }
}

/**
 * The shared servers to pass to `dmSendDenyReason` / `canStartDm`, or
 * undefined when the decision doesn't need them (friends, system users, or a
 * recipient who takes DMs from everyone), so most sends skip the query.
 */
export async function dmSharedServers(sender: Sender, recipient: Recipient): Promise<string[] | undefined> {
  if (recipient.isSystem || isSystemUser(recipient.id)) return undefined;
  const target = normalizeId(recipient.id);
  if ((sender.friends || []).some((f) => normalizeId(f) === target)) return undefined;
  if (!dmNeedsSharedServers(recipient.settings)) return undefined;
  return sharedServerIds(sender.id, recipient.id);
}
