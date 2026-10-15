/**
 * Server side of Discord-shaped messages for bots: loads everything a page of
 * message rows needs (authors, mentioned users, webhooks, reply targets, poll
 * tallies, forwards, thread positions, guild members) in batches and hands it
 * to the pure serializer in src/lib/chat/discordMessage.ts. Used by the bot
 * REST API (src/lib/api/botApi.ts) and the gateway emitters
 * (src/lib/services/gatewayEvents.ts), so both see the same object.
 *
 * Also: the enforce_nonce dedupe slot (Redis) for bot message creates.
 */
import { Message, User, ChannelWebhook, ServerMember, type IMessage } from '@/lib/models';
import { decryptFromStorage } from '@/lib/security';
import { getRedis } from '@/lib/db/redis';
import { parseStoredForward } from '@/lib/chat/forward';
import { parseStoredPoll } from '@/lib/chat/polls';
import {
  serializeMessage,
  type DiscordMessage,
  type ForwardSnapshotLike,
  type MemberLike,
  type UserLike,
  type WebhookLike,
} from '@/lib/chat/discordMessage';
import { interpretNonceSlot, NONCE_PENDING, NONCE_TTL_SECONDS } from '@/lib/chat/messageNonce';

const lower = (s: string) => String(s).toLowerCase();

async function decrypt(content: string | null | undefined): Promise<string> {
  if (!content) return '';
  try {
    return await decryptFromStorage(content);
  } catch {
    return '';
  }
}

export interface LoadOptions {
  /** The bot reading the messages (reactions `me`, poll `me_voted`). */
  viewerId?: string | null;
  /** Gateway payloads: guild_id + the author's partial member. */
  gateway?: boolean;
  /** Thread channel: compute `position`. */
  isThread?: boolean;
  /** Echoed `nonce` per message id. */
  nonces?: ReadonlyMap<string, string | number>;
}

async function loadUsers(ids: string[]): Promise<Map<string, UserLike>> {
  const out = new Map<string, UserLike>();
  const unique = [...new Set(ids.filter(Boolean).map(lower))];
  if (unique.length === 0) return out;
  const users = await User.find({ id: { in: unique } }).catch(() => []);
  for (const u of users as Array<UserLike & { id: string }>) out.set(lower(u.id), u);
  // Discord-bridged authors live in their own table.
  const missing = unique.filter((id) => !out.has(id));
  if (missing.length > 0) {
    const { DiscordUser } = await import('@/lib/models/DiscordUser');
    const bridged = await DiscordUser.findMany(missing).catch(() => []);
    for (const d of bridged) {
      out.set(lower(d.id), { id: d.id, username: d.username || `discord-${d.discordId}`, displayName: d.displayName, avatar: d.avatar, isBot: Boolean(d.isBot) });
    }
  }
  return out;
}

async function loadWebhooks(ids: string[]): Promise<Map<string, WebhookLike>> {
  const out = new Map<string, WebhookLike>();
  if (ids.length === 0) return out;
  const hooks = await ChannelWebhook.find({ id: { in: ids } }).catch(() => []);
  for (const w of hooks as Array<{ id: string; name?: string | null; avatar?: string | null }>) {
    out.set(lower(w.id), { id: w.id, name: w.name ?? null, avatar: w.avatar ?? null });
  }
  return out;
}

async function loadMembers(serverId: string, userIds: string[]): Promise<Map<string, MemberLike>> {
  const out = new Map<string, MemberLike>();
  if (userIds.length === 0) return out;
  const rows = await ServerMember.find({ serverId, userId: { in: userIds } }).catch(() => []);
  for (const m of rows as Array<MemberLike & { userId: string }>) out.set(lower(m.userId), m);
  return out;
}

/**
 * Serialize message rows (any mix of channels) as Discord message objects, in
 * the same order. Rows must be ones the viewer may read.
 */
