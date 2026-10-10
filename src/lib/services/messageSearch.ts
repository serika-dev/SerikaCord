// Server-side message search: the blind index, its backfill and the query.
//
// WHY A BLIND INDEX
// -----------------
// Message content is AES-GCM encrypted at rest (encryptForStorage), so Postgres
// can't LIKE/full-text it, and the old search decrypted the newest ~400 rows of
// one channel in memory: anything older was unfindable. Instead every message
// gets one row in `message_search_index` holding short keyed hashes of its
// normalized words and word prefixes (src/lib/chat/searchTokens.ts):
//
//   term hash = base64url(HMAC-SHA256(searchKey, "w:" + word | "p:" + prefix))[0..11]
//   searchKey = SHA-256("serika:message-search:v1\0" + platform encryption key)
//
// A query hashes its words the same way and asks the GIN index for rows whose
// `terms` overlap each word's {word, prefix} pair. Hits are then decrypted and
// re-checked against the plaintext (drops the odd hash collision) and scored
// for "Most Relevant".
//
// TRADEOFF: no plaintext lands in the index, but it is a deterministic keyed
// index: someone holding the database alone (without the platform key) can see
// which messages share a word, not what the word is. Substring search inside a
// word (e.g. "ploy" in "deploy") isn't supported; prefixes are, like Discord.
// Everything that isn't content (author, mentions, pinned, attachments,
// embeds, stickers, dates) is filtered on the plaintext `messages` columns.
//
// Old messages are indexed by a background backfill (startSearchBackfill),
// leader-locked in Redis; until it finishes, responses carry `indexing: true`
// so the UI can say older results may be missing.
import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { createHash, createHmac } from 'crypto';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { normalizeId } from '@/lib/db/normalizeId';
import { getEncryptionKey } from '@/lib/models/PlatformSettings';
import { decryptFromStorage } from '@/lib/security/encryption';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import {
  CONTENT_FLAG,
  contentFlags,
  extraSearchText,
  indexTerms,
  matchesAllTerms,
  queryTerms,
  relevanceScore,
} from '@/lib/chat/searchTokens';
import type { SearchAuthorType, SearchHas, SearchSort } from '@/lib/chat/searchQuery';

const INDEX_VERSION = 1;
const m = schema.messages;
const s = schema.messageSearchIndex;

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_message_search_index.sql. Additive + idempotent; the
// statements touch only the new table, and never wait long behind a lock.
const g = globalThis as unknown as {
  __messageSearchSchema?: Promise<boolean> | null;
  __messageSearchBackfill?: boolean;
};

