import { describe, expect, test } from "bun:test";
import {
  MAX_DOMAINS_PER_SERVER,
  MAX_SERVER_OWNED_CONNECTIONS,
  allowedServerOAuthProviders,
  checkServerLinkTarget,
  isServerOwnedVerified,
  mergeConnectionViews,
  mergeServerConnections,
  parseServerLinkReturn,
  parseServerLinkTarget,
  pendingDomainToken,
  serverDomainsAllowed,
  serverLinkReturnPath,
  serverOwnedCapacity,
  serverOwnedOwnView,
  type ServerConnectionView,
  type ServerOwnedRow,
} from "../src/lib/connections/serverOwned";
import { newDomainMetadata, verifiedDomainMetadata } from "../src/lib/connections/domain";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SERVER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "0123456789abcdef0123456789abcdef";

function row(over: Partial<ServerOwnedRow>): ServerOwnedRow {
  return {
    id: over.id ?? "r1",
    serverId: SERVER,
    provider: "github",
    accountId: "42",
    username: "acme",
    displayName: "Acme Inc",
    metadata: { oauthVerified: true },
    verified: true,
    visible: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("link target binding", () => {
  test("parses only well-formed ticket / state entries", () => {
    expect(parseServerLinkTarget({ provider: "github", userId: OWNER, serverId: SERVER })).toEqual({ provider: "github", userId: OWNER, serverId: SERVER });
    expect(parseServerLinkTarget({ provider: "serika", userId: OWNER, serverId: SERVER })).toBeNull();
    expect(parseServerLinkTarget({ provider: "twitter", userId: OWNER, serverId: SERVER })).toBeNull();
    expect(parseServerLinkTarget({ provider: "github", userId: "x", serverId: SERVER })).toBeNull();
    expect(parseServerLinkTarget({ provider: "github", userId: OWNER, serverId: "../etc" })).toBeNull();
    expect(parseServerLinkTarget(null)).toBeNull();
    expect(parseServerLinkTarget("github")).toBeNull();
  });

  test("requires the same provider, the signed-in starter and current ownership", () => {
    const target = { provider: "github", userId: OWNER, serverId: SERVER };
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: OWNER, serverOwnerId: OWNER })).toBe("ok");
    // UUID spelling (dashes / case) doesn't matter.
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: OWNER.replace(/-/g, "").toUpperCase(), serverOwnerId: OWNER })).toBe("ok");
    expect(checkServerLinkTarget(target, { provider: "twitch", authUserId: OWNER, serverOwnerId: OWNER })).toBe("invalid");
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: OTHER, serverOwnerId: OWNER })).toBe("wrong_user");
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: null, serverOwnerId: OWNER })).toBe("wrong_user");
    // Ownership transferred while the owner was at the provider.
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: OWNER, serverOwnerId: OTHER })).toBe("not_owner");
    expect(checkServerLinkTarget(target, { provider: "github", authUserId: OWNER, serverOwnerId: null })).toBe("not_owner");
    expect(checkServerLinkTarget(null, { provider: "github", authUserId: OWNER, serverOwnerId: OWNER })).toBe("invalid");
  });

  test("return path round-trips and sanitises the error code", () => {
    const ok = serverLinkReturnPath(SERVER, { linked: "github" });
    expect(ok.startsWith(`/channels/${SERVER}?`)).toBe(true);
    expect(parseServerLinkReturn(ok.slice(ok.indexOf("?")))).toEqual({ tab: "connections", linked: "github", error: null });
    const bad = serverLinkReturnPath(SERVER, { error: "<script>not_owner" });
    expect(bad).not.toContain("<");
    expect(parseServerLinkReturn(bad.slice(bad.indexOf("?")))?.error).toBe("scriptnot_owner");
    expect(parseServerLinkReturn("?settings=connections")).toBeNull();
    expect(parseServerLinkReturn("?serverSettings=connections&linked=../x")?.linked).toBeNull();
  });
});

describe("platform switches", () => {
  test("only configured, enabled providers can be linked", () => {
    const configured = ["github", "twitch", "discord", "spotify"];
    expect(allowedServerOAuthProviders({}, configured)).toEqual(["discord", "github", "twitch", "spotify"]);
    expect(allowedServerOAuthProviders({ disabledProviders: ["twitch"] }, configured)).toEqual(["discord", "github", "spotify"]);
    expect(allowedServerOAuthProviders({ connectionsEnabled: false }, configured)).toEqual([]);
    // Unknown / user-only providers never show up.
    expect(allowedServerOAuthProviders({}, ["serika", "twitter"])).toEqual([]);
  });

  test("domains follow connectionsEnabled and the website switch", () => {
    expect(serverDomainsAllowed({})).toBe(true);
    expect(serverDomainsAllowed({ connectionsEnabled: false })).toBe(false);
    expect(serverDomainsAllowed({ disabledProviders: ["website"] })).toBe(false);
  });
});

