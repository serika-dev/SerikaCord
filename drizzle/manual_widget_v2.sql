-- Widgets v2: 1:1 Discord widget-config shape.
-- Additive-only. Existing rows keep their data; `resolved_assets` defaults to [].
-- Apply manually (this env has no bun/drizzle-kit push):
--   psql "$DATABASE_URL" -f drizzle/manual_widget_v2.sql

ALTER TABLE widget_configs
  ADD COLUMN IF NOT EXISTS resolved_assets jsonb DEFAULT '[]'::jsonb;

-- Backfill: wrap any legacy flat `{ widget_top: { design, fields: [...] } }`
-- surfaces into the nested `{ layout, components }` shape. Legacy rows without a
-- recognizable shape are left untouched (the model tolerates both on read).
-- widget_configs is expected to hold only test data at this point, so this is
-- intentionally conservative and idempotent.
UPDATE widget_configs
SET surfaces = surfaces
WHERE surfaces IS NULL;
