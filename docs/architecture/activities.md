# Activities (Embedded App SDK) — design

Tracker: CORD-92. Status: design settled, phase 1 (developer portal + data
model) built. Phases 2–8 follow this note.

Activities are web apps (games, watch-together, whiteboards) that run in a
sandboxed iframe and talk to the SerikaCord client through Discord's
[Embedded App SDK](https://github.com/discord/embedded-app-sdk). The goal is
that an Activity built for Discord runs here with only its **client ID** and
its backend's **API base URL** changed, as bots already do.

Everything below was checked against `@discord/embedded-app-sdk@2.5.0`
(`output/Discord.mjs`, `Constants.mjs`, `schema/*`, `utils/url.mjs`) and
`discord/discord-api-spec` (`specs/openapi.json`).

---

## 1. Wire protocol and origin checks

### What the SDK does

- `new DiscordSDK(clientId)` reads its query params: `frame_id`, `instance_id`
  and `platform` (`desktop` | `mobile`) are **required** (it throws without
  them); `guild_id`, `channel_id`, `location_id`, `custom_id`, `referrer_id`
  and `mobile_app_version` are optional.
- Its RPC peer is `window.parent.opener ?? window.parent`. It sends with
  `targetOrigin = document.referrer || '*'`.
- Messages are tuples `[opcode, payload]`: `0 HANDSHAKE`, `1 FRAME`, `2 CLOSE`,
  `3 HELLO` (legacy; ignored by the SDK).
- On start it sends `[0, { v: 1, encoding: 'json', client_id, frame_id,
  sdk_version? }]`. `sdk_version` is only included on desktop, or on mobile
  when `mobile_app_version`'s major is at least 250.
- Commands are `[1, { cmd, args, nonce }]` (nonce = uuid v4). Replies are
  `[1, { cmd, evt: null, nonce, data }]`; failures are `[1, { cmd, evt:
  'ERROR', nonce, data: { code, message } }]`; events are `[1, { cmd:
  'DISPATCH', evt, data, nonce: null }]`. `READY` is a DISPATCH the host sends
  after the handshake; the SDK's `ready()` resolves on it. Event
  subscriptions use the `SUBSCRIBE`/`UNSUBSCRIBE` commands (not sent for
  `READY`).
- `[2, { code, message }]` from the host closes the SDK. The app closes with
  `discordSdk.close(code, message)`, which sends `[2, { code, message, nonce }]`.
- After READY the SDK overrides `console.*` to also send `CAPTURE_LOG`.
- RPC error codes (`RPCErrorCodes`): 4000 INVALID_PAYLOAD, 4002
  INVALID_COMMAND, 4003 INVALID_GUILD, 4004 INVALID_EVENT, 4005
  INVALID_CHANNEL, 4006 INVALID_PERMISSIONS, 4007 INVALID_CLIENTID, 4008
  INVALID_ORIGIN, 4009 INVALID_TOKEN, 4010 INVALID_USER. Unknown commands get
  an ERROR frame with 4002 (`Invalid command: <CMD>`).

### The origin check

`handleMessage` drops any message whose `event.origin` is not in:

```
window.location.origin, https://discord.com, https://discordapp.com,
https://ptb.discord.com, https://ptb.discordapp.com, https://canary.discord.com,
https://canary.discordapp.com, https://staging.discord.co,
http://localhost:3333, https://pax.discord.com, 'null'
```

So a SerikaCord page (`https://serika.chat`) that embeds the Activity directly
can't talk to it. We won't impersonate Discord's domains and won't ask
developers to patch the SDK.

### Decision: a same-origin relay frame, no SDK fork

The allowlist contains **the Activity's own origin**. So SerikaCord nests two
frames, both on the Activity's origin:

```
serika.chat (ActivityFrame host)
  └─ iframe  https://<client_id>.<ACTIVITIES_DOMAIN>/.serika/frame?…   (relay, ours)
       └─ iframe  https://<client_id>.<ACTIVITIES_DOMAIN>/?frame_id=…   (the app, root URL mapping)
```

- The app's `window.parent` is the relay. Its `document.referrer` is the
  relay's URL, so the SDK posts to the right origin, and the relay's messages
  arrive with `event.origin === window.location.origin`. The SDK accepts them
  because the origin really is its own. Nothing is spoofed and the stock npm
  SDK works unchanged.
- The relay is ~60 lines of our own JS served by the proxy at the reserved
  path `/.serika/frame`. It forwards `[opcode, payload]` tuples between the app
  and SerikaCord without reading them. It accepts messages from the parent
  only when they come from a SerikaCord app origin (the list is baked in at
  serve time, from `FRONTEND_URL` and the configured app origins).
- **The relay is not a security boundary.** It shares an origin with the app,
  so the app can script it. SerikaCord treats everything arriving from the
  relay as untrusted app input and checks `event.source ===
  relayIframe.contentWindow` and `event.origin === https://<client_id>.<domain>`.
  Every state-changing command is checked again on the server.
- Framing: the relay page sends `Content-Security-Policy: frame-ancestors
  <SerikaCord origins>` and the app's pages get `frame-ancestors 'self'`, so
  no third-party site can frame an Activity on our domain and pose as the
  host.
- Pop-out: the SDK prefers `window.parent.opener`. A popped-out Activity is a
  popup whose top document is the relay page, with the relay's `opener` being
  the SerikaCord window. The same relay code handles both cases.

A `@serika/embedded-app-sdk` fork isn't needed. If a future SDK version drops
`window.location.origin` from the allowlist, the fallback is a thin fork that
adds the SerikaCord origins, published under our own scope.

---

## 2. The Activity origin and proxy

### Domain

Activities need **their own registrable domain**, never a `*.serika.chat`
subdomain. That way the frame is cross-site to SerikaCord: it never gets
SerikaCord cookies (session cookies are HttpOnly and host-only anyway), it
isn't "same-site" for SameSite or for the CSRF guard in
`src/lib/security/csrf.ts`, and a bug in an Activity can't read SerikaCord
storage.

**Proposed: `serika.games`** (it fits `serika.chat` / `.dev` / `.moe` /
`.art`), configurable through `ACTIVITIES_DOMAIN`. Each app is served at
`https://<client_id>.serika.games`, the same scheme as Discord's
`<app_id>.discordsays.com`. Our client ids are already numeric
(`generateClientId()`), so they are valid DNS labels.

### What the owner must set up

1. **Buy** `serika.games` (or another name; set `ACTIVITIES_DOMAIN` to match).
2. **DNS** (at the registrar or Cloudflare, DNS-only/grey-cloud like the other
   Coolify hosts): `A serika.games → <Coolify host IP>` and
   `A *.serika.games → <Coolify host IP>` (plus `AAAA` if the host has IPv6).
3. **Wildcard TLS**: Let's Encrypt only issues wildcards over the **DNS-01**
   challenge. In Coolify → Servers → Proxy (Traefik), add a DNS-challenge
   certificate resolver (for Cloudflare: `CF_DNS_API_TOKEN` with Zone:DNS:Edit
   on `serika.games` only), e.g.
   `--certificatesresolvers.letsencrypt-dns.acme.dnschallenge.provider=cloudflare`.
4. **Route the domain to the SerikaCord app**. In the canary (and later prod)
   app's custom Traefik labels, add a router with
   `rule=HostRegexp(`^[0-9]{1,32}\.serika\.games$`)`,
   `tls.certresolver=letsencrypt-dns`, `tls.domains[0].main=serika.games`,
   `tls.domains[0].sans=*.serika.games`, pointing at the same service/port as
   the main router. (Coolify's domain field can't express wildcards, so this
   has to be a label. Restart the proxy after editing it, see the Coolify notes.)
5. **Env**: `ACTIVITIES_DOMAIN=serika.games` on canary and prod. With it unset,
   the proxy and Activities UI stay off and launching reports "Activities are
   not available on this server".
6. **Optional but recommended: submit `serika.games` to the Public Suffix
   List** (private section). Without it, two Activities (`1.serika.games` and
   `2.serika.games`) are "same-site" with each other and could set
   `Domain=serika.games` cookies from JavaScript for each other. The proxy
   never forwards cookies (below), so this can't reach an app's backend, but
   PSL listing closes it fully. Inclusion takes weeks; nothing blocks on it.

Local development uses `<client_id>.activities.localhost:<PORT>` (Chrome and
Firefox resolve `*.localhost` to loopback, and it's a different site from
`localhost`). That needs no DNS.

### Proxy design (phase 2)

A branch at the very top of `server.ts`'s `fetch`, keyed by the `Host` header
**before** any SerikaCord routing, so `/api`, `/_next`, SSE, the gateway, and
everything else of ours is unreachable on the Activities domain.

- `<client_id>.<ACTIVITIES_DOMAIN>` → look up the app by client id (cached in a
  `BoundedMap`, 60 s) → 404 unless Activities are enabled for it.
- **URL mappings**, Discord's semantics: `/.proxy/<prefix>/rest` is matched by
  the longest prefix and forwarded to `https://<target>/rest`; any other path
  goes to the root mapping (`/`). `/.serika/*` is reserved for our relay page
  and assets. Targets are host[/path] only, always `https://` upstream.
- **SSRF**: resolve the target with `dns.lookup(all)` per request (60 s cache)
  and refuse when *any* address is private, loopback, link-local, CGNAT,
  multicast, unique-local, IPv4-mapped-private, or the Coolify host's own
  addresses. Then connect to the checked IP with the original `Host`/SNI, so a
  DNS rebind between check and connect can't redirect us. Never follow
  redirects server-side (pass 3xx through with the `Location` rewritten when it
  points at a mapped host). Mapping validation already refuses IP-literal
  targets, our own domains, and `localhost`-style names (phase 1,
  `src/lib/activities/urlMappings.ts`).
- **Requests**: strip `Cookie`, `Authorization` only when it's a SerikaCord
  token (apps keep their own bearer tokens), hop-by-hop headers (`Connection`,
  `Keep-Alive`, `Proxy-*`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`
  except for WebSocket), and `X-Forwarded-*` coming from the client. Add
  `X-Forwarded-For` (client IP), `X-Forwarded-Host`, `X-Forwarded-Proto`, and
  `X-Serika-Activity-Client-Id`. Body limit 25 MB, upstream connect timeout
  10 s, response header timeout 30 s; responses stream through (no buffering).
  WebSocket upgrades are proxied for mappings, with message size caps.
- **Responses**: drop `Set-Cookie`, `Strict-Transport-Security` (we set our
  own), hop-by-hop headers and any upstream CSP `frame-ancestors`. Then set
  the frame CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'
  'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob: https://<CDN host>; media-src 'self' blob: data:; connect-src 'self'
  wss://<this host>; font-src 'self' data:; worker-src 'self' blob:;
  frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action
  'self'`. Everything external must go through `/.proxy/`, as on Discord.
  The relay page instead gets `frame-ancestors <SerikaCord origins>`.
- **Rate limits**: new `activityProxy` bucket per (client IP, client id), and
  a per-app global cap so one app can't saturate the single Coolify host.

### SerikaCord's own CSP

`next.config.ts` adds exactly `https://*.<ACTIVITIES_DOMAIN>` (plus the dev
`http://*.activities.localhost:*`) to `frame-src`. Nothing else is widened.

---

## 3. iframe sandboxing

The relay iframe that SerikaCord creates:

```
sandbox="allow-scripts allow-same-origin allow-forms allow-popups
         allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads"
allow="autoplay; fullscreen; clipboard-write; gamepad; screen-wake-lock;
       encrypted-media; picture-in-picture"
referrerpolicy="origin"
```

- `allow-same-origin` together with `allow-scripts` is safe **only** because
  the frame is cross-site. It's needed for storage, IndexedDB, and the SDK's
  own-origin check. It's never combined with a same-origin document.
- No `allow-top-navigation*`: an Activity can't navigate SerikaCord.
  `allow-popups` exists so `window.open` works for OAuth popups an app may
  still use. `openExternalLink` remains the supported path, and it always asks
  the user first.
- **Microphone/camera** aren't delegated by default. If the user agrees to a
  per-app prompt ("<App> wants to use your microphone"), we re-render the
  frame with `microphone` (and/or `camera`) added to `allow`. Discord doesn't
  expose this to Activities today, so it stays off until an app asks for it.
- The relay passes the same `allow` list to the app's nested iframe (a
  nested frame can never get more than its parent).
- **Qt desktop**: QtWebEngine honours `sandbox`/`allow`. The desktop bridge is
  only injected on app URLs (`InjectedScripts.h`), and Activity origins
  aren't app URLs, so the bridge never reaches them. Fullscreen requests need
  the existing `fullScreenRequested` handler to accept requests from
  subframes. Hardware acceleration is always on in Qt, so
  `encourageHardwareAcceleration` returns `{ enabled: true }`.
- **Capacitor**: the WebView loads the hosted app, so it's the same iframe. On
  Android, autoplay needs `mediaPlaybackRequiresUserGesture=false` (already
  set for voice). Orientation locking uses
  `@capacitor/screen-orientation` when present, and falls back to "unlocked".

---

## 4. Instance model

- **Location**: a voice room (server voice/stage channel, DM call, group DM
  call) **or** a text chat (server text channel, thread, DM, group DM).
  `kind` is `gc` (guild channel, with `guild_id`) or `pc` (DM/GDM). Location
  id: `gc:<channel_id>` / `pc:<channel_id>`, opaque to apps like Discord's.
- **One instance per (location, application)**. Launching while one is
  running joins it. Instance id: `i-<snowflake>-<kind>-<channel>` style
  opaque string (random 128-bit, base32), `launch_id` a fresh snowflake per
  launch.
- **Lives in Redis**, mirrored locally like voice rooms:
  - `act:inst:<instance_id>` hash: app id, location (kind, channel, guild),
    launch id, launcher, started at, invitation message id, voice room key
    (when voice-bound), ended flag.
  - `act:loc:<location_id>:<app_id>` → instance id (SET NX, so concurrent
    launches converge on one instance).
  - `act:users:<instance_id>` sorted set of user id → last heartbeat.
    Participants heartbeat every 20 s from the open `ActivityFrame`. A sweeper
    (in the presence keepalive loop) drops entries older than 60 s.
  - Local registry of open frames per instance via `processShared`, for
    pushing `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` without a Redis round trip.
- **Voice-bound instances**: only users currently in that voice room can join.
  Leaving the room removes them from the instance (hooked where the voice room
  removes a member).
- **Lifecycle**: when the participant set becomes empty, the instance ends.
  The location key is deleted, the invitation card is updated to "ended",
  `embedded_activities` drops it, and bots get the update. Text-chat instances
  also end after 12 h regardless, as a safety net.
- **Persisted**: the invitation message (a normal message row, see 5) and an
  `activity_launches` audit row (app, instance, launch id, location, launcher,
  started/ended at, peak participants). Its manual SQL ships with phase 4.
- **Visibility**: instance and participant lists are only served to members of
  the location (voice room members for voice-bound ones, people who can view
  the channel for text ones). Bots only get instance events for channels they
  can view (`publishChannelScoped`).

---

## 5. The Game Invitation message

What Discord's public API defines (`discord-api-spec`):

- Interaction callback type 12 `LAUNCH_ACTIVITY` (only for apps with
  Activities enabled). With `?with_response=true` the 200 body is
  `{ interaction: { …, activity_instance_id }, resource: { type: 12,
  activity_instance: { id } } }`.
- Entry point commands: `type: 4` (`PRIMARY_ENTRY_POINT`), `handler: 1`
  (`APP_HANDLER`: the app gets the interaction and may reply with type 12) or
  `2` (`DISCORD_LAUNCH_ACTIVITY`: "Discord handles the interaction by launching
  an Activity and sending a follow-up message without coordinating with the
  app"). Global only, at most one per app. Enabling Activities auto-creates one
  named `launch` with handler 2. `handler` is only accepted on type 4. Entry
  point descriptions are 1–100 characters, like chat input commands, and they
  take no options. A bulk overwrite that leaves the entry point out fails with
  **50240** ("You cannot remove this app's Entry Point command in a bulk
  update operation…"). That code is what Discord returns in practice; it isn't
  in the public error table.
- `EmbeddedActivityInstance` = `{ application_id, instance_id, launch_id,
  location: { id, kind: 'gc'|'pc', channel_id, guild_id? }, users }`.
- **The message object has no activity field.** `MessageResponse` has no
  `activity_instance`, there's no dedicated message type and no component
  type for the card. Discord's client draws the card from data outside the
  public API.

So, for bots and the Discord bridge, the launch message is **a normal
command follow-up**: `type: 20` (CHAT_INPUT_COMMAND), author = the app's bot
user, `application_id`, empty `content`, no embeds or components, and
`interaction_metadata: { id, type: 2, user, authorizing_integration_owners,
name: <command name>, command_type: 4 }` (plus the deprecated `interaction`).
SerikaCord stores the card state in a new nullable
`messages.activity_instance` jsonb column (`{ application_id, instance_id,
launch_id, ended_at }`, the same pattern as `messages.call`). The bot API
serializer leaves it out, as Discord's does. The web client renders the card
from it, live: the instance start/participant/end changes go out as a
`message_update` through `publishToChannel` / `publishToDm`, so the card
works the same in channels and DMs via `MessageGroup`/`MessageContent`.

Handler 1 + `LAUNCH_ACTIVITY` in a text chat posts the same card. Discord's
docs only promise the follow-up message for handler 2, but in a text chat
without a card nobody else could join. In a voice room neither handler posts a
message: the Activity appears in the call's Activity shelf instead.

The card shows the app icon and name, a status line ("<N> playing" while
running; "Game ended. Start a new one?" once ended) and **Play** (join the
running instance) / **Play again** (start a new one, which posts a fresh card).

---

## Phases

1. **Developer portal + data model** (this change): `application_activity_settings`
   side table, URL mapping and settings validation, `GET/PATCH
   /api/developers/applications/:id/activities`, the Activities portal page,
   the `EMBEDDED` (1 << 17) application flag, entry point commands accepted
   (auto-created `launch`, global only, one per app, 50240 on bulk removal).
2. Proxy origin (`server.ts` Host branch, SSRF guard, relay page, frame CSP).
3. `ActivityFrame` host: handshake, command dispatch, subscriptions, scopes.
4. Launching in calls and text chats, Game Invitation card, `LAUNCH_ACTIVITY`.
5. Instance endpoint, `embedded_activities`, bot events.
6. "Playing <Activity>" presence and `setActivity`.
7. Qt + Capacitor specifics.
8. Developer docs.

Monetization (SKUs, entitlements, `startPurchase`) is out of scope:
`getSkus`/`getEntitlements` return `[]` and `startPurchase` fails with 4002.
Doing it later needs a store/SKU model, a payment provider, and entitlement
grants wired to the existing monetization endpoints.
