# Voice on an SFU, stage channels and bot voice

Status: design (owner decisions 2026-11-05). Phases below land one at a time.

## Decisions

- **Server voice and stage channels move to an SFU: Cloudflare Realtime**
  (`rtc.live.cloudflare.com/v1/apps/<app>`). Browsers send their tracks to the
  SFU once and pull the others' tracks from it, instead of one P2P connection
  per participant.
- **DM and group DM calls stay peer-to-peer.** Their E2EE (SDPs signed over
  the DTLS fingerprints, `docs/architecture/e2ee.md`) only holds when DTLS ends
  at the other person; an SFU terminates it. Bots can't join DM calls anyway.
- **Bots get Discord's voice protocol** (what @discordjs/voice and discord.py
  speak): op 4 → `VOICE_STATE_UPDATE` + `VOICE_SERVER_UPDATE` with a real
  endpoint, a voice WebSocket (v4–v8 opcodes), UDP IP discovery and RTP/Opus
  with `aead_aes256_gcm_rtpsize` and `aead_xchacha20_poly1305_rtpsize`. No
  DAVE (`max_dave_protocol_version` 0), so libraries use plain transport
  encryption. First version: bots **send** audio (music bots) and **receive**
  audio (per-speaker SSRCs, op 5 speaking). No bot video.
- **Stage channels** become joinable (people and bots) with speakers,
  audience (suppressed) and request to speak.

Feasibility was checked before writing this: a server-side WebRTC peer
(`werift`, pure TS, runs on Bun) published an Opus track to Cloudflare
Realtime and a second one pulled it back, 200/200 packets in 4 s.

## Why an SFU, and why Cloudflare's

The mesh sends every participant's media to every other participant: upload
grows with the room, and the server can't enforce mute/deafen (honest
clients do). With an SFU each client uploads once; our server decides who may
pull which track, so server mute, deafen and stage suppression are enforced
by not granting (or closing) pulls. Cloudflare Realtime is managed (no media
server to run), already next to our TURN (`TURN_WORKER_URL`), and has no rooms
or SDK of its own: it's sessions and tracks, and the app keeps the room model.

## Cloudflare Realtime in one paragraph

A **session** is one PeerConnection (the client sends an offer to
`POST /sessions/new`, gets an answer). A session **publishes** tracks
(`POST /sessions/:id/tracks/new` with `location: 'local'`, `mid`, a
`trackName`) and **pulls** other sessions' tracks (`location: 'remote'`,
`sessionId`, `trackName`); pulls usually need a renegotiation
(`requiresImmediateRenegotiation` → SFU offer, client answer via
`PUT /renegotiate`). `PUT /sessions/:id/tracks/close` closes tracks by `mid`.
The app token is a bearer secret: **only our server** talks to this API.

## Architecture

```
browser ── one RTCPeerConnection ──▶ Cloudflare Realtime SFU ◀── werift peer ── voice bridge (our server)
   │                                                                                   │
   └── /api/voice/sfu/* (our server proxies every Realtime call,                       ├─ voice WS  (Discord voice gateway)
       checks room membership, mute/deaf/suppress)                                     └─ UDP :VOICE_UDP_PORT (RTP/Opus, AES-GCM/XChaCha)
                                                                                             ▲
                                                                                   bot (discord.js / discord.py)
```

### Room transport

`/api/voice/join` returns `transport: 'sfu' | 'mesh'`: `sfu` for `channel-*`
rooms (voice and stage) when `VOICE_SFU` is on and the Realtime credentials
are set; `mesh` otherwise (DM / group calls always). Signalling SSE, presence,
speaking, soundboard, ringing and moderation stay exactly as they are; only
media changes.

### Track registry

Each participant in an SFU room gets `sfu: { sessionId, tracks }` in
`VoiceParticipant` (server state, mirrored over `voice:members` like the
rest). Track names are chosen by the server: `<userId>:<kind>:<nonce>` with
kind `audio | video | screen | screenAudio`. Publishing broadcasts
`voice:tracks` to the room; clients pull what they need.

### Server endpoints (all session-checked, the caller must be in the room)

| Endpoint | Does |
|---|---|
| `POST /api/voice/sfu/:roomId/session` `{ offer }` | new Realtime session, records it on the participant, returns the answer |
| `POST /api/voice/sfu/:roomId/publish` `{ offer, tracks: [{ mid, kind }] }` | names + publishes tracks (STREAM for video/screen, SPEAK for audio, not suppressed), broadcasts `voice:tracks` |
| `POST /api/voice/sfu/:roomId/pull` `{ tracks: [{ userId, kind }] }` | pulls into the caller's session; refused for server-deafened callers (audio) and server-muted / suppressed publishers (audio); returns the renegotiation offer |
| `PUT /api/voice/sfu/:roomId/renegotiate` `{ answer }` | |
| `POST /api/voice/sfu/:roomId/close` `{ mids }` | unpublish / stop pulling |

