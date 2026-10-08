# Realtime

How live updates reach clients: SSE streams, the events on them, the
in-process registries, the Redis buses that connect app instances, presence
and notifications.

## Request routing

`server.ts` runs `Bun.serve` on `$PORT` and decides per path:

| Path | Handler |
|------|---------|
| `/api/v10/gateway` | Bot WebSocket, `GatewayHub` from `src/lib/gateway/core.ts` |
| `/api/channels/:id/stream` | `handleSSE` → `registerRawSSEConnection` (channels.ts) after `checkChannelAccess` |
| `/api/dms/:recipientId/stream` | `handleSSE` → `getOrCreateDMChannel` → `registerRawDmSSEConnection` (dms.ts) |
| `/api/users/@me/activity` | `handleActivitySSE` → `registerActivityConnection` (activity.ts) |
| other `/api/*` | `api.handle(req)` (Elysia), including the other SSE routes below |
| everything else | proxied to Next.js on `127.0.0.1:$PORT+1` |

The raw fast path writes straight to the response stream (Next buffered
`ReadableStream` bodies and delayed events). It sends `{"type":"connected"}`
on open and `{"type":"ping"}` every 15 s.

Other SSE endpoints are plain Elysia handlers:

| Endpoint | Purpose | Client |
|----------|---------|--------|
| `GET /api/dms/stream` | DM list updates for the user (`dm:list:update`) | `ChannelSidebar`, `MobileMessagesView` |
| `GET /api/friends/stream` | Friend requests / presence for the friends page | `app/channels/me/page.tsx` |
| `GET /api/voice/signal/:roomId` | WebRTC signaling + room membership | `voiceService.ts` |
| `GET /api/users/@me/activity` (Elysia copy in `index.ts`) | Same as the raw handler; used only when running Next alone | |

Elysia copies of `/channels/:id/stream` and `/dms/:recipientId/stream` also
exist for `dev:next`. When you change a stream, keep the raw handler in
`server.ts` and the Elysia handler in step.

## Registries and `processShared`

Live connections are stored in module-level maps:

| Registry key (`processShared`) | Module | Keyed by |
|------|--------|----------|
| `channelConnections` | channels.ts | channel id |
| `dmConnections` | dms.ts | DM channel id |
| `dmListConnections` | dms.ts | user id |
| `activityConnections` | activity.ts | user id |
| `activityMemberCache` | activity.ts | server id (30 s TTL, `BoundedMap(500)`) |

`src/lib/realtime/processShared.ts` keeps these maps on `globalThis`. Bun's
import of the API modules (server.ts) and Next's bundled copy are separate
module instances; without a shared registry, streams registered in one copy
never saw events published from the other, and delivery depended on a Redis
round trip that was silently dropped when the publisher was unavailable.
`PROCESS_INSTANCE_ID` is the per-process id used to de-duplicate Redis echoes.

**Rule:** any new module-level registry of live connections or realtime state
must use `processShared(key, init)`.

The friends-stream map (`activeFriendStreamConnections` in `index.ts`) and the
voice maps in `voice.ts` predate this and are plain module maps; they work
because `server.ts` now sends all `/api` traffic to the one Bun copy.

## Publishing

Use these helpers. Each delivers locally first, then publishes to Redis for
other instances (best effort, errors swallowed):

| Helper | Module | Redis bus | Reaches |
|--------|--------|-----------|---------|
| `publishToChannel(channelId, data)` | channels.ts | `sse:channel` | open channel streams |
| `publishToDm(channelId, data)` | dms.ts | `sse:dm` | open DM streams |
| `emitDmListUpdate(userIds, payload)` | dms.ts | `sse:dmlist` | users' DM-list streams |
| `notifyChannelActivity(payload)` | activity.ts | `sse:activity` | activity streams of server members who can see the channel |
| `fanoutToUsers({ userIds } \| { serverId }, payload)` | activity.ts | `sse:user-fanout` | activity streams of given users / connected members of a server |
| `notifyReadState`, `notifyUnreadReset` | activity.ts | via `fanoutToUsers` | the user's other devices / affected members |
| voice helpers | voice.ts | `voice:sse`, `voice:members` | voice room signaling streams |
| `emitMessageCreate` and friends | services/gatewayEvents.ts | `gateway:dispatch` | connected bots (filtered by guild + intents) |

Bridges subscribe each bus with a dedicated ioredis connection
(`startChannelSSEBridge`, `startDmSSEBridge`, `startActivitySSEBridge`,
`startVoiceBridge`, `subscribeHubToRedis`) and skip messages whose `originId`
is their own instance id. A Redis outage only affects cross-instance delivery.

Do not publish ad-hoc Redis topics for client events. Topics such as
`message:update`, `typing:start` and `channel:update` once had no subscriber and
were silently lost.

## Events

Channel and DM streams carry JSON objects with a `type`:

