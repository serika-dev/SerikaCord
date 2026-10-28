-- Recent avatars / banners ("Select an Image" dialog): one row per user and
-- kind ('avatar' | 'banner'), items = [{ "url": ..., "at": <ms> }] newest
-- first, at most 6 (src/lib/profiles/recentMedia.ts). Additive and
-- idempotent. The app also creates this table on first use
-- (ensureRecentMediaSchema in src/lib/services/recentProfileMedia.ts).
CREATE TABLE IF NOT EXISTS user_recent_media (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
