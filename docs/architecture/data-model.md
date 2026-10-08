# Data model

Postgres through Drizzle ORM. The schema is `src/lib/db/schema.ts`; the
connection pool and `db` proxy are in `src/lib/db/postgres.ts`; Redis helpers
are in `src/lib/db/redis.ts`.

> The database behind canary is the **production** database, shared with
> prod. Read the migration rules below before changing anything.

## Conventions

- Primary keys are `uuid` with `gen_random_uuid()`. Most route groups reject
  non-UUID id params with 400 (`rejectInvalidObjectIdParams` in
  `src/lib/security/index.ts`, see `api.md`). Legacy 24-hex MongoDB ids are mapped to UUIDs
  by `normalizeId` / `mongoIdToUUID` (the app moved from MongoDB).
- **There are no foreign-key constraints.** Relationships are plain `uuid`
  columns and `uuid[]` arrays, so deleting a parent never cascades: clean up
  children yourself, and expect dangling ids in old data.
- Flexible data lives in `jsonb` columns (`users.settings`,
  `users.customization`, `channels.permission_overwrites`,
  `messages.attachments` / `embeds` / `reactions`, `servers.settings`).
- Permission bitfields are stored as decimal strings (`roles.permissions`,
  overwrite `allow`/`deny`) and parsed with `BigInt`.
- Message `content` is encrypted at rest (`encryptForStorage` /
  `decryptFromStorage` in `src/lib/security/encryption.ts`, with an
  in-process decrypt cache) after `sanitizeInput` HTML-escapes it.

## Main tables

| Table | Key columns | Relationships |
|-------|-------------|---------------|
| `users` | `username`, `display_name`, `status`, `presence_last_heartbeat_at`, `badges[]`, `is_bot`, `is_system`, `is_staff`, `staff_role`, `is_banned`, `friends uuid[]`, `blocked_users uuid[]`, `pending_friend_requests jsonb`, `settings jsonb`, `customization jsonb` | id equals the serika-accounts user id (OAuth `sub`) |
| `servers` | `owner_id`, `settings`, `features[]`, discovery fields, `welcome_screen` | `owner_id` → users |
| `channels` | `server_id` (null for DMs), `type` (`text`, `voice`, `category`, `announcement`, `stage`, `forum`, `public_thread`, `private_thread`, `dm`, `group_dm`), `parent_id`, `position`, `permission_overwrites jsonb`, `recipient_ids uuid[]` (DMs), forum fields (`forum_mode`, `ticket_access_role_ids`, `available_tags`), thread fields (`owner_id`, `archived`, `locked`, `thread_member_ids`, `applied_tags`, `message_count`) | `parent_id` → category or forum channel; threads are channels whose `parent_id` is the forum |
| `messages` | `channel_id`, `server_id`, `author_id`, `content` (encrypted), `type`, `referenced_message_id`, `attachments`, `embeds`, `reactions`, `mention_everyone`, `mentioned_user_ids[]`, `mentioned_role_ids[]`, `pinned`, `edited`, `is_deleted` (soft delete), `interaction`, `discord_message_id`, `suppress_embeds` | → channels, users |
| `roles` | `server_id`, `permissions` (bitfield string), `position`, `color`, `mentionable`, `is_default` (@everyone) | → servers |
| `server_members` | `server_id`, `user_id` (unique pair), `roles uuid[]`, `nickname`, `communication_disabled_until` (timeout) | → servers, users, roles |
| `invites` | `code` (unique), `server_id`, `channel_id`, `inviter_id`, uses / expiry | |
| `server_bans`, `server_member_applications` | per-server moderation and join applications | |
| `server_emojis`, `server_stickers` | custom emoji / stickers | → servers |
| `channel_read_states` | `user_id`, `channel_id` (unique pair), `last_read_message_id`, `last_read_at` | cross-device read markers |
| `channel_webhooks` | `channel_id`, `token`, `creator_id` | incoming webhooks (`POST /api/webhooks/:channelId/:token`) |
| `applications`, `app_commands`, `app_webhooks`, `app_emojis`, `developer_teams`, `authorized_apps` | developer platform: bot apps (`bot_id`, `bot_token`, Ed25519 keys), slash commands, OAuth grants | `applications.bot_id` → a `users` row with `is_bot` |
| `rich_presence`, `activity_history`, `user_games` | game / music / watch activity | → users |
| `user_connections`, `user_device_sessions` | linked accounts, device sessions | → users |
| `discord_users` | Discord bridge identities and consent (`consent_status`) | |
| `widget_configs`, `widget_user_data` | profile/server widgets | |
| `bug_reports` | bug and feedback reports | |
| `tts_sounds`, `tts_voices` | TTS trigger sounds and voices | |
| `admin_logs`, `platform_settings`, `experiments`, `instances` | staff tooling, global settings, feature flags | |

