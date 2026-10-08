# API

The REST API is one Elysia app, `api` in `src/lib/api/index.ts`, mounted at
`/api`. `server.ts` hands every `/api/*` request to `api.handle(req)` directly
(except the gateway WebSocket and the three raw SSE streams, see
`realtime.md`). `src/app/api/[[...slug]]/route.ts` forwards to the same app
when Next runs alone.

## Route modules

| Prefix | Module | Area |
|--------|--------|------|
| `/api/auth` | `auth.ts` | login, register, refresh, OAuth (Discord, GitHub, Last.fm, accounts), QR login, random auth background |
| `/api/internal` | `index.ts` | service-to-service calls from serika-accounts (`x-service-key`) |
| `/api/users` | `index.ts` | `@me`, settings, profile, presence heartbeat/disconnect, activity, mentions, read states, `@me/activity` SSE, game library |
| `/api/friends` | `index.ts` | friends, requests, `/stream` SSE |
| `/api/bug-reports`, `/api/notifications`, `/api/igdb`, `/api/discord` | `index.ts` | bug reports, notification prefs, game search, Discord bridge self-service (forget-me) |
| `/api/servers`, `/api/invites` | `servers.ts` | servers, members, roles, bans, kicks, timeouts, emojis, stickers, channels list/create, partners, invites |
| `/api/channels` | `channels.ts` | messages, reactions, pins, typing, threads/forums, webhooks, `/:channelId/stream` |
| `/api/dms` | `dms.ts` | DM channels and messages, `/stream`, `/:recipientId/stream` |
| `/api/voice` | `voice.ts` | voice rooms, batched states, `/signal/:roomId` SSE |
| `/api/upload` | `uploads.ts` | uploads to B2 (type allowlist from platform settings) |
| `/api/gifs` | `gifs.ts` | GIF search proxy |
| `/api/oembed` | `oembed.ts` | link previews (YouTube, niconico, bilibili, fxtwitter, OpenGraph scrape) |
| `/api/admin` | `admin.ts` | staff panel (users, servers, bans, badges, bug reports, broadcast) |
| `/api/experiments`, `/api/instance` | `experiments.ts` | feature flags, instance info |
| `/api/developers`, `/api/oauth2` | `developers.ts` | developer portal (apps, bots, commands), OAuth2 for third-party apps |
| `/api/v10/*` | `botApi.ts` | Discord-v10-compatible bot REST API |
| `/api/v1/*` | `social-sdk.ts` | Social SDK: rich presence, widgets, game library |
| `/api/mcp`, `/api/docs/mcp`, `/api/v10/mcp` | `mcp.ts` | read-only MCP server over the developer docs |
| `/api/webhooks/:channelId/:token`, `/api/health`, `/api/tts-sounds`, TTS | `index.ts` | inline routes |

## Authentication

- **Users**: `authenticateRequest(authHeader, cookies)` in
  `src/lib/services/auth.ts`. Accepts `Authorization: Bearer <jwt>` or the
  `auth_token` cookie. Local tokens carry `sub` + `sid` and need a live Redis
  session `session:<sid>`; serika-accounts tokens are verified against the
  accounts service and auto-provision a local user. The user row is cached in
  Redis for 5 minutes; banned users get `{ user: null, error: 'Account
  banned' }`. Token verification results are cached in a `BoundedMap`.
- Each route module has its own small `getAuth(headers, cookie)` wrapper that
  pulls the cookie and calls `authenticateRequest`. Pattern:

  ```ts
  const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
  if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }
  ```
- **Staff**: `getAdminAuth` in `admin.ts` requires `isStaff && staffRole ===
  'admin'` or an admin/developer badge, re-reads the user from the DB, and
  applies the `admin` rate limit.
- **Bots**: `authenticateBot` in `botApi.ts` accepts `Authorization: Bot
  <token>` (or the bare token) and resolves the application and its bot user.
- **Service calls**: `/api/internal/*` compares `x-service-key` with
  `config.ACCOUNTS_SERVICE_KEY`.
- Revoking access: `revokeAllUserSessions(userId)` deletes every session and
  the user cache (used on ban).

## Authorization

There is no global permission middleware; every handler checks access itself.

- **Channel access**: `checkChannelAccess(userId, channelId)` (channels.ts)
  returns `{ hasAccess, channel, membership, error }`. DMs: the user must be in
  `recipientIds`. Server channels: membership, private-thread/ticket rules,
  then `VIEW_CHANNEL` overwrites. Use it for every channel or message route.
- **Sending**: the message POST also enforces member timeouts
  (`communicationDisabledUntil`), `canSendInChannel` (`SEND_MESSAGES`
  overwrites), slowmode, and `limitMentionsToPermissions` (strips
  @everyone/@here and non-mentionable role pings without `MENTION_EVERYONE`).
