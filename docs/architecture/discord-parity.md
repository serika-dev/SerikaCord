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

## 1. Where we are (summary)

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
- **Data model:** none expected (`channels` has thread/forum columns,
  `threadMemberIds`). Thread-member `join_timestamp`/`flags` may need
  `CREATE TABLE IF NOT EXISTS thread_members` if the array is not enough.
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
- **Stage instances and soundboard:** CRUD stubs over existing channel types
  (`stage_voice` exists in the enum), soundboard list/default sounds (Serika
  has TTS sound triggers but no soundboard, so return `[]`) and
  `send-soundboard-sound` → 50024/501.
- **Social SDK lobbies / partner-sdk:** out of scope for bot compatibility.
  Serika has its own `social-sdk.ts`; map later if there is demand.

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
| REST, every operation | 248 | 58 | 39 | 151 | 31.3% | 39.1% |
| REST, bot-token usable | 243 | 58 | 39 | 146 | 31.9% | 39.9% |

Gateway: 35/82 receive events emitted (42.7%; 2 of them only from some code paths), 1 more have an emitter nobody calls; 12/13 opcodes; 14/14 close codes used; 16/21 intents defined. Protocol features: 57/63.

### REST coverage by area

| Area | WP | Total | Impl. | Partial | Missing | Coverage |
|---|---|---:|---:|---:|---:|---:|
| Social SDK lobbies / provisional accounts | WP7 | 20 | 0 | 0 | 20 | 0% |
| OAuth2 + linked roles | WP6 | 12 | 1 | 3 | 8 | 20.8% |
| Gateway discovery | WP1 | 2 | 1 | 1 | 0 | 75% |
| Interaction callbacks | WP3 | 1 | 0 | 1 | 0 | 50% |
| Application commands | WP3 | 16 | 11 | 4 | 1 | 81.3% |
| Monetization (entitlements, SKUs, subscriptions) | WP7 | 9 | 0 | 0 | 9 | 0% |
| Applications (app info, app emojis, activities) | WP6 | 11 | 2 | 2 | 7 | 27.3% |
| Webhooks (incl. interaction followups) | WP6 | 18 | 11 | 5 | 2 | 75% |
| Reactions | WP2 | 6 | 5 | 1 | 0 | 91.7% |
| Threads + forums | WP5 | 13 | 0 | 0 | 13 | 0% |
| Messages, pins, polls, typing | WP2 | 13 | 10 | 3 | 0 | 88.5% |
| Channels (settings, overwrites, invites, followers, group DM) | WP4 | 12 | 0 | 3 | 9 | 12.5% |
| Scheduled events + stage instances | WP4 | 15 | 0 | 0 | 15 | 0% |
| Voice (regions, voice states, soundboard) | WP7 | 12 | 0 | 1 | 11 | 4.2% |
| Emojis + stickers | WP4 | 13 | 7 | 0 | 6 | 53.8% |
| Invites | WP4 | 10 | 2 | 1 | 7 | 25% |
| Audit log + AutoMod | WP4 | 7 | 0 | 1 | 6 | 7.1% |
| Members, bans, prune, join requests | WP4 | 18 | 2 | 6 | 10 | 27.8% |
| Users + DMs | WP1 | 8 | 3 | 1 | 4 | 43.8% |
| Guild settings (guild, roles, channels list, widget, onboarding, templates, ...) | WP4 | 32 | 3 | 6 | 23 | 18.8% |

### REST coverage by work package

| WP | Scope | Total | Impl. | Partial | Missing | Coverage |
|---|---|---:|---:|---:|---:|---:|
| WP1 | Gateway core + event plumbing | 10 | 4 | 2 | 4 | 50% |
| WP2 | Messages, reactions, pins, polls, attachments, components | 19 | 15 | 4 | 0 | 89.5% |
| WP3 | Interactions + application commands | 17 | 11 | 5 | 1 | 79.4% |
| WP4 | Guild resources (guild, channels, roles, members, bans, expressions, invites, moderation, events) | 107 | 14 | 17 | 76 | 21% |
| WP5 | Threads + forums | 13 | 0 | 0 | 13 | 0% |
| WP6 | Webhooks, applications, OAuth2, CDN compat | 41 | 14 | 10 | 17 | 46.3% |
| WP7 | Voice, stage, soundboard, monetization, Social SDK lobbies | 41 | 0 | 1 | 40 | 1.2% |

### Protocol features

