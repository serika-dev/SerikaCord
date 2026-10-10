-- Private per-user notes ("Note — only visible to you") and DM Message
-- Requests. Additive + idempotent. The app also runs these at boot
-- (ensureUserNotesSchema in src/lib/services/userNotes.ts and
-- ensureMessageRequestSchema in src/lib/services/messageRequests.ts), so
-- applying this by hand is optional.

CREATE TABLE IF NOT EXISTS "user_notes" (
  "owner_id" uuid NOT NULL,
  "target_id" uuid NOT NULL,
  "note" text NOT NULL,
  "updated_at" timestamp DEFAULT now(),
  PRIMARY KEY ("owner_id", "target_id")
);

-- One row per (1:1 DM channel, recipient): pending | accepted | ignored.
CREATE TABLE IF NOT EXISTS "dm_message_requests" (
  "channel_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "requester_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  PRIMARY KEY ("channel_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "dm_message_requests_user_status_idx"
  ON "dm_message_requests" ("user_id", "status");
