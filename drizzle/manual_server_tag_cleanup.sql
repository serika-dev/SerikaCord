-- CORD-53 server tags: a member's choice is stored as customization.serverTag
-- = {"serverId": "..."} and resolved by the API. Before the feature shipped,
-- the profile PATCH accepted any customization keys, so a stored serverTag
-- could carry forged tag text or an outside image URL. Drop every stored
-- serverTag that is anything other than a bare {serverId} pointer.
-- Idempotent and only touches rows with a malformed serverTag.
UPDATE users
SET customization = customization - 'serverTag'
WHERE customization ? 'serverTag'
  AND (
    jsonb_typeof(customization -> 'serverTag') <> 'object'
    OR (customization -> 'serverTag') - 'serverId' <> '{}'::jsonb
    OR jsonb_typeof(customization -> 'serverTag' -> 'serverId') IS DISTINCT FROM 'string'
  );