| WP | Feature | Status | Evidence |
|---|---|---|---|
| WP0 | Ids exposed as numeric snowflakes (discord.py/JDA/Serenity/DSharpPlus parse ids as 64-bit ints) | yes | src/lib/botapi/boundary.ts |
| WP0 | Validation errors are 400 + code 50035 with an `errors` tree | yes | src/lib/api/botApi.ts, src/lib/botapi/errors.ts, src/lib/botapi/formErrors.ts |
| WP0 | X-RateLimit-Limit/Remaining/Reset/Reset-After/Bucket headers on bot routes | yes | src/lib/security/botRateLimit.ts |
| WP0 | 429 body is { message, retry_after, global } (+ X-RateLimit-Scope) | yes | src/lib/security/botRateLimit.ts |
| WP6 | OAuth2 Bearer tokens accepted on /api/v10 (users/@me, guilds, connections) | **no** | - |
| WP0 | Channel permission overwrites applied to bot actions (reuse computeChannelPermissions from src/lib/permissions/channelOverwrites.ts) | yes | src/lib/api/botApi.ts |
| WP6 | Discord CDN path compatibility (/avatars/{user_id}/{hash}.png, /icons/, /emojis/{id}.png, /embed/avatars/) | **no** | - |
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
| WP1 | Payload before IDENTIFY closes with 4003 | yes | src/lib/gateway/session.ts |
| WP1 | Second IDENTIFY closes with 4005 | yes | src/lib/gateway/session.ts |
| WP1 | Unknown opcode closes with 4001 | yes | src/lib/gateway/session.ts |
| WP1 | Unsupported ?v= closes with 4012 | yes | src/lib/gateway/session.ts |
| WP1 | Op 7 RECONNECT sent before deploy/shutdown so bots resume | yes | src/lib/gateway/core.ts |
| WP2 | multipart/form-data with files[n] + payload_json | yes | src/lib/botapi/boundary.ts, src/lib/chat/botMultipart.ts |
| WP2 | allowed_mentions honoured (parse/users/roles/replied_user) | yes | src/lib/api/botApi.ts, src/lib/chat/allowedMentions.ts |
| WP2 | message_reference on create (replies + forwards), referenced_message in responses | yes | src/lib/api/botApi.ts |
| WP2 | Message components persisted on messages | yes | src/lib/db/schema.ts |
| WP2 | Components v2 (IS_COMPONENTS_V2, container/section/text display/media gallery/file) | yes | src/lib/api/botApi.ts, src/lib/botapi/components.ts, src/lib/chat/interactionEvents.ts |
| WP2 | Embed validation + limits (10 embeds, 6000 chars, field limits) | yes | src/lib/api/botApi.ts, src/lib/botapi/commands.ts, src/lib/chat/embedValidation.ts |
| WP2 | GET messages honours before/after/around | yes | src/lib/api/botApi.ts |
| WP2 | MESSAGE_UPDATE emitted on edits (any surface) | yes | src/lib/discord/bot.ts, src/lib/api/dms.ts, src/lib/api/botApi.ts, src/lib/api/announcements.ts |
| WP2 | sticker_ids on create / sticker_items in responses | yes | src/lib/chat/discordMessage.ts |
| WP3 | Ed25519-signed HTTP interactions endpoint (+ PING verification) | **no** | - |
| WP3 | Callback 5 DEFERRED_CHANNEL_MESSAGE shows "thinking…" and is completed by @original edit | yes | src/lib/services/interactions.ts |
| WP3 | Callbacks 6/7 DEFERRED_UPDATE_MESSAGE / UPDATE_MESSAGE | yes | src/lib/services/interactions.ts |
| WP3 | Callback 8 APPLICATION_COMMAND_AUTOCOMPLETE_RESULT | yes | src/lib/services/interactions.ts, src/lib/botapi/interactionState.ts |
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
| WP3 | default_member_permissions / contexts / integration_types stored and enforced | yes | src/lib/botapi/commands.ts, src/lib/services/appCommands.ts, src/lib/db/schema.ts |
| WP3 | name_localizations / description_localizations | yes | src/lib/botapi/commands.ts, src/lib/db/schema.ts |
| WP6 | Webhook execute ?wait=true returns the message | yes | src/lib/services/channelWebhooks.ts |
| WP6 | Webhook execute thread_id / thread_name (forum posts) | yes | src/lib/services/channelWebhooks.ts |
| WP6 | OAuth2 bot install (scope=bot&permissions=…) creates the managed role and sends GUILD_CREATE | yes | src/lib/api/developers.ts |
| WP6 | client_credentials grant | yes | src/lib/api/developers.ts |
| WP6 | Application flags expose GATEWAY_* intent approvals (1<<12…1<<19) and gate privileged intents | yes | src/lib/botapi/application.ts, src/lib/gateway/intents.ts |
| WP7 | Voice gateway for bots (VOICE_SERVER_UPDATE + voice WS v8 / UDP RTP Opus / DAVE) | **no** | - |
| WP8 | discord.py quick-start example in the docs is valid Python | yes | broken pattern gone |
| WP8 | Docs only promise rate-limit headers the API actually sends | yes | src/lib/security/botRateLimit.ts |

### Object shapes (top-level fields vs the OpenAPI schema)