export function ensureMessageSearchSchema(): Promise<boolean> {
  if (g.__messageSearchSchema) return g.__messageSearchSchema;
  g.__messageSearchSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "message_search_index" (
            "message_id" uuid PRIMARY KEY NOT NULL,
            "channel_id" uuid NOT NULL,
            "terms" text[] DEFAULT '{}'::text[] NOT NULL,
            "flags" integer DEFAULT 0 NOT NULL,
            "version" integer DEFAULT 1 NOT NULL,
            "indexed_at" timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "message_search_index_terms_gin_idx" ON "message_search_index" USING gin ("terms")`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "message_search_index_channel_id_idx" ON "message_search_index" ("channel_id")`);
        });
        return true;
      } catch (err) {
        console.error(`[search] Ensuring message search schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__messageSearchSchema = null;
    return false;
  })();
  return g.__messageSearchSchema;
}

// ─── Term hashing ─────────────────────────────────────────────────────────────
let termKey: Buffer | null = null;

async function getTermKey(): Promise<Buffer> {
  if (termKey) return termKey;
  const platformKey = await getEncryptionKey();
  termKey = createHash('sha256').update('serika:message-search:v1\0').update(platformKey).digest();
  return termKey;
}

function hashTerm(key: Buffer, kind: 'w' | 'p', term: string): string {
  return createHmac('sha256', key).update(`${kind}:${term}`).digest('base64url').slice(0, 11);
}

// ─── Indexing ─────────────────────────────────────────────────────────────────
type IndexableMessage = {
  id: string;
  channelId: string;
  content?: string | null;
  embeds?: unknown;
  attachments?: unknown;
  isDeleted?: boolean | null;
};

/** The plaintext a message is searchable by (content + embed text + file names). */
async function searchableText(msg: Pick<IndexableMessage, 'content' | 'embeds' | 'attachments'>): Promise<{ content: string; full: string }> {
  let content = '';
  try {
    content = decodeHtmlEntities(await decryptFromStorage(msg.content || ''));
  } catch {
    content = '';
  }
  const extra = extraSearchText(msg.embeds, msg.attachments);
  return { content, full: extra ? `${content}\n${extra}` : content };
}

async function buildIndexRow(msg: IndexableMessage) {
  const key = await getTermKey();
  const { content, full } = await searchableText(msg);
  const { words, prefixes } = indexTerms(full);
  const terms: string[] = [];
  for (const w of words) terms.push(hashTerm(key, 'w', w));
  for (const p of prefixes) terms.push(hashTerm(key, 'p', p));
  return {
    messageId: normalizeId(msg.id),
    channelId: normalizeId(msg.channelId),
    terms: Array.from(new Set(terms)),
    flags: contentFlags(content),
    version: INDEX_VERSION,
    indexedAt: new Date(),
  };
}

/** Index (or re-index) one message. Deleted messages are removed instead. */
export async function indexMessage(msg: IndexableMessage): Promise<void> {
  if (!(await ensureMessageSearchSchema())) return;
  if (msg.isDeleted) {
    await removeFromSearchIndex(msg.id);
    return;
  }
  const row = await buildIndexRow(msg);
  await db.insert(s).values(row).onConflictDoUpdate({
    target: s.messageId,
    set: { terms: row.terms, flags: row.flags, version: row.version, indexedAt: row.indexedAt },
  });
}

export async function removeFromSearchIndex(messageId: string): Promise<void> {
  if (!(await ensureMessageSearchSchema())) return;
  await db.delete(s).where(eq(s.messageId, normalizeId(messageId)));
}

/** Best-effort cleanup after a channel's messages were hard-deleted. */
export async function removeChannelsFromSearchIndex(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return;
  if (!(await ensureMessageSearchSchema())) return;
  await db.delete(s).where(inArray(s.channelId, channelIds.map((id) => normalizeId(id))));
}

/**
 * Fire-and-forget hook used by the Message model after every create/update,
 * so every write path (user sends, bots, webhooks, bridges, system DMs, edits,
 * deletes) keeps the index in step without each route remembering to.
 */
export function queueSearchIndex(row: IndexableMessage | null | undefined, changed: { content?: boolean; deleted?: boolean; extras?: boolean }): void {
  if (!row) return;
  if (!changed.content && !changed.deleted && !changed.extras) return;
  void indexMessage(row).catch((err) => {
    console.error('[search] Indexing message failed:', (err as Error)?.message ?? err);
  });
}

// ─── Backfill ─────────────────────────────────────────────────────────────────
const BACKFILL_STATE_KEY = 'search:backfill:v1:state';
const BACKFILL_DONE_KEY = 'search:backfill:v1:done';
const BACKFILL_LOCK_KEY = 'search:backfill:v1:lock';
const BACKFILL_BATCH = 200;
const BACKFILL_PAUSE_MS = 750;
const BACKFILL_LOCK_TTL_S = 60;

type BackfillState = { channelId: string | null; before: string | null };

let doneCache: { value: boolean; at: number } | null = null;

/** Whether the history backfill has finished (cached for a minute). */
export async function isSearchIndexComplete(): Promise<boolean> {
  if (doneCache && Date.now() - doneCache.at < 60_000) return doneCache.value;
  const redis = getRedis();
  let value = false;
  try {
    value = redis ? (await redis.get(BACKFILL_DONE_KEY)) === '1' : false;
  } catch {
    value = false;
  }
  doneCache = { value, at: Date.now() };
  return value;
}

/**
 * Index existing history, one channel at a time (channel id order), newest
 * message first inside a channel, through the (channel_id, created_at) index.
 * Gentle: small batches with a pause between them. One instance runs it at a
 * time (Redis lock); progress survives restarts. Idempotent: rows that are
 * already indexed are skipped. Disable with DISABLE_SEARCH_BACKFILL=1.
 */
export function startSearchBackfill(instanceId: string): void {
  if (g.__messageSearchBackfill) return;
  if (process.env.DISABLE_SEARCH_BACKFILL === '1') return;
  g.__messageSearchBackfill = true;
  void runBackfill(instanceId).catch((err) => {
    console.error('[search] Backfill stopped:', (err as Error)?.message ?? err);
    g.__messageSearchBackfill = false;
  });
}

async function runBackfill(instanceId: string): Promise<void> {
  if (!(await ensureMessageSearchSchema())) {
    g.__messageSearchBackfill = false;
    return;
  }
  const redis = getRedis();
  if (redis && (await redis.get(BACKFILL_DONE_KEY)) === '1') return;

  // Wait for leadership (another instance may already be backfilling).
  if (redis) {
    for (;;) {
      const got = await redis.set(BACKFILL_LOCK_KEY, instanceId, 'EX', BACKFILL_LOCK_TTL_S, 'NX').catch(() => null);
      if (got === 'OK' || (await redis.get(BACKFILL_LOCK_KEY).catch(() => null)) === instanceId) break;
      if ((await redis.get(BACKFILL_DONE_KEY).catch(() => null)) === '1') return;
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }

  let state: BackfillState = { channelId: null, before: null };
  if (redis) {
    try {
      const raw = await redis.get(BACKFILL_STATE_KEY);
      if (raw) state = JSON.parse(raw) as BackfillState;
    } catch { /* start over: indexing is idempotent */ }
  }

  console.log('[search] Backfilling the message search index...');
  let indexed = 0;
  for (;;) {
    // Current channel (resume) or the next one in id order.
    let channelId = state.channelId;
    if (!channelId) {
      const [next] = await db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .orderBy(asc(schema.channels.id))
        .limit(1);
      channelId = next?.id ?? null;
      state = { channelId, before: null };
    }
    if (!channelId) break;

    const conds: SQL[] = [eq(m.channelId, channelId)];
    if (state.before) conds.push(lt(m.createdAt, new Date(state.before)));
    const rows = await db
      .select({
        id: m.id,
        channelId: m.channelId,
        content: m.content,
        embeds: m.embeds,
        attachments: m.attachments,
        isDeleted: m.isDeleted,
        createdAt: m.createdAt,
        indexed: sql<boolean>`EXISTS (SELECT 1 FROM message_search_index si WHERE si.message_id = ${m.id})`,
      })
      .from(m)
      .where(and(...conds))
      .orderBy(desc(m.createdAt))
      .limit(BACKFILL_BATCH);

    const todo = rows.filter((r) => !r.indexed && !r.isDeleted);
    if (todo.length > 0) {
      const values = await Promise.all(todo.map((r) => buildIndexRow(r)));
      await db.insert(s).values(values).onConflictDoNothing();
      indexed += values.length;
    }

    const lastCreated = rows.length > 0 ? rows[rows.length - 1].createdAt : null;
    if (rows.length < BACKFILL_BATCH || !lastCreated) {
      // Channel finished: move to the next channel id.
      const [next] = await db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(sql`${schema.channels.id} > ${channelId}`)
        .orderBy(asc(schema.channels.id))
        .limit(1);
      state = { channelId: next?.id ?? null, before: null };
      if (!next) break;
    } else {
      state = { channelId, before: new Date(lastCreated).toISOString() };
    }

    if (redis) {
      await redis.set(BACKFILL_STATE_KEY, JSON.stringify(state)).catch(() => {});
      await redis.expire(BACKFILL_LOCK_KEY, BACKFILL_LOCK_TTL_S).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, BACKFILL_PAUSE_MS));
  }

  if (redis) {
    await redis.set(BACKFILL_DONE_KEY, '1').catch(() => {});
    await redis.del(BACKFILL_STATE_KEY, BACKFILL_LOCK_KEY).catch(() => {});
  }
  doneCache = { value: true, at: Date.now() };
  console.log(`[search] Message search backfill finished (${indexed} messages indexed).`);
}

// ─── Query ────────────────────────────────────────────────────────────────────
export interface MessageSearchParams {
  /** Channels the searcher may read (already permission-filtered). */
  channelIds: string[];
  text?: string;
  authorIds?: string[];
  mentionIds?: string[];
  has?: SearchHas[];
  pinned?: boolean;
  authorTypes?: SearchAuthorType[];
  minTime?: Date | null;
  maxTime?: Date | null;
  sort?: SearchSort;
  offset?: number;
  limit?: number;
}

export type SearchMessageRow = typeof schema.messages.$inferSelect;

export interface MessageSearchResult {
  total: number;
  /** How many of `total` can be reached by paging (relevance sorts a window). */
  pageable: number;
  rows: SearchMessageRow[];
  /** Decrypted (entity-decoded) content by message id. */
  contents: Map<string, string>;
}

export const SEARCH_PAGE_SIZE = 25;
export const SEARCH_MAX_OFFSET = 5000;
const COUNT_CAP = 10_000;
const RELEVANCE_WINDOW = 250;

const ATTACH_ARRAY_SQL = `(CASE WHEN jsonb_typeof("messages"."attachments") = 'array' THEN "messages"."attachments" ELSE '[]'::jsonb END)`;
const EMBED_ARRAY_SQL = `(CASE WHEN jsonb_typeof("messages"."embeds") = 'array' THEN "messages"."embeds" ELSE '[]'::jsonb END)`;
const ATTACH_ARRAY = sql.raw(ATTACH_ARRAY_SQL);
const EMBED_ARRAY = sql.raw(EMBED_ARRAY_SQL);

const IMAGE_EXT = 'png|jpe?g|gif|webp|bmp|avif|svg';
const VIDEO_EXT = 'mp4|webm|mov|mkv|m4v|avi';
const SOUND_EXT = 'mp3|ogg|wav|flac|m4a|opus|aac';

/** An attachment of this MIME family (or, for legacy rows, file extension). Constants only. */
function attachmentKind(mime: 'image' | 'video' | 'audio', extPattern: string): SQL {
  return sql.raw(
    `EXISTS (SELECT 1 FROM jsonb_array_elements(${ATTACH_ARRAY_SQL}) a ` +
    `WHERE COALESCE(a->>'contentType', a->>'content_type', '') LIKE '${mime}/%' ` +
    `OR COALESCE(a->>'url', a->>'filename', a #>> '{}', '') ~* '\\.(${extPattern})(\\?|$)')`,
  );
}

/** A rich/link embed carrying an image or video. Constants only. */
function embedHas(kind: 'image' | 'video'): SQL {
  return sql.raw(
    `EXISTS (SELECT 1 FROM jsonb_array_elements(${EMBED_ARRAY_SQL}) e ` +
    `WHERE e->'${kind}'->>'url' IS NOT NULL OR e->>'type' = '${kind}')`,
  );
}

/** Builds the WHERE for a search; `terms` are pre-hashed per query word. */
function buildConditions(p: MessageSearchParams, termPairs: string[][]): SQL[] {
  const channelIds = p.channelIds.map((id) => normalizeId(id));
  const conds: SQL[] = [
    inArray(m.channelId, channelIds),
    sql`${m.isDeleted} IS NOT TRUE`,
    sql`(${m.type} IS NULL OR ${m.type} IN ('default', 'reply', 'system'))`,
  ];

  // Content terms + link flag go through the blind index.
  const indexConds: SQL[] = [];
  for (const pair of termPairs) {
    indexConds.push(sql`si.terms && ARRAY[${sql.join(pair.map((h) => sql`${h}`), sql`, `)}]::text[]`);
  }
  const has = new Set(p.has || []);
  if (has.has('link')) indexConds.push(sql.raw(`(si.flags & ${CONTENT_FLAG.LINK}) <> 0`));
  if (indexConds.length > 0) {
    conds.push(sql`${m.id} IN (SELECT si.message_id FROM message_search_index si WHERE si.channel_id IN (${sql.join(channelIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND ${sql.join(indexConds, sql` AND `)})`);
  }

  const flagged = (flag: number) =>
    sql`${m.id} IN (SELECT si.message_id FROM message_search_index si WHERE si.channel_id IN (${sql.join(channelIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND (si.flags & ${flag}) <> 0)`;

  if (has.has('file')) conds.push(sql`jsonb_array_length(${ATTACH_ARRAY}) > 0`);
  if (has.has('embed')) conds.push(sql`jsonb_array_length(${EMBED_ARRAY}) > 0 AND ${m.suppressEmbeds} IS NOT TRUE`);
  if (has.has('image')) conds.push(or(attachmentKind('image', IMAGE_EXT), embedHas('image'), flagged(CONTENT_FLAG.IMAGE_URL))!);
  if (has.has('video')) conds.push(or(attachmentKind('video', VIDEO_EXT), embedHas('video'), flagged(CONTENT_FLAG.VIDEO_URL))!);
  if (has.has('sound')) conds.push(or(attachmentKind('audio', SOUND_EXT), flagged(CONTENT_FLAG.SOUND_URL))!);
  if (has.has('sticker')) conds.push(sql`${m.sticker} IS NOT NULL AND ${m.sticker} <> 'null'::jsonb`);
  if (has.has('poll')) conds.push(sql`${EMBED_ARRAY} @> '[{"type":"poll"}]'::jsonb`);

  if (p.authorIds && p.authorIds.length > 0) conds.push(inArray(m.authorId, p.authorIds.map((id) => normalizeId(id))));
  if (p.mentionIds && p.mentionIds.length > 0) {
    conds.push(sql`${m.mentionedUserIds} && ARRAY[${sql.join(p.mentionIds.map((id) => sql`${normalizeId(id)}`), sql`, `)}]::uuid[]`);
  }
  if (p.pinned !== undefined) conds.push(p.pinned ? eq(m.pinned, true) : sql`${m.pinned} IS NOT TRUE`);
  if (p.authorTypes && p.authorTypes.length > 0 && p.authorTypes.length < 3) {
    const isBot = sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${m.authorId} AND u.is_bot = true)`;
    const isWebhook = sql`EXISTS (SELECT 1 FROM channel_webhooks w WHERE w.id = ${m.authorId})`;
    const parts: SQL[] = [];
    if (p.authorTypes.includes('bot')) parts.push(isBot);
    if (p.authorTypes.includes('webhook')) parts.push(isWebhook);
    if (p.authorTypes.includes('user')) parts.push(sql`NOT (${isBot}) AND NOT (${isWebhook})`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (p.minTime) conds.push(gte(m.createdAt, p.minTime));
  if (p.maxTime) conds.push(lt(m.createdAt, p.maxTime));
  return conds;
}

/** Run a search over already-authorized channels. */
export async function searchMessages(p: MessageSearchParams): Promise<MessageSearchResult> {
  const empty: MessageSearchResult = { total: 0, pageable: 0, rows: [], contents: new Map() };
  if (p.channelIds.length === 0) return empty;
  const schemaReady = await ensureMessageSearchSchema();
  const terms = queryTerms(p.text || '');
  const needsIndex = terms.length > 0 || (p.has || []).some((h) => h === 'link');
  if (needsIndex && !schemaReady) return empty;

  const key = terms.length > 0 ? await getTermKey() : null;
  const termPairs = key ? terms.map((t) => [hashTerm(key, 'w', t), hashTerm(key, 'p', t)]) : [];
  // has:image/video/sound also look at index flags; without the table they
  // fall back to attachments/embeds only.
  const conds = buildConditions(
    schemaReady ? p : { ...p, has: (p.has || []).filter((h) => h !== 'link') },
    termPairs,
  );
  const where = and(...conds);

  const limit = Math.max(1, Math.min(p.limit ?? SEARCH_PAGE_SIZE, 50));
  const offset = Math.max(0, Math.min(p.offset ?? 0, SEARCH_MAX_OFFSET));
  const sort: SearchSort = p.sort === 'relevant' && terms.length === 0 ? 'newest' : (p.sort ?? 'newest');

  const countQuery = db
    .select({ c: sql<number>`count(*)::int` })
    .from(db.select({ one: sql`1`.as('one') }).from(m).where(where).limit(COUNT_CAP).as('hits'));

  const verify = async (rows: SearchMessageRow[]) => {
    const contents = new Map<string, string>();
    const kept: SearchMessageRow[] = [];
    for (const row of rows) {
      const { content, full } = await searchableText(row);
      if (terms.length > 0 && !matchesAllTerms(indexTerms(full), terms)) continue;
      contents.set(row.id, content);
      kept.push(row);
    }
    return { kept, contents };
  };

  if (sort === 'relevant') {
    const [countRows, window] = await Promise.all([
      countQuery,
      db.select().from(m).where(where).orderBy(desc(m.createdAt), desc(m.id)).limit(RELEVANCE_WINDOW),
    ]);
    const { kept, contents } = await verify(window);
    const now = Date.now();
    const scored = kept.map((row) => {
      const ageDays = (now - new Date(row.createdAt ?? 0).getTime()) / 86_400_000;
      const text = `${contents.get(row.id) ?? ''}\n${extraSearchText(row.embeds, row.attachments)}`;
      return { row, score: relevanceScore(text, terms, p.text || '') - Math.min(ageDays, 365) / 365 };
    });
    scored.sort((a, b) => b.score - a.score);
    const page = scored.slice(offset, offset + limit).map((x) => x.row);
    // Relevance ranks only the newest RELEVANCE_WINDOW matches, so only those
    // are pageable; `total` still reports every match like Discord does.
    return { total: countRows[0]?.c ?? 0, pageable: kept.length, rows: page, contents };
  }

  const order = sort === 'oldest' ? [asc(m.createdAt), asc(m.id)] : [desc(m.createdAt), desc(m.id)];
  const [countRows, rows] = await Promise.all([
    countQuery,
    db.select().from(m).where(where).orderBy(...order).limit(limit).offset(offset),
  ]);
  const { kept, contents } = await verify(rows);
  const total = countRows[0]?.c ?? 0;
  return { total, pageable: Math.min(total, SEARCH_MAX_OFFSET + limit), rows: kept, contents };
}
