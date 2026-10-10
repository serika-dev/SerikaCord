# Security

Authorization rules per surface and the guards new code must use. Report
vulnerabilities privately (see `SECURITY.md`), never in public issues or PRs.

## Principles

- The server enforces every rule. Client gating (`usePermissions`, hidden
  buttons) is UX only.
- Every handler authenticates and authorizes on its own; there is no global
  permission middleware. Check ids from params and bodies against what the
  caller may access, never trust flags from the body (`isOwner`, `authorId`,
  `serverId`).
- Fail closed: missing membership, unknown channel or unparseable bitfield
  means no access.
- Remember the model whitelist: a filter key the model doesn't know is
  silently dropped, which can turn an ownership or token check into "match any
  row". Confirm each key you filter on is a `case` in that model (see
  `data-model.md`).

## Identity and sessions

- Users authenticate with a JWT (`Authorization: Bearer` or `auth_token`
  cookie) verified by `authenticateRequest` (`src/lib/services/auth.ts`).
  Local tokens need a live Redis session; serika-accounts tokens are verified
  with the accounts service. Banned users are rejected on every request.
- Sessions: `session:<sid>` in Redis, indexed per user in
  `user:sessions:<uid>`. `revokeAllUserSessions` logs a user out everywhere
  (used on ban, after the suspension DM is sent).
- Passwords: bcrypt (`hashPassword` / `verifyPassword`). Login and register
  are rate limited (`login` blocks for 15 minutes after 5 failures).
- QR login (`/api/auth/qr/*`): approval requires an authenticated session and
  mints a fresh, independently revocable session; tokens are single use and
  expire after 120 s.

## Authorization per surface

| Surface | Rule | Where |
|---------|------|-------|
| Channel read / stream / send | `checkChannelAccess`: DM recipient, or server member who passes private-thread/ticket rules and `VIEW_CHANNEL` overwrites | channels.ts, server.ts `handleSSE` |
| Sending messages | plus timeout (`communicationDisabledUntil`), `canSendInChannel`, slowmode, rate limits, `limitMentionsToPermissions` (`MENTION_EVERYONE`, mentionable roles) | channels.ts POST messages |
| Editing | author only | channels.ts, dms.ts |
| Deleting / bulk delete / pin | author, or `MANAGE_MESSAGES` / `PIN_MESSAGES` / owner / admin (`canManageMessagesInServer`, `canPinMessagesInServer`) | channels.ts |
| Server settings, roles, emojis | `canManageServer`, `canManageRoles`, `canManageEmojis` | servers.ts |
| Kick / ban / timeout | `canKickMembers`, `canModerateMembers`, `canTimeoutMembers` | servers.ts |
| DMs | caller must be a recipient of the DM channel | dms.ts |
| Activity fan-out | recipients must be members; channels with overwrites or private threads re-check `checkChannelAccess` per recipient | activity.ts `deliverLocally` |
| Staff panel `/api/admin` | `getAdminAuth`: admin staff role or admin/developer badge, re-read from DB, `admin` rate limit | admin.ts |
| Service-to-service `/api/internal` | `x-service-key` must equal `ACCOUNTS_SERVICE_KEY` | index.ts |
| Developer portal | application owner/team only | developers.ts |

Server owners and holders of `ADMINISTRATOR` pass every server-level check.
`MANAGE_CHANNELS` or `ADMINISTRATOR` bypass channel overwrites.

Known limitation: channel overwrite resolution folds the @everyone deny into
the final deny, so a role *allow* does not re-grant what @everyone denies
(Discord applies @everyone first, then roles). The client mirror in
`src/lib/roles/channelPermissions.ts` matches the server, and a `test.todo`
in `tests/permissions.test.ts` tracks the fix. Change both sides together.

## Bot API guard (`/api/v10`)

- `authenticateBot` resolves `Authorization: Bot <token>` to an application
  and its bot user.
- An `onBeforeHandle` guard runs before every route with `:guildId` or
  `:channelId`: the bot must be a member of the guild, must pass
  `checkChannelAccess` for the channel (so DMs and private channels need real
  access), the channel must belong to the guild in the path, and a
  `:messageId` must belong to that channel. Errors are Discord-shaped
  (`50001 Missing Access`, `10003 Unknown Channel`, ...).