| Object | Schema | Coverage | Missing fields | Source |
|---|---|---:|---|---|
| User (REST) | UserResponse | 79% | avatar_decoration_data, collectibles, primary_guild | src/lib/api/botApi.ts:508 formatUser() |
| User (gateway) | UserResponse | 0% | accent_color, avatar, avatar_decoration_data, banner, bot, collectibles, discriminator, flags, global_name, id, primary_guild, public_flags, system, username | src/lib/services/gatewayEvents.ts:176 toDiscordUser() |
| Message (REST) | MessageResponse | 75% | activity, actor, application, lobby_member, purchase_notification, resolved, role_subscription_data, shared_client_theme, stickers, thread | src/lib/chat/discordMessage.ts:276 serializeMessage() |
| Message (gateway) | MessageResponse | 75% | activity, actor, application, lobby_member, purchase_notification, resolved, role_subscription_data, shared_client_theme, stickers, thread | src/lib/chat/discordMessage.ts:276 serializeMessage() |
| Guild channel | GuildChannelResponse | 8% | available_tags, bitrate, default_auto_archive_duration, default_forum_layout, default_reaction_emoji, default_sort_order, default_tag_setting, default_thread_rate_limit_per_user, flags, guild_id, last_message_id, last_pin_timestamp, nsfw, parent_id, permission_overwrites, permissions, position, rate_limit_per_user, rtc_region, topic, type, user_limit, video_quality_mode | src/lib/api/botApi.ts:529 formatChannel() |
| Guild | GuildResponse | 29% | afk_channel_id, afk_timeout, application_id, default_message_notifications, discovery_splash, explicit_content_filter, home_header, incidents_data, max_members, max_presences, max_stage_video_channel_users, max_video_channel_users, mfa_level, nsfw, nsfw_level, preferred_locale, premium_progress_bar_enabled, premium_progress_bar_enabled_user_updated_at, premium_subscription_count, public_updates_channel_id, region, rules_channel_id, safety_alerts_channel_id, splash, system_channel_flags, system_channel_id, vanity_url_code, widget_channel_id, widget_enabled | src/lib/api/botApi.ts:534 formatGuild() |
| Role | GuildRoleResponse | 15% | color, colors, hoist, icon, id, managed, mentionable, name, position, tags, unicode_emoji | src/lib/api/botApi.ts:566 formatRole() |
| Guild member | GuildMemberResponse | 86% | avatar_decoration_data, collectibles | src/lib/api/botApi.ts:570 formatMember() |
| Invite | GuildInviteResponse | 50% | flags, guild_id, guild_scheduled_event, is_contact, is_nickname_changeable, roles, target_application, target_channel_id, target_message_id, target_type, target_user, type | src/lib/api/botApi.ts:590 formatInvite() |
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
| APPLICATION_COMMAND_PERMISSIONS_UPDATE | - | emitted | emitApplicationCommandPermissionsUpdate() ×1 |
| AUTO_MODERATION_RULE_CREATE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_RULE_UPDATE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_RULE_DELETE | AUTO_MODERATION_CONFIGURATION | emitted | src/lib/services/automod.ts, emitAutoModRuleEvent() ×1 |
| AUTO_MODERATION_ACTION_EXECUTION | AUTO_MODERATION_EXECUTION | emitted | emitAutoModActionExecution() ×1 |
| CHANNEL_CREATE | GUILDS | **missing** | - |
| CHANNEL_UPDATE | GUILDS | **missing** | - |
| CHANNEL_DELETE | GUILDS | **missing** | - |
| CHANNEL_INFO | - | **missing** | - |
| CHANNEL_PINS_UPDATE | GUILDS, DIRECT_MESSAGES | emitted | emitChannelPinsUpdate() ×1 |
| THREAD_CREATE | GUILDS | **missing** | - |
| THREAD_UPDATE | GUILDS | **missing** | - |
| THREAD_DELETE | GUILDS | **missing** | - |
| THREAD_LIST_SYNC | GUILDS | **missing** | - |
| THREAD_MEMBER_UPDATE | GUILDS | **missing** | - |
| THREAD_MEMBERS_UPDATE | GUILDS, GUILD_MEMBERS | **missing** | - |
| ENTITLEMENT_CREATE | - | **missing** | - |
| ENTITLEMENT_UPDATE | - | **missing** | - |
| ENTITLEMENT_DELETE | - | **missing** | - |
| GUILD_CREATE | GUILDS | emitted | src/lib/gateway/core.ts, emitGuildCreate() ×1 |
| GUILD_UPDATE | GUILDS | **missing** | - |
| GUILD_DELETE | GUILDS | emitted | emitGuildDelete() ×2 |
| GUILD_AUDIT_LOG_ENTRY_CREATE | GUILD_MODERATION | emitted | emitAuditLogEntryCreate() ×1 |
| GUILD_BAN_ADD | GUILD_MODERATION | **missing** | - |
| GUILD_BAN_REMOVE | GUILD_MODERATION | **missing** | - |
| GUILD_EMOJIS_UPDATE | GUILD_EXPRESSIONS | **missing** | - |
| GUILD_STICKERS_UPDATE | GUILD_EXPRESSIONS | **missing** | - |
| GUILD_INTEGRATIONS_UPDATE | GUILD_INTEGRATIONS | **missing** | - |
| GUILD_MEMBER_ADD | GUILD_MEMBERS | partial | emitGuildMemberAdd() ×1; only for the bot itself on install; human joins do not emit |
| GUILD_MEMBER_REMOVE | GUILD_MEMBERS | **emitter unused** | emitGuildMemberRemove() has no callers |
| GUILD_MEMBER_UPDATE | GUILD_MEMBERS | **missing** | - |
| GUILD_MEMBERS_CHUNK | - | emitted | src/lib/gateway/core.ts |
| GUILD_ROLE_CREATE | GUILDS | **missing** | - |
| GUILD_ROLE_UPDATE | GUILDS | **missing** | - |
| GUILD_ROLE_DELETE | GUILDS | **missing** | - |
| GUILD_SCHEDULED_EVENT_CREATE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_UPDATE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_DELETE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/services/scheduledEvents.ts (template) |
| GUILD_SCHEDULED_EVENT_USER_ADD | GUILD_SCHEDULED_EVENTS | emitted | src/lib/api/scheduledEvents.ts |
| GUILD_SCHEDULED_EVENT_USER_REMOVE | GUILD_SCHEDULED_EVENTS | emitted | src/lib/api/scheduledEvents.ts |
| GUILD_SOUNDBOARD_SOUND_CREATE | GUILD_EXPRESSIONS | **missing** | - |
| GUILD_SOUNDBOARD_SOUND_UPDATE | GUILD_EXPRESSIONS | **missing** | - |
| GUILD_SOUNDBOARD_SOUND_DELETE | GUILD_EXPRESSIONS | **missing** | - |
| GUILD_SOUNDBOARD_SOUNDS_UPDATE | GUILD_EXPRESSIONS | **missing** | - |
| SOUNDBOARD_SOUNDS | - | emitted | src/lib/gateway/core.ts |
| INTEGRATION_CREATE | GUILD_INTEGRATIONS | **missing** | - |
| INTEGRATION_UPDATE | GUILD_INTEGRATIONS | **missing** | - |
| INTEGRATION_DELETE | GUILD_INTEGRATIONS | **missing** | - |
| INTERACTION_CREATE | - | emitted | emitInteractionCreate() ×1 |
| INVITE_CREATE | GUILD_INVITES | **missing** | - |
| INVITE_DELETE | GUILD_INVITES | **missing** | - |
| MESSAGE_CREATE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageCreate() ×15 |
| MESSAGE_UPDATE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageUpdate() ×9 |
| MESSAGE_DELETE | GUILD_MESSAGES, DIRECT_MESSAGES | emitted | emitMessageDelete() ×3 |
| MESSAGE_DELETE_BULK | GUILD_MESSAGES | emitted | emitMessageDeleteBulk() ×2 |
| MESSAGE_REACTION_ADD | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionAdd() ×3 |
| MESSAGE_REACTION_REMOVE | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemove() ×4 |
| MESSAGE_REACTION_REMOVE_ALL | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemoveAll() ×1 |
| MESSAGE_REACTION_REMOVE_EMOJI | GUILD_MESSAGE_REACTIONS, DIRECT_MESSAGE_REACTIONS | emitted | emitReactionRemoveEmoji() ×1 |
| PRESENCE_UPDATE | GUILD_PRESENCES | **missing** | - |
| STAGE_INSTANCE_CREATE | GUILDS | **missing** | - |
| STAGE_INSTANCE_UPDATE | GUILDS | **missing** | - |
| STAGE_INSTANCE_DELETE | GUILDS | **missing** | - |
| SUBSCRIPTION_CREATE | - | **missing** | - |
| SUBSCRIPTION_UPDATE | - | **missing** | - |
| SUBSCRIPTION_DELETE | - | **missing** | - |
| TYPING_START | GUILD_MESSAGE_TYPING, DIRECT_MESSAGE_TYPING | emitted | emitTypingStart() ×4 |
| USER_UPDATE | - | **missing** | - |
| VOICE_CHANNEL_EFFECT_SEND | GUILD_VOICE_STATES | **missing** | - |
| VOICE_CHANNEL_START_TIME_UPDATE | GUILDS | **missing** | - |
| VOICE_CHANNEL_STATUS_UPDATE | GUILDS | **missing** | - |
| VOICE_STATE_UPDATE | GUILD_VOICE_STATES | **missing** | - |
| VOICE_SERVER_UPDATE | - | **missing** | - |
| WEBHOOKS_UPDATE | GUILD_WEBHOOKS | **missing** | - |
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

