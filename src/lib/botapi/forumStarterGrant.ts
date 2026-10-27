/**
 * Forum posts (POST /channels/{forum}/threads) send their first message
 * through the bot message route (POST /channels/{thread}/messages, called
 * in-process), which needs SEND_MESSAGES_IN_THREADS. Discord only asks for
 * SEND_MESSAGES in the forum for a new post, so the thread route grants the
 * starter message once: a short-lived, process-local, single-use entry keyed
 * by thread + bot. Nothing outside the server can create one.
 */
import { processShared } from '@/lib/realtime/processShared';

const GRANT_TTL_MS = 30_000;
const grants = processShared('botapi:forumStarterGrants', () => new Map<string, number>());

const keyOf = (threadId: string, botId: string) => `${threadId.toLowerCase()}|${botId.toLowerCase()}`;

/** Allow `botId` one starter message in the new forum post `threadId`. */
export function grantForumStarter(threadId: string, botId: string): void {
  const now = Date.now();
  for (const [k, exp] of grants) if (exp < now) grants.delete(k);
  grants.set(keyOf(threadId, botId), now + GRANT_TTL_MS);
}

/** Use the grant (true once, within its lifetime). */
export function consumeForumStarter(threadId: string, botId: string): boolean {
  const k = keyOf(threadId, botId);
  const exp = grants.get(k);
  if (exp === undefined) return false;
  grants.delete(k);
  return exp >= Date.now();
}

/** Drop an unused grant (the post failed before its message was sent). */
export function revokeForumStarter(threadId: string, botId: string): void {
  grants.delete(keyOf(threadId, botId));
}
