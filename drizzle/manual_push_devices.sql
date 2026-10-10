-- Mobile push devices (FCM registration tokens from the Capacitor app).
-- Additive + idempotent. The app also runs this at boot (ensurePushSchema in
-- src/lib/services/pushNotifications.ts), so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS "push_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token" text NOT NULL,
  "platform" text DEFAULT 'android' NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_unique" ON "push_devices" ("token");
CREATE INDEX IF NOT EXISTS "push_devices_user_id_idx" ON "push_devices" ("user_id");
