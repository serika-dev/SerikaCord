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

## Passkey sign-in (Serika Accounts hand-off)

Passkey ceremonies only run on the accounts origin, so SerikaCord never does
WebAuthn itself. "Sign in with passkey" on `/login` is a plain link (full-page
navigation, no popup, so it also works in the Qt and Capacitor shells):

1. `GET /api/auth/accounts/start?next=<path>[&passkey=0]` (rate limit
   `handoffStart`, per IP) creates a random `state` (32 bytes), a PKCE
   verifier (32 bytes) and its S256 challenge, and a random flow id. The flow
   `{ state, verifier, next, redirectUri }` is stored in Redis as
   `accounts-handoff:<flowId>` for 10 minutes; the browser only gets the flow
   id in `serika_handoff` (HttpOnly, Secure, SameSite=Lax,
   `Path=/api/auth/accounts`, 10 minutes). It then redirects to
   `<ACCOUNTS_PUBLIC_URL>/api/auth/handoff/start?product=serikacord&return=<callback>&state&code_challenge&code_challenge_method=S256&passkey=1`.
2. Serika Accounts signs the user in on its own origin (passkey, or password +
   2FA) and redirects to the callback with a single-use, 2-minute `code` and
   the `state`.
3. `GET /api/auth/accounts/callback` (rate limit `handoffCallback`) consumes
   the flow atomically (`MULTI GET+DEL`), checks the `code`/`state` charset and
   length, compares `state` in constant time, then calls
   `POST <ACCOUNTS_URL>/internal/auth/exchange-code` with the service key and
   `{ code, productId: 'serikacord', redirect_uri, code_verifier, state }`
   (never retried: codes are single use). The response is a password-login
   body and goes through the same `finishAccountsSignIn` as
   `POST /api/auth/login` (session cookies, account switcher, serika.moe /
   Discord connection sync; suspended users get Account Standing).
4. It redirects to `/login?signed_in=1&redirect=<next>`; the login page clears
   the message cache (as a password login does) and continues to `next`.
   Errors go to `/login?error=passkey_*` (expired/used code, state mismatch or
   missing cookie, cancelled, accounts unavailable, age restriction, rate
   limited); the page only shows whitelisted codes. The flow cookie is cleared
   on every callback outcome.

Rules: `next` is sanitized on start and again on the callback
(`sanitizeNextPath`: same-origin relative path, never `/api/*`, else
`/channels/me`), so there is no open redirect. Codes, verifiers, states and
tokens are never logged. The callback URL must be registered **exactly** for
product `serikacord` in the accounts app's `HANDOFF_CLIENTS`; SerikaCord
derives it from `ACCOUNTS_HANDOFF_CALLBACK_URL`, else `FRONTEND_URL`, else
`https://serika.chat` (a loopback request origin is used outside production).
If a start request arrives on another host than the callback's, it restarts
once on the callback's origin so the cookie lands where the callback runs.

Password login passes the accounts refusal code through (`403
PASSKEY_REQUIRED`, `TWO_FACTOR_REQUIRED`, ...); the login page answers those
with the hand-off instead of a generic error. Passkeys are added and managed
on Serika Accounts (`/settings?tab=security`), linked from Settings → Devices
and the mobile My Account page.

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

- Secrets come from environment variables via `src/lib/config.ts`
  (`FIELD_ENCRYPTION_KEY` is read directly by `fieldEncryption.ts`); never log
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

## Encryption at rest

Two layers, both AES-256-GCM:

- **Message content**: `encryptForStorage` / `decryptFromStorage`
  (`src/lib/security/encryption.ts`), keyed by the platform key in
  `platform_settings.encryption_key`.
- **Sensitive fields**: `src/lib/security/fieldEncryption.ts` (async, server
  only) over the pure core `fieldCrypto.ts`. Values are self-describing:
  `enc:<keyId>:<base64url>` (randomized), `encd:<keyId>:<base64url>`
  (deterministic, for secrets looked up by equality) and `{ "enc": "enc:..." }`
  for a whole jsonb value. The key id and mode are bound into the GCM tag.

Keys: `p` is derived from the platform key (always available). If
`FIELD_ENCRYPTION_KEY` (32+ chars) is set in the environment, key `e1` derived
from it encrypts all new writes, so a database dump alone no longer decrypts
them; `p` stays available for reading older values. Once set, that variable
must never change or disappear.

