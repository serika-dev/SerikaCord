-- Per-user notification settings (server / channel / category / DM levels,
-- mutes, @everyone and role-mention suppression). Additive + idempotent.
-- The app also runs this at boot (ensureNotificationSettingsSchema in
-- src/lib/services/notificationSettings.ts), so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS "user_notification_settings" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now()
);
