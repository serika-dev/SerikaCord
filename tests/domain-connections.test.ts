import { describe, expect, test } from "bun:test";
import {
  createDomainToken,
  domainChallenge,
  filterUnverifiedDomains,
  isVerifiedDomainConnection,
  newDomainMetadata,
  normalizeDomain,
  ownDomainStatus,
  readDomainVerification,
  txtRecordsContainToken,
  verifiedDomainMetadata,
} from "../src/lib/connections/domain";

describe("normalizeDomain", () => {
  test("strips scheme, path, port, www and case", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
    expect(normalizeDomain("https://www.example.com/about?x=1")).toBe("example.com");
    expect(normalizeDomain("http://blog.example.co.uk:8080/")).toBe("blog.example.co.uk");
    expect(normalizeDomain("  example.com.  ")).toBe("example.com");
  });

  test("converts IDNs to punycode", () => {
    expect(normalizeDomain("bücher.de")).toBe("xn--bcher-kva.de");
  });

  test("rejects non-public names", () => {
    for (const bad of [
      "", "   ", "localhost", "example", "127.0.0.1", "http://[::1]/", "192.168.1.1",
      "foo.local", "foo.internal", "foo.test", "foo.onion", "-bad.com", "bad-.com",
      "a..com", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com",
      `${"a".repeat(64)}.com`, null, 42,
    ]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });
});

describe("domain verification metadata", () => {
  test("tokens are random 32-char hex", () => {
    const a = createDomainToken();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(createDomainToken()).not.toBe(a);
  });

  test("only server-shaped metadata with verified === true counts", () => {
    const token = createDomainToken();
    expect(readDomainVerification(newDomainMetadata(token))).toEqual({ token, verified: false, verifiedAt: null });
    const at = new Date("2026-10-15T00:00:00Z");
    expect(readDomainVerification(verifiedDomainMetadata(token, at))?.verified).toBeTrue();
    expect(readDomainVerification({ domainVerification: { token, verified: "true" } })?.verified).toBeFalse();
    expect(readDomainVerification({ domainVerification: { token: "not hex!", verified: true } })).toBeNull();
    expect(readDomainVerification(null)).toBeNull();

    expect(isVerifiedDomainConnection({ provider: "website", metadata: verifiedDomainMetadata(token, at) })).toBeTrue();
    expect(isVerifiedDomainConnection({ provider: "website", metadata: newDomainMetadata(token) })).toBeFalse();
    expect(isVerifiedDomainConnection({ provider: "twitter", metadata: verifiedDomainMetadata(token, at) })).toBeFalse();
  });

  test("profile view hides unverified websites but keeps other providers", () => {
    const token = createDomainToken();
    const rows = [
      { id: "a", provider: "website", metadata: verifiedDomainMetadata(token, new Date()) },
      { id: "b", provider: "website", metadata: newDomainMetadata(token) },
      { id: "c", provider: "website", metadata: null },
      { id: "d", provider: "twitter", metadata: null },
    ];
    expect(filterUnverifiedDomains(rows).map((r) => r.id)).toEqual(["a", "d"]);
  });

  test("owner status exposes the TXT challenge, or none for legacy rows", () => {
    const token = "ab".repeat(16);
    const status = ownDomainStatus({ accountId: "example.com", metadata: newDomainMetadata(token) });
    expect(status.verified).toBeFalse();
    expect(status.challenge).toEqual(domainChallenge("example.com", token));
    expect(status.challenge?.name).toBe("_serika.example.com");
    expect(status.challenge?.value).toBe(`serika-verification=${token}`);

    const legacy = ownDomainStatus({ accountId: "https://www.Example.com/", metadata: null });
    expect(legacy).toEqual({ name: "example.com", verified: false, verifiedAt: null, challenge: null });
  });
});

describe("txtRecordsContainToken", () => {
  const token = "cd".repeat(16);
  test("matches an exact record, including chunked and quoted ones", () => {
    expect(txtRecordsContainToken([["v=spf1 -all"], [`serika-verification=${token}`]], token)).toBeTrue();
    expect(txtRecordsContainToken([["serika-verification=", token]], token)).toBeTrue();
    expect(txtRecordsContainToken([[`"serika-verification=${token}"`]], token)).toBeTrue();
  });

  test("rejects other tokens, prefixes and substrings", () => {
    expect(txtRecordsContainToken([], token)).toBeFalse();
    expect(txtRecordsContainToken([[`serika-verification=${"ef".repeat(16)}`]], token)).toBeFalse();
    expect(txtRecordsContainToken([[token]], token)).toBeFalse();
    expect(txtRecordsContainToken([[`x serika-verification=${token}`]], token)).toBeFalse();
  });
});
