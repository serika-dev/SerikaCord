# End-to-end encryption (DMs, group DMs, calls)

Status: implemented October 2026, behind the `E2EE_ENABLED` flag (see
Rollout). Scope chosen by the owner: DMs, group DMs and their voice/video
calls are end-to-end encrypted; new DMs are encrypted by default; keys survive
new devices through a recovery passphrase; reported messages are revealed to
Trust & Safety with a cryptographic proof (message franking). Server channels
stay server-side encrypted at rest (bots, search, AutoMod, history for new
members).

Only WebCrypto primitives available in every supported browser, the Qt
WebEngine shell (Chromium 102+) and Android WebView are used: ECDH P-256,
ECDSA P-256 (SHA-256, IEEE P1363 signatures), HKDF-SHA-256, AES-256-GCM,
PBKDF2-SHA-256. No new dependencies. The same code runs server-side under Bun
for verification and in `bun test` (`tests/e2ee.test.ts`).

Code map:

| Path | What |
|------|------|
| `src/lib/e2ee/` | Isomorphic core: `keys`, `envelope`, `payload`, `attachments`, `backup`, `safetyNumber` (+ `sha256`, a synchronous SHA-256 for its hash chain), `dtls`, `franking`, `policy` (pure server rules), `conversation` (pure client binding rules: URL targets, member checks, plaintext rows, payload URLs), `passphrase` (strength), `link` (device linking: codes, commitment, SAS, sealed keys), `keysVersion` (key-set versions), `constants`, `encoding` |
| `src/lib/e2ee/client/` | Browser only: `keyStore` (IndexedDB, incl. "seen encrypted" memory, archived keys, link escrow), `session` (setup, linking, trust, encrypt/decrypt, caches; lazy-loaded), `plainCache` (decrypted-message cache: memory + encrypted IndexedDB; cached key bundles), `view` (payload → rendered message, crypto-free), `fileCrypto` + `fileWorker` (attachments in a module Web Worker), `state` (crypto-free snapshot for React), `chatGlue` (useChatSession helpers), `callGuard` (does a call room need verified signatures) |
| `src/lib/services/e2ee.ts` | Server: flag, boot DDL, key lookups, key-set versions, key-change notifications, send gate, franking reports |
| `src/lib/api/e2ee.ts` | `/api/e2ee` routes (incl. the device-linking relay) |
| `src/components/e2ee/` | Host (starts E2EE right after sign-in, dialogs, realtime key changes), setup/restore/reset dialog, device-linking dialog, conversation banner, safety numbers, settings panel |
| `src/app/e2ee/link` | Where a linking QR code points (a phone camera opens the app's approve dialog) |

## Notation

`frame(a, b, …)` = each field as a 4-byte big-endian length followed by its
bytes. Every signed byte string and every AEAD associated data is a `frame()`
whose first field is a fixed label (`serika-e2ee-…-v1`), so field boundaries
can't be shifted and no signature can be replayed in another context. Public
keys are raw uncompressed P-256 points (65 bytes) in standard base64; device
ids are 16 random bytes in base64url (22 chars); user and channel ids are
lower-cased UUIDs.

## Keys

| Key | Type | Where the private half lives | Public half |
|-----|------|------------------------------|-------------|
| Identity key (per user) | ECDSA P-256 | IndexedDB on the user's devices + passphrase backup | `e2ee_identities.identity_pub` |
| Backup key (per user) | ECDH P-256 | IndexedDB + passphrase backup | `e2ee_identities.backup_pub` + `backup_sig` |
| Device keys (per device) | ECDH P-256 (encryption) + ECDSA P-256 (signing), non-extractable | IndexedDB of that device only | `e2ee_devices` |
| Link escrow (per device) | identity + backup private JWK, AES-256-GCM under a per-device non-extractable key | IndexedDB (`linkEscrow`) of devices that sealed / restored / were linked | none (see "Linking a device") |

- **Device certificate:** `device_sig = Sign(identity, frame("serika-e2ee-device-v1", userId, deviceId, ecdhPub, signPub))`.
  The server checks it on registration (it can't add devices for a user);
  clients only encrypt to devices that verify under the identity key they
  trust for that user.
- **Backup key certificate:** `backup_sig = Sign(identity, frame("serika-e2ee-backup-key-v1", userId, backupPub))`.
  Every message key is also wrapped to each member's backup key, so an
  unsigned backup key would let the server substitute its own and read
  everything. Senders only wrap to a backup key that verifies.
- **Key lookups are bound to the user asked for:** a bundle the server returns
  for `GET /users/:id/keys` must carry that user id (case-insensitive) or it is
  refused, and a signer is only taken from the sender's own bundle. A member
  list naming someone twice is refused.
- **Trust on first use:** the first identity key seen for a contact is pinned
  in the viewer's IndexedDB. A different key later → "X's security code
  changed" banner; sending in that conversation is blocked until the viewer
  accepts the new code (or verifies the safety number). Every acknowledged
  key is remembered (`seen`) so the contact's older devices still verify old
  messages.
- **Safety number:** per user, `h = frame("serika-e2ee-safety-v1", userId, identityPub)`
  then 5200 rounds of `h = SHA-256(h ‖ identityPub)`; 30 bytes → 6 groups of 5
  digits (each 5-byte chunk mod 100000). The two halves are ordered by user id,
  so both people see the same 12 groups. "Mark as verified" is stored locally.
- **Revoking a device** sets `revoked_at`; the row is kept (never deleted) so
  signatures on messages it sent before still verify (history, franking).
  Revoked devices receive no new messages; a message signed by a device after
  its revocation (+1 min clock slack) is shown as unverifiable.
- **Conversations seen encrypted stay encrypted locally** (IndexedDB
  `conversations`, keyed by what the user opened — `dm:<recipient from the
  URL>` / `gdm:<group channel from the URL>`, never by a server-supplied
  channel id): if the server later reports such a conversation as
  unencrypted, this device still only sends envelopes (which the server then
  rejects) — no silent downgrade to plaintext. The check is async (IndexedDB)
  and re-runs when the E2EE phase changes; a send waits for it (a storage
  error counts as "encrypted"), so nothing goes out in plaintext while it is
  unknown. Calls use the same memory (see Calls).

## Message envelope (v1)

Payload (validated on both ends, `src/lib/e2ee/payload.ts`, ≤ 32 KiB):

```json
{ "v": 1, "content": "…≤4000 chars", "ts": 1760000000000,
  "attachments": [{ "id", "url", "name", "type", "size", "key", "iv", "sha256", "spoiler?", "durationSecs?", "waveform?" }],
  "replyPreview": { "id": "<uuid>", "content": "…≤200 chars" },
  "sticker": { "id", "name", "imageUrl", "serverId?", "serverName?" },
  "mid": "<uuid of the edited message, edits only>" }
```

For each message the sender's client:

1. Generates a random 256-bit message key `K` and 96-bit `iv`;
   `ct = AES-GCM(K, iv, payload, aad = frame("serika-e2ee-msg-v1", channelId, senderUserId, senderDeviceId))`.
2. Generates an ephemeral ECDH key `E`. For every recipient — each verified
   active device of every member (the sender's own devices, this one included)
   **and** each member's verified backup key (`r = "backup:<userId>"`):
   `wrapKey = HKDF-SHA-256(ECDH(E, recipientPub), salt = iv, info = frame("serika-e2ee-wrap-v1", r, E.pub))`,
   `k = AES-GCM(wrapKey, iv2, K, aad = frame("serika-e2ee-wrap-v1", r))`.
3. `cm = SHA-256(K ‖ ct)` — the franking commitment. It also makes the
   ciphertext key-committing (AES-GCM alone is not).
4. `sig = ECDSA(senderDeviceSignKey, frame("serika-e2ee-sig-v1", channelId, sd, iv, ct, cm, E.pub))`.

Stored on the message (`messages.e2ee` jsonb, `content` is `''`):

```json
{ "v": 1, "sd": "<sender device id>", "epk": "<b64 E.pub>", "iv": "<b64>", "ct": "<b64>",
  "cm": "<b64>", "sig": "<b64>",
  "keys": [{ "r": "<device id | backup:<userId>>", "iv": "<b64>", "k": "<b64 wrapped K>" }] }
```

The server validates the exact shape and sizes (`validateEnvelope`: known
fields only, iv 12 B, cm 32 B, sig 64 B, wrapped keys 48 B, 1–128 unique
recipients, ≤ 96 KiB JSON) and that `sd` is an active device of the sender.

**Who gets the keys.** The sender binds the member list to what the user
opened: in a 1:1 DM the key list must be exactly the sender + the person in
the URL (`/dm/<id>`), otherwise nothing is sent and the conversation shows a
red "keys don't match" notice; in a group DM keys only go to members the
group's UI shows (a member the server lists but the UI doesn't is never
encrypted to, and the banner says the lists differ).

Recipients find their entry by device id (or their `backup:` entry, e.g. on a
restored device; archived keys from before a reset are tried too), unwrap
`K`, check the commitment, decrypt (the AAD binds the channel, the sender user
the server attributes the message to, and the sender device), validate the
payload, and verify `sig` with the sender device's key — which must be vouched
for by an identity key they trust for the sender (a device nobody trusted
vouched for — e.g. one signed by a contact's new, not yet accepted key — fails
as "unknown device"; accepting the new code re-verifies). Decryption always
uses the open conversation's channel id (the URL's group; for a 1:1 DM the
channel whose members are exactly us + the URL's person) and refuses rows
whose `channelId` is another conversation. Payload URLs must be one of the
message's stored blobs under our CDN's `/attachments/`, and stickers must be
on our CDN; anything else isn't loaded (no IP leak to a sender-chosen host).
A reply's quote of an encrypted message uses our own decryption of that
message when we have it, otherwise the replier's snippet labelled "quoted by
the sender". Edits are a whole new envelope whose payload carries `mid` = the
message id; recipients reject an envelope whose `mid` names another message
(stops the server from swapping envelopes between messages), and a plaintext
`edit` event never replaces an encrypted message. Failures show "Couldn't
decrypt / verify this message" with a reason; nothing is retried silently.

**Plaintext in an encrypted conversation.** A user message without an
envelope (after the "turned on encryption" notice, or any when no notice is
known) is shown with "Not encrypted – can't verify sender": the server could
have written it.

Reactions, pins, replies (`referencedMessageId`), read states, typing,
timestamps, attachment count/size and the @silent flag stay server-visible
metadata (documented in the Privacy Policy).

## Attachments

Each file gets its own random AES-256 key; the uploaded blob is
`"SRKE2EE\x01" ‖ AES-GCM(key, iv, file, aad = frame("serika-e2ee-file-v1"))`,
named `e2ee-<random>.bin`, type `application/octet-stream`. The 8-byte magic
header versions the format and guarantees ciphertext never sniffs as an image
(random bytes start with `BM` — BMP — once per 65 536 uploads, which the
upload scanner would block as "unreadable image"). The upload routes accept
such blobs past the type whitelist only when the bytes start with the header.
Name, type, size, key, iv and the plaintext SHA-256 travel in the encrypted
payload; the server stores only the opaque blob facts.

Viewing downloads the ciphertext (directly from the CDN, or through the
same-origin relay `GET /api/e2ee/blob?url=` when the CDN has no CORS — it only
serves `.bin` attachment objects from our CDN), decrypts, checks the SHA-256
and shows a `blob:` URL (pictures, video, audio inline; other files are
decrypted when clicked). Encrypted media is excluded from the lightbox
gallery's URL list.

## Conversations

- `channels.e2ee`: `true` encrypted; `false` plain (all legacy rows, and DMs
  with bots / system accounts); `null` = created plain because someone had no
  keys yet — clients turn it on automatically once everyone has keys.
- New 1:1 DMs (`getOrCreateDMChannel`) and new group DMs are created with
  `e2ee = true` when every member has an identity key and an active device.
- Existing DMs keep their history readable; any member can turn encryption on
  (`POST /api/e2ee/channels/:id/enable`: one-way, refused while someone has no
  keys or is a bot / system account) and a "X turned on end-to-end encryption"
  row is posted (`type 'system'`, `messages.e2ee = { v: 1, notice: 'enabled' }`,
  shown as `type: 'e2ee_enabled'`).
- In an encrypted conversation the DM / group DM routes reject plaintext and
  only take envelopes; plain conversations reject envelopes.
  `POST/PATCH /api/channels/:id/messages` never takes envelopes and refuses
  encrypted conversations. Bots can't be added to an encrypted group. Polls,
  forwards (and their notes) are server-readable rows, so they are refused
  into encrypted conversations (and "Create Poll" is hidden there);
  encrypted messages can't be forwarded.
- Never seen by the server: search indexing (skipped/removed for rows with
  `e2ee`), link previews (clients don't render LinkEmbed for encrypted
  messages, so links never reach `/api/oembed`), AutoMod (DMs don't run it),
  DM list / notification / push previews ("Encrypted message"; pushes say
  "New encrypted message", carry no picture and no inline reply).

## Recovery passphrase (key backup)

- On first setup the client creates identity + backup + device keys, publishes
  them, then asks for a recovery passphrase. It must reach "Good" on the
  strength meter (`passphrase.ts`: ≥ 14 chars with 3 character classes, or ≥ 20
  chars; common passwords, keyboard runs, sequences and repeats are always
  weak). "Not now" is allowed with a warning and reminds again after 3 days.
- Identity and backup private keys are extractable only until a backup is
  sealed; then (and on restore) they are re-imported non-extractable in
  IndexedDB. Changing the passphrase therefore opens the current backup with
  the current passphrase and re-seals it.
- `blob = base64(iv ‖ AES-GCM(PBKDF2-SHA-256(NFKC(passphrase), salt 16 B, 600 000), {v, identity JWK, backup JWK}, aad = frame("serika-e2ee-backup-v1", userId)))`,
  stored in `e2ee_identities.backup_blob / backup_salt / backup_iters`
  (≤ 16 KiB, iterations 600 000–5 000 000). A PUT is bound to the current
  identity key so a stale tab can't overwrite the backup after a reset.
- New device: download the blob, enter the passphrase, check the restored
  keys match the published ones, create + sign + publish a device key. All
  history wrapped to `backup:<user>` becomes readable. Linking from another
  device (next section) gives the same result without the passphrase; the
  passphrase stays the fallback when no other device is at hand.
- The passphrase KDF only runs when the user sets, changes or restores it
  (never at startup). WebCrypto runs PBKDF2 off the UI thread in every
  supported engine, so it isn't moved to a worker; the dialogs say it can take
  a few seconds on phones. Strength is unchanged (600 000 iterations).
- Forgotten passphrase: "Reset encryption" needs the account password (the
  server checks it with the accounts service — step-up — before replacing
  keys), publishes new identity + backup keys (`reset: true`), revokes all the
  account's devices and drops the old backup; contacts see a security-code
  change. The old keys are archived in this device's IndexedDB (never
  deleted), so old history stays readable here; it is lost on other devices.
- When `/status` reports a different identity key than this device has (a
  reset elsewhere, or a server claiming one), the device archives its keys
  instead of deleting them and shows "Encryption was reset on another device"
  with a Restore action.

## Linking a device (no passphrase)

A new device (N, phase `needs-restore`) gets the identity + backup private
keys — exactly what a passphrase restore gives — from one of the account's
existing devices (E), through a 5-minute relay on the server. Code:
`src/lib/e2ee/link.ts` (pure, tested), `session.ts` (flows),
`E2eeLinkDialog.tsx` (UI), `/api/e2ee/link*` (relay).

1. N makes an ephemeral ECDH P-256 key pair (`newPub`) and opens a session
   with only a commitment `commit = SHA-256(frame("serika-e2ee-link-commit-v1", newPub))`:
   `POST /link {commit}` → a 10-character Crockford base32 `code` (50 random
   bits), bound to the signed-in account. N shows the code and a QR of
   `<origin>/e2ee/link#<code>.<newPub base64url>` (the fragment never reaches
   a server; a phone's own camera opens the app's approve dialog).
2. E (Settings → Encryption → Link a new device; scan or type the code)
   reads the session (`GET /link/:code` → `commit`, the requesting device's
   self-described name and time) and shows it with a warning ("only continue
   if you are holding that device"); nothing is sent before the user taps
   continue. Then it checks the QR's key against the commitment when scanned,
   makes its own ephemeral pair and posts `oldPub`
   (`POST /link/:code/join {pub, commit}`).
3. N, having seen `oldPub`, pins it at once (before anything is awaited)
   and reveals `newPub` (`POST /link/:code/reveal`); a different `oldPub`
   later aborts the link. Polls are single-flight on both devices, so a slow
   step never overlaps the next poll. E checks `newPub` opens `commit` (and
   equals the QR key).
4. Both derive `ss = ECDH(own, other)` and, with
   `T = frame("serika-e2ee-link-transcript-v1", userId, code, commit, newPub, oldPub)`:
   `sas = HKDF-SHA-256(ss, salt = 0^32, info = frame("serika-e2ee-link-sas-v1", T))` →
   5 bytes → 40-bit integer mod 10^6 (6 digits, shown "123 456"), and
   `K = HKDF-SHA-256(ss, salt = 0^32, info = frame("serika-e2ee-link-key-v1", T))` (AES-256-GCM).
5. The user compares the 6 digits on both screens. Only after confirming on
   E does E send `AES-GCM(K, iv, {v, userId, identity JWK, backup JWK}, aad = frame("serika-e2ee-link-payload-v1", userId, code))`
   (`POST /link/:code/payload`). Only after confirming on N does N open it,
   check both keys equal the account's published `identityPub` /
   `backupPub` (from `/status`), store them non-extractable, create + sign +
   publish its device key, and post `/link/:code/done` (the server drops the
   sealed copy; E shows "set up").

Why the server can't sit in the middle: every relay step is `HSETNX` (once
only, single use, refused after `done`, bound to the account, 5-minute TTL;
`e2eeLink` rate limit 60 / 10 min per user; API calls, bodies included, time
out after 20 s). A relay that substitutes keys must commit to its fake
`newPub` towards E before it sees E's key, and must hand N a fake `oldPub`
before N reveals its own; so the two SAS values it causes are independent
and match by chance only (10^-6 per attempt; a failed attempt is visible and
burns the session). E never sends anything before the user confirmed the
numbers, and N never adopts keys before the user confirmed them there. The
sealed payload is bound to the account and the code. Since the keys must
match the published ones, a lying server could at most make N adopt a fake
identity, which every contact would see as an unknown device.

**Link escrow.** After a passphrase is set, identity / backup private keys
are non-extractable, so E could not export them. Whenever a device holds them
in the clear anyway (setting / changing the passphrase, restoring, being
linked, or the one-time "enter your passphrase to link from this device"
for devices set up before linking existed) it also keeps them as JWK sealed
under a separate non-extractable AES-GCM key in IndexedDB (`linkEscrow`,
AAD bound to user + identity key; deleted with the keys on reset). Only the
linking flow opens it, after the SAS was confirmed. Before a passphrase is
set, the keys are still extractable and are exported directly.

## Calls (DM / group DM voice and video)

Calls are a WebRTC mesh (simple-peer): media is DTLS-SRTP between peers and
TURN only relays ciphertext. In DM / group DM rooms every SDP offer/answer
carries `e2ee: { d: deviceId, s: ECDSA(deviceSignKey, frame("serika-e2ee-dtls-v1", roomId, senderUserId, sortedFingerprints)) }`,
where `sortedFingerprints` are the SDP's `a=fingerprint` lines normalised and
sorted. Receivers verify it against the sender's trusted, active devices
before applying the SDP (signals from one peer are processed in order behind
the check). Whether a DM / group room *requires* signatures is resolved inside
that path before the first SDP is applied, wherever the call was joined from
(ring overlay, another page, mobile): the room maps to its conversation
(`dm:<a>_<b>` → the other person's DM, `gdm:<id>` → the group;
`callGuard.ts`), which is required when this device remembers it encrypted or
the server flags it (first call on a device); unknown → signals wait; storage
errors → required. The DM / group pages can also turn it on
(`voiceService.setRoomE2ee`), never off. When a room becomes required, peers
accepted without a signature are dropped. In required rooms a missing or bad
signature drops that peer with a warning; elsewhere a present-but-bad
signature is still refused. The call panel shows "End-to-end encrypted" when
every connected peer verified.
Server voice channels are unchanged.

## Trust & Safety (message franking)

`POST /api/channels/:id/messages/:mid/report` with `e2ee: { key, payload, sig }`
(K and the exact decrypted payload JSON, kept in memory by the reporter's
client per envelope signature; `sig` names the version the reporter saw —
edits keep the replaced envelopes in `e2ee_envelope_history`, up to 20 per
message). The server checks `SHA-256(K ‖ ct) = cm`, decrypts `ct` under K with
the AAD of the stored message (channel, author, `sd`) and requires the result
to equal the disclosed payload byte for byte, and verifies `sig` with the
stored signing key of device `sd` belonging to the author (revoked devices
included). Only then is the report filed, with the verified plaintext. Each
disclosed attachment whose URL is one of the message's stored blobs on our
CDN is fetched (≤ 50 MB, 15 s), decrypted with the disclosed key, and images
go through `scanUploadedImage` attributed to the **sender** (PhotoDNA +
scam hashes, with the normal strikes / suspension); results are noted in the
report. Each message + file (SHA-256) is scanned once: the verdict is cached
(Redis, 30 days), a file that already produced an `e2ee-report` incident for
that sender reuses the incident, and concurrent reports share one scan, so
repeated reports never create duplicate incidents or strikes (scam strikes
are additionally limited to one per hour by `penalizeScam`). Blobs are
streamed with the 50 MB cap. A report of an encrypted message without a
valid disclosure is refused.

## Storage (additive, `drizzle/manual_e2ee.sql`, also ensured at boot by `ensureE2eeSchema()`)

- `e2ee_identities (user_id pk, identity_pub, backup_pub, backup_sig, backup_blob, backup_salt, backup_iters, created_at, updated_at)`
- `e2ee_devices (id pk, user_id, ecdh_pub, sign_pub, device_sig, identity_pub, name, created_at, last_seen_at, revoked_at)` + index on `user_id`
- `channels.e2ee boolean default false` (constant default: metadata-only),
  `messages.e2ee jsonb` (nullable, no default: metadata-only)
- `e2ee_envelope_history (message_id, sig, envelope jsonb, replaced_at, pk (message_id, sig))`:
  envelopes replaced by edits (a separate table rather than a column on
  `messages`, so no existing `SELECT *` on the big table depends on it)

## API (`src/lib/api/e2ee.ts`, mounted at `/api/e2ee`)

| Route | Purpose |
|-------|---------|
| `GET /status` | `{ enabled, identity, device }`; `?device=<id>` touches last-seen |
| `PUT /identity` | publish own identity + signed backup key (`reset` + account `password` for "Reset encryption") |
| `GET/POST /devices`, `DELETE /devices/:deviceId` | list, register (signature checked, max 10 active), revoke own devices |
| `GET/PUT /backup` | own passphrase-sealed backup |
| `GET /users/:userId/keys` | one user's public key bundle (calls, unknown senders); only for yourself, friends, people you share a DM / group DM or server with; other people's device names and activity times are never returned |
| `GET /channels/:channelId/keys` | members' bundles of a DM / group DM (members only) + `version`; `?v=<version>` → `{ unchanged: true }` when still current |
| `POST /link`, `GET /link/:code`, `POST /link/:code/{join,reveal,payload,done}`, `DELETE /link/:code` | device-linking relay (Redis, 5 min, single use, own account only) |
| `POST /channels/:channelId/enable` | turn encryption on |
| `GET /blob?url=` | same-origin relay of an encrypted attachment blob from our CDN |

Message DTOs (DM, group DM, pins, `GET /api/channels/:id/messages`) carry the
`e2ee` envelope; DM / group DM pages get `{ channelId, e2ee, e2eeAuto }` with
each message page; the DM list and `serializeGroup` carry `e2ee`/`e2eeAuto`;
SSE `edit` events carry the new envelope; `e2ee_enabled` is published when a
conversation switches. Encrypted DM / group sends may carry `e2eeKeys`
(the key-set version); refusals carry a `code` (`e2ee_keys_changed` 409,
`e2ee_device_inactive` 403, `e2ee_required` / `e2ee_not_encrypted` 400) so
clients show a translated message. Activity-stream events: `e2ee_keys`
(`{ userId }`) and `e2ee_link` (`{ code, status }`, own sessions only). Rate
limits: `e2eeRead`, `e2eeWrite`, `e2eeEnable`, `e2eeBlob`, `e2eeLink`
(`src/lib/security/index.ts`). No schema change since the first release:
link sessions live in Redis, caches on the client.

## Client behaviour

- `E2eeHost` (in `AppShellProviders`) loads the crypto module right after
  sign-in (first idle moment) and sets up / checks this device (Web Locks
  serialise tabs). Never blocks startup. IndexedDB or WebCrypto missing →
  "unavailable" with a clear message in encrypted conversations and Settings.
  A device without keys gets one prompt per session: set it up with another
  device (QR / code) or the recovery passphrase.
- `useChatSession({ encryptedChat: true })` (DM and group pages): envelopes are
  decrypted on every fetch / SSE path (in arrival order) before normalising;
  sends and edits are encrypted when the conversation is encrypted; files are
  encrypted before upload. Decrypted results are cached in memory and,
  encrypted, in IndexedDB (see "Performance and caches"); the localStorage
  message cache stores encrypted messages as envelope-only placeholders.
- Settings → Encryption (desktop dialog + mobile settings page): status,
  passphrase, devices with revoke, contacts' safety numbers, reset.

## Performance and caches

Measured with Bun's WebCrypto (`scratchpad` benchmarks; desktop x64 — phones
are roughly 3–10× slower): encrypting one message for 4 / 44 / 128
recipients 0.9 / 2.1 / 4.6 ms; opening + verifying one 0.85 ms, a page of 50
in parallel 4.5 ms; PBKDF2 600k 80–90 ms; a 50 MB attachment ~160 ms each
way. Crypto was never the bottleneck: waiting was (a fixed 3 s start delay,
two network round trips before anything decrypted, a key refetch on most
live messages, re-decrypting everything after a reload). What the client
does now:

- **Start:** `E2eeHost` starts right after sign-in (first idle moment, ≤ 0.5 s;
  the chat engine starts it itself if it needs keys first). `initE2ee` loads
  this device's keys from IndexedDB in one transaction and marks them ready
  (`whenLocalReady`) *before* asking the server (`/status`, device check,
  reset detection run in the background under the setup lock). Decryption and
  call signing wait only for the local keys; sends wait for the server check
  only on a device being set up right then.
- **Key sets** (`getChannelKeys`): served from memory, else from the copy in
  IndexedDB (`plainCache` "bundles", public data, trust re-derived from the
  local pins on each load), and revalidated in the background once older than
  a minute with `?v=<version>` (an unchanged set answers without bundles).
  The version is a digest of the members' identity / backup keys and active +
  revoked devices (`keysVersion.ts`; names / last-seen excluded). Sends carry
  `e2eeKeys: <version>`; the DM / group send routes refuse a stale one with
  `409 { code: "e2ee_keys_changed" }` and the chat re-encrypts with fresh keys
  and retries once. Registering / revoking a device or publishing / resetting
  an identity fans out `{type: "e2ee_keys", userId}` on the activity stream
  to everyone sharing a DM / group with that user (and their own sessions):
  cached sets containing them refetch at once, and a changed set bumps
  `keysVersion` in the snapshot (open chats re-check, banners refresh). A
  group whose shown members differ from the cached set is refetched before
  encrypting (and before the banner reports a mismatch).
- **Decrypted messages:** results are kept in a memory LRU (3000) and in
  IndexedDB (`serika-e2ee-cache` / `plain`, ≤ 10 000 records), each record
  AES-256-GCM under a per-account non-extractable key with AAD
  `serika-e2ee-cache-v1|<user>|<key>`. Key: `<channel>|<message id>|<envelope sig>|<sender>`,
  so an edit or a row claiming another sender is a miss. Only results whose
  payload URLs pass the allowlist are cached. A hit is re-checked
  against current trust: the sender device must still be trusted for the
  sender and not revoked before the message's time (else the message is
  decrypted again and fails with the real reason); with no key set loaded,
  trust follows the pins. Deletes and edits drop a message's entries; sign-in
  and sign-out clear the whole cache. The message key K is never cached:
  reporting a message shown from the cache opens its envelope again
  (`frankingDisclosureFor`).
