import { describe, expect, test } from "bun:test";
import {
  deriveFieldKey,
  isSealedField,
  isSealedJson,
  lookupCandidates,
  looksSealed,
  makeKeyring,
  openJson,
  openKeys,
  openRow,
  openSealed,
  revealField,
  rowHasSealed,
  sealField,
  sealJson,
  sealKeys,
  sealLookupField,
  sealRow,
  type FieldSpec,
} from "../src/lib/security/fieldCrypto";
import { anonymizeIp } from "../src/lib/security/ipPrivacy";
import { CONNECTION_SECRET_KEYS } from "../src/lib/connections/policy";

const platform = deriveFieldKey("p", Buffer.alloc(32, 7));
const env = deriveFieldKey("e1", "an-environment-key-that-is-long-enough-123");
const ring = makeKeyring(platform);
const rotated = makeKeyring(env, platform);

describe("sealField / revealField", () => {
  test("round-trips and is randomized", () => {
    const a = sealField(ring, "a private note ✨");
    const b = sealField(ring, "a private note ✨");
    expect(a.startsWith("enc:p:")).toBe(true);
    expect(a).not.toBe(b);
    expect(revealField(ring, a)).toBe("a private note ✨");
    expect(revealField(ring, b)).toBe("a private note ✨");
  });

  test("legacy plaintext passes through unchanged", () => {
    expect(revealField(ring, "written before encryption")).toBe("written before encryption");
    expect(revealField(ring, "")).toBe("");
    expect(revealField(ring, null)).toBe(null);
    expect(revealField(ring, undefined)).toBe(undefined);
    // Base64-looking legacy values (old tokens) are not mistaken for ciphertext.
    expect(revealField(ring, "aGVsbG8gd29ybGQ=")).toBe("aGVsbG8gd29ybGQ=");
  });

  test("text that only looks sealed is kept as typed", () => {
    const typed = "enc:p:not-really-ciphertext";
    expect(looksSealed(typed)).toBe(true);
    expect(openSealed(ring, typed)).toBe(null);
    expect(revealField(ring, typed)).toBe(typed);
    // ...and it is encrypted on write rather than stored as-is.
    const stored = sealField(ring, typed);
    expect(stored).not.toBe(typed);
    expect(revealField(ring, stored)).toBe(typed);
  });

  test("is idempotent and leaves empty strings alone", () => {
    const once = sealField(ring, "secret");
    expect(sealField(ring, once)).toBe(once);
    expect(sealField(ring, "")).toBe("");
    expect(isSealedField(ring, once)).toBe(true);
  });

  test("tampering or the wrong key fails closed to the stored value", () => {
    const sealed = sealField(ring, "secret");
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    expect(openSealed(ring, flipped)).toBe(null);
    const other = makeKeyring(deriveFieldKey("p", Buffer.alloc(32, 9)));
    expect(openSealed(other, sealed)).toBe(null);
    // Relabelling the key id or mode breaks the auth tag.
    expect(openSealed(ring, sealed.replace("enc:", "encd:"))).toBe(null);
  });

  test("a rotated keyring writes with the new key and still reads the old one", () => {
    const old = sealField(ring, "before");
    const fresh = sealField(rotated, "after");
    expect(fresh.startsWith("enc:e1:")).toBe(true);
    expect(revealField(rotated, old)).toBe("before");
    expect(revealField(rotated, fresh)).toBe("after");
    // Without the env key the new value can't be read.
    expect(openSealed(ring, fresh)).toBe(null);
  });
});

describe("lookup (deterministic) fields", () => {
  test("same input gives the same ciphertext, so equality lookups work", () => {
    const a = sealLookupField(ring, "app123.deadbeef");
    expect(a.startsWith("encd:p:")).toBe(true);
    expect(sealLookupField(ring, "app123.deadbeef")).toBe(a);
    expect(sealLookupField(ring, "app123.other")).not.toBe(a);
    expect(revealField(ring, a)).toBe("app123.deadbeef");
  });

  test("candidates cover every key plus legacy plaintext", () => {
    const candidates = lookupCandidates(rotated, "token-value");
    expect(candidates).toContain("token-value");
    expect(candidates).toContain(sealLookupField(rotated, "token-value"));
    expect(candidates).toContain(sealLookupField(ring, "token-value"));
    expect(candidates.length).toBe(3);
  });

  test("a stored ciphertext presented as the token never matches", () => {
    const stored = sealLookupField(ring, "real-token");
    expect(lookupCandidates(ring, stored)).not.toContain(stored);
  });
});

