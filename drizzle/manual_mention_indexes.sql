-- Indexes for the mentions query (Message.findMentionsOf, used by
-- GET /api/users/@me/mentions at every app start and by the Inbox).
-- Additive + idempotent; no table or column changes.
--
-- Without them Postgres reads every message of the last 90 days in all of the
-- user's channels (through messages_channel_id_created_at_idx) and tests the
-- mention arrays row by row. With them the `@>` / `&&` / mention_everyone
-- conditions become a BitmapOr over the few rows that mention someone.
-- Most messages have empty arrays, so the GIN indexes stay small.
--
-- Apply by hand with psql, one statement at a time and NOT inside a
-- transaction (CREATE INDEX CONCURRENTLY doesn't block reads or writes, but
-- can't run in BEGIN ... COMMIT):
--
--   psql "$DATABASE_URL" -f drizzle/manual_mention_indexes.sql
--
-- If a CONCURRENTLY build is interrupted it leaves an INVALID index that
-- IF NOT EXISTS then skips. Check, and REINDEX INDEX CONCURRENTLY <name> any
-- invalid one:
--
--   SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE c.relname LIKE 'messages_mention%';

-- Direct mentions: mentioned_user_ids @> ARRAY[<user>]
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_mentioned_user_ids_gin_idx
  ON messages USING gin (mentioned_user_ids);

-- Role mentions: mentioned_role_ids && ARRAY[<roles>]
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_mentioned_role_ids_gin_idx
  ON messages USING gin (mentioned_role_ids);

-- @everyone / @here, newest first. Partial: only messages that ping everyone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_mention_everyone_created_at_idx
  ON messages (created_at)
  WHERE mention_everyone = true;