Sessions are not in Postgres: they live in Redis as `session:<sid>` with a
per-user index `user:sessions:<uid>`; `user:<uid>` caches the user row for
5 minutes (`authenticateRequest`, `invalidateUserCache`).

## Models (`src/lib/models`)

Each table has a thin model object (`User`, `Server`, `Channel`, `Message`,
`ServerMember`, `Role`, ...) with `findById`, `findOne`, `find`, `create`,
`updateById`, `deleteById` and table-specific helpers such as
`Message.unreadCounts` and `ChannelReadState.ack`. They return plain objects.

**Whitelist gotcha.** `find` and `findOne` translate each filter key through a
`switch`:

```ts
switch (key) {
  case 'id': ...
  case 'channelId': ...
  case 'isDeleted': ...
  // anything else: silently ignored
}
```

An unknown key is dropped without an error and the query returns an arbitrary
matching row. This once made delete/edit/pin act on the wrong message. Before
filtering on a new key, add its `case` to that model (both `find` and
`findOne` if you use both). For complex queries, use `db` with Drizzle
operators directly.

## Migrations

There is no migration runner in `package.json` and nothing applies SQL at
boot today. `drizzle/0000`–`0002` were generated by drizzle-kit (see
`drizzle/meta/_journal.json`); `0003_suppress_embeds.sql` and every
`drizzle/manual_*.sql` were written by hand and applied by the owner with
`psql`. `scripts/create-indexes.sql` holds extra indexes, also applied by hand.

To change the schema:

1. Edit `src/lib/db/schema.ts`.
2. Add `drizzle/manual_<feature>.sql` that is **additive and idempotent**:
   - `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... DEFAULT ...`
   - `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (enum values)
   - `INSERT ... ON CONFLICT DO NOTHING` for seed rows
   - backfills only as `UPDATE ... WHERE <column> IS NULL`
3. Never `DROP`, `TRUNCATE`, rename, narrow a type, or add `NOT NULL` without a
   default. Leave unused columns in place.
4. Make the code tolerate the column not existing yet where practical (canary
   may deploy before the owner applies the SQL), or say clearly in the PR /
   report that the SQL must be applied before deploy.
5. If you add boot-time DDL instead (for example in `initializeAPI`), it must
   meet the same rules, because every instance runs it on every start.

Never run `drizzle-kit push` or `drizzle-kit migrate` against the shared
database: push diffs the whole schema and can drop or alter columns.

Several scripts in `scripts/` write to the database (`merge-users.ts`,
`migrate-media-urls.ts`, `repair-bug-report-media.ts`, `drop-stale-indexes.ts`,
`add-badges.ts`, `seed-file-types.ts`, `upload-emojis-stickers.ts`,
`migrate-mongo-to-postgres.ts`). Read a script before running it, and only run
one when the owner asks; prefer its `--dry` mode where it has one.

## Redis keys (selection)

| Key / channel | Use |
|---------------|-----|
| `session:<sid>`, `user:sessions:<uid>` | sessions |
| `user:<uid>` | cached user row (5 min) |
| `rl:<limiter>:<id>` | rate limiter buckets |
| `qrlogin:<token>` | QR login handshake (120 s) |
| `serikacord:discord-bot-lock` | Discord bridge leader lock |
| `sse:channel`, `sse:dm`, `sse:dmlist`, `sse:activity`, `sse:user-fanout`, `voice:sse`, `voice:members`, `gateway:dispatch` | pub/sub buses (see `realtime.md`) |

`CacheService.delPattern` uses `SCAN`, never `KEYS`. Keep it that way.
