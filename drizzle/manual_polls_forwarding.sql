-- Polls and message forwarding.
-- Additive + idempotent. Also applied automatically at boot by
-- ensureMessageExtrasSchema() in src/lib/services/messageExtras.ts.

-- "Poll results" row posted when a poll closes.
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'poll_result';

-- Poll on a poll message (StoredPoll) or the frozen outcome on a 'poll_result'
-- row (PollResultData); see src/lib/chat/polls.ts.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "poll" jsonb;

-- Forwarded message copy (StoredForward); see src/lib/chat/forward.ts.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "message_snapshot" jsonb;

-- One row per (poll message, voter, answer).
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  answer_id integer NOT NULL,
  created_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_message_user_answer_idx ON poll_votes (message_id, user_id, answer_id);
CREATE INDEX IF NOT EXISTS poll_votes_message_answer_idx ON poll_votes (message_id, answer_id);