Intents missing from `Intents` in gatewayEvents.ts: GUILD_EXPRESSIONS (1<<3), GUILD_INTEGRATIONS (1<<4), GUILD_WEBHOOKS (1<<5), GUILD_INVITES (1<<6), GUILD_VOICE_STATES (1<<7).

### REST operations

<details><summary><b>Social SDK lobbies / provisional accounts</b> (WP7): 0 implemented, 0 partial, 20 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | POST | `/lobbies` |  |  |
| **missing** | PUT | `/lobbies` |  |  |
| **missing** | DELETE | `/lobbies/{lobby_id}` |  |  |
| **missing** | GET | `/lobbies/{lobby_id}` |  |  |
| **missing** | PATCH | `/lobbies/{lobby_id}` |  |  |
| **missing** | PATCH | `/lobbies/{lobby_id}/channel-linking` |  |  |
| **missing** | DELETE | `/lobbies/{lobby_id}/members/{user_id}` |  |  |
| **missing** | PUT | `/lobbies/{lobby_id}/members/{user_id}` |  |  |
| **missing** | POST | `/lobbies/{lobby_id}/members/{user_id}/invites` |  |  |
| **missing** | DELETE | `/lobbies/{lobby_id}/members/@me` |  |  |
| **missing** | POST | `/lobbies/{lobby_id}/members/@me/invites` |  |  |
| **missing** | POST | `/lobbies/{lobby_id}/members/bulk` |  |  |
| **missing** | GET | `/lobbies/{lobby_id}/messages` |  |  |
| **missing** | POST | `/lobbies/{lobby_id}/messages` |  |  |
| **missing** | PUT | `/lobbies/{lobby_id}/messages/{message_id}/moderation-metadata` |  |  |
| **missing** | PUT | `/partner-sdk/dms/{user_id_1}/{user_id_2}/messages/{message_id}/moderation-metadata` |  |  |
| **missing** | POST | `/partner-sdk/provisional-accounts/unmerge` |  |  |
| **missing** | POST | `/partner-sdk/provisional-accounts/unmerge/bot` |  |  |
| **missing** | POST | `/partner-sdk/token` |  |  |
| **missing** | POST | `/partner-sdk/token/bot` |  |  |

</details>

<details><summary><b>OAuth2 + linked roles</b> (WP6): 1 implemented, 3 partial, 8 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | GET | `/applications/{application_id}/role-connections/metadata` |  |  |
| **missing** | PUT | `/applications/{application_id}/role-connections/metadata` |  |  |
| **missing** | GET | `/oauth2/@me` |  |  |
| ok | GET | `/oauth2/applications/@me` | src/lib/api/botApi.ts:788 |  |
| partial | GET | `/oauth2/authorize` | src/lib/api/developers.ts:1392 | only reachable without the /v10 prefix (/api/oauth2/authorize) |
| **missing** | GET | `/oauth2/keys` |  |  |
| partial | POST | `/oauth2/token` | src/lib/api/developers.ts:1337 | only reachable without the /v10 prefix (/api/oauth2/token) |
| partial | POST | `/oauth2/token/revoke` | src/lib/api/developers.ts:1437 | only reachable without the /v10 prefix (/api/oauth2/token/revoke) |
| **missing** | GET | `/oauth2/userinfo` |  |  |
| **missing** | DELETE | `/users/@me/applications/{application_id}/role-connection` |  |  |
| **missing** | GET | `/users/@me/applications/{application_id}/role-connection` |  |  |
| **missing** | PUT | `/users/@me/applications/{application_id}/role-connection` |  |  |

</details>

