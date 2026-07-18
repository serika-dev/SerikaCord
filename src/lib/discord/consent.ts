import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { DiscordUser } from '@/lib/models/DiscordUser';

/**
 * Erase all bridged data Serika holds for a Discord user who has withdrawn (or
 * declined) consent. Deletes every message authored by their bridged profile,
 * then removes the DiscordUser profile row itself.
 *
 * Called when a Discord user presses "Decline" on the consent DM, and available
 * for admin/data-deletion requests. Satisfies the Developer ToS requirement to
 * delete API Data on user request / when no longer necessary.
 */
export async function deleteBridgedUserData(discordId: string, opts?: { forgetProfile?: boolean }): Promise<{ deletedMessages: number }> {
  const profile = await DiscordUser.findByDiscordId(discordId);
  if (!profile) return { deletedMessages: 0 };

  // Delete messages authored by this bridged (non-linked) profile.
  const deleted = await db
    .delete(schema.messages)
    .where(eq(schema.messages.authorId, profile.id))
    .returning({ id: schema.messages.id });

  if (opts?.forgetProfile) {
    // Full erasure (e.g. an admin "forget me" request): drop the row entirely.
    await db.delete(schema.discordUsers).where(eq(schema.discordUsers.id, profile.id));
  } else {
    // Decline flow: scrub stored PII but keep the 'denied' decision so we don't
    // re-prompt them and can keep enforcing any restriction.
    await db
      .update(schema.discordUsers)
      .set({ avatar: null, displayName: 'Discord user', consentStatus: 'denied', consentUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.discordUsers.id, profile.id));
  }

  return { deletedMessages: deleted.length };
}
