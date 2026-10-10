-- Threads in text / announcement channels (thread panel). Additive +
-- idempotent. Also applied automatically at boot by ensureThreadSchema() in
-- src/lib/services/threads.ts.
--
--   message_type 'thread_created'      "X started a thread: name" row in the channel
--   channels.auto_archive_duration     minutes of inactivity before auto-archive (null = never)
--   channels.archive_timestamp         when the thread was (last) archived
--   channels.starter_message_id        the channel message a thread was started from
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'thread_created';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_archive_duration integer;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS archive_timestamp timestamp;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS starter_message_id uuid;