<details><summary><b>Gateway discovery</b> (WP1): 1 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/gateway` | src/lib/api/botApi.ts:753 |  |
| partial | GET | `/gateway/bot` | src/lib/api/botApi.ts:754 | always 1 shard; session_start_limit is static |

</details>

<details><summary><b>Interaction callbacks</b> (WP3): 0 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | POST | `/interactions/{interaction_id}/{interaction_token}/callback` | src/lib/api/botApi.ts:2027 | query 1/1; body 0/2; callback types 10 (premium) and 12 (launch activity) are rejected with 50035 |

</details>

<details><summary><b>Application commands</b> (WP3): 11 implemented, 4 partial, 1 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}/commands` | src/lib/api/botApi.ts:1904 | query 0/1 |
| partial | POST | `/applications/{application_id}/commands` | src/lib/api/botApi.ts:1918 | body 0/11; reads 0/11 body fields |
| ok | PUT | `/applications/{application_id}/commands` | src/lib/api/botApi.ts:1911 |  |
| ok | DELETE | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi.ts:1941 |  |
| ok | GET | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi.ts:1925 |  |
| partial | PATCH | `/applications/{application_id}/commands/{command_id}` | src/lib/api/botApi.ts:1933 | body 0/10; reads 0/10 body fields |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi.ts:1949 | query 0/1 |
| partial | POST | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi.ts:1963 | body 0/11; reads 0/11 body fields |
| ok | PUT | `/applications/{application_id}/guilds/{guild_id}/commands` | src/lib/api/botApi.ts:1956 |  |
| ok | DELETE | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi.ts:1996 |  |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi.ts:1980 |  |
| partial | PATCH | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}` | src/lib/api/botApi.ts:1988 | body 0/10; reads 0/10 body fields |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions` | src/lib/api/botApi.ts:2004 |  |
| ok | PUT | `/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions` | src/lib/api/botApi.ts:2013 | body 0/1 |
| ok | GET | `/applications/{application_id}/guilds/{guild_id}/commands/permissions` | src/lib/api/botApi.ts:1973 |  |
| **missing** | PUT | `/applications/{application_id}/guilds/{guild_id}/commands/permissions` |  |  |

</details>

<details><summary><b>Monetization (entitlements, SKUs, subscriptions)</b> (WP7): 0 implemented, 0 partial, 9 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | GET | `/applications/{application_id}/entitlements` |  |  |
| **missing** | POST | `/applications/{application_id}/entitlements` |  |  |
| **missing** | DELETE | `/applications/{application_id}/entitlements/{entitlement_id}` |  |  |
| **missing** | GET | `/applications/{application_id}/entitlements/{entitlement_id}` |  |  |
| **missing** | POST | `/applications/{application_id}/entitlements/{entitlement_id}/consume` |  |  |
| **missing** | GET | `/applications/{application_id}/skus` |  |  |
| **missing** | GET | `/skus/{sku_id}/subscriptions` |  |  |
| **missing** | GET | `/skus/{sku_id}/subscriptions/{subscription_id}` |  |  |
| **missing** | GET | `/users/@me/applications/{application_id}/entitlements` |  |  |

</details>

<details><summary><b>Applications (app info, app emojis, activities)</b> (WP6): 2 implemented, 2 partial, 7 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/applications/{application_id}` | src/lib/api/botApi.ts:793 |  |
| partial | PATCH | `/applications/{application_id}` | src/lib/api/botApi.ts:805 | body 0/17; reads 0/17 body fields |
| **missing** | GET | `/applications/{application_id}/activity-instances/{instance_id}` |  |  |
| **missing** | POST | `/applications/{application_id}/attachment` |  |  |
| **missing** | GET | `/applications/{application_id}/emojis` |  |  |
| **missing** | POST | `/applications/{application_id}/emojis` |  |  |
| **missing** | DELETE | `/applications/{application_id}/emojis/{emoji_id}` |  |  |
| **missing** | GET | `/applications/{application_id}/emojis/{emoji_id}` |  |  |
| **missing** | PATCH | `/applications/{application_id}/emojis/{emoji_id}` |  |  |
| ok | GET | `/applications/@me` | src/lib/api/botApi.ts:783 |  |
| partial | PATCH | `/applications/@me` | src/lib/api/botApi.ts:800 | body 0/17; reads 0/17 body fields |

</details>

<details><summary><b>Webhooks (incl. interaction followups)</b> (WP6): 11 implemented, 5 partial, 2 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/channels/{channel_id}/webhooks` | src/lib/api/botApi.ts:2524 |  |
| ok | POST | `/channels/{channel_id}/webhooks` | src/lib/api/botApi.ts:2537 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/webhooks` | src/lib/api/botApi.ts:2513 |  |
| ok | DELETE | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:2612 |  |
| ok | GET | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:2569 |  |
| partial | PATCH | `/webhooks/{webhook_id}` | src/lib/api/botApi.ts:2591 | body 0/3; avatar takes an https URL, not image data; reads 0/3 body fields |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:2665 |  |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:2646 |  |
| partial | PATCH | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:2659 | body 0/2; avatar takes an https URL, not image data |
| partial | POST | `/webhooks/{webhook_id}/{webhook_token}` | src/lib/api/botApi.ts:2635 | query 3/3; body 0/12; applied_tags only used with thread_name; poll is ignored; reads 0/12 body fields |
| **missing** | POST | `/webhooks/{webhook_id}/{webhook_token}/github` |  |  |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:2710 | query 1/1 |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:2689 | query 1/1 |
| partial | PATCH | `/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}` | src/lib/api/botApi.ts:2699 | query 2/2; body 0/7; reads 0/7 body fields |
| ok | DELETE | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:2683 | query 0/1 |
| ok | GET | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:2671 | query 0/1 |
| partial | PATCH | `/webhooks/{webhook_id}/{webhook_token}/messages/@original` | src/lib/api/botApi.ts:2677 | query 0/2; body 0/7; reads 0/7 body fields; reads 0/2 query params |
| **missing** | POST | `/webhooks/{webhook_id}/{webhook_token}/slack` |  |  |

</details>

<details><summary><b>Reactions</b> (WP2): 5 implemented, 1 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions` | src/lib/api/botApi.ts:1853 |  |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}` | src/lib/api/botApi.ts:1828 |  |
| ok | GET | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}` | src/lib/api/botApi.ts:1803 | query 3/3 |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}` | src/lib/api/botApi.ts:1794 |  |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me` | src/lib/api/botApi.ts:1787 |  |
| partial | PUT | `/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me` | src/lib/api/botApi.ts:1741 | custom emoji ids must be Serika ids until the snowflake layer resolves `name:<snowflake>` path segments |