| `type` | Sent when | Client handling (`useChatSession`) |
|--------|-----------|-----------------------------------|
| `message` | new message | append (deduped by id against optimistic sends) |
| `ephemeral` | interaction reply visible to one user | shown to that user |
| `edit` | message edited (also embed-only edits) | replace content/embeds |
| `suppress_embeds` | embeds hidden | update flag |
| `delete` | message deleted | remove |
| `reaction_add` / `reaction_remove` | reaction changed | `applyReactionToMessages` (idempotent) |
| `pin_update` | pin / unpin | update pins |
| `typing` | user typing | typing indicator (`useChatStream`) |
| `thread_create` | forum post / thread created | forum view |
| `connected`, `ping` | stream lifecycle | ignored |

The activity stream (`/api/users/@me/activity`) carries user-scoped events:
`channel_activity` (message in any visible channel: unread glow, mention
counts), `dm_activity` (DM to this user), `read_state` (read on another
device), `unread_reset` (newest message deleted). The DM-list stream carries
`dm:list:update`.

`useChatStream` reconnects with exponential backoff and calls `onReconnect`,
which refetches messages missed while disconnected. `UnreadContext` reconnects
its EventSource itself after HTTP errors (the browser gives up after a
401/502/503) and re-syncs read states on reconnect and on tab focus.

## Messages created outside the user routes

The user send routes in channels.ts and dms.ts publish, notify activity and
emit gateway events inline. Anything else that creates a message (bot API,
channel webhooks, interaction replies, system DMs) must:

1. `publishToChannel` / `publishToDm` the `message` event,
2. call `signalChannelMessage` or `signalDmMessage` from
   `src/lib/services/messageSignals.ts` (unread badge, sound, desktop
   notification, DM list bump), using `extractUserMentionIds` for mentions,
3. call `emitMessageCreate` if bots should see it.

`sendSystemDM` (`src/lib/services/systemNotify.ts`) does the DM equivalent
inline.

Channel activity respects visibility: for channels with permission overwrites
or private threads, `deliverLocally` runs `checkChannelAccess` per recipient,
so names, authors and @everyone pings from private channels never reach
members who can't see them.

## Presence

- Statuses: `online`, `idle`, `dnd`, `offline`, `invisible`
  (`resolveEffectiveStatus` in `src/lib/services/presence.ts`; invisible is
  shown as offline, system users are always online).
- A user is online while `presenceLastHeartbeatAt` is newer than 90 s. The
  client posts `/api/users/me/presence/heartbeat` every 30 s (AuthContext).
- Background tabs throttle timers, so `startPresenceKeepalive` (activity.ts)
  also refreshes the heartbeat every 30 s for every user with an open activity
  stream on this instance.
- A closing tab sends a `sendBeacon` to `/api/users/me/presence/disconnect`.
  The server waits briefly, and only clears the heartbeat if the user has no
  activity stream left (reloads and other tabs keep them online). It never
  writes status `offline`, so a chosen status survives reloads.

## Notifications and unread (client)

`UnreadContext` (`src/contexts/UnreadContext.tsx`) owns unread glow, mention
counts, server-rail aggregation and background notifications:

- Seeds from `/api/users/@me/read-states`, `/api/users/@me/mentions` and
  `/api/users/@me/channel-activity` (all via `sharedGet`), plus localStorage
  (`sc:unread:*`).
- `notifyBackgroundMessage` decides sound / desktop notification / toast
  through `evaluateNotification` (`src/lib/services/notificationUX.ts`), which
  applies the user's notification settings, DND and channel mutes. The open
  conversation is notified by its chat view instead.
- `markChannelRead` POSTs `/api/users/@me/read-states` (DB table
  `channel_read_states`); the server fans `read_state` out to the user's other
  devices.
- Counts are capped at `MAX_UNREAD_BADGE` (100, shown as "99+").

## Bot gateway

Bots connect to `wss://<host>/api/v10/gateway` (Discord v10 opcodes,
heartbeats, intents). The app publishes Discord-shaped dispatches to the Redis
channel `gateway:dispatch` with `emit*` helpers in
`src/lib/services/gatewayEvents.ts`; `GatewayHub.routeDispatch` sends each one
to bots in that guild with the required intent (or to `targetBotId`). The
gateway runs inside `server.ts`; `scripts/gateway.ts` is an optional standalone
process using the same core.

## Debugging checklist

- Run `bun run dev` (not `dev:next`): without `server.ts` there is no raw SSE
  path and no shared registry.
- Check the browser's EventSource connections for `connected` and `ping`.
- Is the event published with the helpers above, and does its `type` match a
  client handler?
- For user-scoped events, does the recipient have an activity stream open
  (`hasActivityConnection`)? Is the author excluded on purpose?
- For private channels, does `checkChannelAccess` pass for the recipient?
- Cross-instance only: is Redis reachable (bridge logs `subscribed to ...`)?