describe("verification", () => {
  test("domains need a verified TXT challenge, accounts need the OAuth mark", () => {
    expect(isServerOwnedVerified(row({}))).toBe(true);
    expect(isServerOwnedVerified(row({ metadata: {} }))).toBe(false);
    expect(isServerOwnedVerified(row({ verified: false }))).toBe(false);
    expect(isServerOwnedVerified(row({ provider: "twitter" }))).toBe(false);
    const pending = row({ provider: "website", accountId: "acme.com", metadata: newDomainMetadata(TOKEN), verified: false });
    expect(isServerOwnedVerified(pending)).toBe(false);
    // The column alone isn't enough: the challenge must say verified too.
    expect(isServerOwnedVerified({ ...pending, verified: true })).toBe(false);
    const done = row({ provider: "website", accountId: "acme.com", metadata: verifiedDomainMetadata(TOKEN, new Date()), verified: true });
    expect(isServerOwnedVerified(done)).toBe(true);
    expect(pendingDomainToken(pending)).toBe(TOKEN);
    expect(pendingDomainToken(done)).toBeNull();
    expect(pendingDomainToken(row({}))).toBeNull();
  });

  test("the owner view carries the challenge but never the metadata", () => {
    const pending = row({ provider: "website", accountId: "acme.com", metadata: newDomainMetadata(TOKEN), verified: false });
    const view = serverOwnedOwnView(pending);
    expect(view).not.toHaveProperty("metadata");
    expect(view.domain?.challenge?.value).toBe(`serika-verification=${TOKEN}`);
    expect(view.domain?.challenge?.name).toBe("_serika.acme.com");
    expect(serverOwnedOwnView(row({}))).not.toHaveProperty("domain");
  });
});

describe("capacity", () => {
  test("caps total rows and domains", () => {
    expect(serverOwnedCapacity([], "website")).toBe("ok");
    const domains = Array.from({ length: MAX_DOMAINS_PER_SERVER }, () => ({ provider: "website" }));
    expect(serverOwnedCapacity(domains, "website")).toBe("too_many_domains");
    expect(serverOwnedCapacity(domains, "oauth")).toBe("ok");
    const full = Array.from({ length: MAX_SERVER_OWNED_CONNECTIONS }, () => ({ provider: "github" }));
    expect(serverOwnedCapacity(full, "oauth")).toBe("too_many");
    expect(serverOwnedCapacity(full, "website")).toBe("too_many");
  });
});

describe("merging what members see", () => {
  const ownerGithub: ServerConnectionView = { id: "o1", provider: "github", accountId: "42", username: "me", displayName: null, verified: true, source: "owner" };
  const ownerSite: ServerConnectionView = { id: "o2", provider: "website", accountId: "me.dev", username: null, displayName: "me.dev", verified: true, source: "owner" };

  test("server-owned verified + visible rows first, then the owner's, without repeats", () => {
    const owned = [
      row({ id: "s2", provider: "twitch", accountId: "acmetv", createdAt: "2026-02-01T00:00:00.000Z" }),
      row({ id: "s1", createdAt: "2026-01-01T00:00:00.000Z" }), // same GitHub account as the owner's
      row({ id: "s3", provider: "twitch", accountId: "hidden", visible: false }),
      row({ id: "s4", provider: "website", accountId: "pending.com", metadata: newDomainMetadata(TOKEN), verified: false }),
    ];
    const merged = mergeServerConnections(owned, [ownerGithub, ownerSite]);
    expect(merged.map((c) => `${c.source}:${c.id}`)).toEqual(["server:s1", "server:s2", "owner:o2"]);
    expect(merged.every((c) => c.verified)).toBe(true);
  });

  test("dedupes case-insensitively and honours the cap", () => {
    const a: ServerConnectionView = { ...ownerSite, id: "a", accountId: "Me.Dev", source: "server" };
    expect(mergeConnectionViews([a], [ownerSite]).map((c) => c.id)).toEqual(["a"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...ownerGithub, id: `x${i}`, accountId: String(i) }));
    expect(mergeConnectionViews(many, [], 5)).toHaveLength(5);
  });
});