</details>

<details><summary><b>Threads + forums</b> (WP5): 0 implemented, 0 partial, 13 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | POST | `/channels/{channel_id}/messages/{message_id}/threads` |  |  |
| **missing** | GET | `/channels/{channel_id}/thread-members` |  |  |
| **missing** | DELETE | `/channels/{channel_id}/thread-members/{user_id}` |  |  |
| **missing** | GET | `/channels/{channel_id}/thread-members/{user_id}` |  |  |
| **missing** | PUT | `/channels/{channel_id}/thread-members/{user_id}` |  |  |
| **missing** | DELETE | `/channels/{channel_id}/thread-members/@me` |  |  |
| **missing** | PUT | `/channels/{channel_id}/thread-members/@me` |  |  |
| **missing** | POST | `/channels/{channel_id}/threads` |  | web-session route exists: POST /api/channels/:channelId/threads (src/lib/api/channels.ts:2277), reuse its logic |
| **missing** | GET | `/channels/{channel_id}/threads/archived/private` |  |  |
| **missing** | GET | `/channels/{channel_id}/threads/archived/public` |  |  |
| **missing** | GET | `/channels/{channel_id}/threads/search` |  |  |
| **missing** | GET | `/channels/{channel_id}/users/@me/threads/archived/private` |  |  |
| **missing** | GET | `/guilds/{guild_id}/threads/active` |  |  |

</details>

