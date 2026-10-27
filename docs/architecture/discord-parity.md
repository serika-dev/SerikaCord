# Discord API v10 parity: gap analysis and plan

Goal: bots written for discord.js, discord.py, JDA, Serenity, DSharpPlus and the
like run against SerikaCord by changing only the REST base URL (and the CDN base
where the library exposes it). The gateway URL comes from `GET /gateway/bot`.

This document has two parts:

1. **Hand-written analysis and plan** (this part). Edit it freely.
2. **Generated coverage tables** between the `parity:generated` markers at the
   bottom. Regenerate with `bun scripts/discord-parity.ts` (offline, reads the
   pinned upstream snapshot in `scripts/discord-spec/discord-api.json`). Use
   `--refresh` to pull the newest Discord spec + docs, and `--check` in CI to
   fail when coverage drops. Machine-readable data lives in
   `docs/architecture/discord-parity.json`.

How the checker decides "implemented / partial / missing" is documented at the
top of `scripts/discord-parity.ts`. In short: the route must be mounted under
`/api/v10` (or `/api/v9`) with the same method and path template. A route is
**partial** when it has a `KNOWN_GAPS` entry, reads under 40% of the spec's body
fields, or reads under half its query params. Protocol behaviour is checked by
regex probes (`FEATURES`), gateway events by finding emitters and their callers.
The numbers are a floor for what is missing, not proof that something works.
Only the smoke tests in section 6 can show that.

## 0. Status (2026-10-27, after v2.3.0)

M1-M4 are done. Every non-deprecated REST operation in the pinned spec now has
a route: **248 of 248 reachable, 226 implemented + 22 partial, 95.6% weighted
coverage** (bot-usable: 243 reachable, 95.5%). History: 19% at the original
snapshot, 71% (78% reachable, 55 routes missing) at v2.1.22. Gateway: 73 of 82 receive events emitted, opcodes
12/13 (op 43 Request Channel Info is the only one missing), close codes 14/14,
intents 21/21, protocol features 64/67. Unmodified discord.js 14 and
discord.py 2.x log in, receive guilds, messages, interactions and member
chunks, and reply, against the local harness in `scripts/bot-compat/` (see its
README). Snowflake ids, CDN hashes and Discord permission bit numbers apply to
applications with `api_id_format = 'snowflake'` (the default for new apps);
legacy UUID-format apps keep the old behaviour.

Landed in the October parity pass (uncommitted at the time of writing, see the
`KNOWN_GAPS` history in `scripts/discord-parity.ts`):

- Messages: CHANNEL_PINNED_MESSAGE (type 6) system message on pin
  (`src/lib/botapi/pinNotice.ts`), components on create and edit, custom emoji
  `name:<snowflake>` reaction paths resolved through the snowflake store, DM
  `recipients` as user objects (`src/lib/botapi/dmRecipients.ts`).
- Threads: a thread started from a message takes the message's id, forum posts
  need only SEND_MESSAGES in the forum (`forumStarterGrant.ts`), real
  per-member `join_timestamp` (Redis hash, `threadMemberJoins.ts`),
  `threads/search` honours `slop`, `min_id`, `max_id`.
- Guilds: message search (`guildSearch.ts`), join requests, incident actions,
  new-member welcome, widget.json with channels/members + widget.png, audit log
  `application_commands` / `guild_scheduled_events`, onboarding `mode` /
  channel ids stored, scheduled-event user counts and (always empty) exception
  routes, soundboard CRUD, stage instances (`stage_instances` table), voice
  channel status, `send-soundboard-sound`, `GET /gateway/bot` shard
  recommendation and the real IDENTIFY budget.
- Webhooks: avatar image data, polls, `applied_tags` with `thread_name`,
  Slack- and GitHub-compatible execute (`/slack`, `/github`).
- Applications / OAuth2: every editable `PATCH /applications/@me` field
  (`application_api_settings` side table), batch command permissions,
  activity attachment upload, linked roles (role connection metadata + user
  role connections), OpenID Connect (`openid` scope, RS256 `id_token`,
  `/oauth2/userinfo`, `/oauth2/keys`), `gdm.join`.
- Social SDK: lobbies (app-scoped, `sdk.social_layer` Bearer tokens, linked
  channels, lobby chat), invite target users, partner-sdk routes (validate, then
  530000: no provisional accounts).

Still open (the 22 partial routes are listed with reasons in the generated
tables): voice media for bots (needs an SFU, see WP7), ETF and zstd transport,
gateway op 43 / CHANNEL_INFO and VOICE_CHANNEL_START_TIME_UPDATE, cross-instance
RESUME (the replay buffer is per process), monetization and integration events
(no payments, no integrations), recurring scheduled events (no exceptions
exist), Social SDK gateway events and lobby <- linked channel relay, and the
Discord webhook-events delivery (`event_webhooks_status` 2 is refused), and
the incident-actions DM pause (`dms_disabled_until` is stored and reported, not
enforced).
Remaining body/query fields the checker sees unread on implemented routes:
`POST /channels/{id}/invites` `target_type` / `target_user_id` /
`target_application_id` / `target_user_ids` / `role_ids`, a few forum and
guild settings on `PATCH /channels/{id}`, `POST /guilds/{id}/channels` and
`PATCH /guilds/{id}`, `with_localizations`, `thread_id` on `@original`
GET/DELETE, `shard` on `GET /users/@me/guilds`, `bio` on `PATCH
members/@me`, `override_event_webhooks_url` on lobbies. The sections below are
the original plan and analysis; the generated tables at the bottom are
current.

## 1. Where we are (summary, as originally written)

See the generated "Headline numbers" below for exact figures. At the snapshot
this document was written against (spec `ed01408`, docs `3714862`):

- **REST**: 27 of 248 non-deprecated operations are implemented, 41 more are
  partial, and the rest are missing. Weighted coverage is **19%**.
- **Gateway**: 21 of 82 receive events have an emitter. 7 of those fire only
  from some code paths. `MESSAGE_UPDATE` and `GUILD_MEMBER_REMOVE` have emitters
  that nothing calls. 7 of 13 opcodes work, 4 of 14 close codes are used, 11
  of 21 intents are defined, and 3 of 63 protocol features pass.
- **Library reality check** (read from the library sources in Oct 2026):
  - **discord.py** cannot log in. `Client.login()` calls
    `GET /oauth2/applications/@me` right after `GET /users/@me`, and that route
    does not exist. Past that, every id goes through `int()`, so UUIDs crash it.
    It also handles a 429 only when the response has a `Via` header. Without
    one it assumes a Cloudflare ban and raises.
    `AutoShardedClient` reads `READY.shard`, which we don't send.
  - **discord.js** connects (JSON, no compression by default) but sees no guilds.
    READY lists every guild as unavailable and no `GUILD_CREATE` follows, so
    after `waitGuildTimeout` (15 s) it emits ready with an empty cache. Messages
    in uncached guild channels are dropped unless the bot enables
    `Partials.Channel`. Anything that sorts channels/roles or reads
    `createdTimestamp` calls `BigInt(id)` and throws on UUIDs.
  - **JDA / Serenity / DSharpPlus** parse ids as 64-bit integers, so they fail
    at the first payload. (Not tested; this follows from their typed id models.)

So the **first milestone is not "more endpoints"**. It is the WP0 foundations
plus the WP1 READY/GUILD_CREATE fix. Without them no mainstream library gets
far enough to use the endpoints we already have.

## 2. Findings that need action now (independent of the parity project)

These are bugs in code that is live today. Each is small:

> **Status (2026-10-15):** items 1-7 are fixed on `canary` (gateway routing in
> `src/lib/gateway/routing.ts` + `audience` on dispatches, channel permissions
> via `getMemberChannelPermissions` + `src/lib/permissions/botChannel.ts`,
> privileged intents in `src/lib/gateway/intents.ts`, bot attachments via
> `normalizeBotAttachments`, filtered DM/member queries, truthful rate-limit and
> Python docs). Follow-ups: multipart `files[n]` + `payload_json` uploads
> (`src/lib/chat/botMultipart.ts`), per-bot rate limits with X-RateLimit-*
> headers (`src/lib/security/botRateLimit.ts`), GUILD_DELETE on removal,
> permission-scoped audit-log/AutoMod events, DM-only slash dispatch.
> Regression tests: `tests/bot-api-security.test.ts`,
> `tests/bot-api-multipart-ratelimit.test.ts`. Still open: MESSAGE_DELETE /
> edit / reaction events are not emitted from most paths.

1. **DM privacy leak in gateway routing** (`src/lib/gateway/core.ts`
   `routeDispatch`). For dispatches with no `guildId`, the DM filter is
   `if (channelId && conn.data.dmChannelIds.size && !has(channelId)) continue;`.
   A bot that had **zero** DM channels at IDENTIFY gets *every* DM-scoped
   dispatch. `postConversationMessage` and `finalizePoll`
   (`src/lib/services/messageExtras.ts`) emit `MESSAGE_CREATE` for DM polls,
   forwards and poll results between humans, so any bot with the
   `DIRECT_MESSAGES` intent and no DMs receives them. The same happens to a DM
   dispatch that has no `channel_id`.
   **Fix:** deliver a guild-less dispatch only when its channel is in the
   session's DM set, or when it is targeted at that bot. Track DMs opened after
   IDENTIFY.