- **Server actions** (servers.ts): `canManageRoles`, `canManageServer`,
  `canModerateMembers`, `canKickMembers`, `canTimeoutMembers`,
  `canManageEmojis`. Message moderation (channels.ts):
  `canManageMessagesInServer`, `canPinMessagesInServer`. All treat the server
  owner and `ADMINISTRATOR` as allowed. Role bitfields are cached briefly.
- The canonical bits are in `src/lib/permissions/bits.ts`
  (`PERMISSION_BITS`, `hasPermission`, Discord bit numbers). Client gating
  uses `usePermissions(serverId)` backed by
  `GET /api/servers/:serverId/members/@me/permissions`; the server always
  re-checks.
- **Bot API guard**: an `onBeforeHandle` in `botApi.ts` requires guild
  membership for `:guildId` routes, `checkChannelAccess` for `:channelId`
  routes, and that `:messageId` belongs to `:channelId`. Bot permission bits
  come from `getBotServerPermissions` / `botHasPermission`.

## Validation

- `rejectInvalidObjectIdParams` (security/index.ts) runs as `onBeforeHandle`
  on the `/users`, `/friends`, `/servers` and `/dms` groups and returns 400
  `{ error: 'Invalid ID format' }` for non-UUID `serverId`, `channelId`,
  `messageId`, `userId`, ... params. `/channels` does not use it yet, and the
  bot API checks ids with `isValidObjectId` itself. Add the guard to new route
  groups.
- Use Elysia schemas (`body: t.Object({...})`, `query: t.Object({...})`) for
  request shapes. Failures go to the global `onError` as `VALIDATION`.
- Text input: `validateMessageContent`, `sanitizeInput`, `sanitizeUsername`,
  `validatePassword`. SVG uploads are sanitized (`sanitizeSvgBuffer`).

## Error shapes

- App routes: set `set.status` and return `{ error: string, ...extra }`
  (for example `retryAfter`, `communicationDisabledUntil`).
- Global `onError` in `index.ts`: `VALIDATION` → 400 `{ error: 'Validation
  error', details }`; `NOT_FOUND` → 404 with a self-describing body (Discord
  shape `{ message: '404: Not Found', code: 0 }` under `/api/v10`); anything
  else → 500 `{ error: 'Internal server error' }`.
- Bot API (`/api/v10`): Discord-shaped `{ code, message }` everywhere
  (`10003 Unknown Channel`, `10004 Unknown Guild`, `10008 Unknown Message`,
  `50001 Missing Access`, `50035 Invalid Form Body`).
- `server.ts` wraps `api.handle` and returns 500 `{ error: 'Internal server
  error' }` on throws.

## Rate limiting

`checkRateLimit(limiter, identifier)` in `src/lib/security/index.ts` uses
`rate-limiter-flexible` on Redis, falling back to in-memory if Redis errors.
Limiters (`rateLimiters_config`):

| Limiter | Budget |
|---------|--------|
| `api` | 100 / min per IP, applied to every route by `rateLimitPlugin` (skipped for `/admin`) |
| `login` | 5 / 5 min, then blocked 15 min |
| `register` | 3 / hour |
| `message` | 10 / 10 s per user per channel |
| `messageGlobal` | 50 / min per user |
| `upload` | 10 / min |
| `invite` | 5 / min |
| `serverCreate` | 10 / day |
| `friendRequest` | 20 / day |
| `admin` | 60 / min |
| `bugReport` | 5 / 10 min |

On a hit, return 429 with `{ error, retryAfter }`. Add a new limiter to
`rateLimiters_config` rather than inventing one inline. Client IP comes from
`getClientIP` (`cf-connecting-ip`, then `x-forwarded-for`, then `x-real-ip`).

## Redirects

Return a raw `Response` with a `Location` header for redirects (and append
`Set-Cookie` headers manually); `set.redirect` and the `redirect()` helper have
broken in this setup. See `oauthRedirect()` in `auth.ts`.

## Adding a route: checklist

1. Put it in the module that owns the resource; make sure UUID params are
   validated (`rejectInvalidObjectIdParams` on the group, or `isValidObjectId`).
2. Authenticate (`getAuth` / `authenticateBot` / `getAdminAuth`) and return 401 early.
3. Authorize: `checkChannelAccess` for channel/message resources, the `can*`
   helpers or role bits for server actions, ownership for user resources.
   Never trust ids or flags from the body.
4. Validate with `t.Object` and the sanitizers; cap list sizes and string lengths.
5. Rate limit writes with `checkRateLimit`.
6. Models: confirm every `find`/`findOne` filter key is whitelisted.
7. Realtime: `publishToChannel` / `publishToDm` / `fanoutToUsers`; for messages
   not created by the user routes, call `signalChannelMessage` /
   `signalDmMessage` and the gateway `emit*` helper.
8. Never return secrets (tokens, password hashes, emails of other users).
9. Wire the client call; if it is a startup fetch, add it to `BootPrefetch`
   and read it with `sharedGet`.
10. Document public bot/developer endpoints under `src/app/developers/docs`.
