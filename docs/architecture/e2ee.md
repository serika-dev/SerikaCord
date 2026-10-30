# End-to-end encryption (DMs, group DMs, calls)

Status: implemented October 2026, behind the `E2EE_ENABLED` flag (see
Rollout). Scope chosen by the owner: DMs, group DMs and their voice/video
calls are end-to-end encrypted; new DMs are encrypted by default (any member
can turn it off per conversation with a signed record, and on again); keys
survive new devices through a **6-digit PIN** (the default, required once per
account; X-style), device linking by QR, or an optional long recovery
passphrase; reported messages are revealed to Trust & Safety with a
cryptographic proof (message franking). Server channels stay server-side
encrypted at rest (bots, search, AutoMod, history for new members).

Only WebCrypto primitives available in every supported browser, the Qt
WebEngine shell (Chromium 102+) and Android WebView are used: ECDH P-256,
ECDSA P-256 (SHA-256, IEEE P1363 signatures), HKDF-SHA-256, AES-256-GCM,
PBKDF2-SHA-256. No new dependencies. The same code runs server-side under Bun
for verification and in `bun test` (`tests/e2ee.test.ts`).

Code map:

| Path | What |
|------|------|
| `src/lib/e2ee/` | Isomorphic core: `keys`, `envelope`, `payload`, `attachments`, `backup`, `safetyNumber` (+ `sha256`, a synchronous SHA-256 for its hash chain), `dtls`, `franking`, `policy` (pure server rules), `conversation` (pure client binding rules: URL targets, member checks, plaintext rows and the on / off timeline, payload URLs), `passphrase` (strength), `link` (device linking: codes, commitment, SAS, sealed keys), `keysVersion` (key-set versions), `notifyKeys` (notification keys, push blocks, recipient cap), `previewText` (preview line + mention detection), `pin` (PIN derivation, bundle seal / open, commit + removal signatures, easy-PIN rules), `pinVault` (server half with the pepper: verifier hash, sealed server secret, attempt rules), `conversationState` (signed "turned off" records and the downgrade rules), `trust` (identity pins: trust on first use, accept / verify), `decryptRetry` (which decrypt failures are transient, backoff, result memo), `constants`, `encoding` |
| `src/lib/e2ee/client/` | Browser only: `keyStore` (IndexedDB, incl. "seen encrypted" memory, archived keys, link escrow), `session` (setup, linking, trust, encrypt/decrypt, caches; lazy-loaded), `plainCache` (decrypted-message cache: memory + encrypted IndexedDB; cached key bundles), `view` (payload → rendered message, crypto-free), `fileCrypto` + `fileWorker` (attachments in a module Web Worker), `state` (crypto-free snapshot for React), `chatGlue` (useChatSession helpers), `callGuard` (does a call room need verified signatures), `previews` (notification / DM-list previews), `retryBus` ("Try again" on a message → the open chat), `notifyKey` (Android: notification key + trusted senders for native code) |
| `src/lib/services/e2ee.ts` | Server: flag, boot DDL, key lookups, key-set versions, key-change notifications, send gate, franking reports, "turned off" record checks |
| `src/lib/services/e2eePin.ts` | Server: PIN backups (pepper, begin / commit, unlock with atomic attempt counting, lockout + system DM, removal) |
| `src/lib/api/e2ee.ts` | `/api/e2ee` routes (incl. the device-linking relay) |
| `src/components/e2ee/` | Host (starts E2EE right after sign-in, dialogs, realtime key changes), `PinInput` (6 boxes) + `PinFlows` (create / upgrade / change / unlock) shown by `E2eePinDialog` and inline by `E2eePinGate` (DM pages), setup/restore/reset dialog, device-linking dialog, `E2eeConversationLock` (header lock + panel), conversation banner (warnings only), safety numbers, settings panel |
| `src/app/e2ee/link` | Where a linking QR code points (a phone camera opens the app's approve dialog) |
| `src/lib/push/fcm.ts`, `src/lib/services/pushNotifications.ts` | Push builder: the per-device `e2ee` block for protocol 3 phones |
| `mobile/android/.../serikacord/` `E2eeNotifyCrypto`, `EncryptedPreviewText`, `EncryptedPushPreview`, `NotificationKeyStore` | Android: open + verify encrypted pushes, preview text, Keystore-wrapped notification key and trusted senders |

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
| PIN backup (per user) | identity + backup private JWK, AES-256-GCM under a key needing the PIN **and** a server secret S | server: bundle ciphertext; S only encrypted under a key derived from the `E2EE_PIN_PEPPER` env secret | none (see "6-digit PIN") |
| Link escrow (per device, ≤ 10 min) | identity + backup private JWK, AES-256-GCM under a per-device non-extractable key | IndexedDB (`linkEscrow`) for 10 minutes after the passphrase was proven here or the device was linked | none (see "Linking a device") |
| Notification key (per Android install, protocol 3) | ECDH P-256 | the APK's native storage, AES-256-GCM under a non-exportable Android Keystore key | `e2ee_notify_keys`, signed by the owning device's signing key |

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
  messages. The pin rules are pure (`lib/e2ee/trust.ts`): only a bundle from
  the server sets or clears a pending change; a copy cached on this device
  never does, and a cached copy that disagrees with the trusted key waits for
  the server instead of showing a change. "Accept new code" stores exactly
  the key the banner showed (`acknowledgeIdentityChange(uid, pendingKey)`),
  never a newer one that arrived unseen; "Mark as verified" in the safety
  number dialog verifies the key it displayed (a pending one is accepted as
  verified). Pins are per device (IndexedDB) and written per contact in one
  read-modify-write transaction, so a tab with an older copy never
  overwrites another tab's decision; a `BroadcastChannel` tells the other
  tabs to reload them. Key sets checked against older pins are never cached
  (a trust epoch).
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
decrypt / verify this message" with a reason and a "Try again" button;
transient ones are retried first (see "Failures and retries"). A retry
re-runs exactly the same checks; nothing is ever accepted on a weaker basis.

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
- Any member can **turn encryption off** for a conversation (and anyone back
  on): see "Turning encryption off" below.
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
  DM list / notification / push previews: the server only ever sends the
  envelope; devices decrypt previews themselves (see "Previews and push
  notifications"). Pushes carry no picture and no inline reply.

## Turning encryption off (per conversation)

Encrypted by default; any member may turn it off (confirmation: new messages
won't be end-to-end encrypted, older encrypted ones stay encrypted and
readable) and anyone may turn it on again (the existing enable path, with its
"turned on" notice). The server must not be able to do it silently, so "off"
needs a member device's signature (`lib/e2ee/conversationState.ts`):

```
record = { v: 1, channelId, kind: "dm" | "group_dm", members?: [a, b], userId, deviceId, state: "off", ts, sig }
sig    = ECDSA(deviceSignKey, frame("serika-e2ee-conv-state-v1", channelId, kind, a | "", b | "", userId, deviceId, "off", ts))
```

`members` (1:1 DMs only) are the two people, lower-cased and sorted, and the
signer must be one of them: a 2-person group's genuine record can't be served
as a 1:1 DM's.

- `POST /e2ee/channels/:id/disable {record}`: the server checks shape, that
  it names this conversation, its kind (and a DM's two people) and the
  caller, ts within ±10 min, and the
  signature under the caller's active device; then sets `channels.e2ee =
  false`, stores the record (`e2ee_conversation_states`), posts a system row
  (`messages.e2ee = {v: 1, notice: "disabled", record}`, sent to clients as
  `type: "e2ee_disabled"` with `e2eeRecord`: "X turned off end-to-end
  encryption. New messages here aren't end-to-end encrypted.") and publishes
  `e2ee_disabled` (with the record) on the conversation stream.
  `GET /e2ee/channels/:id/state` returns the current record.
- **Clients** that remember the conversation encrypted keep it encrypted
  until the record verifies (`session.verifyConversationOff`, used by
  `chatGlue.conversationEncryptionHere`): the record must name the kind of
  conversation the user opened (and, for a 1:1 DM, exactly us + the URL's
  person; a DM channel this device already proved to be another one is
  refused), the signer must be a member of the conversation bound to the URL
  (a 1:1 DM's channel must be exactly us + the URL's person), the device must
  be vouched for by an identity key this
  device trusts for that member and not revoked before `ts` (+1 min), the
  signature must verify, `ts` must not be more than 10 minutes ahead, and it
  must be newer than the last time this device saw the conversation
  encrypted (minus 10 minutes of clock skew) and than any off record it
  accepted before; a record this device accepted and then saw superseded
  (the conversation encrypted again) is never accepted again, whatever the
  clocks say — so an old record can't be replayed after the conversation
  was turned on again. Verdicts are never cached: only checks still in
  flight are shared, and "stay encrypted" answers are kept for 30 s at most,
  so every downgrade is re-checked against the current memory (cheap once
  accepted: a local read). A live `e2ee_disabled` event changes the local
  state only once its record verifies. `seenEncryptedAt` is written at most
  once a minute per tab (immediately after an accepted "off"). Accepted → stored per conversation in
  IndexedDB (`conversationStates`), plaintext sends allowed, no
  "Not encrypted – can't verify sender" flags. Anything else (no record,
  unknown device, bad signature, replay) → the conversation stays encrypted
  here (the server then refuses this device's envelopes) and the banner says
  "Encryption was turned off by the server, but no member's confirmation
  checks out on this device. Sending is paused." with "Turn on encryption"
  (when everyone has keys) and "Turn off here too" (confirmed: this device
  signs its own record and accepts it). When the record is signed by a
  member whose security code changed and isn't accepted yet (their new
  device isn't trusted here), that member's "security code changed" line
  says so instead: accepting the code makes the record verify. Seeing the
  conversation encrypted again (server flag, `e2ee_enabled`) clears the off
  state and moves `seenEncryptedAt` forward.
- **History**: plain rows are judged against the on / off timeline of the
  notices seen (`isPlainAllowedAt`): legitimate in the plain era before the
  first "turned on" notice and after a *verified* "turned off" notice until
  the next "turned on" — or until the last time this device itself saw the
  conversation encrypted, whichever comes first; a "turned off" proves the
  conversation was encrypted before it. An off point sits at the record's
  signed time (not the server's row time); a notice whose row time is more
  than 10 minutes from it is ignored, and each record counts once.
  Unverified "turned off" rows never open a plain window.
- The "turned off" system row names the member who signed the record (the
  row's author only when it is that member, else "Someone") and is marked
  "Not verified" when the record doesn't verify on this device.
- Encrypted messages can't get a plaintext edit while it's off (the DM /
  group routes and `PATCH /api/channels/:id/messages/:mid` refuse: clients
  would keep showing the encrypted version).
- **Android**: when a device verifies an "off", it sends
  `{ <channel>: { kind: "plain" } }` to `setEncryptedConversations`; newer
  APKs drop that conversation from the native encrypted list (so plain
  pushes show their text), older APKs ignore the entry and keep showing
  "New encrypted message" (fails safe). Turning it on again re-adds it.
- Calls follow the conversation state (`callGuard` uses the same memory);
  `voiceService.setRoomE2ee` still never switches a room off mid-session.

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
- Since the PIN backup the passphrase is an **optional extra** method
  (Settings: "Recovery passphrase (optional)", Turn off / Change); accounts
  that had one are upgraded to a PIN by entering it once (see "6-digit PIN").
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

## 6-digit PIN (default key backup)

What a passphrase restore or a device link yields (the identity + backup
private keys) is also sealed in a **PIN backup**: on a new device the user
types six digits and everything decrypts (like X's encrypted DMs). Code:
`lib/e2ee/pin.ts` (client + shared, tested), `lib/e2ee/pinVault.ts` (server,
pure, tested), `services/e2eePin.ts`, `session.ts` (flows), `PinFlows.tsx`.

**Crypto.**

```
master   = PBKDF2-SHA-256(utf8(PIN ‖ ":" ‖ userId), salt 16 B, 600 000)       (32 B; in the attachment worker when it runs)
verifier = HKDF-SHA-256(master, 0^32, frame("serika-e2ee-pin-verifier-v1", userId))
wrap     = HKDF-SHA-256(master, 0^32, frame("serika-e2ee-pin-wrap-v1", userId))
K        = HKDF-SHA-256(wrap ‖ S, 0^32, frame("serika-e2ee-pin-v1", userId))   → AES-256-GCM
bundle   = base64(iv ‖ AES-GCM(K, iv, {v, identity JWK, backup JWK}, aad = frame("serika-e2ee-pin-bundle-v1", userId, identityPub)))
```

S is 32 random bytes made by the server. The server stores per user
(`e2ee_pin_backups`): salt, iterations, the bundle, the identity key it
belongs to, `verifier_hash = HMAC-SHA-256(macKey, frame("serika-e2ee-pin-verifier-hash-v1", userId, verifier))`
and `secret_enc = AES-256-GCM(encKey, S, aad = frame("serika-e2ee-pin-secret-v1", userId))`,
where `macKey` / `encKey` are HKDF-derived (separate labels) from
`E2EE_PIN_PEPPER`, an environment secret that is never in the database. A
database dump alone therefore can neither test PIN guesses (no pepper → no
HMAC) nor open S (and without S the bundle doesn't open even with the right
PIN).

**Set / change** (two steps, so the client never sends S back):
`POST /pin/begin` → a fresh S (kept pending, encrypted, 10 minutes; a new
begin replaces it). The client seals the bundle with it and posts
`POST /pin/commit {identityPub, salt, iterations, verifier, bundle, secretCheck, sig}`:
`secretCheck = SHA-256(frame("serika-e2ee-pin-secret-check-v1", S))` binds the
commit to the pending S (a second tab's begin makes the first commit fail
instead of storing a bundle nobody can open), and
`sig = Sign(identity, frame("serika-e2ee-pin-commit-v1", userId, identityPub, salt, iterations, SHA-256(bundle), secretCheck))`
proves a device holding the account's identity key made it: a stolen session
alone can't swap the backup for one whose PIN it knows (the verifier is not
signed: a signature over it would be an offline oracle). So the verifier is
not cryptographically bound to the bundle: whoever can rewrite the commit in
transit (TLS broken) or the server itself could store a different verifier,
which only makes later unlocks fail (a denial of service the server could
cause anyway: it holds S and the bundle). The server checks
the identity is the current one. *Deviation from the original brief* (which
asked for the current verifier on change): the identity-key signature is a
stronger proof and also lets a device that still holds the keys set a new PIN
when the old one is forgotten; the UI still asks for the current PIN to
change it (that's what opens the keys on a device whose keys are sealed).
After a commit the keys on the device are re-imported non-extractable (as
after a passphrase) and the 10-minute link escrow is opened. PINs that are
all one digit, straight runs, repeated pairs / triples, mirrored halves and a
few very common ones are refused (`isEasyPin`).

**Unlock** (`POST /pin/unlock {verifier}`, needs the account's session): the
route first **reserves an attempt atomically**
(`UPDATE … SET attempts = attempts + 1 WHERE attempts < 10 AND bundle IS NOT NULL … RETURNING`),
then compares `HMAC(verifier)` in constant time. Right → attempts reset to 0,
returns S, the bundle, salt and iterations; the client opens the bundle,
checks the keys equal the published ones and registers the device. Wrong →
403 with `attemptsLeft`. The attempt that reaches 10 (in total, across devices
and time; only a right PIN resets the count) **wipes S and the bundle**
(`locked_at` set) and the user gets a system DM ("Too many wrong PIN
attempts: your encrypted-message PIN backup was reset…"); their devices, the
passphrase backup and QR linking keep working. Because the attempt is
reserved before the check, parallel requests can never evaluate more than 10
guesses. Rate limits on top: `e2eePin` 5 / minute per user **and** per IP.

**Remove** (`POST /pin/remove`, identity-signed `frame("serika-e2ee-pin-remove-v1", userId, identityPub, "pin", ts)`,
±10 min) and "Reset encryption" (and any identity change) drop the PIN
backup. The passphrase backup can be removed the same way
(`POST /backup/remove`, method `"passphrase"`); Settings only offers it while a
PIN exists, and removing the PIN only while a passphrase exists.

**Required setup / upgrade (UX).**
- Every account converts to a PIN (`snapshot.requirePinSetup`): an account
  without E2EE gets "Create a 6-digit PIN" right after its keys are made
  (PIN + confirm, ~5 s); an account that already has a recovery passphrase
  gets "Upgrade to a 6-digit PIN": enter the passphrase once (it opens the
  backup — so the keys are at hand even though they're sealed here), then
  create + confirm the PIN. "Forgot your passphrase?": when this device can
  still produce the keys (never sealed here, or within the escrow window) the
  **account password** (`POST /reauth`, the same accounts-service step-up as
  "Reset encryption") stands in for it; when the keys here are sealed it
  can't work (non-extractable keys can't be exported) and the only ways are
  another device / a reset. A device that just restored with the passphrase
  goes straight to creating the PIN. The PIN dialog opens once per session;
  DM / group DM pages show the same setup inline instead of the conversation
  until it's done (bots / system DMs, e.g. the lockout notice, stay readable;
  server channels are unaffected). A linked device of an account with
  neither PIN nor passphrase and sealed keys can't make the bundle: it shows
  "Create your PIN on the device where you first set up encryption".
- New device (`needs-restore`) of an account with a PIN: "Enter your PIN"
  (6 boxes, numeric keypad, auto-advance, paste, the sixth digit submits)
  inline on DM pages and as a dialog the first time the DM list opens;
  "2 tries left before your encrypted messages are reset" when low; links to
  "Use another device instead", "Use recovery passphrase" (when set) and
  "Forgot PIN? Reset encryption"; "Not now" shows the conversation for the
  session. Without a PIN: passphrase (then the PIN is created) / another
  device / reset.
- Approving a device link from a device whose keys are sealed asks for the
  PIN (or the passphrase) once, like the passphrase did.
- Without `E2EE_PIN_PEPPER` every PIN route answers 503, `/status` reports
  `pin.available: false`, and the apps behave as before (passphrase
  onboarding, QR linking): never a weaker PIN.

**Threat model of the PIN** (honest version, also in Settings: "For the
strongest protection, also set a long recovery passphrase and remove the
PIN"):
- Protects against a **database leak** (pepper + encrypted S: no offline
  guessing), **online guessing** (10 tries in total, then the backup is
  destroyed; 10 / 10^6 minus refused easy PINs) and **network attackers**
  (TLS; S and the bundle are useless without the PIN's wrap key).
- Does **not** protect against **whoever operates the server with the
  pepper** (or anyone who obtains database + pepper): they hold S and the
  verifier hash and can try all 10^6 PINs offline (10^6 × 600 000 PBKDF2
  iterations: hours on one GPU), or simply log verifiers sent to
  `/pin/unlock`. A long recovery passphrase has no such server-side dependency.
- Someone with the user's session (stolen cookie) can burn the 10 attempts
  and destroy the PIN backup (DoS, the user is told by system DM), with a
  10 / 10^6 chance of guessing right.
- Future option: distributed guess-limiting (Juicebox / Signal SVR style:
  secret shares across independent realms or an enclave) would remove the
  "operator with the pepper" case.

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

**Link escrow (short-lived).** After a passphrase is set, identity / backup
private keys are non-extractable, so E could not export them. Only right
after the user proved the passphrase on this device (setting / changing it,
restoring with it, or "enter your recovery passphrase" in the link dialog) or
right after this device was linked does it keep them as JWK sealed under a
separate non-extractable AES-GCM key in IndexedDB (`linkEscrow`, AAD bound to
user + identity key), with `expiresAt` = now + 10 minutes. The expiry is
checked on every read (an expired, far-future or pre-expiry record is
deleted instead of used); expired records are also deleted at start, when
the page becomes visible again and by a timer; a successful approval deletes
it at once (one link per proof of the passphrase); a reset deletes it with
the keys. Approving later asks for the recovery passphrase again (the dialog
says so). Before a passphrase is set the keys are still extractable and are
exported directly (that existing path is unchanged); an account without a
passphrase whose keys here are no longer extractable (a device linked from
one without a passphrase, after its 10 minutes) is told to set a recovery
passphrase first. Setting the passphrase also uses the escrow while it is
valid, so a freshly linked device can set one without the old one.

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
included). Only then is the report filed, with the verified plaintext, in the
staff queue (`message_reports`, `src/lib/services/messageReports.ts`; staff see
only the reported message, never the rest of the conversation). Each
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
- `e2ee_notify_keys (id pk, user_id, device_id, ecdh_pub, sig, created_at, revoked_at)` + index on
  `user_id`, and `push_devices.e2ee_notify_id text` (nullable): notification keys and which phone
  holds one (stage 2: `drizzle/manual_e2ee_notify.sql`, also ensured at boot by
  `ensureE2eeSchema()` / `ensurePushSchema()`)
- `e2ee_pin_backups (user_id pk, identity_pub, salt, iterations, bundle, verifier_hash, secret_enc, pending_secret_enc, pending_expires_at, attempts, locked_at, created_at, updated_at)`
  and `e2ee_conversation_states (channel_id pk, state, record jsonb, updated_by, updated_at)`:
  PIN backups and "turned off" records (`drizzle/manual_e2ee_pin.sql`, also
  ensured at boot). New tables only.
- `e2ee_envelope_history (message_id, sig, envelope jsonb, replaced_at, pk (message_id, sig))`:
  envelopes replaced by edits (a separate table rather than a column on
  `messages`, so no existing `SELECT *` on the big table depends on it)

## API (`src/lib/api/e2ee.ts`, mounted at `/api/e2ee`)

| Route | Purpose |
|-------|---------|
| `GET /status` | `{ enabled, identity, device, pin: { available, set, attemptsLeft, lockedAt } }`; `?device=<id>` touches last-seen |
| `PUT /identity` | publish own identity + signed backup key (`reset` + account `password` for "Reset encryption") |
| `GET/POST /devices`, `DELETE /devices/:deviceId` | list, register (signature checked, max 10 active), revoke own devices |
| `GET/PUT /backup` | own passphrase-sealed backup |
| `GET /users/:userId/keys` | one user's public key bundle (calls, unknown senders); only for yourself, friends, people you share a DM / group DM or server with; other people's device names and activity times are never returned |
| `GET /channels/:channelId/keys` | members' bundles of a DM / group DM (members only) + `version`; `?v=<version>` → `{ unchanged: true }` when still current |
| `POST /link`, `GET /link/:code`, `POST /link/:code/{join,reveal,payload,done}`, `DELETE /link/:code` | device-linking relay (Redis, 5 min, single use, own account only) |
| `POST /channels/:channelId/enable` | turn encryption on (also after it was turned off) |
| `POST /channels/:channelId/disable`, `GET /channels/:channelId/state` | turn encryption off with a member device-signed record; the current record |
| `GET /pin`, `POST /pin/begin`, `POST /pin/commit`, `POST /pin/unlock`, `POST /pin/remove` | PIN backup: parameters, fresh server secret, store (identity-signed), unlock (10 tries in total), remove (identity-signed) |
| `POST /backup/remove` | remove the passphrase backup (identity-signed) |
| `POST /reauth` | account password step-up (forgotten passphrase while upgrading to a PIN) |
| `GET /blob?url=` | same-origin relay of an encrypted attachment blob from our CDN |
| `POST /notify-keys`, `DELETE /notify-keys/:id` | register (device-signed; optional `pushToken` link) / revoke this phone's notification key |

Message DTOs (DM, group DM, pins, `GET /api/channels/:id/messages`) carry the
`e2ee` envelope; DM / group DM pages get `{ channelId, e2ee, e2eeAuto }` with
each message page, and the latest page of an encrypted conversation also
`e2eeKeys` (the member key set, same shape as `GET /channels/:id/keys`); the DM list and `serializeGroup` carry `e2ee`/`e2eeAuto`;
SSE `edit` events carry the new envelope; `e2ee_enabled` is published when a
conversation switches. Encrypted DM / group sends may carry `e2eeKeys`
(the key-set version); refusals carry a `code` (`e2ee_keys_changed` 409,
`e2ee_device_inactive` 403, `e2ee_required` / `e2ee_not_encrypted` 400) so
clients show a translated message. Activity-stream events: `e2ee_keys`
(`{ userId }`) and `e2ee_link` (`{ code, status }`, own sessions only). Rate
limits: `e2eeRead`, `e2eeWrite`, `e2eeEnable`, `e2eeBlob`, `e2eeLink`
(`src/lib/security/index.ts`), plus `e2eePin` (unlock attempts, per user and
per IP). Link sessions live in Redis, caches on the
client. Stage 2 added notification keys (see Storage) and the `e2ee` field
on `dm_activity`, `dm:list:update` and DM-list last messages.

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
  6-digit PIN (create / change / remove), recovery passphrase (optional:
  set / change / turn off), link a device, devices with revoke, contacts'
  safety numbers, reset.
- Conversation header: a lock next to the DM / group name ("End-to-end
  encrypted"; an open lock when a member turned it off). It opens a popover
  (desktop) / bottom sheet (phones): "Messages and calls are end-to-end
  encrypted.", each member with "Verify safety number", and "Turn off
  encryption" (or "Turn on encryption"). There is no permanent "encrypted"
  strip above the composer any more: only actionable / warning strips
  (security code changed, key / member mismatch, someone without keys, this
  device not set up, unverifiable "off", encryption off with "Turn on
  encryption", PIN to be set on another device). The "turned on / off"
  system rows stay as the in-history explanation.

## Performance and caches

Measured with Bun's WebCrypto (`scratchpad` benchmarks; desktop x64 — phones
are roughly 3–10× slower): encrypting one message for 4 / 44 / 128
recipients 0.9 / 2.1 / 4.6 ms; opening + verifying one 0.85 ms, a page of 50
in parallel 4.5 ms; PBKDF2 600k 80–90 ms; a 50 MB attachment ~160 ms each
way. Crypto was never the bottleneck: waiting was (a fixed 3 s start delay,
two network round trips before anything decrypted, a key refetch on most
live messages, re-decrypting everything after a reload). What the client
does now:

- **Opening the app on a DM / group DM** starts loading the crypto module as
  the page hydrates (`AppProviders`), so the cached messages can be decrypted
  as soon as the conversation mounts.
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
  and retries once. The server caches each member set's current version in
  Redis (`memberKeysVersion`), tagged with every member's key epoch, which
  `notifyE2eeKeysChanged` bumps on each key change; without Redis it is
  computed from the database every time. Registering / revoking a device or publishing / resetting
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
  failures, with their envelope and stored blob URLs so "Try again" works
  after a reload); first paint fills them from the memory cache
  synchronously, then from IndexedDB (`hydratePlaceholders`, usually before
  the network page arrives) — only rows of the open conversation's validated
  channel (the URL's group; for a 1:1 DM a channel whose key set is exactly us
  + the URL's person). The memory layer is dropped whenever trust changes;
  reply quotes only borrow our own text from the same conversation. Hovering a DM in the sidebar
  prefetches and decrypts its latest page with exactly the checks an open
  conversation runs (it shares the request the conversation itself makes
  when it opens meanwhile). The latest page carries the key set
  (`e2eeKeys`): it is processed exactly like a `/keys` answer (bundle checks,
  trust on first use against the local pins, cached in memory and IndexedDB),
  so a cold open makes one request instead of the page and then the keys;
  the encrypted-cache lookup runs while the keys are checked. On a cold open
  the newest 20 rows are decrypted and shown first, then the whole page goes
  through the normal decode (those rows are memo hits), so the result is the
  same. Uncached rows decrypt in parallel, newest first. A
  message still decrypting after 150 ms shows "Decrypting…"; before that it
  is an empty line (no flash). Envelope shape checks run once per row;
  long-lived public keys (device signing / encryption keys, backup keys) are
  imported once per session (`importRecipientPublicKey`, the ECDSA verify
  key cache in `keys.ts`), ephemeral keys every time.
- **Failures and retries** (`lib/e2ee/decryptRetry.ts`, pure and tested;
  `hooks/useE2eeDecryptRetry.ts` in the chat engine). Reasons are split:
  *transient* — `not_ready` (keys still loading), `keys_unavailable` (the
  conversation's key set or the sender's keys couldn't be fetched: network,
  401 while the token refreshes, 429, 20 s timeout; also a 1:1 DM row with
  no known channel), `unknown_device` (a contact's device not in the key set
  yet), `temporary` (the engine threw: storage, WebCrypto) — and
  *permanent* (`no_key`, `unwrap`, `decrypt`, `commitment`, `payload`,
  `signature`, `revoked_device`, `edit_mismatch`, `wrong_conversation`,
  `foreign_url`, `malformed`; `restore` waits for the user). A transient
  failure keeps its envelope and stored blob URLs on the row and is retried
  3 times (after 1, 3 and 6 s) while it shows "Decrypting…"; only then does
  the error appear. Every failure shown is decrypted again when this
  device's keys load, a security code is accepted, or a key set changes;
  transient ones also when the tab becomes visible, the browser comes back
  online or the stream reconnects. "Try again" forgets what is remembered
  about the message, reloads the conversation's key set and the sender's
  keys from the server, and decrypts again. The in-memory result memo keeps
  successes; a permanent failure for 60 s; a transient one only while in
  flight (a rejected key fetch is dropped too), so no failure is ever cached
  for good. A retried result only replaces a row still showing the same
  failed envelope (an edit or a fetch that came meanwhile wins), and only its
  decrypted fields; replies quoting it get our own text. A live message that
  arrives in a 1:1 DM before the page's conversation facts uses the row's
  channel, checked against the URL's person exactly like the page's.
  Notification / DM-list previews retry transient failures within their 4 s
  budget, and the mobile DM list decrypts missed previews again once keys
  are ready.
- **Live messages** decrypt before they are inserted (about a millisecond;
  no IndexedDB lookup for rows that just arrived); the key set is never
  refetched on the critical path. Own sends show their plaintext right away
  (the optimistic bubble is marked encrypted, so it is never persisted as
  plaintext). The server's answer and the stream echo of an own send aren't
  opened again: the tab still has the plaintext, and the sender signature
  (which covers ciphertext, commitment, iv and ephemeral key) is still
  verified against this device's trusted key.
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

## Previews and push notifications (stage 2)

The server never sees preview text: every preview is decrypted on the device
that shows it, with the same checks as an open conversation.

### In-app and desktop notifications, DM list

- Encrypted DM / group sends carry their envelope on the `dm_activity`
  activity event and on `dm:list:update` (`{ encrypted: true, e2ee }`, the
  same envelope the members already get over the DM stream). `GET /api/dms`
  adds `lastMessage.e2ee` for encrypted last messages, **trimmed to the
  viewer's own wrap entries** (their devices, revoked ones included, and
  their backup key; `envelopeForRecipients` — the signature doesn't cover the
  entry list, so it still verifies).
- `session.decryptForPreview(msg, channelId, selfId, { dmPeer })` decrypts
  through every cache (in flight / memory / encrypted IndexedDB) and verifies
  the sender device signature exactly like the chat. For a 1:1 DM, `dmPeer`
  makes the channel prove it is exactly us + that person (as when it is
  opened); rows claiming another channel are refused.
  `lib/e2ee/client/previews.ts` wraps it (lazy import of the crypto module,
  4 s cap so an alert never waits on a slow key fetch) and formats one line
  with `previewText.ts`: mentions as names (yourself, the author, else
  `@user`), spoilers replaced by a "Spoiler" label, files / stickers
  labelled when there is no text.
- `UnreadContext` (in-app toasts, desktop notifications, the Qt shell, which
  uses the browser Notification API): badges and unread state update
  synchronously as before; only the alert waits for the decryption. "Show
  message preview" off (or Streamer Mode) → "New message" with no decryption
  at all; a failure to decrypt / verify → "New encrypted message". Blocked
  authors never alert (unchanged).
- Mobile DM list (`MobileMessagesView`; the desktop DM sidebar shows no
  previews): rows render at once with "Encrypted message", then the newest
  rows are decrypted six at a time and replaced; decrypted lines are kept in
  memory so a list refresh doesn't flash the placeholder. Last messages by
  blocked users are not decrypted. Streamer Mode still hides previews.
- **Mentions.** The server can't see mentions inside encrypted text, so it
  records none for encrypted messages (no Inbox entry, no server-side mention
  count). Every DM / group DM message already counts towards the red DM
  badge (DMs are "mentions" in the unread engine), so badges are unchanged.
  After decrypting, the device runs `mentionsUser(text, selfId)`: the open
  chat highlights the mention (`mentionedUserIds`, stage 1) and the
  notification is raised as a mention (it passes Focus mode like any direct
  mention). Limits: no Inbox entry; no "mentions only" filtering for group
  DMs (DMs always notify per their level); legacy push devices don't know.
- Reply quotes and jump-to previews of encrypted messages come from stage 1's
  `view.ts` (our own decryption of the quoted message, else the sender's
  snippet labelled "quoted by the sender"): reviewed, unchanged.

### Notification keys (Android push previews)

A per-install **notification key** lets a closed app show the real text.

- **Created** by the WebView once E2EE is `ready` on an APK whose
  `getCapabilities().pushProtocol >= 3`: an extractable ECDH P-256 pair. The
  PKCS#8 private key goes to native code once
  (`SerikaNative.setNotificationKey`), which stores it AES-256-GCM encrypted
  under a non-exportable Android Keystore key (AAD = key id; usable while the
  phone is locked, since pushes arrive then); the JS copy is zeroed and
  dropped. The id is device-shaped (16 random bytes, base64url), so it is
  just one more v1 wrap recipient that every other client ignores.
- **Authenticated by the owning device:**
  `sig = ECDSA(deviceSignKey, frame("serika-e2ee-notify-v1", userId, deviceId, notifyId, ecdhPub))`
  (`POST /api/e2ee/notify-keys`; the server checks it against the device's
  stored signing key). Senders verify it again and only wrap to a
  notification key whose owning device is one of that user's verified,
  active devices they already encrypt to (`selectNotifyRecipients`). So the
  server can't add one, a device certificate can't pass as one (different
  label), and a notification key never signs, so it can never pass as a
  sender. One active key per device (a new one revokes the old); ids never
  collide with device ids. (The stage 1 hand-off suggested an
  identity-key signature; signing with the device key ties the key's
  lifetime to its device: revoking the device drops it everywhere.)
- **Listed** in key bundles as `notifyKeys: [{ id, deviceId, ecdhPub, sig }]`
  (only keys of active devices). They enter `canonicalKeySet` only when a
  bundle has any, so existing key-set versions stay the same; registering a
  key bumps the version of that user's conversations (senders with a cached
  set retry once after a 409, as for a new device) and fans out `e2ee_keys`.
- **Wrapped to** by senders (own other phones included) after all device and
  backup entries, and only while the envelope stays within the
  128-recipient limit (`capRecipients`: readers first, notification keys are
  optional).
- **Linked to the push token**: `push_devices.e2ee_notify_id`, set by
  `POST /api/e2ee/notify-keys { pushToken }` or by the push registration
  (`POST /api/users/@me/push-devices { notifyKeyId }`, only the caller's own
  active key). A token that moves to another account loses the link.
- **Revoked** on sign-out (`DELETE /api/e2ee/notify-keys/:id` + native
  `clearNotificationKey`, which also drops the trusted-sender list), when its
  device is revoked, and on "Reset encryption" (all of the account's); the
  phone is unlinked. A device that ends up `needs-restore` clears its native
  key. A new device (re-setup) makes a new key.

### Push flow (protocol 3)

Push protocols (`push_devices.platform`): `android` / `ios` = 1
(system-rendered), `android-2` = rich data-only, `android-3` = rich +
encrypted previews. For an encrypted DM / group message the server builds,
per device:

- protocol 1 / 2: unchanged ("New encrypted message", no picture, no reply);
- protocol 3: `enc: "1"`, and, when the phone is linked to a notification key
  that has an entry in the envelope, `e2ee` = the JSON of
  `{ v: 1, sd, epk, iv, ct, cm, sig, k: { r, iv, k } }`: that one wrap entry
  and the fields needed to open and verify it (`notifyPushBlock`). It must
  fit the 3600-byte data budget: the inline picture, group icon and avatar
  are dropped first to make room; if it still doesn't fit (payload JSON over
  roughly 1.5 KB: long texts, several attachments) it is left out and the
  phone shows "New encrypted message". There is no separate short-preview
  ciphertext: it would need a new envelope field, which v1 clients reject.
  Never plaintext.

The app (`EncryptedPushPreview` → `E2eeNotifyCrypto`) shows text only when
all of these pass, otherwise its own translated "New encrypted message":

1. `k.r` is its stored notification key id;
2. the sender device `sd` is in the **trusted-sender list** for the push's
   `authorId` (user id → device id → signing key) that the WebView syncs
   (`setTrustedSigners`): every key bundle the client processes replaces
   that user's entry (devices vouched for by a pinned identity key, not
   revoked; for a contact whose new key isn't accepted yet only devices of
   keys already accepted), and once per session the list is replaced with
   everything derivable from the key sets cached on the device. That stale
   copy is read-only (it never changes pins: only already accepted identity
   keys count, a pending key change is left alone), never overrides a user
   refreshed from the server this session, and never brings back a device
   this session has seen revoked. Setting or replacing the native key
   re-sends the whole list;
3. the ECDSA signature over `frame("serika-e2ee-sig-v1", channel, sd, iv, ct, cm, epk)`
   verifies under that key (P1363 converted to DER for JCA); `epk` must be a
   point on P-256;
4. ECDH + HKDF-SHA-256 + AES-GCM unwrap K, `SHA-256(K ‖ ct) = cm`, and `ct`
   decrypts with `aad = frame("serika-e2ee-msg-v1", channel, author, sd)`
   (channel and author come from the push data, so a server that lies about
   either makes decryption fail);
5. the payload is v1, has no `mid` (edits are never shown) and its sender
   time `ts` is at most 3 days old (and at most a day ahead).

Reply stays disabled for encrypted conversations (a native reply would go
out unencrypted); tapping opens the conversation; Mark as read works as
before. The text is shown with `VISIBILITY_PRIVATE` (hidden on a secure lock
screen when the user hides sensitive content).

**Test vectors**: `docs/architecture/e2ee-notify-vectors.json`, made by
`bun scripts/e2ee-notify-vectors.ts --write` with the real web code: the key
pair (PKCS#8), the exact FCM `e2ee` string, and the intermediate ECDH
secret, wrap key, message key, both AADs, the signed bytes and the payload.
Checked by `tests/e2ee-notify.test.ts` (TypeScript) and
`mobile/android/app/src/test/java/dev/serika/serikacord/E2eeNotifyCryptoTest.java`
(JVM unit test, `./gradlew test`; it also checks that every tampered field
is refused). On a device: install a protocol 3 APK, sign in, open the app
once (key + trusted senders sync), put it in the background and have a
contact send an encrypted DM.

### Threat model of previews

- The server learns nothing new (envelopes, who talks to whom, timing). A
  push carries only the receiving phone's wrap entry; FCM / Google see
  ciphertext plus the metadata they saw before (names, avatars, ids).
- A malicious server can withhold the `e2ee` block (generic text), replay an
  old message's push (shown again while under 3 days old; the web chat has
  the same replay limit), or show it under a wrong display name / title
  (names were always server data; what is verified is "device `sd` of user
  `authorId` wrote this in channel `channelId`"). Pointing a push at another
  conversation makes decryption fail. It can't make the phone show text a
  trusted sender device didn't sign for that conversation.
- The notification key opens only messages wrapped to it (since it was
  registered). It sits under a Keystore key, so a copy of the app's files
  alone doesn't open it; whoever controls the unlocked phone can read the
  notifications anyway.
- The trusted-sender list is public data. Changing it needs control of the
  app's storage or of the page's JS (which could use the device keys
  anyway); it only affects previews, never what the chat shows.
- **Encrypted conversations on the phone.** The WebView also syncs
  (`setEncryptedConversations`, merge-only, cleared on sign-out) which
  conversations it knows are encrypted and what each is: a 1:1 DM with
  person X once its channel proved to be exactly us + X (opened, previewed
  in the DM list, or sent to), a group once its page (URL) decrypted it or
  from the device's "seen encrypted" memory. For those channels, and for any
  push marked `enc` / carrying `e2ee`, the app never shows the server's
  `body` (decrypted text or "New encrypted message" only), never offers
  Reply (whatever `canReply` says), takes the kind and the tap route from the
  synced entry (a signed group message can't be shown as a 1:1 DM), and for
  a 1:1 DM only shows text whose sender is the synced person. A push whose
  `tag` names another channel than its `channelId` is dropped. Encrypted
  @mentions found after decrypting count as mentions (Mentions channel for
  group DMs). A conversation the WebView never checked on this phone is
  only protected if the push says it is encrypted.
- **Lock screen.** Encrypted conversations' notifications carry a public
  version ("New encrypted message", app name, no sender), shown on a secure
  lock screen whatever the device's sensitive-content setting.
- **Preview setting.** When the recipient turned message previews off
  (Settings → Notifications, `settings.notifications.showPreview = false`,
  stored on the server), their phones get no `e2ee` block (just
  "New encrypted message"). Streamer Mode is a per-browser setting the
  server doesn't know: it hides previews in that browser only.
- **Bridge origin.** The WebView may also show `accounts.serika.dev` (sign-in),
  which gets the Capacitor bridge too: the notification-key, trusted-sender
  and conversation methods refuse unless the page is `https://serika.chat`
  or `https://canary.serika.chat` (plus localhost / emulator hosts in debug
  builds). The app loads its code from serika.chat, so the web limit applies
  to Android as well: a malicious server shipping JS could call these
  methods (as it could use the device keys).
- **Backups.** The APK disables Auto Backup, `adb backup` and device-to-device
  transfer (`allowBackup="false"` plus backup / data-extraction rules that
  exclude everything): the WebView's IndexedDB holds the E2EE keys and
  `shared_prefs` the notification key's ciphertext and the lists. If a
  notification key's Keystore key is ever missing (e.g. a restore by other
  means), `getNotificationKey` reports none and the web app makes a new one.
- **Account switch** runs the sign-out cleanup first (push token and
  notification key dropped while the old session is still valid).

### Desktop / browser push when the app is closed

Not built. The web app has a service worker (`public/sw.js`: caching and
local notifications) but no Web Push (no `PushManager` subscription, VAPID
keys or `push` handler), so a closed browser gets no push at all. Follow-up:
subscribe browsers to Web Push, register a per-browser notification key the
same way (signed by the device, wrapped like the Android one) and decrypt in
the service worker with a non-extractable key from IndexedDB, checking
signatures against the pins the page keeps there.

## Rollout: `E2EE_ENABLED`, `E2EE_PIN_PEPPER`

`E2EE_PIN_PEPPER` (32+ random bytes, base64, e.g. `openssl rand -base64 32`)
enables PIN backups. Set the **same value on canary and production** (they
share the database) and **never change it once set**: every stored PIN
backup becomes unusable (users fall back to their devices / passphrase and
have to create a new PIN). Missing / too short → PIN routes 503, apps use
the passphrase / linking as before. The new tables are created at boot; the
off / PIN routes are new, so older production code ignores them (a
"turned off" row shows there as an empty system row until the release;
older clients that remember such a conversation encrypted keep sending
envelopes, which the server refuses).


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
- Link escrow: for up to 10 minutes after the passphrase was proven on a
  device (or it was linked), script running in the SerikaCord origin can
  obtain the identity / backup private keys (otherwise it can only *use*
  them), and so can someone holding the browser profile on disk. A malicious
  server shipping script could already capture the passphrase, so this
  changes nothing against the server; it briefly widens what an XSS bug
  could take. Expiry is enforced by the client (a deleted record is gone;
  a copy of the profile taken inside the window keeps it).
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
- Push previews: a push from a sender device this phone hasn't been told to
  trust yet (a contact whose keys this device hasn't loaded since signing
  in) shows "New encrypted message"; so do long messages (FCM's 4 KB).
  Pushes under 3 days old can be replayed. Encrypted mentions never reach
  the Inbox. Closed browsers get no push (no Web Push yet).
- Notification-key revocation is enforced by the server only (there is no
  signed revocation): a server could keep listing a revoked key, which only
  lets that phone (whose key it is) read previews. Group names in push
  titles are server data (only 1:1 DMs bind the sender).
- Google (FCM) sees, per push, the ciphertext length (≈ message length) and
  the sender device id, besides the names / ids it saw before.
- **PIN backup**: whoever runs the server *with* `E2EE_PIN_PEPPER` (or
  obtains database + pepper) can brute-force a 6-digit PIN offline
  (10^6 × PBKDF2) or log verifiers, and so read everything wrapped to the
  backup key. That's the price of a 6-digit PIN; the strongest setup is a
  long recovery passphrase with the PIN removed (Settings says so). Future:
  distributed guess-limiting (Juicebox / SVR). A stolen session can burn the
  10 attempts and destroy the PIN backup (the user is told). Easy-PIN rules
  and the "required PIN" are enforced by clients only. A device whose keys
  are sealed (non-extractable) can't create a PIN without the current PIN /
  passphrase (or escrow): forgetting both there means a reset. The
  "account password instead of a forgotten passphrase" step is a client-side
  gate (the device already holds the keys; the server can't tell), and
  passkey-only accounts can't use it (same as "Reset encryption").
- **Turning encryption off**: a record a device never saw before can be
  replayed by the server only if it is at most ~11 minutes (10-minute
  clock-skew allowance + the 1-minute `seenEncryptedAt` write interval)
  older than the last time that device saw the conversation encrypted;
  records a device already saw superseded are never accepted again. A live
  "turned off" event whose record doesn't verify leaves the open chat
  encrypted without a warning until the next page load shows the server's
  unverifiable claim. Devices that never saw a
  conversation encrypted have nothing to protect (as before). The Android
  app learns that a conversation was turned off only once the web app on
  that phone verified it (opened or received the live event); until then
  its pushes say "New encrypted message". The "turned off" notice's author
  and time are server data (what's verified is the signed record).