2. **Reaction removal without permission** (`src/lib/api/botApi.ts`).
   `DELETE …/reactions` (remove all) and `DELETE …/reactions/:emoji/:userId`
   (remove someone else's) skip the `MANAGE_MESSAGES` check. Any bot that can
   see the channel can wipe reactions.
3. **Bot-sent attachments are stored as given** (`POST /channels/:id/messages`
   takes `attachments: [{ url, … }]` objects verbatim). A bot can make any
   off-CDN URL render as a native attachment. Only accept attachments from an
   upload the bot made (WP2 multipart).
4. **No channel-overwrite checks for bots.** The guard checks VIEW access only.
   Sending, deleting, pinning and managing use guild-wide role bits. A bot can
   post in channels where its role is denied `SEND_MESSAGES`. Reuse
   `computeChannelPermissions` from `src/lib/permissions/channelOverwrites.ts`.
5. **MESSAGE_CONTENT is never enforced** and privileged intents are never
   checked against the application. Every bot gets every message's content.
6. **Full table scans**: `GET/POST /users/@me/channels` call `Channel.find({})`.
   `GET /guilds/:id/members` loads every member before slicing.
7. **Docs promise behaviour that doesn't exist.** `docs-content.ts` documents
   `X-RateLimit-*` headers and says discord.js/discord.py bots work "with a
   one-line base-URL change". The discord.py quick-start is not valid Python
   (`async on_ready(self):` is missing `def`).

## 3. Top 30 gaps by impact

Ranked by how many real bots break, then by blast radius. WP = work package in
section 5.

| # | Gap | Why it matters | WP |
|---:|---|---|---|
| 1 | Ids are UUIDs, not snowflakes (REST, gateway, mentions in content, custom-emoji tokens) | Breaks discord.py, JDA, Serenity, DSharpPlus at once; discord.js sorting/timestamps throw; date-based pagination (`before: SnowflakeUtil.generate(date)`) is impossible | WP0 |
| 2 | `GET /oauth2/applications/@me` and `GET/PATCH /applications/@me` missing | discord.py login fails; discord.js `client.application.fetch()` and every command-deploy script fail | WP6 (do in M1) |
| 3 | READY guilds never followed by `GUILD_CREATE` | Libraries start with empty caches; discord.js drops guild messages without partials | WP1 |
| 4 | DM routing leak (section 2.1) | Privacy | WP1 (hotfix) |
| 5 | Domain events missing: CHANNEL_*, GUILD_ROLE_*, GUILD_MEMBER_* (humans), GUILD_UPDATE/DELETE, GUILD_BAN_*, MESSAGE_UPDATE, MESSAGE_DELETE(_BULK), MESSAGE_REACTION_*, TYPING_START, CHANNEL_PINS_UPDATE, INVITE_*, WEBHOOKS_UPDATE, PRESENCE_UPDATE, USER_UPDATE | Library caches go stale, permission math goes wrong, event handlers never fire | WP1 (plumbing) + each WP wires its own resources |
| 6 | MESSAGE_CONTENT / privileged intents not enforced; `GUILD_EXPRESSIONS`, `GUILD_WEBHOOKS`, `GUILD_INVITES`, `GUILD_VOICE_STATES`, `GUILD_PRESENCES`, `*_REACTIONS`, `*_TYPING` intents not defined | Privacy; wrong filtering once events exist | WP1 |
| 7 | No rate-limit headers; 429 body is `{error, retryAfter}` with no `Via` | Libraries can't pace; discord.py treats our 429 as a ban and raises | WP0 |
| 8 | Error bodies lack the `errors` tree (50035) and real codes on 500s | Libraries surface useless errors; DX | WP0 |
| 9 | `GET /channels/:id/messages` ignores `before/after/around` | `channel.history()` / purge loops never terminate (same page every time) and hammer the API | WP2 |
| 10 | Multipart uploads (`files[n]` + `payload_json`) unsupported | `channel.send({ files })`, `discord.File`, attachments in embeds all fail | WP2 |
| 11 | `message_reference` (replies/forwards) and `allowed_mentions` ignored | `message.reply()` posts a plain message; bots can't suppress pings, so a bot echoing user text can mass-ping @everyone | WP2 |
| 12 | Interaction callback types 5/6/7/8/9 dropped; `@original` and followup edit/delete routes missing | `deferReply()` + `editReply()`, the most common slash-command pattern, does nothing | WP3 |
| 13 | Executing a channel webhook via `/api/v10/webhooks/{id}/{token}` hits the interaction-followup handler (10062); real execute is unversioned and keyed by channel id | Every webhook library (WebhookClient, discord.py `Webhook.from_url`) fails | WP6 |
| 14 | Message components not stored, rendered or interactable (buttons, selects, v2 layouts) | Role menus, tickets, pagination, confirm dialogs: a large share of modern bots | WP2 (storage + render) + WP3 (interactions) |
| 15 | Slash commands are text-parsed `/name args`; no typed options UI, autocomplete, modals, context menus; gateway delivery only if the app has no HTTP endpoint | Command UX and correctness | WP3 |
| 16 | Bulk command overwrite deletes and recreates rows (ids change every boot); permissions v2 / contexts / localizations dropped; `application_id` is clientId in interactions but the UUID in READY and the routes | Command mentions break; discord.js/discord.py command trees see id churn and app-id mismatch | WP3 |
| 17 | Gateway op 8 (Request Guild Members) missing | discord.js `guild.members.fetch()` hangs to timeout; discord.py `chunk_guilds_at_startup` never finishes | WP1 |
| 18 | Channel objects lack `permission_overwrites` (and `last_message_id`, `flags`); overwrite routes missing | Library-side `permissionsFor()` is wrong, so bots refuse to act or act wrongly | WP4 |
| 19 | Reactions: no events, custom emoji `name:id` not parsed, permission bugs (section 2.2) | Reaction-role bots, polls via reactions | WP2 |
| 20 | Threads/forums REST and events completely missing (13 routes, 6 events) although Serika has threads (`src/lib/services/threads.ts`) | Forum/ticket bots | WP5 |
| 21 | RESUME doesn't replay or validate; no op 7 RECONNECT on deploy | Every Coolify deploy drops events for all bots | WP1 |
| 22 | CDN compatibility: `avatar`/`icon` are full URLs, not hashes; no `/avatars/{id}/{hash}.png` routes | `displayAvatarURL()` and embeds with avatars/icons show broken images | WP6 |
| 23 | Members: `GET /guilds/:id/members` ignores `after`; `members/search`, `PATCH members/@me`, `add_member` (OAuth `guilds.join`), role add/remove sub-routes missing | Moderation and welcome bots | WP4 |
| 24 | Audit log + AutoMod REST missing although services exist (`toDiscordEntry`, `toDiscordRule`) and their events are emitted | Moderation bots; easy wins | WP4 |
| 25 | Scheduled events REST missing although events are emitted (`toDiscordEvent` exists) | Event bots; easy win | WP4 |
| 26 | Guild object ~29% of fields; no `with_counts`; `GUILD_CREATE` on install has ~20% | Libraries default many fields; some code paths throw on `undefined` | WP0 serializers + WP4 |
| 27 | Typing is a no-op (no UI indicator, no TYPING_START) | "Bot is typing…" UX for LLM/slow bots | WP2 |
| 28 | Op 3 Presence Update ignored | Bot status / "Playing …" never shows (silently) | WP1 |
| 29 | Interaction tokens in a per-process `Map` | Followups fail after restart or on another instance | WP3 |
| 30 | Bot API is one 1,900-line file with copy-pasted auth/format/error code; REST and gateway serializers differ (`formatMessage` vs `toDiscordMessage`) | Blocks parallel work; shape drift between REST and gateway | WP0 |

Not ranked, but decide early: **voice** (bots cannot join voice at all; section
5, WP7) and **monetization** (stub with empty lists).

## 4. Cross-cutting design decisions (WP0, land first)

### 4.1 Snowflake ids

- **Mapping table, timestamp-derived ids.** Every entity a bot can see gets a
  64-bit snowflake built from its own `created_at`:
  `((created_at_ms - 1420070400000) << 22) | (worker << 17) | seq`. Discord
  libraries derive `createdAt` from the id, so it stays correct. Ordering by
  snowflake matches ordering by time. `before/after/around` and date-based
  cursors decode to a timestamp with no lookup.
- The mapping is stored in one table and cached in a process `BoundedMap` plus
  Redis (`sf:u2s:<uuid>`, `sf:s2u:<sf>`). Outbound serialization batch-resolves
  ids (one `IN` query per payload). Inbound path params, body ids and
  `<@…>`/`<#…>`/`<@&…>`/`<:name:…>` tokens in content are translated back.
  Unknown snowflakes become the right `Unknown X` error.
- **Compatibility.** Input accepts both forms (UUID regex or digits).
  Output format is per application: new `applications.api_id_format`, where
  NULL means legacy UUID (existing bots keep working) and new apps get
  `'snowflake'`. The portal gets a toggle and a warning.
- **Rejected alternatives:** changing primary keys to bigint (huge migration on
  production data, see CLAUDE.md rule 1) and a deterministic hash without a
  table (64 bits can't hold a UUID, so reverse lookup still needs storage).

```sql
-- drizzle/manual_api_snowflakes.sql (owner applies by hand)
CREATE TABLE IF NOT EXISTS api_snowflakes (
  snowflake  bigint PRIMARY KEY,
  kind       smallint NOT NULL,   -- 1 user 2 guild 3 channel 4 message 5 role 6 emoji 7 sticker 8 webhook
                                  -- 9 application 10 command 11 attachment 12 interaction 13 event 14 automod rule
                                  -- 15 audit entry 16 entitlement/sku 17 integration
  uuid       uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_snowflakes_uuid_unique ON api_snowflakes (uuid);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS api_id_format text;
```

Rows are created lazily (first exposure, `INSERT … ON CONFLICT DO NOTHING`, retry
`seq` on a PK clash). Messages dominate. If the table grows too fast, the
message kind can move to an additive `messages.api_id bigint` column plus a
`CREATE INDEX CONCURRENTLY IF NOT EXISTS`, with no change to callers.

### 4.2 One serializer module for REST and gateway

`src/lib/botapi/serialize/{user,guild,channel,message,member,role,emoji,sticker,invite,webhook,application,command,interaction,thread,event,automod,audit}.ts`.
Each takes internal rows and returns spec-shaped objects. Every id goes through
the snowflake resolver, and every CDN field goes through the CDN mapper
(`hash` plus a resolvable `/cdn-compat/...` path). REST handlers and gateway
emitters must both use these. `formatX` in `botApi.ts` and `toDiscordX` in
`gatewayEvents.ts` become thin re-exports, then go away. The checker's
`OBJECT_CHECKS` finds serializers by function name, so update it when renaming.

### 4.3 Errors, validation, rate limits

- `src/lib/botapi/errors.ts`: `apiError(code, message, errors?)` builds Discord
  JSON errors with the `errors` tree
  (`{ "content": { "_errors": [{ "code": "BASE_TYPE_MAX_LENGTH", "message": "…" }] } }`).
  Keep a table of the codes we use (10003, 10004, 10008, 10013, 10015, 10062,
  50001, 50006, 50007, 50013, 50034, 50035, 50109, 40060 already-acknowledged,
  …). Elysia `t.Object` validation errors map to 50035.
- `src/lib/botapi/ratelimit.ts`: per-bot buckets keyed by route + major
  parameter (`channel_id`, `guild_id`, `webhook_id+token`, interaction token),
  plus a global 50 req/s per bot (Redis, sliding window or GCRA; the existing
  `rate-limiter-flexible` setup works). Responses carry `X-RateLimit-Limit`,
  `-Remaining`, `-Reset`, `-Reset-After` and `-Bucket` (hash of the route
  template). A 429 carries `X-RateLimit-Scope`, `X-RateLimit-Global`,
  `Retry-After`, `Via: 1.1 serika` (discord.py needs `Via`) and the body
  `{ message, retry_after, global, code? }`. Bot routes must be exempt from the
  per-IP `rateLimitPlugin` and use these buckets instead. Bots run from shared
  hosts, so per-IP limiting would make them flaky.
- Authentication: `Bot <token>` stays. Add `Bearer <oauth token>` for the
  `users/@me*`, `guilds.join` and `applications.commands.*` routes. Today OAuth2
  access tokens are minted (`developers.ts`) but no v10 route accepts them.

### 4.4 Event plumbing

`src/lib/botapi/dispatch.ts` exports one typed emitter per Discord event (e.g.
`dispatchChannelUpdate(channelRow, before?)`). Each emitter serializes with
4.2 and publishes to `gateway:dispatch` with `{ guildId, intent, targetBotIds?,
channelId, requiresMessageContent? }`. GatewayHub filters per connection on
intents, guild membership, DM recipients, shard (`(guild_id >> 22) % n`) and
MESSAGE_CONTENT stripping.

Mutation sites call these emitters right next to their existing
`publishToChannel` / `fanoutToUsers` calls. **Each work package wires the events
for the resources it owns**, so nobody else edits `servers.ts`/`channels.ts`
for the same resource:

| Event family | Mutation sites (today) | Owner |
|---|---|---|
| MESSAGE_* (user/DM/webhook/bot sends, edits, deletes, bulk) | `channels.ts` send/edit/delete, `dms.ts`, `index.ts` webhook execute, `messageExtras.ts`, `botApi` | WP2 |
| MESSAGE_REACTION_*, CHANNEL_PINS_UPDATE, TYPING_START | `channels.ts`, `dms.ts`, `botApi` | WP2 |
| CHANNEL_*, GUILD_ROLE_*, GUILD_UPDATE/DELETE, GUILD_MEMBER_*, GUILD_BAN_*, INVITE_*, GUILD_EMOJIS/STICKERS_UPDATE, WEBHOOKS_UPDATE | `servers.ts`, `channels.ts`, `serverMembership.ts`, `community.ts`, `botApi` | WP4 (WEBHOOKS_UPDATE: WP6) |
| THREAD_* | `services/threads.ts`, `channels.ts` thread routes | WP5 |
| PRESENCE_UPDATE, USER_UPDATE, VOICE_STATE_UPDATE | `services/presence.ts`, `index.ts` profile routes, `api/voice.ts` | WP1 (presence/user), WP7 (voice) |

Today the web clients don't get live updates for role, channel or member changes
either (no SSE events exist). Adding them to the same call sites is a natural
side benefit, but it is out of scope here.

### 4.5 Splitting the bot API

`src/lib/api/botApi.ts` becomes `src/lib/api/botApi/index.ts` (prefix `/v10`,
plus `/v9` mounting the same groups), with one group per area:
`users.ts guilds.ts members.ts roles.ts channels.ts messages.ts reactions.ts
threads.ts webhooks.ts applications.ts commands.ts interactions.ts invites.ts
moderation.ts expressions.ts events.ts voice.ts monetization.ts oauth2.ts`.
Shared helpers (`auth`, guard, permission resolution) live in
`src/lib/botapi/`. The checker discovers routes through `.use(name)` mounts, so
the split needs no checker change.

## 5. Work packages

Every WP must: write `drizzle/manual_<name>.sql` (idempotent, additive) for
schema changes and mirror it in `schema.ts`; update `KNOWN_GAPS` / `FEATURES` /
`EVENT_GAPS` in `scripts/discord-parity.ts` when it closes a gap; add contract
tests (section 6); document new routes under `src/app/developers/docs` (with
`gt()` strings); and leave `bun scripts/discord-parity.ts --check` green.

Order: **M1** = WP0 + the WP1 READY/GUILD_CREATE/DM hotfix + the
`applications/@me` routes from WP6. After that, WP1-WP6 and WP8 run in parallel
on separate files. WP7 is last and partly research.

### WP0: Foundations (1 engineer, blocks everything, ~1.5-2 weeks)

- **Scope:** sections 4.1-4.5. Snowflake resolver plus content token rewriting;
  the serializer module; errors/validation; the rate limiter and headers;
  Bearer auth; the bot API split with no behaviour change; channel permission
  resolution (`computeChannelPermissions`) as a guard helper
  (`requireChannelPerm(bot, channel, bits)`); fixes for section 2 items 2, 4
  and 6.
- **Files:** new `src/lib/botapi/*`; `src/lib/api/botApi.ts` → `botApi/`;
  `src/lib/services/gatewayEvents.ts` (re-export serializers);
  `src/lib/api/index.ts` (mount, exempt bot routes from per-IP limits; stay
  clear of the owner's bug-report section); `src/lib/db/schema.ts`;
  `drizzle/manual_api_snowflakes.sql`.
- **Risks:** the per-request id-resolution cost (batch it and cache it), and
  mistakes in content-token rewriting (fuzz-test round trips). Existing bots
  that rely on UUIDs are protected by the per-app format flag.
- **Tests:** unit tests for the snowflake encode/decode/ordering, the
  content-rewrite round trip, `errors` tree building and rate-limit bucket math
  (pure, `tests/`). Contract-validate every serializer against its OpenAPI
  schema (ajv over the spec schemas).

### WP1: Gateway core and event plumbing (1 engineer, ~2 weeks)

- **READY/GUILD_CREATE:** send `READY` with `shard`, `application{id,flags}`
  (snowflake), `user` (full), `guilds` unavailable. Then send one
  `GUILD_CREATE` per guild with the full guild plus `channels`, `threads`,
  `members` (up to `large_threshold`), `roles`, `emojis`, `stickers`,
  `member_count`, `large`, `joined_at`, `voice_states`, `presences`,
  `stage_instances: []`, `guild_scheduled_events`, `soundboard_sounds: []`.
  Send `GUILD_DELETE` on leave/kick/ban and `GUILD_CREATE` on install
  (replacing the ad-hoc payload in `developers.ts`).
- **Protocol:** support op 3 (store bot presence and broadcast PRESENCE_UPDATE
  to members), op 8 (`GUILD_MEMBERS_CHUNK`, by query/user_ids, with `nonce`,
  chunking by 1000, `not_found`, presences), op 31 (empty
  `SOUNDBOARD_SOUNDS` until WP7) and op 43 (`CHANNEL_INFO`). Use close codes
  4001/4002/4003/4005/4007/4008/4010/4011/4012/4013/4014 with Discord's
  semantics. Add a gateway send rate limit (120/60 s). Accept `?v=10`
  (reject other versions with 4012), `encoding=json` and
  `compress=zlib-stream` (per-connection `zlib.createDeflate`, `Z_SYNC_FLUSH`).
  `zstd-stream` is optional (discord.py prefers it when `zstandard` is
  installed but falls back), and so is ETF.
- **Sessions:** keep session state in Redis (`gw:sess:<id>`: bot, intents,
  shard, guilds, seq) with a capped replay buffer (`gw:replay:<id>`, about the
  last 1000 dispatches, TTL 3 min after disconnect). RESUME validates the token,
  session and seq, replays, then sends `RESUMED`. A failed resume gets
  `op 9 d:false`. Send op 7 RECONNECT to all connections on `SIGTERM` (Coolify
  deploys). Sharding: honour `shard`, recommend `ceil(guilds/1000)` in
  `/gateway/bot`, and enforce `max_concurrency` buckets.
- **Intents:** add every missing intent bit. Privileged ones (GUILD_MEMBERS,
  GUILD_PRESENCES, MESSAGE_CONTENT) must be enabled on the app (application
  `flags` GATEWAY_*_LIMITED / GATEWAY_*, set in the portal, stored in the
  existing `applications.gateway_intents` / `flags`), otherwise close 4014.
  Without MESSAGE_CONTENT, blank `content/embeds/attachments/components/poll`
  except in DMs, when the bot is mentioned, or when it authored the message.
- **Event plumbing:** build `dispatch.ts` (4.4) and the hub-side filters. Wire
  PRESENCE_UPDATE and USER_UPDATE here (`services/presence.ts`, profile
  routes) and the DM `CHANNEL_CREATE` when a DM with a bot is opened.
- **Files:** `src/lib/gateway/core.ts` (consider splitting into `session.ts`,
  `filters.ts`, `compression.ts`), `server.ts` (WS upgrade query parsing,
  SIGTERM reconnect), `scripts/gateway.ts`, `src/lib/botapi/dispatch.ts`,
  `src/lib/services/presence.ts`.
- **Data model:** none in Postgres (Redis keys only).
  `applications.gateway_intents` already exists.
- **Risks:** `GUILD_CREATE` size for big servers (respect `large_threshold`,
  chunk the rest via op 8). Memory per connection (zlib contexts, around
  64-256 KB). Fan-out cost: `routeDispatch` scans all connections. Index
  connections by guild id once there are many bots.
- **Tests:** in-process protocol tests driving `GatewayHub` with a fake `Conn`
  (no DB: stub the identity lookup): hello/identify/heartbeat/ack, resume replay,
  invalid resume, close codes, intent filtering, MESSAGE_CONTENT stripping and
  the DM-leak regression. Then the discord.js/discord.py smoke tests in
  section 6.

### WP2: Messages, reactions, pins, polls, attachments, components (1-2 engineers, ~3 weeks)

- **Routes:** fix every partial message/reaction/pin route. Add
  `GET /channels/{id}/messages/pins` (paginated) and
  `PUT/DELETE /channels/{id}/messages/pins/{mid}`, `crosspost` (wrap
  `announcements.ts`), `polls/{mid}/answers/{aid}` and `polls/{mid}/expire`
  (wrap `messageExtras`), `typing` (publish typing to SSE + TYPING_START), and
  `DELETE …/reactions/{emoji}`.
- **Create/edit:** `content`, `nonce` + `enforce_nonce` (Redis dedupe), `tts`
  (store; our TTS can honour it), `embeds` (validate limits, sanitize URLs),
  `allowed_mentions` (resolve before mention extraction/notifications),
  `message_reference` (reply type 19 and forward type 1 using the existing
  forward code), `components` (v1 and v2, validated against the component
  schema), `sticker_ids`, `attachments` metadata (descriptions, keep/remove on
  edit), `flags` (SUPPRESS_EMBEDS, SUPPRESS_NOTIFICATIONS, IS_VOICE_MESSAGE,
  IS_COMPONENTS_V2), and `poll`.
- **Multipart:** parse `files[n]` + `payload_json` and run them through the
  existing upload pipeline (`src/lib/api/uploads.ts` / `services/storage.ts`:
  file-type allowlist, scanning, size limits, B2). Return Discord attachment
  objects. Never accept caller-supplied attachment URLs. Also support
  `attachment://name` references in embeds.
- **Reads:** `before/after/around/limit` using snowflake timestamps. Messages
  get `referenced_message`, `message_reference`, `mentions` as full user
  objects (plus `member` in MESSAGE_CREATE), `mention_channels`,
  `sticker_items`, `webhook_id`, `application_id`, `interaction_metadata`,
  `components`, `thread`, `position`, and `reactions` with
  `me`/`count_details`/`burst_*` computed for the caller.
- **Events (this WP wires them):** MESSAGE_CREATE for DMs and webhooks;
  MESSAGE_UPDATE (partial payloads for embed unfurls); MESSAGE_DELETE;
  MESSAGE_DELETE_BULK; MESSAGE_REACTION_ADD/REMOVE/REMOVE_ALL/REMOVE_EMOJI;
  CHANNEL_PINS_UPDATE; TYPING_START. This covers every surface: `channels.ts`,
  `dms.ts`, `messageExtras.ts`, the webhook execute route in `index.ts`,
  `botApi`, `messageReports.ts` and `automod.ts`.
- **Frontend:** render components v1 (buttons, string/user/role/channel/
  mentionable selects) and v2 (container, section, text display, thumbnail,
  media gallery, file, separator) in `MessageGroup` (and add the prop to its
  `arePropsEqual`). Clicks post to an internal interaction route that WP3 owns.
  Theme vars only, strings via `useChatGt()`, and do it once in the shared chat
  engine so channels and DMs both get it.
- **Data model:** `ALTER TABLE messages ADD COLUMN IF NOT EXISTS components jsonb;`
  `… webhook_id uuid; … application_id uuid; … tts boolean;` (all nullable, no
  rewrite).
- **Risks:** E2EE DMs (bots can't read E2EE content, so serialize those as
  content-less with a flag, never ciphertext). Embed/component sanitization
  (security review required: URLs, emoji, custom_id lengths). Notification
  storms from `allowed_mentions` mistakes.
- **Tests:** contract tests for every route against `MessageResponse` etc., a
  multipart round trip, the allowed_mentions matrix (unit), pagination
  correctness over a seeded channel, and `bun run check:chat-media` /
  `check:theme` for the component UI.

### WP3: Interactions and application commands (1-2 engineers, ~3 weeks)

- **Commands REST:** upsert-by-name semantics with stable ids (bulk PUT diffs
  instead of delete/recreate), plus validation (name regex, 100 global/guild
  commands, option limits, 50035 trees). Store `default_member_permissions`,
  `dm_permission`, `contexts`, `integration_types`, `name/description
  _localizations`, `nsfw`, `handler` and `version` (a snowflake bumped on
  change). Add command permissions v2
  (`GET/PUT …/commands/{id}/permissions`,
  `GET …/guilds/{gid}/commands/permissions`) and
  `APPLICATION_COMMAND_PERMISSIONS_UPDATE`. Use one application id everywhere:
  the app's snowflake, with `clientId` accepted as an alias.
- **Interactions:** move tokens into Redis
  (`ix:<token>` → app, channel, guild, invoker, response state, original
  message id; TTL 15 min) with an ack deadline of 3 s and error 40060
  "already acknowledged". Support callback types 1, 4, 5 (show a "Bot is
  thinking…" placeholder message, ephemeral when flagged), 6, 7, 8, 9, 10
  (premium, deprecated: reject) and 12 (launch activity: reject). Support
  `with_response=true` returning `InteractionCallbackResponse`. Add the
  webhook-shaped routes: `GET/PATCH/DELETE /webhooks/{app}/{token}/messages/@original`,
  `POST /webhooks/{app}/{token}` (followup; shares the router with WP6), and
  `GET/PATCH/DELETE …/messages/{id}`. Ephemeral messages stay unpersisted but
  get ids (snowflakes) so they can be edited.
- **Interaction payload:** `id`, `application_id`, `type`, `data` (with
  `resolved` users/members/roles/channels/attachments/messages), `guild`,
  `guild_id`, `channel` (partial), `channel_id`, `member` (with
  `permissions`), `user`, `token`, `version`, `message` (components),
  `app_permissions`, `locale`, `guild_locale`, `entitlements`,
  `authorizing_integration_owners`, `context`, and
  `attachment_size_limit`. Deliver over the gateway **and** the HTTP endpoint
  (Discord sends to HTTP only if a URL is set; keep that rule but make the
  gateway path complete).
- **Client UI:** a slash-command picker with typed option inputs (string,
  integer/number with min/max, boolean, user/role/channel/mentionable pickers,
  attachments, choices). Autocomplete (type 4) round trips while typing. Modal
  rendering (text inputs, plus label/select components from the 2025 modal
  update) and submit (type 5). User/message context menus (types 2/3 with
  `target_id`) in the existing context menus. Component clicks (type 3) from
  WP2's renderers. Keep the text `/name args` parser as a fallback.
- **Files:** `src/lib/services/interactions.ts` (split into `store.ts`,
  `build.ts`, `respond.ts`), `src/lib/services/appCommands.ts`,
  `botApi/commands.ts`, `botApi/interactions.ts`, `src/hooks/useSlashCommands.ts`,
  `src/hooks/useComposerSuggestions.ts`, the composer in
  `src/components/chat/MessageBar.tsx`, a new `InteractionModal`
  (`next/dynamic` + `MountWhenOpened`), and `MessageContextMenu`.
- **Data model:** `ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS
  default_member_permissions text, ADD COLUMN IF NOT EXISTS contexts integer[],
  ADD COLUMN IF NOT EXISTS integration_types integer[], ADD COLUMN IF NOT EXISTS
  name_localizations jsonb, ADD COLUMN IF NOT EXISTS description_localizations
  jsonb, ADD COLUMN IF NOT EXISTS nsfw boolean, ADD COLUMN IF NOT EXISTS
  handler integer;` plus
  `CREATE TABLE IF NOT EXISTS app_command_permissions (application_id uuid,
  guild_id uuid, command_id uuid NULL, permissions jsonb, PRIMARY KEY …)`.
- **Risks:** UI scope (biggest frontend chunk of the project). Abuse of HTTP
  interaction endpoints (SSRF: the endpoint URL is already validated at
  registration; keep the 3 s timeout and add a per-app concurrency cap).
- **Tests:** unit tests for option coercion/validation and the token state
  machine (ack twice → 40060, followups after 15 min → 10015). discord.js
  `deferReply → editReply → followUp → deleteReply` and discord.py
  `app_commands` sync/invoke in the smoke suite.

### WP4: Guild resources (2 engineers splitting by area, ~3-4 weeks)

- **4a: guild, channels, roles, members, bans.** `GET/PATCH /guilds/{id}`
  (all fields, `with_counts`, image data URIs through the upload pipeline);
  `PATCH /guilds/{id}/channels` (positions); `PUT/DELETE
  /channels/{id}/permissions/{oid}`; `GET/POST /channels/{id}/invites`;
  `POST /channels/{id}/followers` (reuse `announcements.ts`); group-DM
  recipients; roles `GET {id}`, `PATCH` bulk positions, `member-counts`, role
  icons; members `search`, `PATCH @me`, `PUT` (OAuth `guilds.join`),
  `PUT/DELETE …/roles/{rid}`, list with `after`; `bulk-ban`; `prune`
  (GET/POST); vanity URL; `regions`.
- **4b: expressions, invites, moderation, events, onboarding.** Stickers
  create/patch/delete, `/stickers/{id}`, `/sticker-packs`; invites
  (`with_counts`, `with_expiration`, full objects, target users); audit log
  (fill `users`, `webhooks`, `threads`, `integrations`; `before/after`);
  AutoMod CRUD (wrap `services/automod.ts`); scheduled events CRUD + users
  (wrap `services/scheduledEvents.ts`); welcome screen, onboarding (wrap
  `community.ts` / `server_onboarding`), widget settings + `widget.json`
  (+ png later), templates (wrap `serverTemplates.ts`), `preview`,
  `integrations` (return the bot integrations), `incident-actions`, join
  requests (wrap `server_member_applications`), `guild_search` (wrap
  `messageSearch.ts`, honouring E2EE exclusions).
- **Events (this WP wires them):** GUILD_UPDATE, CHANNEL_CREATE/UPDATE/DELETE,
  GUILD_ROLE_*, GUILD_MEMBER_ADD/UPDATE/REMOVE (humans, including timeouts,
  nick, roles, `pending`), GUILD_BAN_*, GUILD_EMOJIS_UPDATE,
  GUILD_STICKERS_UPDATE, INVITE_CREATE/DELETE, GUILD_INTEGRATIONS_UPDATE,
  INTEGRATION_*.
- **Files:** `botApi/{guilds,channels,roles,members,moderation,expressions,
  invites,events}.ts`; event wiring in `src/lib/api/servers.ts`,
  `src/lib/api/channels.ts` (channel CRUD only), `services/serverMembership.ts`,
  `api/community.ts`, `api/automod.ts`, `api/scheduledEvents.ts`.
- **Data model:** mostly none (`channels.permission_overwrites`, threads,
  tags, onboarding and templates exist). Possibly `servers.vanity_url_code`,
  `servers.widget_*`, `roles.icon/unicode_emoji` if missing.
- **Risks:** role-hierarchy and permission rules must use the existing
  `botGuild.ts` helpers (`outranks`, `canGrantBits`), with security review.
  Events must not leak hidden channels: a bot only receives CHANNEL_* for
  channels it can view, and must get CREATE/DELETE when overwrites change its
  view.
- **Tests:** contract tests per route; permission matrix tests (pure); the
  discord.js `guild.channels.create`, `member.roles.add`, `ban` and
  `members.fetch` smoke flows.

### WP5: Threads and forums (1 engineer, ~1.5 weeks)

- **Routes:** `POST /channels/{id}/threads` (incl. forum posts with `message`
  and `applied_tags`), `POST …/messages/{mid}/threads`,
  `thread-members` (list with `with_member`, get, add, remove, `@me`
  join/leave), `threads/archived/public|private`,
  `users/@me/threads/archived/private`, `GET /guilds/{id}/threads/active`,
  `threads/search`. Plus thread fields on `PATCH /channels/{id}` (`archived`,
  `locked`, `auto_archive_duration`, `invitable`, `applied_tags`) and forum
  fields (`available_tags`, `default_reaction_emoji`,
  `default_sort_order`, `default_forum_layout`).
- **Events:** THREAD_CREATE/UPDATE/DELETE, THREAD_LIST_SYNC (on gaining access),
  THREAD_MEMBER_UPDATE, THREAD_MEMBERS_UPDATE. Threads must be included in
  GUILD_CREATE (coordinate with WP1).
- **Files:** `botApi/threads.ts`, `src/lib/services/threads.ts` (already has
  the members/archive logic and `thread_members_update` fan-out),
  `channels.ts` thread routes (wiring only).
- **Data model:** none (`channels` has thread/forum columns,
  `threadMemberIds`). Thread-member `join_timestamp` is kept in a Redis hash
  per thread (`thread:joins:<threadId>`, `src/lib/botapi/threadMemberJoins.ts`)
  and falls back to the thread's creation time; `flags` is always 0.
- **Tests:** contract tests and the discord.js `forum.threads.create` +
  `thread.members.add` smoke flows.

### WP6: Webhooks, applications, OAuth2, CDN compatibility (1 engineer, ~2 weeks)

- **Webhook router:** one handler for `/webhooks/{id}/{token}` that resolves a
  channel webhook (by webhook id, timing-safe token compare) or an interaction
  token (WP3) and dispatches to either. Add execute `wait`, `thread_id`,
  `thread_name`, `with_components`, `username`/`avatar_url` overrides,
  multipart, `flags`. Add `GET/PATCH/DELETE` by token, `messages/{id}` and
  `@original` CRUD, `PATCH /webhooks/{id}`, `/slack` and `/github`
  compatibility, and WEBHOOKS_UPDATE. Webhook objects get `url` and
  `application_id`. Keep the old `/api/webhooks/{channelId}/{token}` URLs
  working, since they are already handed out.
- **Applications:** `GET/PATCH /applications/@me`,
  `GET /oauth2/applications/@me`, `GET/PATCH /applications/{id}`
  (owner/team), app emojis CRUD (table exists: `app_emojis`),
  `role-connections/metadata`, `upload_application_attachment` (stub), and
  activity instances (404 stub). Application objects carry `flags` (incl.
  GATEWAY_* intent approvals), `bot`, `owner`/`team`, `verify_key`,
  `install_params`, `integration_types_config`, `interactions_endpoint_url`
  and approximate counts.
- **OAuth2:** serve `/api/v10/oauth2/*` aliases of the unversioned routes.
  Add `GET /oauth2/@me`, `GET /oauth2/userinfo` + `GET /oauth2/keys` (OIDC; may
  piggyback on serika-accounts), `users/@me/guilds` (Bearer `guilds`),
  `users/@me/guilds/{id}/member`, `users/@me/connections`,
  `users/@me/applications/{id}/role-connection`, the `client_credentials` /
  `refresh_token` grants, and bot install with `integration_type=1`
  (user-installed apps) if WP3 does `contexts`.
- **CDN compatibility:** serve `/{avatars,icons,banners,splashes,
  discovery-splashes,emojis,stickers,role-icons,app-icons,guilds/{g}/users/{u}/avatars,embed/avatars}/…`
  from a `cdn-compat` path (or a separate host such as `cdn-compat.serika.chat`)
  that 302s to `cdnImage()` URLs with `size`/`format` mapped to wsrv params.
  Serializers emit a stable **hash** (a hex digest of the storage key, with an
  `a_` prefix when animated) and keep a reverse map in Redis. Libraries are
  pointed at it with discord.js `rest.cdn` and discord.py
  `discord.asset.Asset.BASE`.
- **Files:** `botApi/{webhooks,applications,oauth2}.ts`, `src/lib/api/index.ts`
  (webhook execute route; keep the owner's bug-report section untouched),
  `src/lib/api/developers.ts`, `server.ts` (CDN redirect fast path),
  `src/lib/botapi/cdn.ts`.
- **Data model:** `ALTER TABLE channel_webhooks ADD COLUMN IF NOT EXISTS
  application_id uuid, ADD COLUMN IF NOT EXISTS type smallint, ADD COLUMN IF
  NOT EXISTS source_channel_id uuid;` and, if linked roles are in scope,
  `CREATE TABLE IF NOT EXISTS app_role_connection_metadata (...)` and
  `user_app_role_connections (...)`.
- **Risks:** webhook tokens in URLs (keep timing-safe compares and
  per-webhook rate limits), and an open redirect on the CDN shim (only
  redirect to our own CDN).
- **Status (2026-10-27):** all of the above has landed. Linked roles use the
  `application_api_settings` side tables (`drizzle/manual_application_api_settings.sql`,
  created on first use) instead of the two tables sketched here; nothing in the
  Serika UI consumes role connections yet. OIDC is served by SerikaCord itself
  (`src/lib/oauth/oidc.ts`, signing key from `OIDC_SIGNING_KEY` or a
  Redis-shared generated key in `src/lib/services/oidcKeys.ts`), not by
  serika-accounts. `/slack` and `/github` webhook execute convert payloads in
  `src/lib/botapi/webhookCompat.ts`.

### WP7: Voice, stage, soundboard, monetization, Social SDK lobbies (research + 1 engineer)

- **Monetization: stub.** `GET /applications/{id}/skus` and `…/entitlements`
  return `[]`, `GET /skus/{id}/subscriptions` returns `[]`, and test
  entitlements return 404/501. This lets libraries' monetization helpers work
  without a payment system. No events.
- **Voice state (feasible, ~1 week):** `GET/PATCH /guilds/{id}/voice-states/@me|{uid}`,
  VOICE_STATE_UPDATE from `src/lib/api/voice.ts` join/leave/mute/deafen,
  `voice_states` in GUILD_CREATE, and member `PATCH` `channel_id`
  (move/disconnect), `mute` and `deaf`. That covers moderation bots and voice
  logging.
- **Voice media for bots (not feasible short term).** Serika voice is a
  browser P2P mesh (simple-peer + TURN, no SFU). Discord bots expect op 4 →
  VOICE_SERVER_UPDATE → voice WS v8 → UDP IP discovery → RTP with
  `aead_aes256_gcm_rtpsize` / `aead_xchacha20_poly1305_rtpsize` → Opus, plus
  DAVE E2EE negotiation (libraries fall back when the server advertises no
  DAVE). Doing this needs a server-side media bridge: a Bun UDP endpoint
  speaking the voice protocol, bridged into WebRTC through a server-side peer
  (e.g. werift) or, better, after moving Serika voice onto an SFU
  (mediasoup/LiveKit). Estimate 6-10 weeks with real risk. Recommendation: send
  VOICE_STATE_UPDATE now; for op 4 joins, answer with VOICE_SERVER_UPDATE
  `endpoint: null` (Discord's "voice server unavailable" signal) so library
  joins time out with a clear error instead of hanging mid-handshake; revisit
  with the SFU work.
- **Stage instances and soundboard (done):** stage instances are real rows in
  `stage_instances` (`src/lib/botapi/guildStageInstances.ts`,
  `drizzle/manual_stage_instances.sql`) with STAGE_INSTANCE_* events and audit
  entries 83-85; `send_start_notification` is permission-checked only. The
  server soundboard (`servers.soundboard_sounds`) is exposed through
  `GET/POST/PATCH/DELETE /guilds/{id}/soundboard-sounds` with
  GUILD_SOUNDBOARD_SOUND_* events and audit entries 130-132;
  `/soundboard-default-sounds` is `[]` (Serika has no built-in set);
  `send-soundboard-sound` plays to everyone in the voice channel without the
  bot being connected (bots can't join voice) and emits
  VOICE_CHANNEL_EFFECT_SEND. Voice channel status (`PUT
  /channels/{id}/voice-status`) lives in Redis and is cleared when the channel
  empties; the web client doesn't show it yet.
- **Social SDK lobbies / partner-sdk (done, app-scoped):** Discord's Lobby
  resource is implemented in `src/lib/api/botApi/social.ts` (rules in
  `src/lib/botapi/lobbies.ts`, storage in `src/lib/services/lobbies.ts`,
  `drizzle/manual_social_parity.sql`). A lobby belongs to one application;
  members must be users who authorized it; user calls take a Bearer token with
  `sdk.social_layer`. Lobby chat is text only, encrypted at rest and kept 72
  hours. A linked channel gets a copy of each lobby message from the app's bot
  (when it may send there); nothing is relayed back, and no LOBBY_* gateway
  events are sent. The partner-sdk token / unmerge routes validate the request
  and answer 530000 (no provisional accounts); DM moderation metadata is stored
  per application. Serika's own Social SDK (`social-sdk.ts`, `/api/v1`) is
  separate and unchanged.

### WP8: Developer experience (1 engineer, continuous)

- **Docs:** rewrite the bot quick-starts with tested, copy-paste-correct
  snippets. For discord.js: `new Client({ rest: { api:
  'https://api.serika.chat/api', cdn: … } })` plus intents. For discord.py:
  `discord.http.Route.BASE = 'https://api.serika.chat/api/v10'`, plus the
  `Asset.BASE` CDN override. Also JDA (`RestConfig.setBaseUrl`), Serenity
  (`HttpBuilder::proxy`) and DSharpPlus (confirm its REST base override first). Add a compatibility matrix page
  generated from `discord-parity.json` (per-route status, live), "differences
  from Discord" (UUID-format apps, voice, monetization), and a rate-limit page
  that matches the real headers. Fix the broken discord.py snippet now.
- **Portal:** id format toggle, privileged intent toggles, interactions
  endpoint tester (PING plus a signed sample command), a gateway inspector
  (last N dispatches per app from the replay buffer), per-bot rate-limit
  dashboard (bucket usage, 429s), and token reset with a session kill.
- **Sandbox:** a "bot playground" server template plus a one-click "create
  test server with your bot installed". Also an `X-Serika-Debug: 1` request
  header that echoes the resolved route, bucket and permission decision.
- **Compat CI:** the section 6 smoke suite on every PR touching bot code, plus
  `bun scripts/discord-parity.ts --check`.

## 6. Testing without touching production data

The constraints: the canary/prod Postgres and Redis are shared production data,
this machine has about 3 GB of free RAM, and there is no local Postgres/Redis
binary (`psql`, `docker` and `podman` are installed; Docker is running).

### 6.1 Recommended: a disposable local stack plus an API-only harness

**Data services (about 50 MB RAM total).** Run them in containers:
`postgres:17-alpine` (`-c shared_buffers=16MB -c fsync=off -c
synchronous_commit=off -c max_connections=30`, data on `--tmpfs`) and
`valkey:8-alpine` (`--save "" --appendonly no`), bound to `127.0.0.1` on
non-standard ports (55432/56379). Podman is daemonless; Docker is already
running. Either works, and both need a one-time image pull the owner approves.
This gives real Postgres semantics (row locks in `mutateReactions`, enums,
`gen_random_uuid`) and real Redis Lua (`rate-limiter-flexible` uses EVAL), which
mocks don't reproduce. If the owner prefers no containers, `apt install
postgresql redis-server` with a throwaway `initdb` data dir uses the same RAM.

**Schema.** Build it offline, never with `drizzle-kit push` against an env-read
URL. Use `drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`) from
`src/lib/db/schema.ts`, apply `drizzle/manual_*.sql`, then let
`initializeAPI()` run its idempotent `ensure*Schema` steps.

**Harness** (`scripts/bot-compat/serve.ts`, about 300 MB RSS). This is a Bun
process that imports `api` from `src/lib/api` and serves `/api/*` via
`api.handle(req)` and `/api/v10/gateway` via `GatewayHub` +
`subscribeHubToRedis`. No Next.js, so no `next build` or dev server is needed.
Its first lines assert that `POSTGRES_URI` and `REDIS_URL` point at
`127.0.0.1:55432/56379` and that every external-service variable (B2/CDN
upload keys, FCM, PhotoDNA, accounts service, Discord bridge) is unset, and
abort otherwise. It sets `DISABLE_DISCORD_BOT=1` and runs with an explicit
`--env-file scripts/bot-compat/.env.test` so the repo `.env` is never the source
of truth. A seed step (`scripts/bot-compat/seed.ts`) creates two users, a
server, text/forum/voice channels, a role and an application with a bot. It
installs the bot via the same service code as the OAuth flow and prints the bot
token and user session tokens to a git-ignored file.

**Smoke clients** (about 80 MB each). They live in a scratch dir outside the
repo, installed once: `npm i discord.js` and `python -m venv` + `pip install
discord.py`. Each script logs in, asserts READY + GUILD_CREATE, asks the
harness (using a seeded user session) to post a message, and asserts it receives
and replies with `reply()`, a file, reactions and an edit/delete. It then syncs
a slash command, has the harness invoke it, and runs defer → editReply →
followUp. It fetches members (op 8), creates a thread and runs a webhook
execute with `wait=true`. JDA can be added later (Java is installed); Serenity
needs a Rust toolchain.

**Peak** is about 600 MB with everything running. Don't run `tsc` or Next at
the same time.

### 6.2 Tests that need no services at all (add first)

- Pure unit tests in `tests/` (`bun test`): snowflake codec and ordering,
  content token rewriting, the `errors` tree, rate-limit buckets, the intent
  and MESSAGE_CONTENT filter, the routeDispatch DM regression, option coercion
  and the interaction token state machine.
- **Contract tests**: validate serializer output and recorded responses against
  the OpenAPI component schemas with Ajv (draft 2020-12, `strict: false`). The
  full spec is fetched by `--refresh` into the scratch area, not committed.
- `GatewayHub` protocol tests with a fake `Conn` and an injected identity
  lookup (a small seam in `identify()`), so no DB is needed.

### 6.3 Rejected options

- **PGlite + ioredis-mock fully in-process.** No external processes, but more
  RAM than the containers (WASM Postgres, about 150 MB+). It needs code seams in
  `src/lib/db/postgres.ts` (the `pg` Pool has `min: 4` hard-coded) and in every
  `new Redis(...)`, and ioredis-mock's Lua support breaks the rate limiter.
  Fine for unit tests, not for library smoke tests.
- **Pointing tests at canary.** Forbidden (production data, real users).

## 7. Milestones

| Milestone | Contents | Exit criterion |
|---|---|---|
| M0 (now) | Section 2 hotfixes 1, 2, 5 (MESSAGE_CONTENT gate), fix the docs snippet | DM-leak regression test; the `gw.dm_routing` probe flips to yes |
| M1 | WP0, WP1 READY/GUILD_CREATE/intents/op 8, WP6 `applications/@me` + `oauth2/applications/@me`, test stack 6.1 | discord.py and discord.js log in, see guilds, receive and reply to a message in the local harness |
| M2 | WP2, WP3 core (defer/edit/followup, stable command ids), WP6 webhook router | ping/reply/file/reaction/slash smoke tests green for both libraries |
| M3 | WP4, WP5, WP3 UI (components, modals, autocomplete, context menus) | REST coverage ≥ 70% of bot-usable routes; all non-voice/monetization events emitted |
| M4 | WP7 stubs + voice state, WP8 portal/sandbox, JDA smoke | REST ≥ 85%; compatibility page live |
| Later | Voice media bridge (after an SFU decision), ETF, zstd | — |

<!-- parity:generated:start (bun scripts/discord-parity.ts rewrites this block) -->

Generated from `discord/discord-api-spec@ed01408` (2026-10-14) and `discord/discord-api-docs@3714862` (2026-10-09). Coverage counts a partial route as half; "reachable" counts it as whole. Deprecated routes (4) are excluded.

### Headline numbers

| Surface | Total | Implemented | Partial | Missing | Coverage | Reachable |
|---|---:|---:|---:|---:|---:|---:|
| REST, every operation | 248 | 226 | 22 | 0 | 95.6% | 100% |
| REST, bot-token usable | 243 | 221 | 22 | 0 | 95.5% | 100% |

Gateway: 73/82 receive events emitted (89%; 3 of them only from some code paths), 0 more have an emitter nobody calls; 12/13 opcodes; 14/14 close codes used; 21/21 intents defined. Protocol features: 64/67.

### REST coverage by area

| Area | WP | Total | Impl. | Partial | Missing | Coverage |
|---|---|---:|---:|---:|---:|---:|
| Social SDK lobbies / provisional accounts | WP7 | 20 | 13 | 7 | 0 | 82.5% |
| OAuth2 + linked roles | WP6 | 12 | 12 | 0 | 0 | 100% |
| Gateway discovery | WP1 | 2 | 2 | 0 | 0 | 100% |
| Interaction callbacks | WP3 | 1 | 0 | 1 | 0 | 50% |
| Application commands | WP3 | 16 | 16 | 0 | 0 | 100% |
| Monetization (entitlements, SKUs, subscriptions) | WP7 | 9 | 9 | 0 | 0 | 100% |
| Applications (app info, app emojis, activities) | WP6 | 11 | 9 | 2 | 0 | 90.9% |
| Webhooks (incl. interaction followups) | WP6 | 18 | 18 | 0 | 0 | 100% |
| Reactions | WP2 | 6 | 6 | 0 | 0 | 100% |
| Threads + forums | WP5 | 13 | 12 | 1 | 0 | 96.2% |
| Messages, pins, polls, typing | WP2 | 13 | 12 | 1 | 0 | 96.2% |
| Channels (settings, overwrites, invites, followers, group DM) | WP4 | 12 | 9 | 3 | 0 | 87.5% |
| Scheduled events + stage instances | WP4 | 15 | 11 | 4 | 0 | 86.7% |
| Voice (regions, voice states, soundboard) | WP7 | 12 | 12 | 0 | 0 | 100% |
| Emojis + stickers | WP4 | 13 | 13 | 0 | 0 | 100% |
| Invites | WP4 | 10 | 10 | 0 | 0 | 100% |
| Audit log + AutoMod | WP4 | 7 | 6 | 1 | 0 | 92.9% |
| Members, bans, prune, join requests | WP4 | 18 | 18 | 0 | 0 | 100% |
| Users + DMs | WP1 | 8 | 7 | 1 | 0 | 93.8% |
| Guild settings (guild, roles, channels list, widget, onboarding, templates, ...) | WP4 | 32 | 31 | 1 | 0 | 98.4% |

### REST coverage by work package

| WP | Scope | Total | Impl. | Partial | Missing | Coverage |
|---|---|---:|---:|---:|---:|---:|
| WP1 | Gateway core + event plumbing | 10 | 9 | 1 | 0 | 95% |
| WP2 | Messages, reactions, pins, polls, attachments, components | 19 | 18 | 1 | 0 | 97.4% |
| WP3 | Interactions + application commands | 17 | 16 | 1 | 0 | 97.1% |
| WP4 | Guild resources (guild, channels, roles, members, bans, expressions, invites, moderation, events) | 107 | 98 | 9 | 0 | 95.8% |
| WP5 | Threads + forums | 13 | 12 | 1 | 0 | 96.2% |
| WP6 | Webhooks, applications, OAuth2, CDN compat | 41 | 39 | 2 | 0 | 97.6% |
| WP7 | Voice, stage, soundboard, monetization, Social SDK lobbies | 41 | 34 | 7 | 0 | 91.5% |

### Protocol features

| WP | Feature | Status | Evidence |
|---|---|---|---|
| WP0 | Ids exposed as numeric snowflakes (discord.py/JDA/Serenity/DSharpPlus parse ids as 64-bit ints) | yes | src/lib/api/botApi/applications.ts, src/lib/botapi/boundary.ts |
| WP0 | Validation errors are 400 + code 50035 with an `errors` tree | yes | src/lib/botapi/threads.ts, src/lib/botapi/gdmJoin.ts, src/lib/botapi/expressions.ts, src/lib/botapi/errors.ts |
| WP0 | X-RateLimit-Limit/Remaining/Reset/Reset-After/Bucket headers on bot routes | yes | src/lib/security/botRateLimit.ts, server.ts |
| WP0 | 429 body is { message, retry_after, global } (+ X-RateLimit-Scope) | yes | src/lib/api/botApi.ts, src/lib/api/botApi/applications.ts, src/lib/botapi/threads.ts, src/lib/security/botRateLimit.ts |
| WP6 | OAuth2 Bearer tokens accepted on /api/v10 (users/@me, guilds, connections) | yes | src/lib/api/botApi.ts, src/lib/api/botApi/applications.ts |
| WP0 | Channel permission overwrites applied to bot actions (reuse computeChannelPermissions from src/lib/permissions/channelOverwrites.ts) | yes | src/lib/api/botApi.ts, src/lib/api/botApi/social.ts, src/lib/botapi/guildSearch.ts, src/lib/botapi/guildExtras.ts |
| WP0 | Permission bitfields in Discord v10 numbering (bits 42-46 permuted at the boundary for snowflake-format apps) | yes | src/lib/botapi/boundary.ts |
| WP6 | Discord CDN path compatibility (/avatars/{user_id}/{hash}.png, /icons/, /emojis/{id}.png, /embed/avatars/) | yes | src/lib/botapi/cdnCompat.ts, server.ts |
| WP1 | GUILD_CREATE sent for every guild after READY | yes | src/lib/gateway/core.ts |
| WP1 | compress=zlib-stream transport compression | yes | src/lib/gateway/core.ts, src/lib/gateway/compression.ts |
| WP1 | compress=zstd-stream transport compression | **no** | - |
| WP1 | encoding=etf (Erlang term format) | **no** | - |
| WP1 | RESUME replays missed dispatches (per-session buffer) | yes | src/lib/gateway/core.ts, src/lib/gateway/session.ts |
| WP1 | RESUME validates session_id + seq; bad resume → op 9 / 4007 | yes | src/lib/gateway/session.ts |
| WP1 | IDENTIFY shard [id, n] honoured (guild_id >> 22 % n), 4010/4011 | yes | src/lib/gateway/core.ts, src/lib/gateway/session.ts |
| WP1 | Op 3 Presence Update (bot status + activities) | yes | src/lib/gateway/core.ts |
| WP7 | Op 4 Voice State Update → VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE | yes | src/lib/gateway/core.ts |
| WP1 | Op 8 Request Guild Members → GUILD_MEMBERS_CHUNK | yes | src/lib/gateway/core.ts |
| WP7 | Op 31 Request Soundboard Sounds | yes | src/lib/gateway/core.ts |
| WP1 | Privileged intents checked against app flags (close 4014) | yes | src/lib/gateway/intents.ts, src/lib/gateway/session.ts |
| WP1 | Invalid intents rejected (close 4013) | yes | src/lib/gateway/session.ts |
| WP1 | Without MESSAGE_CONTENT, content/embeds/attachments/components are blanked (except DMs, mentions, own msgs) | yes | src/lib/gateway/intents.ts, src/lib/gateway/routing.ts |
| WP1 | DM events reach only bots that are recipients (no fan-out to bots with zero DMs) | yes | broken pattern gone |
| WP1 | DMs opened after IDENTIFY are tracked (CHANNEL_CREATE for DMs) | yes | src/lib/gateway/core.ts |
| WP1 | Leaving/kicked/banned guilds are dropped from the session (GUILD_DELETE) | yes | src/lib/gateway/core.ts |
| WP1 | Gateway send rate limit (120 / 60 s) with close 4008 | yes | src/lib/gateway/session.ts |
| WP1 | IDENTIFY budget: 1 per 5 s per bot (op 9) and 1000 per day (close 4008), reported by GET /gateway/bot | yes | src/lib/gateway/core.ts, src/lib/security/botRateLimit.ts |
| WP1 | Payload before IDENTIFY closes with 4003 | yes | src/lib/gateway/session.ts |
| WP1 | Second IDENTIFY closes with 4005 | yes | src/lib/gateway/session.ts |
| WP1 | Unknown opcode closes with 4001 | yes | src/lib/gateway/session.ts |
| WP1 | Unsupported ?v= closes with 4012 | yes | src/lib/gateway/session.ts |
| WP1 | Op 7 RECONNECT sent before deploy/shutdown so bots resume | yes | src/lib/gateway/core.ts |
| WP2 | multipart/form-data with files[n] + payload_json | yes | src/lib/api/botApi.ts, src/lib/botapi/boundary.ts, src/lib/chat/botMultipart.ts |
| WP2 | allowed_mentions honoured (parse/users/roles/replied_user) | yes | src/lib/api/botApi.ts, src/lib/chat/allowedMentions.ts |
| WP2 | message_reference on create (replies + forwards), referenced_message in responses | yes | src/lib/api/botApi.ts, src/lib/api/botApi/social.ts, src/lib/botapi/lobbies.ts |
| WP2 | Message components persisted on messages | yes | src/lib/db/schema.ts |
| WP2 | Components v2 (IS_COMPONENTS_V2, container/section/text display/media gallery/file) | yes | src/lib/api/botApi.ts, src/lib/botapi/components.ts, src/lib/chat/interactionEvents.ts, src/lib/chat/componentsV2.ts |
| WP2 | Embed validation + limits (10 embeds, 6000 chars, field limits) | yes | src/lib/api/botApi.ts, src/lib/botapi/commands.ts, src/lib/botapi/threadRules.ts, src/lib/chat/embedValidation.ts |
| WP2 | GET messages honours before/after/around | yes | src/lib/api/botApi.ts, src/lib/botapi/users.ts |
| WP2 | MESSAGE_UPDATE emitted on edits (any surface) | yes | src/lib/discord/bot.ts, src/lib/api/dms.ts, src/lib/api/botApi.ts, src/lib/api/announcements.ts |
| WP2 | Pinning posts a CHANNEL_PINNED_MESSAGE (type 6) system message | yes | src/lib/api/botApi.ts, src/lib/botapi/pinNotice.ts |
| WP2 | sticker_ids on create / sticker_items in responses | yes | src/lib/botapi/permissionBits.ts, src/lib/chat/discordMessage.ts |
| WP3 | Ed25519-signed HTTP interactions endpoint (+ PING verification) | yes | src/lib/botapi/endpointVerify.ts |
| WP3 | Callback 5 DEFERRED_CHANNEL_MESSAGE shows "thinking…" and is completed by @original edit | yes | src/lib/services/interactions.ts, src/lib/botapi/roleConnections.ts |
| WP3 | Callbacks 6/7 DEFERRED_UPDATE_MESSAGE / UPDATE_MESSAGE | yes | src/lib/services/interactions.ts, src/lib/botapi/roleConnections.ts |
| WP3 | Callback 8 APPLICATION_COMMAND_AUTOCOMPLETE_RESULT | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts, src/lib/botapi/roleConnections.ts |
| WP3 | Callback 9 MODAL | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts, src/lib/botapi/interactionState.ts |
| WP3 | Type 3 MESSAGE_COMPONENT interactions from button/select clicks | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts |
| WP3 | Type 4 APPLICATION_COMMAND_AUTOCOMPLETE while typing options | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts |
| WP3 | Type 5 MODAL_SUBMIT | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts |
| WP3 | GET/PATCH/DELETE /webhooks/{app}/{token}/messages/@original + followup edit/delete | yes | src/lib/api/botApi.ts |
| WP3 | Interaction tokens shared across instances (Redis), 15 min TTL | yes | broken pattern gone |
| WP3 | interaction.application_id equals the id READY and the command routes use | yes | broken pattern gone |
| WP3 | interaction.data.resolved (users/members/roles/channels/attachments) | yes | src/lib/services/interactions.ts |
| WP3 | interaction.app_permissions / member.permissions / entitlements / context / authorizing_integration_owners | yes | src/lib/services/interactions.ts |
| WP3 | User + message context-menu commands (data.target_id) invocable from the UI | yes | src/lib/services/interactions.ts |
| WP3 | default_member_permissions / contexts / integration_types stored and enforced | yes | src/lib/api/botApi/applications.ts, src/lib/botapi/permissionBits.ts, src/lib/botapi/commands.ts, src/lib/services/appCommands.ts |
| WP3 | name_localizations / description_localizations | yes | src/lib/api/botApi/applications.ts, src/lib/botapi/permissionBits.ts, src/lib/botapi/roleConnections.ts, src/lib/botapi/commands.ts |
| WP6 | Webhook execute ?wait=true returns the message | yes | src/lib/services/channelWebhooks.ts |
| WP6 | Webhook execute thread_id / thread_name (forum posts) | yes | src/lib/api/botApi.ts, src/lib/services/channelWebhooks.ts |
| WP6 | OAuth2 bot install (scope=bot&permissions=…) creates the managed role and sends GUILD_CREATE | yes | src/lib/api/developers.ts |
| WP6 | OpenID Connect: RS256 id_token from POST /oauth2/token with the openid scope (+ /oauth2/userinfo, /oauth2/keys) | yes | src/lib/services/oauth2Tokens.ts |
| WP6 | client_credentials grant | yes | src/lib/api/developers.ts, src/lib/services/oauth2Tokens.ts |
| WP6 | Application flags expose GATEWAY_* intent approvals (1<<12…1<<19) and gate privileged intents | yes | src/lib/botapi/application.ts, src/lib/gateway/intents.ts |
| WP7 | Voice gateway for bots (VOICE_SERVER_UPDATE + voice WS v8 / UDP RTP Opus / DAVE) | **no** | - |
| WP8 | discord.py quick-start example in the docs is valid Python | yes | broken pattern gone |
| WP8 | Docs only promise rate-limit headers the API actually sends | yes | src/lib/security/botRateLimit.ts |

### Object shapes (top-level fields vs the OpenAPI schema)

| Object | Schema | Coverage | Missing fields | Source |
|---|---|---:|---|---|
| User (REST) | UserResponse | 79% | avatar_decoration_data, collectibles, primary_guild | src/lib/api/botApi.ts:670 formatUser() |
| User (gateway) | UserResponse | 0% | accent_color, avatar, avatar_decoration_data, banner, bot, collectibles, discriminator, flags, global_name, id, primary_guild, public_flags, system, username | src/lib/services/gatewayEvents.ts:182 toDiscordUser() |
| Message (REST) | MessageResponse | 75% | activity, actor, application, lobby_member, purchase_notification, resolved, role_subscription_data, shared_client_theme, stickers, thread | src/lib/chat/discordMessage.ts:310 serializeMessage() |
| Message (gateway) | MessageResponse | 75% | activity, actor, application, lobby_member, purchase_notification, resolved, role_subscription_data, shared_client_theme, stickers, thread | src/lib/chat/discordMessage.ts:310 serializeMessage() |
| Guild channel | GuildChannelResponse | 0% | available_tags, bitrate, default_auto_archive_duration, default_forum_layout, default_reaction_emoji, default_sort_order, default_tag_setting, default_thread_rate_limit_per_user, flags, guild_id, id, last_message_id, last_pin_timestamp, name, nsfw, parent_id, permission_overwrites, permissions, position, rate_limit_per_user, rtc_region, topic, type, user_limit, video_quality_mode | src/lib/api/botApi.ts:691 formatChannel() |
| Guild | GuildResponse | 12% | afk_channel_id, afk_timeout, application_id, banner, default_message_notifications, description, discovery_splash, explicit_content_filter, features, home_header, icon, id, incidents_data, max_members, max_presences, max_stage_video_channel_users, max_video_channel_users, mfa_level, name, nsfw, nsfw_level, owner_id, preferred_locale, premium_progress_bar_enabled, premium_progress_bar_enabled_user_updated_at, premium_subscription_count, premium_tier, public_updates_channel_id, region, rules_channel_id, safety_alerts_channel_id, splash, system_channel_flags, system_channel_id, vanity_url_code, verification_level | src/lib/api/botApi.ts:701 formatGuild() |
| Role | GuildRoleResponse | 0% | color, colors, flags, hoist, icon, id, managed, mentionable, name, permissions, position, tags, unicode_emoji | src/lib/api/botApi.ts:730 formatRole() |
| Guild member | GuildMemberResponse | 7% | avatar, avatar_decoration_data, banner, collectibles, communication_disabled_until, deaf, flags, joined_at, mute, nick, pending, premium_since, roles | src/lib/api/botApi.ts:734 formatMember() |
| Invite | GuildInviteResponse | 50% | flags, guild_id, guild_scheduled_event, is_contact, is_nickname_changeable, roles, target_application, target_channel_id, target_message_id, target_type, target_user, type | src/lib/api/botApi.ts:1347 formatInvite() |
| READY payload | gateway docs | 100% | - | src/lib/gateway/core.ts |
| IDENTIFY fields read | gateway docs | 63% | properties, compress, capabilities | src/lib/gateway/core.ts |
| GUILD_CREATE (after READY + on install) | gateway docs | 98% | premium_progress_bar_enabled_user_updated_at | src/lib/gateway/guildPayload.ts |

### Gateway receive events

| Event | Intent | Status | Evidence / gap |
|---|---|---|---|
| HELLO | - | emitted | OP.HELLO in core.ts |
| READY | - | emitted | src/lib/gateway/core.ts |
| RESUMED | - | partial | src/lib/gateway/core.ts; replay buffer is per process: a RESUME that lands on another instance (or after a restart) gets op 9 |
| RECONNECT | - | emitted | OP.RECONNECT in core.ts |
| RATE_LIMITED | - | emitted | src/lib/gateway/core.ts |
| INVALID_SESSION | - | emitted | OP.INVALID_SESSION in core.ts |
| APPLICATION_COMMAND_PERMISSIONS_UPDATE | - | emitted | emitApplicationCommandPermissionsUpdate() ×2 |
| AUTO_MODERATION_RULE_CREATE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_RULE_UPDATE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_RULE_DELETE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_ACTION_EXECUTION | AUTO_MODERATION_EXECUTION | emitted | emitAutoModActionExecution() ×1 |
| CHANNEL_CREATE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| CHANNEL_UPDATE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| CHANNEL_DELETE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| CHANNEL_INFO | - | **missing** | - |
| CHANNEL_PINS_UPDATE | GUILDS, DIRECT_MESSAGES | emitted | emitChannelPinsUpdate() ×1 |
| THREAD_CREATE | GUILDS | emitted | emitThreadCreate() ×4, emitThreadMembersUpdate() ×1 |
| THREAD_UPDATE | GUILDS | emitted | emitThreadUpdate() ×5 |
| THREAD_DELETE | GUILDS | emitted | emitThreadDelete() ×3 |
| THREAD_LIST_SYNC | GUILDS | partial | emitThreadListSync() ×1; sent by the instance that made the access change, and only when it held a recent audience snapshot of the guild |
| THREAD_MEMBER_UPDATE | GUILDS | partial | emitThreadMembersUpdate() ×1; only when the bot itself joins a thread (Serika has no per-member thread flags) |
| THREAD_MEMBERS_UPDATE | GUILDS, GUILD_MEMBERS | emitted | emitThreadMembersUpdate() ×1 |
| ENTITLEMENT_CREATE | - | emitted | src/lib/botapi/application.ts |
| ENTITLEMENT_UPDATE | - | **missing** | - |
| ENTITLEMENT_DELETE | - | **missing** | - |
| GUILD_CREATE | GUILDS | emitted | src/lib/gateway/core.ts, emitGuildCreate() ×1 |
| GUILD_UPDATE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_DELETE | GUILDS | emitted | emitGuildDelete() ×2 |
| GUILD_AUDIT_LOG_ENTRY_CREATE | GUILD_MODERATION | emitted | emitAuditLogEntryCreate() ×1 |
| GUILD_BAN_ADD | GUILD_MODERATION | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_BAN_REMOVE | GUILD_MODERATION | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_EMOJIS_UPDATE | GUILD_EXPRESSIONS | emitted | emitGuildEmojisUpdate() ×4 |
| GUILD_STICKERS_UPDATE | GUILD_EXPRESSIONS | emitted | emitGuildStickersUpdate() ×4 |
| GUILD_INTEGRATIONS_UPDATE | GUILD_INTEGRATIONS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_MEMBER_ADD | GUILD_MEMBERS | emitted | emitGuildMemberAdd() ×1 |
| GUILD_MEMBER_REMOVE | GUILD_MEMBERS | emitted | emitGuildMemberRemove() ×1 |
| GUILD_MEMBER_UPDATE | GUILD_MEMBERS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_MEMBERS_CHUNK | - | emitted | src/lib/gateway/core.ts |
| GUILD_ROLE_CREATE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_ROLE_UPDATE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_ROLE_DELETE | GUILDS | emitted | src/lib/services/guildGatewayEvents.ts |
| GUILD_SCHEDULED_EVENT_CREATE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_UPDATE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_DELETE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_USER_ADD | GUILD_SCHEDULED_EVENTS | emitted | src/lib/api/scheduledEvents.ts |
| GUILD_SCHEDULED_EVENT_USER_REMOVE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/api/scheduledEvents.ts |
| GUILD_SOUNDBOARD_SOUND_CREATE | GUILD_EXPRESSIONS | emitted | src/lib/botapi/guildSoundboard.ts, emitGuildSoundboardSound() ×3 |
| GUILD_SOUNDBOARD_SOUND_UPDATE | GUILD_EXPRESSIONS | emitted | src/lib/botapi/guildSoundboard.ts, emitGuildSoundboardSound() ×3 |
| GUILD_SOUNDBOARD_SOUND_DELETE | GUILD_EXPRESSIONS | emitted | src/lib/botapi/guildSoundboard.ts, emitGuildSoundboardSound() ×3 |
| GUILD_SOUNDBOARD_SOUNDS_UPDATE | GUILD_EXPRESSIONS | emitted | src/lib/botapi/guildSoundboard.ts, emitGuildSoundboardSound() ×3 |
| SOUNDBOARD_SOUNDS | - | emitted | src/lib/gateway/core.ts |
| INTEGRATION_CREATE | GUILD_INTEGRATIONS | **missing** | - |
| INTEGRATION_UPDATE | GUILD_INTEGRATIONS | **missing** | - |
| INTEGRATION_DELETE | GUILD_INTEGRATIONS | emitted | emitIntegrationDelete() ×1 |
| INTERACTION_CREATE | - | emitted | emitInteractionCreate() ×1 |
| INVITE_CREATE | GUILD_INVITES | emitted | src/lib/services/guildGatewayEvents.ts |
| INVITE_DELETE | GUILD_INVITES | emitted | src/lib/services/guildGatewayEvents.ts |
| MESSAGE_CREATE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageCreate() ×17 |
| MESSAGE_UPDATE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageUpdate() ×9 |
| MESSAGE_DELETE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageDelete() ×3 |
| MESSAGE_DELETE_BULK | GUILD_MESSAGES | emitted | emitMessageDeleteBulk() ×3 |
| MESSAGE_REACTION_ADD | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionAdd() ×3 |
| MESSAGE_REACTION_REMOVE | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemove() ×4 |
| MESSAGE_REACTION_REMOVE_ALL | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemoveAll() ×1 |
| MESSAGE_REACTION_REMOVE_EMOJI | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemoveEmoji() ×1 |
| PRESENCE_UPDATE | GUILD_PRESENCES | emitted | emitPresenceUpdate() ×3 |
| STAGE_INSTANCE_CREATE | GUILDS | emitted | src/lib/botapi/guildStageInstances.ts, emitStageInstance() ×3 |
| STAGE_INSTANCE_UPDATE | GUILDS | emitted | src/lib/botapi/guildStageInstances.ts, emitStageInstance() ×3 |
| STAGE_INSTANCE_DELETE | GUILDS | emitted | src/lib/botapi/guildStageInstances.ts, emitStageInstance() ×3 |
| SUBSCRIPTION_CREATE | - | **missing** | - |
| SUBSCRIPTION_UPDATE | - | **missing** | - |
| SUBSCRIPTION_DELETE | - | **missing** | - |
| TYPING_START | GUILD_MESSAGE_TYPING, DIRECT_MESSAGE_TYPING | emitted | emitTypingStart() ×4 |
| USER_UPDATE | - | emitted | emitUserUpdate() ×1 |
| VOICE_CHANNEL_EFFECT_SEND | GUILD_VOICE_STATES | emitted | emitVoiceChannelEffectSend() ×2 |
| VOICE_CHANNEL_START_TIME_UPDATE | GUILDS | **missing** | - |
| VOICE_CHANNEL_STATUS_UPDATE | GUILDS | emitted | emitVoiceChannelStatusUpdate() ×2 |
| VOICE_STATE_UPDATE | GUILD_VOICE_STATES | emitted | src/lib/gateway/core.ts, emitVoiceStateUpdate() ×1 |
| VOICE_SERVER_UPDATE | - | emitted | src/lib/gateway/core.ts |
| WEBHOOKS_UPDATE | GUILD_WEBHOOKS | emitted | emitWebhooksUpdate() ×1 |
| MESSAGE_POLL_VOTE_ADD | GUILD_MESSAGE_POLLS, DIRECT_MESSAGE_POLLS | emitted | emitPollVoteChanges() ×1 |
| MESSAGE_POLL_VOTE_REMOVE | GUILD_MESSAGE_POLLS, DIRECT_MESSAGE_POLLS | emitted | emitPollVoteChanges() ×1 |

### Gateway opcodes and close codes

| Op | Name | Direction | Status |
|---:|---|---|---|
| 0 | Dispatch | Receive | yes |
| 1 | Heartbeat | Send/Receive | yes |
| 2 | Identify | Send | yes |
| 3 | Presence Update | Send | yes |
| 4 | Voice State Update | Send | yes |
| 6 | Resume | Send | yes |
| 7 | Reconnect | Receive | yes |
| 8 | Request Guild Members | Send | yes |
| 9 | Invalid Session | Receive | yes |
| 10 | Hello | Receive | yes |
| 11 | Heartbeat ACK | Receive | yes |
| 31 | Request Soundboard Sounds | Send | yes |
| 43 | Request Channel Info | Send | **no** |

Close codes used: 4000, 4001, 4002, 4003, 4004, 4005, 4007, 4008, 4009, 4010, 4011, 4012, 4013, 4014. Never sent: .

Intents missing from `Intents` in gatewayEvents.ts: none.

### REST operations

<details><summary><b>Social SDK lobbies / provisional accounts</b> (WP7): 13 implemented, 7 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | POST | `/lobbies` | src/lib/api/botApi/social.ts:272 | body 4/5 |
| ok | PUT | `/lobbies` | src/lib/api/botApi/social.ts:288 | body 5/5 |
| ok | DELETE | `/lobbies/{lobby_id}` | src/lib/api/botApi/social.ts:349 |  |
| ok | GET | `/lobbies/{lobby_id}` | src/lib/api/botApi/social.ts:321 |  |
| ok | PATCH | `/lobbies/{lobby_id}` | src/lib/api/botApi/social.ts:328 | body 4/5 |
| partial | PATCH | `/lobbies/{lobby_id}/channel-linking` | src/lib/api/botApi/social.ts:362 | body 1/1; messages sent in the linked channel are not relayed back into the lobby |
| ok | DELETE | `/lobbies/{lobby_id}/members/{user_id}` | src/lib/api/botApi/social.ts:468 |  |
| ok | PUT | `/lobbies/{lobby_id}/members/{user_id}` | src/lib/api/botApi/social.ts:444 | body 3/3 |
| ok | POST | `/lobbies/{lobby_id}/members/{user_id}/invites` | src/lib/api/botApi/social.ts:480 |  |
| ok | DELETE | `/lobbies/{lobby_id}/members/@me` | src/lib/api/botApi/social.ts:399 |  |
| ok | POST | `/lobbies/{lobby_id}/members/@me/invites` | src/lib/api/botApi/social.ts:411 |  |
| ok | POST | `/lobbies/{lobby_id}/members/bulk` | src/lib/api/botApi/social.ts:431 |  |
| ok | GET | `/lobbies/{lobby_id}/messages` | src/lib/api/botApi/social.ts:492 | query 1/1 |
| partial | POST | `/lobbies/{lobby_id}/messages` | src/lib/api/botApi/social.ts:506 | body 13/13; text only: embeds/attachments/components/poll/sticker_ids/message_reference/tts rejected with 50035; linked-channel copy is posted by the app bot, only when it can send there; no Social SDK gateway events |
| ok | PUT | `/lobbies/{lobby_id}/messages/{message_id}/moderation-metadata` | src/lib/api/botApi/social.ts:566 |  |
| partial | PUT | `/partner-sdk/dms/{user_id_1}/{user_id_2}/messages/{message_id}/moderation-metadata` | src/lib/api/botApi/social.ts:729 | stored app-scoped; no client consumes it |
| partial | POST | `/partner-sdk/provisional-accounts/unmerge` | src/lib/api/botApi/social.ts:707 | body 4/4; SerikaCord has no provisional accounts: validates the request (and client credentials) then answers 530000 |
| partial | POST | `/partner-sdk/provisional-accounts/unmerge/bot` | src/lib/api/botApi/social.ts:719 | body 1/1; SerikaCord has no provisional accounts: validates the request (and client credentials) then answers 530000 |
| partial | POST | `/partner-sdk/token` | src/lib/api/botApi/social.ts:687 | body 4/4; SerikaCord has no provisional accounts: validates the request (and client credentials) then answers 530000 |
| partial | POST | `/partner-sdk/token/bot` | src/lib/api/botApi/social.ts:699 | body 3/3; SerikaCord has no provisional accounts: validates the request (and client credentials) then answers 530000 |

</details>

<details><summary><b>OAuth2 + linked roles</b> (WP6): 12 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}/role-connections/metadata` | src/lib/api/botApi/applications.ts:253 |  |
| ok | PUT | `/applications/{application_id}/role-connections/metadata` | src/lib/api/botApi/applications.ts:260 |  |
| ok | GET | `/oauth2/@me` | src/lib/api/botApi.ts:1619 |  |
| ok | GET | `/oauth2/applications/@me` | src/lib/api/botApi.ts:1644 |  |
| ok | GET | `/oauth2/authorize` | src/lib/api/botApi.ts:1605 |  |
| ok | GET | `/oauth2/keys` | src/lib/api/botApi/applications.ts:368 |  |
| ok | POST | `/oauth2/token` | src/lib/api/botApi.ts:1609 |  |
| ok | POST | `/oauth2/token/revoke` | src/lib/api/botApi.ts:1614 |  |
| ok | GET | `/oauth2/userinfo` | src/lib/api/botApi/applications.ts:359 |  |
| ok | DELETE | `/users/@me/applications/{application_id}/role-connection` | src/lib/api/botApi/applications.ts:290 |  |
| ok | GET | `/users/@me/applications/{application_id}/role-connection` | src/lib/api/botApi/applications.ts:271 |  |
| ok | PUT | `/users/@me/applications/{application_id}/role-connection` | src/lib/api/botApi/applications.ts:277 | body 3/3 |

</details>

<details><summary><b>Gateway discovery</b> (WP1): 2 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/gateway` | src/lib/api/botApi.ts:1515 |  |
| ok | GET | `/gateway/bot` | src/lib/api/botApi.ts:1516 |  |

</details>

<details><summary><b>Interaction callbacks</b> (WP3): 0 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | POST | `/interactions/{interaction_id}/{interaction_token}/callback` | src/lib/api/botApi.ts:3382 | query 1/1; body 2/2; callback types 10 (PREMIUM_REQUIRED, deprecated) and 12 (LAUNCH_ACTIVITY) are rejected with 50035: SerikaCord has no app monetization or Activities |

</details>

<details><summary><b>Application commands</b> (WP3): 16 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}/commands` | src/lib/api/botApi.ts:3275 | query 0/1 |
| ok | POST | `/applications/{application_id}/commands` | src/lib/api/botApi/applications.ts:175 | body 11/11 |
| ok | PUT | `/applications/{application_id}/commands` | src/lib/api/botApi.ts:3282 |  |
| ok | DELETE | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi.ts:3297 |  |
| ok | GET | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi.ts:3289 |  |
| ok | PATCH | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi/applications.ts:189 | body 10/10 |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi.ts:3305 | query 0/1 |
| ok | POST | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi/applications.ts:204 | body 11/11 |
| ok | PUT | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi.ts:3314 |  |
| ok | DELETE | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi.ts:3345 |  |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi.ts:3335 |  |
| ok | PATCH | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi/applications.ts:220 | body 10/10 |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions` | src/lib/api/botApi.ts:3355 |  |
| ok | PUT | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions` | src/lib/api/botApi.ts:3366 | body 1/1 |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/permissions` | src/lib/api/botApi.ts:3326 |  |
| ok | PUT | `/applications/{application_id}/guilds/{guild_id}/commands/permissions` | src/lib/api/botApi/applications.ts:242 |  |

</details>

<details><summary><b>Monetization (entitlements, SKUs, subscriptions)</b> (WP7): 9 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}/entitlements` | src/lib/api/botApi.ts:4775 | query 8/9 |
| ok | POST | `/applications/{application_id}/entitlements` | src/lib/api/botApi.ts:4794 | body 3/3 |
| ok | DELETE | `/applications/{application_id}/entitlements/{entitlement_id}` | src/lib/api/botApi.ts:4804 |  |
| ok | GET | `/applications/{application_id}/entitlements/{entitlement_id}` | src/lib/api/botApi.ts:4787 |  |
| ok | POST | `/applications/{application_id}/entitlements/{entitlement_id}/consume` | src/lib/api/botApi.ts:4811 |  |
| ok | GET | `/applications/{application_id}/skus` | src/lib/api/botApi.ts:4769 |  |
| ok | GET | `/skus/{sku_id}/subscriptions` | src/lib/api/botApi.ts:4827 | query 4/4 |
| ok | GET | `/skus/{sku_id}/subscriptions/{subscription_id}` | src/lib/api/botApi.ts:4834 | query 0/1 |
| ok | GET | `/users/@me/applications/{application_id}/entitlements` | src/lib/api/botApi.ts:4818 | query 1/2 |

</details>

<details><summary><b>Applications (app info, app emojis, activities)</b> (WP6): 9 implemented, 2 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}` | src/lib/api/botApi.ts:1649 |  |
| partial | PATCH | `/applications/{application_id}` | src/lib/api/botApi/applications.ts:155 | body 17/17; event_webhooks_status 2 (enabled) is refused: SerikaCord does not deliver webhook events |
| ok | GET | `/applications/{application_id}/activity-instances/{instance_id}` | src/lib/api/botApi/applications.ts:347 |  |
| ok | POST | `/applications/{application_id}/attachment` | src/lib/api/botApi/applications.ts:305 | body 1/1 |
| ok | GET | `/applications/{application_id}/emojis` | src/lib/api/botApi.ts:3986 |  |
| ok | POST | `/applications/{application_id}/emojis` | src/lib/api/botApi.ts:4000 | body 2/2 |
| ok | DELETE | `/applications/{application_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:4016 |  |
| ok | GET | `/applications/{application_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:3993 |  |
| ok | PATCH | `/applications/{application_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:4008 | body 1/1 |
| ok | GET | `/applications/@me` | src/lib/api/botApi.ts:1639 |  |
| partial | PATCH | `/applications/@me` | src/lib/api/botApi/applications.ts:141 | body 17/17; event_webhooks_status 2 (enabled) is refused: SerikaCord does not deliver webhook events |

</details>

<details><summary><b>Webhooks (incl. interaction followups)</b> (WP6): 18 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/channels/{channel_id}/webhooks` | src/lib/api/botApi.ts:4036 |  |
| ok | POST | `/channels/{channel_id}/webhooks` | src/lib/api/botApi.ts:4049 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/webhooks` | src/lib/api/botApi.ts:4025 |  |
| ok | DELETE | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:4117 |  |
| ok | GET | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:4071 |  |
| ok | PATCH | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:4093 | body 3/3 |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:4185 |  |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:4162 |  |
| ok | PATCH | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:4175 | body 2/2 |
| ok | POST | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:4141 | query 3/3; body 12/12 |
| ok | POST | `/webhooks/{webhook_id}/{webhook_token}/github` | src/lib/api/botApi/messages.ts:128 | query 2/2; body 20/20 |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:4250 | query 1/1 |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:4220 | query 1/1 |
| ok | PATCH | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:4230 | query 2/2; body 7/7 |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:4214 | query 0/1 |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:4191 | query 0/1 |
| ok | PATCH | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:4197 | query 2/2; body 7/7 |
| ok | POST | `/webhooks/{webhook_id}/{webhook_token}/slack` | src/lib/api/botApi/messages.ts:120 | query 2/2; body 4/4 |

</details>

<details><summary><b>Reactions</b> (WP2): 6 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions` | src/lib/api/botApi.ts:3222 |  |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}` | src/lib/api/botApi.ts:3197 |  |
| ok | GET | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}` | src/lib/api/botApi.ts:3172 | query 3/3 |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}` | src/lib/api/botApi.ts:3163 |  |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me` | src/lib/api/botApi.ts:3156 |  |
| ok | PUT | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me` | src/lib/api/botApi.ts:3110 |  |

</details>

<details><summary><b>Threads + forums</b> (WP5): 12 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | POST | `/channels/{channel_id}/messages/{message_id}/threads` | src/lib/api/botApi.ts:4501 | body 3/3 |
| partial | GET | `/channels/{channel_id}/thread-members` | src/lib/api/botApi.ts:4514 | query 3/3; flags always 0; join_timestamp falls back to the thread creation for members who joined before join times were recorded |
| ok | DELETE | `/channels/{channel_id}/thread-members/{user_id}` | src/lib/api/botApi.ts:4550 |  |
| ok | GET | `/channels/{channel_id}/thread-members/{user_id}` | src/lib/api/botApi.ts:4535 | query 1/1 |
| ok | PUT | `/channels/{channel_id}/thread-members/{user_id}` | src/lib/api/botApi.ts:4544 |  |
| ok | DELETE | `/channels/{channel_id}/thread-members/@me` | src/lib/api/botApi.ts:4529 |  |
| ok | PUT | `/channels/{channel_id}/thread-members/@me` | src/lib/api/botApi.ts:4523 |  |
| ok | POST | `/channels/{channel_id}/threads` | src/lib/api/botApi.ts:4476 | body 7/7 |
| ok | GET | `/channels/{channel_id}/threads/archived/private` | src/lib/api/botApi.ts:4563 | query 2/2 |
| ok | GET | `/channels/{channel_id}/threads/archived/public` | src/lib/api/botApi.ts:4556 | query 2/2 |
| ok | GET | `/channels/{channel_id}/threads/search` | src/lib/api/botApi.ts:4577 | query 11/11 |
| ok | GET | `/channels/{channel_id}/users/@me/threads/archived/private` | src/lib/api/botApi.ts:4570 | query 2/2 |
| ok | GET | `/guilds/{guild_id}/threads/active` | src/lib/api/botApi.ts:4584 |  |

</details>

<details><summary><b>Messages, pins, polls, typing</b> (WP2): 12 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/channels/{channel_id}/messages` | src/lib/api/botApi.ts:2327 | query 4/4 |
| partial | POST | `/channels/{channel_id}/messages` | src/lib/api/botApi.ts:2388 | body 13/13; sticker_ids: one sticker per message (Serika limit); shared_client_theme ignored |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:2915 |  |
| ok | GET | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:2378 |  |
| ok | PATCH | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:2736 | body 7/7 |
| ok | POST | `/channels/{channel_id}/messages/{message_id}/crosspost` | src/lib/api/botApi.ts:3014 |  |
| ok | POST | `/channels/{channel_id}/messages/bulk-delete` | src/lib/api/botApi.ts:2952 | body 1/1 |
| ok | GET | `/channels/{channel_id}/messages/pins` | src/lib/api/botApi.ts:2341 | query 2/2 |
| ok | DELETE | `/channels/{channel_id}/messages/pins/{message_id}` | src/lib/api/botApi.ts:2371 |  |
| ok | PUT | `/channels/{channel_id}/messages/pins/{message_id}` | src/lib/api/botApi.ts:2364 |  |
| ok | GET | `/channels/{channel_id}/polls/{message_id}/answers/{answer_id}` | src/lib/api/botApi.ts:3042 | query 2/2 |
| ok | POST | `/channels/{channel_id}/polls/{message_id}/expire` | src/lib/api/botApi.ts:3066 |  |
| ok | POST | `/channels/{channel_id}/typing` | src/lib/api/botApi.ts:3248 |  |

</details>

<details><summary><b>Channels (settings, overwrites, invites, followers, group DM)</b> (WP4): 9 implemented, 3 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | DELETE | `/channels/{channel_id}` | src/lib/api/botApi.ts:2122 |  |
| ok | GET | `/channels/{channel_id}` | src/lib/api/botApi.ts:2085 |  |
| ok | PATCH | `/channels/{channel_id}` | src/lib/api/botApi.ts:2096 | body 20/26 |
| ok | POST | `/channels/{channel_id}/followers` | src/lib/api/botApi.ts:2272 | body 1/1 |
| ok | GET | `/channels/{channel_id}/invites` | src/lib/api/botApi.ts:2189 |  |
| ok | POST | `/channels/{channel_id}/invites` | src/lib/api/botApi.ts:2198 | body 4/9 |
| ok | DELETE | `/channels/{channel_id}/permissions/{overwrite_id}` | src/lib/api/botApi.ts:2164 |  |
| ok | PUT | `/channels/{channel_id}/permissions/{overwrite_id}` | src/lib/api/botApi.ts:2137 | body 3/3 |
| ok | DELETE | `/channels/{channel_id}/recipients/{user_id}` | src/lib/api/botApi.ts:2311 |  |
| partial | PUT | `/channels/{channel_id}/recipients/{user_id}` | src/lib/api/botApi.ts:2291 | body 2/2; nick is ignored (Serika group DMs have no per-member nicknames) |
| partial | POST | `/channels/{channel_id}/send-soundboard-sound` | src/lib/api/botApi/messages.ts:61 | body 2/2; the bot need not be connected to voice (bots cannot join SerikaCord voice); plays for everyone in the channel |
| partial | PUT | `/channels/{channel_id}/voice-status` | src/lib/api/botApi/messages.ts:33 | body 1/1; MANAGE_CHANNELS always required (bots never join voice); status not shown in the web client |

</details>

<details><summary><b>Scheduled events + stage instances</b> (WP4): 11 implemented, 4 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/scheduled-events` | src/lib/api/botApi.ts:4322 | query 1/1 |
| ok | POST | `/guilds/{guild_id}/scheduled-events` | src/lib/api/botApi.ts:4329 | body 10/10 |
| ok | DELETE | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` | src/lib/api/botApi.ts:4351 |  |
| ok | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` | src/lib/api/botApi.ts:4336 | query 1/1 |
| ok | PATCH | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` | src/lib/api/botApi.ts:4343 | body 11/11 |
| partial | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/{guild_scheduled_event_exception_id}/users` | src/lib/api/botApi/guilds.ts:137 | query 4/4; Serika scheduled events do not recur: no exceptions exist |
| partial | POST | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions` | src/lib/api/botApi/guilds.ts:117 | body 4/4; Serika scheduled events do not recur: no exceptions exist |
| partial | DELETE | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}` | src/lib/api/botApi/guilds.ts:131 | Serika scheduled events do not recur: no exceptions exist |
| partial | PATCH | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}` | src/lib/api/botApi/guilds.ts:124 | body 3/3; Serika scheduled events do not recur: no exceptions exist |
| ok | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users` | src/lib/api/botApi.ts:4357 | query 4/4 |
| ok | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users/counts` | src/lib/api/botApi/guilds.ts:108 | query 1/1 |
| ok | POST | `/stage-instances` | src/lib/api/botApi.ts:4370 | body 5/5 |
| ok | DELETE | `/stage-instances/{channel_id}` | src/lib/api/botApi.ts:4390 |  |
| ok | GET | `/stage-instances/{channel_id}` | src/lib/api/botApi.ts:4377 |  |
| ok | PATCH | `/stage-instances/{channel_id}` | src/lib/api/botApi.ts:4383 | body 2/2 |

</details>

<details><summary><b>Voice (regions, voice states, soundboard)</b> (WP7): 12 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/regions` | src/lib/api/botApi.ts:1789 |  |
| ok | GET | `/guilds/{guild_id}/soundboard-sounds` | src/lib/api/botApi.ts:4753 |  |
| ok | POST | `/guilds/{guild_id}/soundboard-sounds` | src/lib/api/botApi/guilds.ts:146 | body 5/5 |
| ok | DELETE | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` | src/lib/api/botApi/guilds.ts:160 |  |
| ok | GET | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` | src/lib/api/botApi.ts:4759 |  |
| ok | PATCH | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` | src/lib/api/botApi/guilds.ts:153 | body 4/4 |
| ok | GET | `/guilds/{guild_id}/voice-states/{user_id}` | src/lib/api/botApi.ts:4714 |  |
| ok | PATCH | `/guilds/{guild_id}/voice-states/{user_id}` | src/lib/api/botApi.ts:4730 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/voice-states/@me` | src/lib/api/botApi.ts:4708 |  |
| ok | PATCH | `/guilds/{guild_id}/voice-states/@me` | src/lib/api/botApi.ts:4721 | body 3/3 |
| ok | GET | `/soundboard-default-sounds` | src/lib/api/botApi.ts:4748 |  |
| ok | GET | `/voice/regions` | src/lib/api/botApi.ts:4698 |  |

</details>

<details><summary><b>Emojis + stickers</b> (WP4): 13 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/emojis` | src/lib/api/botApi.ts:2042 |  |
| ok | POST | `/guilds/{guild_id}/emojis` | src/lib/api/botApi.ts:3908 | body 3/3 |
| ok | DELETE | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:3922 |  |
| ok | GET | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:3902 |  |
| ok | PATCH | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:3915 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/stickers` | src/lib/api/botApi.ts:3930 |  |
| ok | POST | `/guilds/{guild_id}/stickers` | src/lib/api/botApi.ts:3942 | body 4/4 |
| ok | DELETE | `/guilds/{guild_id}/stickers/{sticker_id}` | src/lib/api/botApi.ts:3960 |  |
| ok | GET | `/guilds/{guild_id}/stickers/{sticker_id}` | src/lib/api/botApi.ts:3936 |  |
| ok | PATCH | `/guilds/{guild_id}/stickers/{sticker_id}` | src/lib/api/botApi.ts:3953 | body 3/3 |
| ok | GET | `/sticker-packs` | src/lib/api/botApi.ts:3973 |  |
| ok | GET | `/sticker-packs/{pack_id}` | src/lib/api/botApi.ts:3978 |  |
| ok | GET | `/stickers/{sticker_id}` | src/lib/api/botApi.ts:3966 |  |

</details>

<details><summary><b>Invites</b> (WP4): 10 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/invites` | src/lib/api/botApi.ts:2072 |  |
| ok | DELETE | `/invites/{code}` | src/lib/api/botApi.ts:3398 |  |
| ok | GET | `/invites/{code}` | src/lib/api/botApi.ts:3390 | query 2/4 |
| ok | GET | `/invites/{code}/target-users` | src/lib/api/botApi/social.ts:581 |  |
| ok | PUT | `/invites/{code}/target-users` | src/lib/api/botApi/social.ts:595 | body 1/1 |
| ok | DELETE | `/invites/{code}/target-users/{user_id}` | src/lib/api/botApi/social.ts:676 |  |
| ok | PUT | `/invites/{code}/target-users/{user_id}` | src/lib/api/botApi/social.ts:666 |  |
| ok | POST | `/invites/{code}/target-users/bulk-add` | src/lib/api/botApi/social.ts:639 | body 1/1 |
| ok | POST | `/invites/{code}/target-users/bulk-delete` | src/lib/api/botApi/social.ts:657 | body 1/1 |
| ok | GET | `/invites/{code}/target-users/job-status` | src/lib/api/botApi/social.ts:634 |  |

</details>

<details><summary><b>Audit log + AutoMod</b> (WP4): 6 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/audit-logs` | src/lib/api/botApi.ts:4262 | query 6/6 |
| ok | GET | `/guilds/{guild_id}/auto-moderation/rules` | src/lib/api/botApi.ts:4288 |  |
| ok | POST | `/guilds/{guild_id}/auto-moderation/rules` | src/lib/api/botApi.ts:4300 | body 8/8 |
| ok | DELETE | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` | src/lib/api/botApi.ts:4314 |  |
| ok | GET | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` | src/lib/api/botApi.ts:4294 |  |
| ok | PATCH | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` | src/lib/api/botApi.ts:4307 | body 8/8 |
| partial | PUT | `/guilds/{guild_id}/incident-actions` | src/lib/api/botApi/guilds.ts:98 | body 2/2; dms_disabled_until is stored and reported but not enforced; invites_disabled_until pauses invite joins |

</details>

<details><summary><b>Members, bans, prune, join requests</b> (WP4): 18 implemented, 0 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/bans` | src/lib/api/botApi.ts:2050 | query 3/3 |
| ok | DELETE | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:3886 |  |
| ok | GET | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:3874 |  |
| ok | PUT | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:3836 | body 2/2 |
| ok | POST | `/guilds/{guild_id}/bulk-ban` | src/lib/api/botApi.ts:3854 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/members` | src/lib/api/botApi.ts:1991 | query 2/2 |
| ok | DELETE | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:3777 |  |
| ok | GET | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:2030 |  |
| ok | PATCH | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:3670 | body 7/7 |
| ok | PUT | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:3695 | body 5/6 |
| ok | DELETE | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` | src/lib/api/botApi.ts:3689 |  |
| ok | PUT | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` | src/lib/api/botApi.ts:3684 |  |
| ok | PATCH | `/guilds/{guild_id}/members/@me` | src/lib/api/botApi.ts:3663 | body 3/4 |
| ok | GET | `/guilds/{guild_id}/members/search` | src/lib/api/botApi.ts:2006 | query 2/2 |
| ok | GET | `/guilds/{guild_id}/prune` | src/lib/api/botApi.ts:3800 | query 2/2 |
| ok | POST | `/guilds/{guild_id}/prune` | src/lib/api/botApi.ts:3811 | body 3/3 |
| ok | GET | `/guilds/{guild_id}/requests` | src/lib/api/botApi/guilds.ts:84 | query 4/4 |
| ok | PATCH | `/guilds/{guild_id}/requests/{request_id}` | src/lib/api/botApi/guilds.ts:91 | body 2/2 |

</details>

<details><summary><b>Users + DMs</b> (WP1): 7 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/users/{user_id}` | src/lib/api/botApi.ts:1588 |  |
| ok | GET | `/users/@me` | src/lib/api/botApi.ts:1525 |  |
| partial | PATCH | `/users/@me` | src/lib/api/botApi.ts:1536 | body 3/3; username follows Serika handle rules (2-32 of a-z 0-9 _ .), not Discord display names |
| ok | POST | `/users/@me/channels` | src/lib/api/botApi.ts:4603 | body 3/3 |
| ok | GET | `/users/@me/connections` | src/lib/api/botApi.ts:1581 |  |
| ok | GET | `/users/@me/guilds` | src/lib/api/botApi.ts:1549 | query 4/5 |
| ok | DELETE | `/users/@me/guilds/{guild_id}` | src/lib/api/botApi.ts:4683 |  |
| ok | GET | `/users/@me/guilds/{guild_id}/member` | src/lib/api/botApi.ts:1566 |  |

</details>

<details><summary><b>Guild settings (guild, roles, channels list, widget, onboarding, templates, ...)</b> (WP4): 31 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}` | src/lib/api/botApi.ts:1659 | query 1/1 |
| ok | PATCH | `/guilds/{guild_id}` | src/lib/api/botApi.ts:1668 | body 14/21 |
| ok | GET | `/guilds/{guild_id}/channels` | src/lib/api/botApi.ts:1860 |  |
| ok | PATCH | `/guilds/{guild_id}/channels` | src/lib/api/botApi.ts:1898 |  |
| ok | POST | `/guilds/{guild_id}/channels` | src/lib/api/botApi.ts:3406 | body 12/19 |
| ok | GET | `/guilds/{guild_id}/integrations` | src/lib/api/botApi.ts:4462 |  |
| ok | DELETE | `/guilds/{guild_id}/integrations/{integration_id}` | src/lib/api/botApi.ts:4468 |  |
| partial | GET | `/guilds/{guild_id}/messages/search` | src/lib/api/botApi/guilds.ts:50 | query 24/24; slop ignored; offsets past 5000 return an empty page |
| ok | GET | `/guilds/{guild_id}/new-member-welcome` | src/lib/api/botApi/guilds.ts:78 |  |
| ok | GET | `/guilds/{guild_id}/onboarding` | src/lib/api/botApi.ts:4398 |  |
| ok | PUT | `/guilds/{guild_id}/onboarding` | src/lib/api/botApi.ts:4404 | body 4/4 |
| ok | GET | `/guilds/{guild_id}/preview` | src/lib/api/botApi.ts:1762 |  |
| ok | GET | `/guilds/{guild_id}/roles` | src/lib/api/botApi.ts:1959 |  |
| ok | PATCH | `/guilds/{guild_id}/roles` | src/lib/api/botApi.ts:3574 |  |
| ok | POST | `/guilds/{guild_id}/roles` | src/lib/api/botApi.ts:3515 | body 8/8 |
| ok | DELETE | `/guilds/{guild_id}/roles/{role_id}` | src/lib/api/botApi.ts:3635 |  |
| ok | GET | `/guilds/{guild_id}/roles/{role_id}` | src/lib/api/botApi.ts:1984 |  |
| ok | PATCH | `/guilds/{guild_id}/roles/{role_id}` | src/lib/api/botApi.ts:3586 | body 8/8 |
| ok | GET | `/guilds/{guild_id}/roles/member-counts` | src/lib/api/botApi.ts:1967 |  |
| ok | GET | `/guilds/{guild_id}/templates` | src/lib/api/botApi.ts:4430 |  |
| ok | POST | `/guilds/{guild_id}/templates` | src/lib/api/botApi.ts:4436 | body 2/2 |
| ok | DELETE | `/guilds/{guild_id}/templates/{code}` | src/lib/api/botApi.ts:4456 |  |
| ok | PATCH | `/guilds/{guild_id}/templates/{code}` | src/lib/api/botApi.ts:4449 | body 2/2 |
| ok | PUT | `/guilds/{guild_id}/templates/{code}` | src/lib/api/botApi.ts:4443 |  |
| ok | GET | `/guilds/{guild_id}/vanity-url` | src/lib/api/botApi.ts:1796 |  |
| ok | GET | `/guilds/{guild_id}/welcome-screen` | src/lib/api/botApi.ts:4411 |  |
| ok | PATCH | `/guilds/{guild_id}/welcome-screen` | src/lib/api/botApi.ts:4417 | body 3/3 |
| ok | GET | `/guilds/{guild_id}/widget` | src/lib/api/botApi.ts:1803 |  |
| ok | PATCH | `/guilds/{guild_id}/widget` | src/lib/api/botApi.ts:1811 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/widget.json` | src/lib/api/botApi.ts:1856 |  |
| ok | GET | `/guilds/{guild_id}/widget.png` | src/lib/api/botApi/guilds.ts:168 | query 1/1 |
| ok | GET | `/guilds/templates/{code}` | src/lib/api/botApi.ts:4424 |  |

</details>

### SerikaCord /api/v10 routes with no Discord counterpart

- `GET /api/v10/guilds/:guildId/bridge` (src/lib/api/botApi.ts:1874)
- `PATCH /api/v10/guilds/:guildId/channels/:channelId` (src/lib/api/botApi.ts:3492)
- `DELETE /api/v10/guilds/:guildId/channels/:channelId` (src/lib/api/botApi.ts:3502)
- `GET /api/v10/users/@me/channels` (src/lib/api/botApi.ts:4592)
- `GET /api/v10/mcp` (src/lib/api/mcp.ts:893)
- `GET /api/v10/docs/mcp` (src/lib/api/mcp.ts:895)
- `POST /api/v10/mcp` (src/lib/api/mcp.ts:899)
- `POST /api/v10/docs/mcp` (src/lib/api/mcp.ts:901)

<!-- parity:generated:end -->
