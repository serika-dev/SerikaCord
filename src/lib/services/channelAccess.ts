/**
 * Who sees which channel just changed in a server (overwrites edited, a channel
 * created / moved / deleted, a role's permissions or a member's roles changed).
 *
 * - Clients refetch their channel list (`channel_access_changed`, ids only; the
 *   list route filters per viewer), so a channel hidden from someone leaves
 *   their sidebar at once and a newly granted one appears.
 * - Open text and voice streams are re-checked now instead of on the 60 s
 *   backstop, so someone who lost access stops receiving messages and leaves
 *   the call. Other instances drop their cached role permissions first.
 *
 * Pass `userIds` when only those members are affected (their roles changed);
 * otherwise every member of the server refetches and every open stream of the
 * server's channels is re-checked. `channelIds` adds channels that no longer
 * exist (a delete). Calls for one server within DEBOUNCE_MS are merged (a bulk
 * edit sends one signal); one server-wide call covers any per-user ones.
 * Fire-and-forget.
 */
import { Channel } from '@/lib/models';
import { normalizeId } from '@/lib/db/normalizeId';
import { requestChannelStreamsRecheck, requestUserChannelStreamRecheck } from '@/lib/realtime/channelStreams';
import { processShared } from '@/lib/realtime/processShared';

const DEBOUNCE_MS = 400;

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  everyone: boolean;
  userIds: Set<string>;
  channelIds: Set<string>;
}

const pendingByServer = processShared('channelAccessPending', () => new Map<string, Pending>());

export function channelAccessChanged(
  serverId: string | null | undefined,
  opts: { userIds?: string[]; channelIds?: string[] } = {},
): void {
  if (!serverId) return;
  const sid = normalizeId(serverId);
  let pending = pendingByServer.get(sid);
  if (!pending) {
    pending = {
      timer: setTimeout(() => {
        pendingByServer.delete(sid);
        void flush(sid, pending!).catch(() => { /* best-effort */ });
      }, DEBOUNCE_MS),
      everyone: false,
      userIds: new Set(),
      channelIds: new Set(),
    };
    pendingByServer.set(sid, pending);
  }
  if (opts.userIds) for (const id of opts.userIds) pending.userIds.add(normalizeId(id));
  else pending.everyone = true;
  for (const id of opts.channelIds ?? []) pending.channelIds.add(normalizeId(id));
}

async function flush(serverId: string, pending: Pending): Promise<void> {
  const { fanoutToUsers } = await import('@/lib/api/activity');
  if (pending.everyone) {
    const channels = await Channel.find({ serverId }).catch(() => []);
    requestChannelStreamsRecheck([...new Set([...channels.map((c) => normalizeId(c.id)), ...pending.channelIds])], serverId);
    await fanoutToUsers({ serverId }, { type: 'channel_access_changed', serverId });
    return;
  }
  if (pending.channelIds.size > 0) requestChannelStreamsRecheck([...pending.channelIds], serverId);
  const userIds = [...pending.userIds];
  if (userIds.length === 0) return;
  for (const id of userIds) requestUserChannelStreamRecheck(id);
  await fanoutToUsers({ userIds }, { type: 'channel_access_changed', serverId });
}
