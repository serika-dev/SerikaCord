-- Indexes for the deleted-content retention purge
-- (src/lib/services/retentionPurge.ts). Additive + idempotent; no table or
-- column changes. The purge refuses to run until all three exist and are
-- valid, so it never table-scans `messages`.
--
-- Apply by hand with psql, one statement at a time and NOT inside a
-- transaction (CREATE INDEX CONCURRENTLY doesn't block reads or writes, but
-- can't run in BEGIN ... COMMIT):
--
--   psql "$DATABASE_URL" -f drizzle/manual_retention_purge.sql
--
-- If a CONCURRENTLY build is interrupted it leaves an INVALID index that
-- IF NOT EXISTS then skips; the purge reports it as "INVALID, rebuild it".
-- Rebuild that one index with REINDEX INDEX CONCURRENTLY <name>; and re-check:
--
--   SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE c.relname LIKE 'messages_%_gin_idx' OR c.relname = 'messages_retention_purge_idx';

-- Soft-deleted messages by deletion moment (deleted_at, or updated_at for rows
-- deleted before deleted_at was written). Partial: only deleted rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_retention_purge_idx"
  ON "messages" ((COALESCE("deleted_at", "updated_at", "created_at")), "id")
  WHERE "is_deleted" = true;

-- "Is this file still used by another message?" lookups by attachment URL.
-- Partial: only messages that have attachments.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_attachments_gin_idx"
  ON "messages" USING gin ("attachments" jsonb_path_ops)
  WHERE "attachments" IS NOT NULL AND "attachments" <> '[]'::jsonb;

-- Same for forwards, which copy the original's attachments into
-- message_snapshot. Partial: only forwards.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_snapshot_attachments_gin_idx"
  ON "messages" USING gin (("message_snapshot" -> 'attachments') jsonb_path_ops)
  WHERE "message_snapshot" IS NOT NULL;