- Permission-gated bot actions use `getBotServerPermissions` +
  `botHasPermission` (owner and `ADMINISTRATOR` imply everything).
- New bot routes must keep ids in the path (so the guard sees them) or repeat
  the same checks explicitly. Never look a message up globally by id.
- Outgoing interactions are signed with the app's Ed25519 key
  (`X-Signature-Ed25519` over `timestamp + body`, `signInteraction` in
  `appIdentity.ts`) and time out after 3 s.

## Input handling and XSS

- Message text is sanitized server-side with `sanitizeInput` (xss +
  sanitize-html with no allowed tags, control characters stripped, NFC
  normalized), then encrypted at rest. The client decodes entities
  (`decodeHtmlEntities`) and renders messages as React text nodes. Do not
  render user content with `dangerouslySetInnerHTML`; the only exception in
  chat is twemoji output in `src/components/ui/twemoji.tsx`, which escapes its
  input first.
- Markdown links (`src/lib/chat/markdown.ts`) allow only `http(s):`,
  `mailto:` and relative URLs; anything else (`javascript:`, `data:`,
  `vbscript:`) renders as plain text. Tested in `tests/markdown.test.ts`.
- Inline `<script>` in `src/app/layout.tsx` and `BootPrefetch` contain only
  static code and `JSON.stringify`-ed constants; never interpolate user data
  into them.
- Uploads (`/api/upload`): authenticated, rate limited, size-capped (higher
  for Serika+), file type checked against the platform allowlist, SVGs passed
  through `sanitizeSvgBuffer`. Stored under random keys
  (`attachments/<userId>/<nanoid>.<ext>`), served from the CDN.
- Usernames: `sanitizeUsername`. Passwords: `validatePassword`.

## SSRF and outbound requests

Any server-side `fetch` of a user-supplied URL (link previews, embeds, avatars
from URLs, webhooks to app endpoints) must:

1. accept only `http:`/`https:`,
2. resolve the host and refuse loopback, private, link-local and unique-local
   addresses (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`,
   `169.254/16` including cloud metadata, `::1`, `fc00::/7`, `fe80::/10`)
   and internal hostnames,
3. follow redirects manually and re-check every hop,
4. use a short timeout and cap the bytes read,
5. require authentication and a rate limit when the route is user-callable.

Return only the parsed fields the client needs, never the raw upstream body.
Third-party API keys (GIF providers, IGDB, Last.fm, serika.art) stay on the
server; proxy the call instead of exposing the key (see the random auth
background proxy in `auth.ts`).

## Transport and headers

- CORS for `/api` allows `config.ALLOWED_ORIGINS` and their subdomains, with
  credentials.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.ts`
  `headers()`. They apply to pages served by Next; `/api` responses come
  straight from Bun and Elysia and don't get them.
- `serika.cc` short links redirect to the app domain (in `server.ts` and
  `src/middleware.ts`).

## Secrets and data

- Secrets come from environment variables via `src/lib/config.ts`; never log
  tokens, keys or message plaintext, and never return `password_hash`,
  `bot_token`, private keys, verification/reset tokens or other users'
  emails from an endpoint.
- Message search never indexes plaintext: `message_search_index.terms` holds
  truncated HMAC-SHA256 hashes of normalized words/prefixes, keyed by a key
  derived from the platform encryption key. Someone with only the database
  can see which messages share a word, not the word. Search routes only pass
  channel ids that passed the same view checks as opening the channel
  (`listViewableServerChannels`, DM recipients), and deleting a message
  removes its index row.
- The Discord bridge is consent-gated both ways (`discord_users.consent_status`,
  `settings.dataPrivacy.discordBridgeOutbound`); decline and `/forgetme` erase
  bridged data.

## Review checklist for a diff

- [ ] Every new route authenticates and returns 401 early.
- [ ] Every resource id in params/body is access-checked for the caller.
- [ ] Model filters use whitelisted keys only.
- [ ] Bodies validated (`t.Object`), lengths and list sizes capped.
- [ ] Writes rate limited.
- [ ] No user content reaches `dangerouslySetInnerHTML`, `href`/`src` without
      scheme checks, or inline scripts.
- [ ] Outbound fetches of user URLs follow the SSRF rules.
- [ ] Realtime fan-out only reaches users who can see the source channel.
- [ ] No secrets or other users' private fields in responses or logs.
- [ ] Schema changes additive and idempotent.