<details><summary><b>Messages, pins, polls, typing</b> (WP2): 10 implemented, 3 partial, 0 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/channels/{channel_id}/messages` | src/lib/api/botApi.ts:992 | query 4/4 |
| partial | POST | `/channels/{channel_id}/messages` | src/lib/api/botApi.ts:1053 | body 12/13; components are not stored or rendered yet (message components work package); sticker_ids: one sticker per message (Serika limit); shared_client_theme ignored |
| ok | DELETE | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:1546 |  |
| ok | GET | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:1043 |  |
| partial | PATCH | `/channels/{channel_id}/messages/{message_id}` | src/lib/api/botApi.ts:1382 | body 7/7; components ignored (message components work package) |
| ok | POST | `/channels/{channel_id}/messages/{message_id}/crosspost` | src/lib/api/botApi.ts:1645 |  |
| ok | POST | `/channels/{channel_id}/messages/bulk-delete` | src/lib/api/botApi.ts:1583 | body 1/1 |
| ok | GET | `/channels/{channel_id}/messages/pins` | src/lib/api/botApi.ts:1006 | query 2/2 |
| ok | DELETE | `/channels/{channel_id}/messages/pins/{message_id}` | src/lib/api/botApi.ts:1036 |  |
| partial | PUT | `/channels/{channel_id}/messages/pins/{message_id}` | src/lib/api/botApi.ts:1029 | no system "pinned a message" (type 6) message is posted |
| ok | GET | `/channels/{channel_id}/polls/{message_id}/answers/{answer_id}` | src/lib/api/botApi.ts:1673 | query 2/2 |
| ok | POST | `/channels/{channel_id}/polls/{message_id}/expire` | src/lib/api/botApi.ts:1697 |  |
| ok | POST | `/channels/{channel_id}/typing` | src/lib/api/botApi.ts:1879 |  |

</details>

<details><summary><b>Channels (settings, overwrites, invites, followers, group DM)</b> (WP4): 0 implemented, 3 partial, 9 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | DELETE | `/channels/{channel_id}` | src/lib/api/botApi.ts:979 | no CHANNEL_DELETE / client refresh; threads + messages not cascaded through the shared deletion service |
| partial | GET | `/channels/{channel_id}` | src/lib/api/botApi.ts:951 | DM recipients are bare ids |
| partial | PATCH | `/channels/{channel_id}` | src/lib/api/botApi.ts:960 | body 4/26; only name/topic/nsfw/rate_limit_per_user; position, parent_id, permission_overwrites, bitrate, user_limit, flags, tags ignored; no CHANNEL_UPDATE / client refresh; reads 4/26 body fields |
| **missing** | POST | `/channels/{channel_id}/followers` |  | web-session route exists: POST /api/channels/:channelId/followers (src/lib/api/announcements.ts:266), reuse its logic |
| **missing** | GET | `/channels/{channel_id}/invites` |  |  |
| **missing** | POST | `/channels/{channel_id}/invites` |  |  |
| **missing** | DELETE | `/channels/{channel_id}/permissions/{overwrite_id}` |  |  |
| **missing** | PUT | `/channels/{channel_id}/permissions/{overwrite_id}` |  |  |
| **missing** | DELETE | `/channels/{channel_id}/recipients/{user_id}` |  |  |
| **missing** | PUT | `/channels/{channel_id}/recipients/{user_id}` |  |  |
| **missing** | POST | `/channels/{channel_id}/send-soundboard-sound` |  |  |
| **missing** | PUT | `/channels/{channel_id}/voice-status` |  |  |

</details>

<details><summary><b>Scheduled events + stage instances</b> (WP4): 0 implemented, 0 partial, 15 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | GET | `/guilds/{guild_id}/scheduled-events` |  |  |
| **missing** | POST | `/guilds/{guild_id}/scheduled-events` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/{guild_scheduled_event_exception_id}/users` |  |  |
| **missing** | POST | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users` |  |  |
| **missing** | GET | `/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users/counts` |  |  |
| **missing** | POST | `/stage-instances` |  |  |
| **missing** | DELETE | `/stage-instances/{channel_id}` |  |  |
| **missing** | GET | `/stage-instances/{channel_id}` |  |  |
| **missing** | PATCH | `/stage-instances/{channel_id}` |  |  |

</details>

<details><summary><b>Voice (regions, voice states, soundboard)</b> (WP7): 0 implemented, 1 partial, 11 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| **missing** | GET | `/guilds/{guild_id}/regions` |  |  |
| **missing** | GET | `/guilds/{guild_id}/soundboard-sounds` |  |  |
| **missing** | POST | `/guilds/{guild_id}/soundboard-sounds` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/soundboard-sounds/{sound_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/voice-states/{user_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/voice-states/{user_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/voice-states/@me` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/voice-states/@me` |  |  |
| **missing** | GET | `/soundboard-default-sounds` |  |  |
| partial | GET | `/voice/regions` | src/lib/api/botApi.ts:2817 | static list |

</details>

<details><summary><b>Emojis + stickers</b> (WP4): 7 implemented, 0 partial, 6 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/emojis` | src/lib/api/botApi.ts:907 |  |
| ok | POST | `/guilds/{guild_id}/emojis` | src/lib/api/botApi.ts:2402 | body 3/3 |
| ok | DELETE | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:2459 |  |
| ok | GET | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:2384 |  |
| ok | PATCH | `/guilds/{guild_id}/emojis/{emoji_id}` | src/lib/api/botApi.ts:2434 | body 2/2 |
| ok | GET | `/guilds/{guild_id}/stickers` | src/lib/api/botApi.ts:2473 |  |
| **missing** | POST | `/guilds/{guild_id}/stickers` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/stickers/{sticker_id}` |  |  |
| ok | GET | `/guilds/{guild_id}/stickers/{sticker_id}` | src/lib/api/botApi.ts:2491 |  |
| **missing** | PATCH | `/guilds/{guild_id}/stickers/{sticker_id}` |  |  |
| **missing** | GET | `/sticker-packs` |  |  |
| **missing** | GET | `/sticker-packs/{pack_id}` |  |  |
| **missing** | GET | `/stickers/{sticker_id}` |  |  |

</details>

<details><summary><b>Invites</b> (WP4): 2 implemented, 1 partial, 7 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/guilds/{guild_id}/invites` | src/lib/api/botApi.ts:938 |  |
| ok | DELETE | `/invites/{code}` | src/lib/api/botApi.ts:2042 |  |
| partial | GET | `/invites/{code}` | src/lib/api/botApi.ts:2034 | query 0/4; guild/channel are id-only stubs; approximate counts always 0; with_counts ignored; reads 0/4 query params |
| **missing** | GET | `/invites/{code}/target-users` |  |  |
| **missing** | PUT | `/invites/{code}/target-users` |  |  |
| **missing** | DELETE | `/invites/{code}/target-users/{user_id}` |  |  |
| **missing** | PUT | `/invites/{code}/target-users/{user_id}` |  |  |
| **missing** | POST | `/invites/{code}/target-users/bulk-add` |  |  |
| **missing** | POST | `/invites/{code}/target-users/bulk-delete` |  |  |
| **missing** | GET | `/invites/{code}/target-users/job-status` |  |  |

</details>

<details><summary><b>Audit log + AutoMod</b> (WP4): 0 implemented, 1 partial, 6 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | GET | `/guilds/{guild_id}/audit-logs` | src/lib/api/botApi.ts:2722 | query 3/6; users/webhooks/threads arrays always empty; before/after ignored |
| **missing** | GET | `/guilds/{guild_id}/auto-moderation/rules` |  |  |
| **missing** | POST | `/guilds/{guild_id}/auto-moderation/rules` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/auto-moderation/rules/{rule_id}` |  |  |
| **missing** | PUT | `/guilds/{guild_id}/incident-actions` |  |  |

</details>

<details><summary><b>Members, bans, prune, join requests</b> (WP4): 2 implemented, 6 partial, 10 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | GET | `/guilds/{guild_id}/bans` | src/lib/api/botApi.ts:924 | query 0/3; user objects are bare ids; before/after/limit ignored; reads 0/3 query params |
| partial | DELETE | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:2367 | no GUILD_BAN_REMOVE |
| ok | GET | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:2356 |  |
| partial | PUT | `/guilds/{guild_id}/bans/{user_id}` | src/lib/api/botApi.ts:2329 | body 0/2; no GUILD_BAN_ADD; delete_message_seconds handling unverified |
| **missing** | POST | `/guilds/{guild_id}/bulk-ban` |  |  |
| partial | GET | `/guilds/{guild_id}/members` | src/lib/api/botApi.ts:878 | query 2/2; Discord default limit is 1, Serika defaults to 100 |
| partial | DELETE | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:2306 | no GUILD_MEMBER_REMOVE |
| ok | GET | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:895 |  |
| partial | PATCH | `/guilds/{guild_id}/members/{user_id}` | src/lib/api/botApi.ts:2220 | body 5/7; no GUILD_MEMBER_UPDATE / client refresh |
| **missing** | PUT | `/guilds/{guild_id}/members/{user_id}` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` |  |  |
| **missing** | PUT | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/members/@me` |  | request is captured by PATCH /api/v10/guilds/:guildId/members/:userId (src/lib/api/botApi.ts:2220) and fails |
| **missing** | GET | `/guilds/{guild_id}/members/search` |  | request is captured by GET /api/v10/guilds/:guildId/members/:userId (src/lib/api/botApi.ts:895) and fails |
| **missing** | GET | `/guilds/{guild_id}/prune` |  |  |
| **missing** | POST | `/guilds/{guild_id}/prune` |  |  |
| **missing** | GET | `/guilds/{guild_id}/requests` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/requests/{request_id}` |  |  |