Server mute, deafen and suppression close the affected pulls with
`tracks/close` on the pullers' sessions (the server remembers which mid each
pull got), and new pulls are refused while they last.

### Client

`src/lib/voice/sfuTransport.ts`: one RTCPeerConnection to the SFU per joined
room. `voiceService` uses it instead of `createPeer` when the join says `sfu`:
the mic (and camera / screen when on) are published; tracks announced in
`voice:state` / `voice:tracks` are pulled and land in the same
`remoteStreams` / `remoteScreenStreams` maps the UI already reads, so tiles,
the audio sink, speaking detection and volume controls don't change.

### Bot voice

- **op 4** really joins: the bot becomes a room participant (`isBot`), its
  voice state is stored and broadcast like a person's, `voice-states/@me`
  works, and the bot gets `VOICE_SERVER_UPDATE { token, guild_id, endpoint }`.
  The token is a short-lived signed grant for (bot, room).
- **Voice WebSocket** at `wss://<api host>/voice-gateway` (v4–v8):
  Identify (0) → Hello (8) / Ready (2: ssrc, ip, port, modes) → Select
  Protocol (1) → Session Description (4: mode, secret_key) → Speaking (5),
  Heartbeat (3) / ACK (6, v8 `seq_ack`), Resume (7) / Resumed (9), Client
  Connect / Disconnect (11 / 13).
- **UDP** on `VOICE_UDP_PORT` (`Bun.udpSocket`): 74-byte IP discovery, then
  RTP. Packets from the bot are decrypted and written into a werift track
  published to the bot's Realtime session. For receive, the bridge pulls every
  speaker's audio, rewrites SSRCs to one per user (announced with op 5), and
  encrypts toward the bot.
- **Hosting:** every DNS record stays proxied (the origin IP must never be
  public). The voice WebSocket is on `voice.serika.chat` (production) /
  `voice-canary.serika.chat` (canary) behind Cloudflare. Cloudflare's proxy
  doesn't carry UDP, so the media address bots get in Ready is a separate
  setting, `VOICE_UDP_HOST`, meant for something that reaches the UDP port
  (`VOICE_UDP_PORT`, published by each app: 50000 / 50001) without revealing
  the origin. That is a playit.gg UDP tunnel per app, run by the playit agent
  already on the host (Coolify service, host networking) with local address
  `127.0.0.1:<VOICE_UDP_PORT>`; `VOICE_UDP_HOST` is the tunnel's `*.ply.gg`
  name and `VOICE_UDP_PUBLIC_PORT` its public port, which is what Ready (op 2)
  announces. Packets reach us from the agent, so IP discovery answers with the
  agent's address; that is fine, since replies go back the same way. Until
  `VOICE_UDP_HOST` is set, `VOICE_SERVER_UPDATE` keeps `endpoint: null` and
  bots can't connect.

### Stage channels

`computeRoomAuth` accepts `stage` channels. Everyone joins suppressed except
members with MUTE_MEMBERS / MOVE_MEMBERS (stage moderators) who are speakers;
`request_to_speak_timestamp` via `PATCH /guilds/:id/voice-states/@me`
(bots) and a "Request to speak" button (people); moderators invite / move to
audience via `PATCH voice-states/:userId` and the stage UI. A suppressed
participant's audio is never pullable.

## Phases

1. SFU transport for server voice channels (people), behind `VOICE_SFU`.
2. Stage channels.
3. Bot voice: op 4 join, voice WS, UDP, send audio.
4. Bot receive audio, op 5 speaking for others.
5. REST / gateway parity (voice-states, regions, GUILD_CREATE voice_states in
   the standalone gateway), docs pages, parity doc.

## Config

`CF_REALTIME_APP_ID`, `CF_REALTIME_APP_TOKEN` (secret), `VOICE_SFU=1` (or
`VOICE_SFU_CHANNELS=<id>,<id>` for a test / gradual rollout: canary and
production share rooms over Redis, so set the same value on both),
`VOICE_PUBLIC_HOST` (proxied voice WebSocket name), `VOICE_UDP_PORT` (bind),
`VOICE_UDP_HOST` / `VOICE_UDP_PUBLIC_PORT` (the playit tunnel's public address).