**Legacy plaintext.** Rows written before encryption are plaintext, and no
column type changed. Every read path is decrypt-if-encrypted: a value without
the prefix (or one that only looks sealed but doesn't authenticate, e.g. a note
someone typed as `enc:...`) is returned unchanged. Writes always encrypt, so
old values are converted the next time they are saved.
`scripts/encrypt-legacy-fields.ts` converts the rest in one go; it is opt-in
(report-only unless `--apply`), never prints values, and must be run
deliberately against production after a backup. Deterministic lookups match
both the ciphertext and the legacy plaintext (`fieldLookupCandidates`), except
that an input which itself looks sealed never matches as plaintext (so a stored
ciphertext can't be replayed as a token).

| Column | Mode | Written by | Read (decrypted) by |
|--------|------|------------|---------------------|
| `user_connections.metadata` token keys (`CONNECTION_SECRET_KEYS`: OAuth access/refresh tokens, Last.fm `sessionKey`, ...) | per key; `oauthVerified`, `domainVerification`, `serikaMoeId` stay readable | `UserConnection.create/updateById/updateByIdForUser` (OAuth callbacks in `api/auth.ts`, `api/index.ts`) | every `UserConnection` read; metadata never leaves the server (`toOwnConnection`, public view strips it) |
| `applications.bot_token` | deterministic | `Application.create/updateById` (`ensureBotProvisioned`, reset token) | `Application.findOne({ botToken })` (bot API, gateway IDENTIFY, `/gateway/bot`), developer portal |
| `applications.client_secret`, `applications.private_key_pem` | randomized | `Application` model | OAuth token exchange, interaction signing, developer portal |
| `channel_webhooks.token` | deterministic | `ChannelWebhook.create` | `ChannelWebhook.findOne({ channelId, token })` (execute route), webhook lists for managers |
| `channel_webhooks.url` (embeds the token) | randomized | `ChannelWebhook` model | webhook lists for managers |
| `app_webhooks.secret` | randomized | `AppWebhook` model | `AppWebhook` model |
| `instances.secret_key` (`api_key` is already a SHA-256 hash) | randomized | `Instance` model | `Instance` model |
| `server_member_applications.answers` | jsonb `{ enc }` | `ServerMemberApplication.create/updateById` | every `ServerMemberApplication` read (review queue, own status) |
| `server_member_applications.rejection_reason` | randomized | same | same |
| `user_notes.note` | randomized | `setUserNote` | `listUserNotes`, `getUserNote` |
| `account_appeals.message`, `account_appeals.staff_note` | randomized | `createAppeal`, `decideAppeal` | `listAppealsForUser`, `getAppeal`, `listAppeals`, `getStanding` |
| `safety_incidents.ip`, `safety_incidents.notes` | randomized | `recordIncident`, `updateIncident` | `listIncidents` (staff panel) |
| `message_reports.details`, `.content`, `.staff_note` (randomized); `.attachments`, `.attachment_notes` (jsonb `{ enc }`) | randomized / jsonb | `fileMessageReport`, `importLegacyMessageReports`, `setReportCaseNote` (`services/messageReports.ts`) | `listReportCases`, `getReportCase` (staff report queue, `reports.review`) |
| `push_devices.token` | deterministic (unique index still works) | `registerPushDevice` (removes a legacy plaintext duplicate first) | `devicesFor`; unregister and dead-token cleanup match both forms |
| `servers.settings.integrations.discordWebhooks.*` (Discord webhook URLs) | randomized per value | Discord channel sync in `api/servers.ts` | `replicateToDiscord` in `api/channels.ts` |

Rules for new code: read and write these columns through the model or service
listed above, never with a raw `db.select()` that hands the stored value to a
client. A new secret column gets a `FieldSpec` entry in its model (or explicit
`encryptField` / `decryptField` in its service), a row in this table, and the
backfill script entry.

Intentionally plaintext:

- `users.email`: looked up by value for login and unique, and owned by the
  accounts service; a blind index would need a new column and a coordinated
  change there.
- `users.verification_token` / `reset_token`: only the legacy local auth flow
  (unused; serika-accounts handles both) writes them; short-lived.
- `users.password_hash` (bcrypt), `instances.api_key` (SHA-256): already
  one-way hashes.
- Moderation reasons (`server_bans.reason`, `admin_logs.reason`,
  `users.ban_reason`, strike/restriction reasons): shown to moderators and to
  the user, read by many SQL paths.
- `bug_reports.*`: owned by the bug report feature, not covered yet.
- Message attachments/embeds metadata (filenames, URLs): read on many paths and
  served from the public CDN anyway.
- `applications.public_key`, scheduled event text, server/channel names: public.

### Data minimization

- IPs stored for longer than a rate-limit window are truncated with
  `anonymizeIp` (`src/lib/security/ipPrivacy.ts`: IPv4 /24, IPv6 /48):
  `user_device_sessions.ip_address` and the Redis `session:<sid>` record.
  Rate-limit keys keep the full IP; they expire within minutes.
- `safety_incidents.ip` keeps the full address (needed for legal reports) but
  encrypted.
- Logs never contain message content, author names of bridged messages or
  identifiers of users who declined the Discord bridge.

DMs, group DMs and their calls can additionally be **end-to-end encrypted**
(the server never sees their plaintext); see [e2ee.md](e2ee.md). Rollout is
gated by `E2EE_ENABLED`.

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
- [ ] New secret or private columns are encrypted at rest (see "Encryption at
      rest") and every reader tolerates legacy plaintext.