</details>

<details><summary><b>Users + DMs</b> (WP1): 3 implemented, 1 partial, 4 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| ok | GET | `/users/{user_id}` | src/lib/api/botApi.ts:770 |  |
| ok | GET | `/users/@me` | src/lib/api/botApi.ts:765 |  |
| **missing** | PATCH | `/users/@me` |  |  |
| partial | POST | `/users/@me/channels` | src/lib/api/botApi.ts:2762 | body 1/3; reads 1/3 body fields |
| **missing** | GET | `/users/@me/connections` |  |  |
| **missing** | GET | `/users/@me/guilds` |  | web-session route exists: GET /api/users/@me/guilds (src/lib/api/index.ts:1028), reuse its logic |
| ok | DELETE | `/users/@me/guilds/{guild_id}` | src/lib/api/botApi.ts:2806 |  |
| **missing** | GET | `/users/@me/guilds/{guild_id}/member` |  |  |

</details>

<details><summary><b>Guild settings (guild, roles, channels list, widget, onboarding, templates, ...)</b> (WP4): 3 implemented, 6 partial, 23 missing</summary>

| Status | Method | Path | Serika | Notes |
|---|---|---|---|---|
| partial | GET | `/guilds/{guild_id}` | src/lib/api/botApi.ts:813 | query 0/1; with_counts ignored; many GuildResponse fields missing (see Objects) |
| partial | PATCH | `/guilds/{guild_id}` | src/lib/api/botApi.ts:822 | body 5/21; icon/banner stored as given (no image data URI handling); no GUILD_UPDATE; reads 5/21 body fields |
| ok | GET | `/guilds/{guild_id}/channels` | src/lib/api/botApi.ts:862 |  |
| **missing** | PATCH | `/guilds/{guild_id}/channels` |  |  |
| partial | POST | `/guilds/{guild_id}/channels` | src/lib/api/botApi.ts:2060 | body 7/19; permission_overwrites ignored; no CHANNEL_CREATE / client refresh; reads 7/19 body fields |
| **missing** | GET | `/guilds/{guild_id}/integrations` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/integrations/{integration_id}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/messages/search` |  |  |
| **missing** | GET | `/guilds/{guild_id}/new-member-welcome` |  |  |
| **missing** | GET | `/guilds/{guild_id}/onboarding` |  |  |
| **missing** | PUT | `/guilds/{guild_id}/onboarding` |  |  |
| ok | GET | `/guilds/{guild_id}/preview` | src/lib/api/botApi.ts:843 |  |
| ok | GET | `/guilds/{guild_id}/roles` | src/lib/api/botApi.ts:870 |  |
| **missing** | PATCH | `/guilds/{guild_id}/roles` |  |  |
| partial | POST | `/guilds/{guild_id}/roles` | src/lib/api/botApi.ts:2146 | body 5/8; no GUILD_ROLE_CREATE / client refresh |
| partial | DELETE | `/guilds/{guild_id}/roles/{role_id}` | src/lib/api/botApi.ts:2203 | no GUILD_ROLE_DELETE / client refresh |
| **missing** | GET | `/guilds/{guild_id}/roles/{role_id}` |  |  |
| partial | PATCH | `/guilds/{guild_id}/roles/{role_id}` | src/lib/api/botApi.ts:2170 | body 5/8; no GUILD_ROLE_UPDATE / client refresh |
| **missing** | GET | `/guilds/{guild_id}/roles/member-counts` |  |  |
| **missing** | GET | `/guilds/{guild_id}/templates` |  |  |
| **missing** | POST | `/guilds/{guild_id}/templates` |  |  |
| **missing** | DELETE | `/guilds/{guild_id}/templates/{code}` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/templates/{code}` |  |  |
| **missing** | PUT | `/guilds/{guild_id}/templates/{code}` |  |  |
| **missing** | GET | `/guilds/{guild_id}/vanity-url` |  |  |
| **missing** | GET | `/guilds/{guild_id}/welcome-screen` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/welcome-screen` |  |  |
| **missing** | GET | `/guilds/{guild_id}/widget` |  |  |
| **missing** | PATCH | `/guilds/{guild_id}/widget` |  |  |
| **missing** | GET | `/guilds/{guild_id}/widget.json` |  |  |
| **missing** | GET | `/guilds/{guild_id}/widget.png` |  |  |
| **missing** | GET | `/guilds/templates/{code}` |  |  |

</details>

### SerikaCord /api/v10 routes with no Discord counterpart

- `PATCH /api/v10/guilds/:guildId/channels/:channelId` (src/lib/api/botApi.ts:2104)
- `DELETE /api/v10/guilds/:guildId/channels/:channelId` (src/lib/api/botApi.ts:2133)
- `GET /api/v10/users/@me/channels` (src/lib/api/botApi.ts:2751)
- `GET /api/v10/mcp` (src/lib/api/mcp.ts:893)
- `GET /api/v10/docs/mcp` (src/lib/api/mcp.ts:895)
- `POST /api/v10/mcp` (src/lib/api/mcp.ts:899)
- `POST /api/v10/docs/mcp` (src/lib/api/mcp.ts:901)

<!-- parity:generated:end -->