describe("JSON wrapper", () => {
  test("round-trips arrays and objects", () => {
    const answers = [{ q: "Why join?", a: "Friends" }];
    const sealed = sealJson(ring, answers);
    expect(isSealedJson(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("Friends");
    expect(openJson(ring, sealed)).toEqual(answers);
  });

  test("legacy plain JSON passes through, null stays null", () => {
    const legacy = [{ q: "x", a: "y" }];
    expect(openJson(ring, legacy)).toBe(legacy);
    expect(openJson(ring, { enc: "plain", other: 1 })).toEqual({ enc: "plain", other: 1 });
    expect(sealJson(ring, null)).toBe(null);
    expect(sealJson(ring, undefined)).toBe(undefined);
  });

  test("a wrapper that can't be decrypted yields the fallback", () => {
    expect(openJson(ring, { enc: "enc:p:AAAA" }, [])).toEqual([]);
  });

  test("is idempotent", () => {
    const sealed = sealJson(ring, { a: 1 });
    expect(sealJson(ring, sealed)).toBe(sealed);
  });
});

describe("secret keys inside an object", () => {
  test("seals only token keys and keeps flags readable", () => {
    const meta = { accessToken: "gho_abc", refreshToken: "r1", oauthVerified: true, serikaMoeId: "42" };
    const sealed = sealKeys(ring, meta, CONNECTION_SECRET_KEYS);
    expect(sealed.oauthVerified).toBe(true);
    expect(sealed.serikaMoeId).toBe("42");
    expect(String(sealed.accessToken).startsWith("enc:")).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("gho_abc");
    expect(openKeys(ring, sealed, CONNECTION_SECRET_KEYS)).toEqual(meta);
  });

  test("leaves objects without secrets (and non-objects) untouched", () => {
    const meta = { oauthVerified: true };
    expect(sealKeys(ring, meta, CONNECTION_SECRET_KEYS)).toBe(meta);
    expect(sealKeys(ring, null, CONNECTION_SECRET_KEYS)).toBe(null);
    expect(openKeys(ring, [1, 2], CONNECTION_SECRET_KEYS)).toEqual([1, 2]);
  });

  test("legacy plaintext tokens read back unchanged", () => {
    const legacy = { sessionKey: "lastfm-session", oauthVerified: true };
    expect(openKeys(ring, legacy, CONNECTION_SECRET_KEYS)).toBe(legacy);
  });
});

describe("rows", () => {
  const spec: FieldSpec = { text: ["note"], lookup: ["token"], json: ["answers"], secretKeys: { metadata: ["accessToken"] } };

  test("seals and opens every kind of column", () => {
    const row = { id: "1", note: "hi", token: "t0k", answers: ["a"], metadata: { accessToken: "x", oauthVerified: true } };
    const sealed = sealRow(ring, spec, row);
    expect(sealed.id).toBe("1");
    expect(sealed.note).not.toBe("hi");
    expect(sealed.token).toBe(sealLookupField(ring, "t0k"));
    expect(rowHasSealed(spec, sealed)).toBe(true);
    expect(openRow(ring, spec, sealed)).toEqual(row);
  });

  test("partial updates only touch the columns they carry", () => {
    const patch = { visible: false };
    expect(sealRow(ring, spec, patch)).toEqual(patch);
    const nulls = { note: null, answers: null };
    expect(sealRow(ring, spec, nulls)).toEqual(nulls);
  });

  test("legacy rows are returned as-is", () => {
    const legacy = { id: "2", note: "old", token: "plain", answers: [], metadata: { accessToken: "old" } };
    expect(rowHasSealed(spec, legacy)).toBe(false);
    expect(openRow(ring, spec, legacy)).toBe(legacy);
  });
});

describe("anonymizeIp", () => {
  test("keeps the IPv4 /24", () => {
    expect(anonymizeIp("203.0.113.77")).toBe("203.0.113.0");
    expect(anonymizeIp("203.0.113.77:51234")).toBe("203.0.113.0");
    expect(anonymizeIp("::ffff:198.51.100.9")).toBe("198.51.100.0");
  });

  test("keeps the IPv6 /48", () => {
    expect(anonymizeIp("2001:db8:abcd:12:34:56:78:9")).toBe("2001:db8:abcd::");
    expect(anonymizeIp("2001:db8::1")).toBe("2001:db8:0::");
    expect(anonymizeIp("[2001:0db8:00ab::1]:443")).toBe("2001:db8:ab::");
    expect(anonymizeIp("fe80::1%eth0")).toBe("fe80:0:0::");
  });

  test("uses the first hop of a forwarded list and drops non-IPs", () => {
    expect(anonymizeIp("198.51.100.9, 10.0.0.1")).toBe("198.51.100.0");
    expect(anonymizeIp("unknown")).toBe(null);
    expect(anonymizeIp("")).toBe(null);
    expect(anonymizeIp(undefined)).toBe(null);
  });
});
