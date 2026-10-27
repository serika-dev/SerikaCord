-- Origin of messages relayed in by the Discord bridge, shown to bots as
-- `bridged_from` so a bot running on both platforms can skip the copy.
-- Nullable, no default: a metadata-only change. Also applied at boot by
-- ensureMessageExtrasSchema() (src/lib/services/messageExtras.ts).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "bridge_origin" jsonb;
