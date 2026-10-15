import { describe, expect, test } from "bun:test";
import {
  CONVERSATION_STATE_MAX_SKEW_MS,
  E2eeFormatError,
  E2eeVerifyError,
  PIN_MAX_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  checkOffRecord,
  derivePinKeys,
  dmPair,
  exportPrivateJwk,
  exportPublicKey,
  fromB64,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  isEasyPin,
  isPlainAllowedAt,
  isUnverifiablePlaintextRowIn,
  isValidPin,
  mergeTimelines,
  noticeTimeMatches,
  openPinBundle,
  parseConversationState,
  pinAttemptsLeft,
  pinSecretCheck,
  sealPinBundle,
  signConversationOff,
  signPinCommit,
  signRecoveryRemoval,
  timelineOf,
  toB64,
  validateConversationState,
  verifyConversationStateSig,
  verifyPinCommit,
  verifyRecoveryRemoval,
} from "@/lib/e2ee";
import { randomBytes } from "@/lib/e2ee/encoding";
import {
  newPinSecret,
  openPinSecret,
  parsePinPepper,
  pinAttemptOutcome,
  pinVaultKeys,
  pinVerifierHash,
  pinVerifierMatches,
  sealPinSecret,
} from "@/lib/e2ee/pinVault";
import { e2eeNoticeKind, e2eeOffNotice, offNoticeRecord, storedEnvelope } from "@/lib/e2ee/policy";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";
const OTHER_CHANNEL = "44444444-4444-4444-8444-444444444444";

async function identityWithSecrets() {
  const id = await generateIdentityKeyPair(true);
  const bk = await generateBackupKeyPair(true);
  return {
    identityPriv: id.privateKey,
    identityPub: await exportPublicKey(id.publicKey),
    secrets: { identity: await exportPrivateJwk(id.privateKey), backup: await exportPrivateJwk(bk.privateKey) },
  };
}

describe("PIN rules", () => {
  test("only six digits are a PIN", () => {
    expect(isValidPin("482913")).toBe(true);
    expect(isValidPin("48291")).toBe(false);
    expect(isValidPin("4829134")).toBe(false);
    expect(isValidPin("48291a")).toBe(false);
    expect(isValidPin("４８２９１３")).toBe(false); // full-width digits
    expect(isValidPin(482913)).toBe(false);
  });

  test("easy PINs are refused", () => {
    for (const pin of ["000000", "999999", "123456", "654321", "345678", "121212", "123123", "112233", "123321", "159753"]) {
      expect(isEasyPin(pin)).toBe(true);
    }
    for (const pin of ["482913", "730519", "205847"]) expect(isEasyPin(pin)).toBe(false);
  });

  test("attempts left never go negative", () => {
    expect(pinAttemptsLeft(0)).toBe(PIN_MAX_ATTEMPTS);
    expect(pinAttemptsLeft(7)).toBe(3);
    expect(pinAttemptsLeft(50)).toBe(0);
  });
});

