-- Staff-editable badge definitions (users.badges stores these ids).
--
-- You normally do NOT need to run this: the API creates the table and seeds
-- the built-in badges at boot (ensureBadgesTable in
-- src/lib/services/badgeRegistry.ts). It is kept for manual/ops use and is
-- fully idempotent — safe to run any number of times, never overwrites rows
-- edited from the admin panel.
CREATE TABLE IF NOT EXISTS "badges" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "icon" text,
  "icon_url" text,
  "color" text DEFAULT '#8B5CF6' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "automatic" boolean DEFAULT false NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- Built-in badges (mirrors DEFAULT_BADGES in src/lib/constants/badges.ts).
INSERT INTO "badges" ("id", "name", "description", "icon", "color", "priority", "automatic") VALUES
  ('serikacord_developer',   'SerikaCord Developer',   'Core developer of SerikaCord',       'Code',         '#e2b714', 150, false),
  ('serikacord_contributor', 'SerikaCord Contributor', 'Contributed to SerikaCord',          'HandHeart',    '#A78BFA', 145, false),
  ('serikacord_tester',      'SerikaCord Tester',      'Helped test SerikaCord',             'FlaskConical', '#23A55A', 140, false),
  ('staff',                  'Serika Staff',           'Official Serika staff member',       'ShieldCheck',  '#8B5CF6', 100, true),
  ('admin',                  'Administrator',          'Platform administrator',             'Shield',       '#EF4444',  99, true),
  ('moderator',              'Moderator',              'Platform moderator',                 'ShieldHalf',   '#A78BFA',  98, true),
  ('partner',                'Partnered Server Owner', 'Owner of a partnered server',        'Handshake',    '#8B5CF6',  90, true),
  ('serika_plus',            'Serika+',                'Serika+ subscriber',                 'UserStar',     '#F47FFF',  85, true),
  ('early_supporter',        'Early Supporter',        'Supported Serika in its early days', 'Heart',        '#A78BFA',  80, false),
  ('verified_bot_developer', 'Verified Bot Developer', 'Developer of a verified bot',        'Bot',          '#8B5CF6',  70, true),
  ('bug_hunter_gold',        'Bug Hunter (Gold)',      'Elite bug hunter',                   'Bug',          '#FFD700',  66, false),
  ('bug_hunter',             'Bug Hunter',             'Found and reported critical bugs',   'Bug',          '#7C3AED',  65, false),
  ('active_developer',       'Active Developer',       'Active application developer',       'Code',         '#8B5CF6',  55, true),
  ('server_owner',           'Server Owner',           'Owns at least one server',           'Crown',        '#FFD700',  50, true)
ON CONFLICT ("id") DO NOTHING;