- **Opening a conversation:** the localStorage message tail keeps encrypted
  messages that decrypted fine as envelope-only placeholders (failures stay
  failures, without envelope); first paint fills them from the memory cache
  synchronously, then from IndexedDB (`hydratePlaceholders`, usually before
  the network page arrives) — only rows of the open conversation's validated
  channel (the URL's group; for a 1:1 DM a channel whose key set is exactly us
  + the URL's person). The memory layer is dropped whenever trust changes;
  reply quotes only borrow our own text from the same conversation. Hovering a DM in the sidebar
  prefetches and decrypts its latest page with exactly the checks an open
  conversation runs. Uncached rows decrypt in parallel, newest first. A
  message still decrypting after 150 ms shows "Decrypting…"; before that it
  is an empty line (no flash). Envelope shape checks run once per row.
- **Live messages** decrypt before they are inserted (about a millisecond;
  no IndexedDB lookup for rows that just arrived); the key set is never
  refetched on the critical path. Own sends show their plaintext right away
  (the optimistic bubble is marked encrypted, so it is never persisted as
  plaintext).
- **Attachments** are encrypted / decrypted in a module Web Worker
  (`fileWorker.ts`) with transferred buffers: the 50 MB case drops from
  ~35 ms main-thread stalls to ~2 ms. The worker must answer a ping before any
  buffer is handed over; without workers (old WebViews) the same code runs
  inline. Downloads report progress; once the CDN has refused CORS the client
  goes straight to the same-origin relay instead of failing a request per
  file. Message decryption stays on the main thread: WebCrypto already runs
  off-thread and the JS around it is ~0.1 ms per message, less than a worker
  round trip.
- **Calls:** joining a DM / group call prefetches the peers' keys in parallel
  with media / ICE setup, so checking an SDP signature (~1 ms) doesn't wait on
  the network; signing only needs the local device key (a call answered
  before E2EE finished starting is still signed).
- **Safety numbers** use a synchronous SHA-256 for the 5200-round chain
  (≈ 20 ms instead of ~1 s of awaited digests in browsers; identical output,
  tested against WebCrypto).
- **Storage:** once a device is ready the client calls
  `navigator.storage.persist()` (iOS Safari / PWAs evict otherwise) and
  remembers in localStorage that this browser had keys, so a start without
  them says "This browser cleared your encryption keys" and offers linking /
  the passphrase. Lost IndexedDB connections reopen on the next access; API
  calls time out after 20 s (AbortController, not `AbortSignal.timeout`,
  which Chromium 102 lacks).

## Previews (stage 2 hand-off)

`session.decryptForPreview(message, channelId, selfId)` decrypts one message
for a notification or the DM list using every cache above (never throws;
`{ ok, text, attachments, sticker, verified }` or a failure reason). The
channel id must be the conversation the message belongs to (the AAD binds
it).

A per-device **notification key** for Android native push plugs in as one
more wrap recipient, without a new envelope version: the native app makes an
ECDH P-256 key, gets a device-shaped id (16 random bytes, base64url, so
`RECIPIENT_RE` / `validateEnvelope` already accept it and every v1 client
simply ignores an entry that isn't its own), and publishes it signed by the
identity key under its own label (e.g.
`frame("serika-e2ee-notify-v1", userId, id, ecdhPub)`, so it can never pass as
a signing device), listed in key bundles apart from devices (it never signs,
so it must never be accepted as a sender). Senders add `{ r: id, iv, k }` for
it exactly like a device wrap (counts towards the 128-recipient limit).
Include these keys in `canonicalKeySet` so the 409 freshness check covers
them. The push payload carries that one wrap + `sd`, `epk`, `iv`, `ct`, `cm`,
`sig` (well under FCM's 4 KB for text); native code unwraps K, checks `cm`,
decrypts with the same AAD (channel, sender, sender device) and verifies `sig`
with the sender device key from a trusted-signer list the WebView syncs to it
(pins + vouched, non-revoked devices). Previews of messages that fail any
check show the generic "New encrypted message".

## Rollout: `E2EE_ENABLED`

Canary and production share one database and production runs older code
until a release. E2EE is off unless the server has `E2EE_ENABLED=1`. While
off: no key setup, onboarding or E2EE settings; new DMs / groups are created
unencrypted; enabling and key/device/backup writes are refused (503); plain
conversations take plaintext as before. Conversations that are already
encrypted keep working on devices that have keys (reading, rendering,
sending envelopes); plaintext stays refused in them. Turn the flag on only
after production runs a release with this code — older code shows encrypted
messages as blank.

## Known limitations

- No forward secrecy beyond the per-message ephemeral key: a stolen device
  key reads everything wrapped to it; revoke the device (Settings).
- The server could re-attach a revoked device row (revocation is enforced by
  the server; there is no identity-signed device list). After losing a
  device, also reset encryption if that matters.
- A message replayed by the server as a duplicate row in the same
  conversation still verifies (the payload carries the sender time `ts`, not
  the server id).
- Reactions, replies, timestamps, sizes and who-talks-to-whom are metadata.
- Voice messages can't be sent in encrypted conversations yet; message
  drafts are still kept in localStorage as typed.
- Members added to a group later can't read earlier encrypted history.
- Web clients load code from the server, so a malicious server could ship
  malicious JavaScript (the limit of every web-based E2EE app); the open
  source makes this auditable.
- Group membership is not cryptographically authenticated: messages are only
  encrypted to the members the group shows, but that list also comes from the
  server. A server can visibly add someone (people should watch the member
  list and safety numbers); it can't add someone invisibly. Likewise the
  binding of a 1:1 DM to its channel id relies on the server's member list for
  that channel: a server lying that a group has only the two of you could show
  that group's messages in the 1:1 view.
- The server can roll an edited message back to an earlier envelope (each
  version is validly signed and carries the same `mid`); clients can't tell
  which version is the latest.
- The revoked-device cutoff (messages signed by a device after its revocation
  + 1 min) relies on the server's `createdAt`, which the server controls.
- A plaintext row the server back-dates to before the "turned on encryption"
  notice is shown without the "Not encrypted" warning, among the old plain
  history.
- Recovery passphrase strength is enforced by clients only (the server never
  sees it); a modified client could seal with a weak one.
- Link escrow: on a device that sealed, restored or was linked, script
  running in the SerikaCord origin while the device is unlocked can obtain
  the identity / backup private keys (it could previously only *use* them).
  A malicious server shipping script could already capture the passphrase,
  so this changes nothing against the server; it widens what an XSS bug
  could take. Disk-level access to the browser profile reads it too, like
  every key stored in IndexedDB (non-extractable keys are only protected from
  script, not from someone holding the profile).
- The decrypted-message cache is encrypted under a key stored in the same
  browser profile: it keeps plaintext out of the files (backups, sync, casual
  forensics), not away from someone who controls the unlocked profile, who
  can use the device keys anyway. Sign-out clears it.
- Linking compares 6 digits (10^-6 per attempt against an active relay,
  attempts are visible and rate-limited); it needs Redis on the server.
- A cached decryption is shown before the background key refresh; a device
  revoked since is caught when that refresh lands (the message is re-checked
  and fails), not before.
- Key-set versions only keep honest clients fresh; a malicious server can
  report any version (it controls the key lists anyway — trust comes from
  identity signatures, pins and safety numbers).