describe("PIN key derivation", () => {
  test("verifier and wrap key are deterministic, separate, and bound to PIN, user and salt", async () => {
    const salt = randomBytes(16);
    const a = await derivePinKeys("482913", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    const again = await derivePinKeys("482913", ALICE.toUpperCase(), salt, PIN_PBKDF2_ITERATIONS);
    expect(a.verifier.byteLength).toBe(32);
    expect(a.wrap.byteLength).toBe(32);
    expect(toB64(a.verifier)).toBe(toB64(again.verifier));
    expect(toB64(a.wrap)).toBe(toB64(again.wrap));
    expect(toB64(a.verifier)).not.toBe(toB64(a.wrap));
    const otherPin = await derivePinKeys("482914", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    const otherUser = await derivePinKeys("482913", BOB, salt, PIN_PBKDF2_ITERATIONS);
    const otherSalt = await derivePinKeys("482913", ALICE, randomBytes(16), PIN_PBKDF2_ITERATIONS);
    for (const other of [otherPin, otherUser, otherSalt]) {
      expect(toB64(other.verifier)).not.toBe(toB64(a.verifier));
      expect(toB64(other.wrap)).not.toBe(toB64(a.wrap));
    }
  });

  test("refuses weak parameters and bad PINs", async () => {
    const salt = randomBytes(16);
    await expect(derivePinKeys("48291", ALICE, salt, PIN_PBKDF2_ITERATIONS)).rejects.toBeInstanceOf(E2eeFormatError);
    await expect(derivePinKeys("482913", ALICE, salt, 1000)).rejects.toBeInstanceOf(E2eeFormatError);
    await expect(derivePinKeys("482913", ALICE, randomBytes(8), PIN_PBKDF2_ITERATIONS)).rejects.toBeInstanceOf(E2eeFormatError);
    await expect(derivePinKeys("482913", "not-a-user", salt, PIN_PBKDF2_ITERATIONS)).rejects.toBeInstanceOf(E2eeFormatError);
  });
});

describe("PIN bundle", () => {
  test("seals and opens with the right PIN keys and server secret only", async () => {
    const { identityPub, secrets } = await identityWithSecrets();
    const salt = randomBytes(16);
    const keys = await derivePinKeys("730519", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    const secret = newPinSecret();
    const bundle = await sealPinBundle(keys, secret, ALICE, identityPub, secrets);
    const opened = await openPinBundle(keys, secret, ALICE, identityPub, bundle);
    expect(opened.identity.d).toBe(secrets.identity.d!);
    expect(opened.backup.d).toBe(secrets.backup.d!);

    // Wrong PIN, wrong server secret, wrong user, wrong identity (AAD).
    const wrongPin = await derivePinKeys("730518", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    await expect(openPinBundle(wrongPin, secret, ALICE, identityPub, bundle)).rejects.toBeInstanceOf(E2eeVerifyError);
    await expect(openPinBundle(keys, newPinSecret(), ALICE, identityPub, bundle)).rejects.toBeInstanceOf(E2eeVerifyError);
    await expect(openPinBundle(keys, secret, BOB, identityPub, bundle)).rejects.toBeInstanceOf(E2eeVerifyError);
    const other = await identityWithSecrets();
    await expect(openPinBundle(keys, secret, ALICE, other.identityPub, bundle)).rejects.toBeInstanceOf(E2eeVerifyError);

    // Tampered ciphertext.
    const raw = fromB64(bundle);
    raw[raw.length - 1] ^= 1;
    await expect(openPinBundle(keys, secret, ALICE, identityPub, toB64(raw))).rejects.toBeInstanceOf(E2eeVerifyError);
  });

  test("refuses to seal keys of another identity", async () => {
    const a = await identityWithSecrets();
    const b = await identityWithSecrets();
    const keys = await derivePinKeys("730519", ALICE, randomBytes(16), PIN_PBKDF2_ITERATIONS);
    await expect(sealPinBundle(keys, newPinSecret(), ALICE, b.identityPub, a.secrets)).rejects.toBeInstanceOf(E2eeFormatError);
  });

  test("commit and removal signatures are bound to the identity, user and contents", async () => {
    const { identityPriv, identityPub, secrets } = await identityWithSecrets();
    const salt = randomBytes(16);
    const keys = await derivePinKeys("730519", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    const secret = newPinSecret();
    const commit = {
      identityPub,
      salt: toB64(salt),
      iterations: PIN_PBKDF2_ITERATIONS,
      bundle: await sealPinBundle(keys, secret, ALICE, identityPub, secrets),
      secretCheck: await pinSecretCheck(secret),
    };
    const sig = await signPinCommit(identityPriv, ALICE, commit);
    expect(await verifyPinCommit(identityPub, ALICE, commit, sig)).toBe(true);
    expect(await verifyPinCommit(identityPub, BOB, commit, sig)).toBe(false);
    expect(await verifyPinCommit(identityPub, ALICE, { ...commit, iterations: PIN_PBKDF2_ITERATIONS + 1 }, sig)).toBe(false);
    expect(await verifyPinCommit(identityPub, ALICE, { ...commit, secretCheck: await pinSecretCheck(newPinSecret()) }, sig)).toBe(false);
    const other = await identityWithSecrets();
    expect(await verifyPinCommit(other.identityPub, ALICE, commit, sig)).toBe(false);

    const now = Date.now();
    const removal = await signRecoveryRemoval(identityPriv, ALICE, identityPub, "pin", now);
    expect(await verifyRecoveryRemoval(identityPub, ALICE, "pin", now, removal, now)).toBe(true);
    expect(await verifyRecoveryRemoval(identityPub, ALICE, "passphrase", now, removal, now)).toBe(false);
    // Too old to replay.
    expect(await verifyRecoveryRemoval(identityPub, ALICE, "pin", now, removal, now + 11 * 60_000)).toBe(false);
  });
});

describe("PIN vault (server, pepper)", () => {
  const pepper = parsePinPepper(toB64(randomBytes(32)))!;

  test("pepper must be 32+ bytes of base64", () => {
    expect(parsePinPepper(undefined)).toBeNull();
    expect(parsePinPepper("short")).toBeNull();
    expect(parsePinPepper(toB64(randomBytes(16)))).toBeNull();
    expect(parsePinPepper(toB64(randomBytes(48)))?.byteLength).toBe(48);
    // url-safe without padding works too
    expect(parsePinPepper(toB64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))?.byteLength).toBe(32);
  });

  test("verifier hash: right verifier matches, wrong one / other user / other pepper don't", async () => {
    const keys = await pinVaultKeys(pepper);
    const verifier = toB64(randomBytes(32));
    const stored = await pinVerifierHash(keys, ALICE, verifier);
    expect(stored).not.toBe(verifier);
    expect(await pinVerifierMatches(keys, ALICE, verifier, stored)).toBe(true);
    expect(await pinVerifierMatches(keys, ALICE, toB64(randomBytes(32)), stored)).toBe(false);
    expect(await pinVerifierMatches(keys, BOB, verifier, stored)).toBe(false);
    const otherKeys = await pinVaultKeys(parsePinPepper(toB64(randomBytes(32)))!);
    expect(await pinVerifierMatches(otherKeys, ALICE, verifier, stored)).toBe(false);
    expect(await pinVerifierMatches(keys, ALICE, "not base64!", stored)).toBe(false);
    expect(await pinVerifierMatches(keys, ALICE, verifier, null)).toBe(false);
  });

  test("server secret is sealed under the pepper and bound to the user", async () => {
    const keys = await pinVaultKeys(pepper);
    const secret = newPinSecret();
    const sealed = await sealPinSecret(keys, ALICE, secret);
    expect(toB64((await openPinSecret(keys, ALICE, sealed))!)).toBe(toB64(secret));
    expect(await openPinSecret(keys, BOB, sealed)).toBeNull();
    const otherKeys = await pinVaultKeys(parsePinPepper(toB64(randomBytes(32)))!);
    expect(await openPinSecret(otherKeys, ALICE, sealed)).toBeNull();
    expect(await openPinSecret(keys, ALICE, null)).toBeNull();
  });

  test("lockout: the 10th wrong attempt wipes, a right one resets", () => {
    for (let n = 1; n < PIN_MAX_ATTEMPTS; n++) {
      expect(pinAttemptOutcome(n, false)).toEqual({ result: "wrong", attemptsLeft: PIN_MAX_ATTEMPTS - n });
    }
    expect(pinAttemptOutcome(PIN_MAX_ATTEMPTS, false)).toEqual({ result: "wiped", attemptsLeft: 0 });
    expect(pinAttemptOutcome(PIN_MAX_ATTEMPTS + 3, false).result).toBe("wiped");
    expect(pinAttemptOutcome(PIN_MAX_ATTEMPTS, true)).toEqual({ result: "ok", attemptsLeft: PIN_MAX_ATTEMPTS });
  });

  test("end to end: a database copy without the pepper can't check guesses", async () => {
    const { identityPub, secrets } = await identityWithSecrets();
    const vault = await pinVaultKeys(pepper);
    const salt = randomBytes(16);
    const keys = await derivePinKeys("205847", ALICE, salt, PIN_PBKDF2_ITERATIONS);
    const secret = newPinSecret();
    const row = {
      verifierHash: await pinVerifierHash(vault, ALICE, toB64(keys.verifier)),
      secretEnc: await sealPinSecret(vault, ALICE, secret),
      bundle: await sealPinBundle(keys, secret, ALICE, identityPub, secrets),
    };
    // Unlock: the server checks the verifier, opens S, the client opens the bundle.
    expect(await pinVerifierMatches(vault, ALICE, toB64(keys.verifier), row.verifierHash)).toBe(true);
    const s = (await openPinSecret(vault, ALICE, row.secretEnc))!;
    expect((await openPinBundle(keys, s, ALICE, identityPub, row.bundle)).identity.d).toBe(secrets.identity.d!);
    // The stored hash is not the verifier, and the bundle can't open without S.
    expect(row.verifierHash).not.toBe(toB64(keys.verifier));
    await expect(openPinBundle(keys, randomBytes(32), ALICE, identityPub, row.bundle)).rejects.toBeInstanceOf(E2eeVerifyError);
  });
});

describe("Turning encryption off (signed record)", () => {
  test("record signature, shape and binding", async () => {
    const device = await generateDeviceKeys(true);
    const signPub = await exportPublicKey(device.sign.publicKey);
    const record = await signConversationOff(device.sign.privateKey, { channelId: CHANNEL.toUpperCase(), kind: "group_dm", userId: ALICE, deviceId: device.id });
    expect(record.channelId).toBe(CHANNEL);
    expect(validateConversationState(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(await verifyConversationStateSig(signPub, record)).toBe(true);
    // Moving it to another conversation / user / time breaks it.
    expect(await verifyConversationStateSig(signPub, { ...record, channelId: OTHER_CHANNEL })).toBe(false);
    expect(await verifyConversationStateSig(signPub, { ...record, userId: BOB })).toBe(false);
    expect(await verifyConversationStateSig(signPub, { ...record, ts: record.ts + 1 })).toBe(false);
    const other = await generateDeviceKeys(true);
    expect(await verifyConversationStateSig(await exportPublicKey(other.sign.publicKey), record)).toBe(false);
    // Unknown fields / states are refused.
    expect(parseConversationState({ ...record, extra: 1 })).toBeNull();
    expect(parseConversationState({ ...record, state: "on" })).toBeNull();
    expect(parseConversationState({ ...record, sig: "AAAA" })).toBeNull();
    // A group's record can't pass as a 1:1 DM's (kind and the two people are signed).
    expect(await verifyConversationStateSig(signPub, { ...record, kind: "dm", members: dmPair(ALICE, BOB) })).toBe(false);
    expect(parseConversationState({ ...record, members: dmPair(ALICE, BOB) })).toBeNull();
  });

  test("1:1 DM records are bound to the two people", async () => {
    const device = await generateDeviceKeys(true);
    const signPub = await exportPublicKey(device.sign.publicKey);
    const record = await signConversationOff(device.sign.privateKey, { channelId: CHANNEL, kind: "dm", members: [BOB, ALICE], userId: ALICE, deviceId: device.id });
    expect(record.members).toEqual(dmPair(ALICE, BOB));
    expect(validateConversationState(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(await verifyConversationStateSig(signPub, record)).toBe(true);
    const CAROL = "55555555-5555-4555-8555-555555555555";
    expect(await verifyConversationStateSig(signPub, { ...record, members: dmPair(ALICE, CAROL) })).toBe(false);
    expect(await verifyConversationStateSig(signPub, { ...record, kind: "group_dm", members: undefined })).toBe(false);
    // The signer must be one of the two, and the pair must be sorted.
    expect(parseConversationState({ ...record, members: dmPair(BOB, CAROL) })).toBeNull();
    expect(parseConversationState({ ...record, members: [record.members![1], record.members![0]] })).toBeNull();
    await expect(signConversationOff(device.sign.privateKey, { channelId: CHANNEL, kind: "dm", members: [BOB, CAROL], userId: ALICE, deviceId: device.id })).rejects.toBeInstanceOf(E2eeFormatError);
    const base = {
      record,
      channelId: CHANNEL,
      expected: { kind: "dm" as const, members: [ALICE, BOB] as [string, string] },
      memberIds: [ALICE, BOB],
      signer: { trusted: true, revokedAt: null },
      signatureValid: true,
      now: record.ts,
      seenEncryptedAt: null,
    };
    expect(checkOffRecord(base)).toEqual({ ok: true });
    expect(checkOffRecord({ ...base, expected: { kind: "dm", members: [ALICE, CAROL] } })).toEqual({ ok: false, reason: "wrong_conversation" });
    expect(checkOffRecord({ ...base, expected: { kind: "group_dm" } })).toEqual({ ok: false, reason: "wrong_conversation" });
  });

  test("off notices carry the record; they are never envelopes", async () => {
    const device = await generateDeviceKeys(true);
    const record = await signConversationOff(device.sign.privateKey, { channelId: CHANNEL, kind: "group_dm", userId: ALICE, deviceId: device.id });
    const notice = e2eeOffNotice(record);
    expect(e2eeNoticeKind(notice)).toBe("disabled");
    expect(e2eeNoticeKind({ v: 1, notice: "enabled" })).toBe("enabled");
    expect(e2eeNoticeKind({ v: 1 })).toBeNull();
    expect(storedEnvelope(notice)).toBeNull();
    expect(offNoticeRecord(JSON.parse(JSON.stringify(notice)))).toEqual(record);
    expect(offNoticeRecord({ v: 1, notice: "disabled", record: { ...record, sig: "x" } })).toBeNull();
  });

  test("downgrade rules", async () => {
    const device = await generateDeviceKeys(true);
    const now = Date.now();
    const record = await signConversationOff(device.sign.privateKey, { channelId: CHANNEL, kind: "group_dm", userId: BOB, deviceId: device.id, ts: now });
    const base = {
      record,
      channelId: CHANNEL,
      expected: { kind: "group_dm" as const },
      memberIds: [ALICE, BOB],
      signer: { trusted: true, revokedAt: null },
      signatureValid: true,
      now,
      seenEncryptedAt: now - 60_000,
    };
    expect(checkOffRecord(base)).toEqual({ ok: true });
    expect(checkOffRecord({ ...base, record: null })).toEqual({ ok: false, reason: "malformed" });
    expect(checkOffRecord({ ...base, channelId: OTHER_CHANNEL })).toEqual({ ok: false, reason: "wrong_conversation" });
    expect(checkOffRecord({ ...base, memberIds: [ALICE] })).toEqual({ ok: false, reason: "not_member" });
    expect(checkOffRecord({ ...base, signer: null })).toEqual({ ok: false, reason: "unknown_device" });
    expect(checkOffRecord({ ...base, signer: { trusted: false, revokedAt: null } })).toEqual({ ok: false, reason: "unknown_device" });
    expect(checkOffRecord({ ...base, signer: { trusted: true, revokedAt: now - 3_600_000 } })).toEqual({ ok: false, reason: "revoked_device" });
    expect(checkOffRecord({ ...base, signatureValid: false })).toEqual({ ok: false, reason: "signature" });
    expect(checkOffRecord({ ...base, now: now - CONVERSATION_STATE_MAX_SKEW_MS - 1 })).toEqual({ ok: false, reason: "future" });
    // A replayed record from before this device last saw the conversation encrypted.
    expect(checkOffRecord({ ...base, seenEncryptedAt: now + CONVERSATION_STATE_MAX_SKEW_MS + 1 })).toEqual({ ok: false, reason: "stale" });
    // Within the clock-skew allowance it's accepted.
    expect(checkOffRecord({ ...base, seenEncryptedAt: now + 60_000 })).toEqual({ ok: true });
    // Never older than an off record already accepted.
    expect(checkOffRecord({ ...base, acceptedOffTs: now + 1 })).toEqual({ ok: false, reason: "stale" });
    // Never seen encrypted: accepted (nothing to downgrade from).
    expect(checkOffRecord({ ...base, seenEncryptedAt: null })).toEqual({ ok: true });
    // The same record again after the conversation was turned back on: never (whatever the clocks say).
    expect(checkOffRecord({ ...base, seenEncryptedAt: null, consumedOffTs: now })).toEqual({ ok: false, reason: "stale" });
    expect(checkOffRecord({ ...base, consumedOffTs: now - 1 })).toEqual({ ok: true });
  });

  test("plaintext timeline: legit only while a verified off was the latest switch", () => {
    const t = (iso: string) => new Date(iso).getTime();
    const on1 = t("2026-10-01T00:00:00Z");
    const off1 = t("2026-10-05T00:00:00Z");
    const on2 = t("2026-10-08T00:00:00Z");
    const timeline = { on: [on1, on2], off: [off1] };
    expect(isPlainAllowedAt(t("2026-09-30T00:00:00Z"), timeline)).toBe(true); // plain era before the first "on"
    expect(isPlainAllowedAt(t("2026-10-02T00:00:00Z"), timeline)).toBe(false); // encrypted
    expect(isPlainAllowedAt(t("2026-10-06T00:00:00Z"), timeline)).toBe(true); // turned off (verified)
    expect(isPlainAllowedAt(t("2026-10-09T00:00:00Z"), timeline)).toBe(false); // on again
    expect(isPlainAllowedAt(null, timeline)).toBe(false);
    // Created encrypted (no "on" notice), turned off and on again: before the off is encrypted.
    const created = { on: [on2], off: [off1] };
    expect(isPlainAllowedAt(t("2026-10-02T00:00:00Z"), created)).toBe(false);
    expect(isPlainAllowedAt(t("2026-10-06T00:00:00Z"), created)).toBe(true);
    // Nothing known: nothing plain is legit.
    expect(isPlainAllowedAt(t("2026-10-06T00:00:00Z"), { on: [], off: [] })).toBe(false);

    const rows = [
      { id: "a", type: "e2ee_enabled", createdAt: "2026-10-01T00:00:00Z" },
      { id: "b", type: "e2ee_disabled", createdAt: "2026-10-05T00:00:00Z" },
      { id: "c", type: "e2ee_disabled", createdAt: "2026-10-06T00:00:00Z" },
      { id: "d", type: "e2ee_enabled", createdAt: "2026-10-08T00:00:00Z" },
    ];
    // Only verified "off" notices count (c is not), at the time their signed record gives.
    const fromRows = timelineOf(rows, (r) => (r.id === "b" ? off1 : null));
    expect(fromRows).toEqual({ on: [on1, on2], off: [off1] });
    expect(timelineOf(rows, (r) => (r.id === "b" ? off1 + 5 : null)).off).toEqual([off1 + 5]);
    // A notice whose server time is far from its signed time is ignored.
    expect(noticeTimeMatches(off1 + 60_000, { ts: off1 })).toBe(true);
    expect(noticeTimeMatches(off1 + CONVERSATION_STATE_MAX_SKEW_MS + 1, { ts: off1 })).toBe(false);
    expect(noticeTimeMatches(null, { ts: off1 })).toBe(false);
    expect(mergeTimelines(fromRows, { on: [on1], off: [] })).toEqual(fromRows);
    expect(isUnverifiablePlaintextRowIn({ type: "default", createdAt: "2026-10-06T00:00:00Z" }, fromRows)).toBe(false);
    expect(isUnverifiablePlaintextRowIn({ type: "default", createdAt: "2026-10-09T00:00:00Z" }, fromRows)).toBe(true);
    expect(isUnverifiablePlaintextRowIn({ type: "e2ee_disabled", createdAt: "2026-10-09T00:00:00Z" }, fromRows)).toBe(false);
    expect(isUnverifiablePlaintextRowIn({ type: "default", e2ee: { v: 1 }, createdAt: "2026-10-09T00:00:00Z" }, fromRows)).toBe(false);
  });
});