export async function loadDiscordMessages(rows: IMessage[], opts: LoadOptions = {}): Promise<DiscordMessage[]> {
  if (rows.length === 0) return [];
  const replyIds = [...new Set(rows.filter((r) => r.type === 'reply' && r.referencedMessageId).map((r) => lower(r.referencedMessageId!)))];
  const [contents, referencedRows] = await Promise.all([
    Promise.all(rows.map((r) => decrypt(r.content))),
    replyIds.length ? Message.find({ id: { in: replyIds } }).catch(() => [] as IMessage[]) : Promise.resolve([] as IMessage[]),
  ]);
  const referencedById = new Map<string, IMessage>();
  for (const r of referencedRows as IMessage[]) if (!r.isDeleted) referencedById.set(lower(r.id), r);

  const userIds: string[] = [];
  for (const r of [...rows, ...referencedById.values()]) {
    userIds.push(r.authorId);
    for (const id of (r.mentionedUserIds ?? []) as string[]) userIds.push(id);
  }
  const pollIds = rows.filter((r) => r.type !== 'poll_result' && parseStoredPoll(r.poll)).map((r) => r.id);
  const [users, tallies, refContents, forwards] = await Promise.all([
    loadUsers(userIds),
    pollIds.length
      ? import('@/lib/services/messageExtras').then((m) => m.loadPollTallies(pollIds, opts.viewerId ?? null)).catch(() => new Map())
      : Promise.resolve(new Map()),
    Promise.all([...referencedById.values()].map(async (r) => [lower(r.id), await decrypt(r.content)] as const)),
    Promise.all(rows.map(async (r): Promise<ForwardSnapshotLike | null> => {
      const stored = r.messageSnapshot ? parseStoredForward(r.messageSnapshot) : null;
      if (!stored) return null;
      return {
        messageId: stored.messageId,
        channelId: stored.channelId,
        serverId: stored.serverId,
        content: await decrypt(stored.content),
        attachments: stored.attachments,
        embeds: stored.embeds,
        sticker: stored.sticker,
        createdAt: stored.createdAt,
        edited: stored.edited,
      };
    })),
  ]);
  const unknownAuthors = [...new Set(rows.map((r) => lower(r.authorId)).filter((id) => !users.has(id)))];
  const webhooks = await loadWebhooks(unknownAuthors);

  // Guild members of the authors (gateway payloads only), per server.
  const members = new Map<string, Map<string, MemberLike>>();
  if (opts.gateway) {
    const byServer = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.serverId) continue;
      const set = byServer.get(lower(r.serverId)) ?? new Set<string>();
      set.add(r.authorId);
      byServer.set(lower(r.serverId), set);
    }
    await Promise.all([...byServer].map(async ([sid, ids]) => members.set(sid, await loadMembers(sid, [...ids]))));
  }

  const positions = opts.isThread && rows[0]
    ? await Message.threadPositions(rows[0].channelId, rows.map((r) => r.id)).catch(() => new Map<string, number>())
    : new Map<string, number>();

  const refContentById = new Map(refContents);
  const referencedSerialized = new Map<string, DiscordMessage>();
  for (const [id, ref] of referencedById) {
    referencedSerialized.set(id, serializeMessage({ ...ref, content: refContentById.get(id) ?? '' }, {
      viewerId: opts.viewerId,
      users,
      webhooks,
      includeGuildId: opts.gateway,
    }));
  }

  return rows.map((r, i) => serializeMessage({ ...r, content: contents[i] }, {
    viewerId: opts.viewerId,
    users,
    webhooks,
    includeGuildId: opts.gateway,
    authorMember: opts.gateway && r.serverId ? members.get(lower(r.serverId))?.get(lower(r.authorId)) ?? null : null,
    referenced: r.referencedMessageId ? referencedSerialized.get(lower(r.referencedMessageId)) ?? null : null,
    pollTally: (tallies as Map<string, { counts: Record<number, number>; myVotes: number[] }>).get(r.id) ?? null,
    forward: forwards[i],
    position: positions.get(lower(r.id)) ?? null,
    nonce: opts.nonces?.get(lower(r.id)) ?? null,
  }));
}

/** One message as a gateway payload (guild_id + member), or null when it no longer exists. */
export async function loadGatewayMessage(messageId: string, extras: { nonce?: string | number | null } = {}): Promise<DiscordMessage | null> {
  const row = await Message.findById(messageId).catch(() => null);
  if (!row) return null;
  const [msg] = await loadDiscordMessages([row], {
    gateway: true,
    nonces: extras.nonce !== undefined && extras.nonce !== null ? new Map([[lower(row.id), extras.nonce]]) : undefined,
  });
  return msg ?? null;
}

/**
 * CHANNEL_PINS_UPDATE for bots after any pin or unpin (users, bots, DMs), with
 * the newest remaining pin time. Fire-and-forget.
 */
export function notifyPinsChanged(channel: { id: string; serverId?: string | null }): void {
  void (async () => {
    const last = await Message.lastPinTimestamp(channel.id).catch(() => null);
    const { emitChannelPinsUpdate } = await import('./gatewayEvents');
    await emitChannelPinsUpdate({ channelId: channel.id, guildId: channel.serverId ?? null, lastPinTimestamp: last });
  })().catch(() => {});
}

/**
 * Voters for one poll answer, ordered by user id, strictly after `after`
 * (GET /channels/{id}/polls/{message}/answers/{answer}).
 */
export async function pollAnswerVoterIds(messageId: string, answerId: number, opts: { after?: string | null; limit: number }): Promise<string[]> {
  const { and, asc, eq, gt } = await import('drizzle-orm');
  const { db, schema } = await import('@/lib/db/postgres');
  const { normalizeId } = await import('@/lib/db/normalizeId');
  const pv = schema.pollVotes;
  const rows = await db.select({ userId: pv.userId }).from(pv)
    .where(and(
      eq(pv.messageId, normalizeId(messageId)),
      eq(pv.answerId, answerId),
      opts.after ? gt(pv.userId, normalizeId(opts.after)) : undefined,
    ))
    .orderBy(asc(pv.userId))
    .limit(Math.max(1, Math.min(100, opts.limit)));
  return rows.map((r) => r.userId);
}

// ─── enforce_nonce ─────────────────────────────────────────

export type NonceClaim =
  | { kind: 'claimed' }
  | { kind: 'existing'; messageId: string }
  /** Redis unavailable: dedupe can't be enforced, create normally. */
  | { kind: 'unavailable' };

/**
 * Reserve `key` for a new message, or find the message an earlier request
 * with the same nonce created. A concurrent request still creating is waited
 * for (up to ~3 s).
 */
export async function claimNonce(key: string): Promise<NonceClaim> {
  const redis = getRedis();
  if (!redis) return { kind: 'unavailable' };
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const set = await redis.set(key, NONCE_PENDING, 'EX', NONCE_TTL_SECONDS, 'NX');
      if (set === 'OK') return { kind: 'claimed' };
      const slot = interpretNonceSlot(await redis.get(key));
      if (slot.action === 'existing') return { kind: 'existing', messageId: slot.messageId };
      if (slot.action === 'create') continue; // expired between SET and GET
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    return { kind: 'unavailable' };
  }
  return { kind: 'unavailable' };
}

/** Record the created message for `key` (or release the slot when the create failed). */
export async function settleNonce(key: string, messageId: string | null): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (messageId) await redis.set(key, messageId, 'EX', NONCE_TTL_SECONDS);
    else await redis.del(key);
  } catch { /* best-effort */ }
}
