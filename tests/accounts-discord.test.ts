import { describe, expect, test } from "bun:test";
import {
  ACCOUNTS_DISCORD_FRESH_MIN_INTERVAL_MS,
  accountsDiscordMetadata,
  accountsLookupsFor,
  discordLinkFromAccountsUser,
  shouldAskAccounts,
} from "../src/lib/connections/accountsDiscord";
import { OAUTH_VERIFIED_KEY, isOAuthVerifiedConnection } from "../src/lib/connections/policy";

describe("accountsLookupsFor", () => {
  test("a local id derived from an accounts ObjectId looks up that id only", () => {
    // mongoIdToUUID("65f1a2b3c4d5e6f7a8b9c0d1") right-pads to 32 hex digits.
    expect(accountsLookupsFor("65f1a2b3-c4d5-e6f7-a8b9-c0d100000000", "a@b.c")).toEqual([{ id: "65f1a2b3c4d5e6f7a8b9c0d1" }]);
  });

  test("a legacy local id falls back to originalUserId, then email", () => {
    const id = "3f2b8c1e-9a4d-4c2b-8e1f-6a7b8c9d0e1f";
    expect(accountsLookupsFor(id, "  Someone@Example.COM ")).toEqual([{ originalUserId: id }, { email: "someone@example.com" }]);
    expect(accountsLookupsFor(id, null)).toEqual([{ originalUserId: id }]);
    expect(accountsLookupsFor(id, "not-an-email")).toEqual([{ originalUserId: id }]);
  });
});

describe("discordLinkFromAccountsUser", () => {
  test("reads a snowflake id and a trimmed username", () => {
    expect(discordLinkFromAccountsUser({ discordId: "123456789012345678", discordUsername: " serika " })).toEqual({ id: "123456789012345678", username: "serika" });
    expect(discordLinkFromAccountsUser({ discordId: "123456789012345678" })).toEqual({ id: "123456789012345678", username: null });
  });

  test("no link, or a malformed one, is null", () => {
    expect(discordLinkFromAccountsUser(null)).toBeNull();
    expect(discordLinkFromAccountsUser({})).toBeNull();
    expect(discordLinkFromAccountsUser({ discordId: "" })).toBeNull();
    expect(discordLinkFromAccountsUser({ discordId: "abc" })).toBeNull();
    expect(discordLinkFromAccountsUser({ discordId: 123456789012345678 })).toBeNull();
    expect(discordLinkFromAccountsUser({ discordId: { $gt: "" } })).toBeNull();
  });
});

describe("shouldAskAccounts", () => {
  const now = 1_000_000;
  test("asks when nothing is remembered", () => {
    expect(shouldAskAccounts(null, now, false)).toBe(true);
    expect(shouldAskAccounts(undefined, now, true)).toBe(true);
  });

  test("trusts a remembered miss unless forced", () => {
    expect(shouldAskAccounts({ at: now - 1 }, now, false)).toBe(false);
    expect(shouldAskAccounts({ at: now - 60_000 }, now, false)).toBe(false);
  });

  test("a forced re-check is throttled", () => {
    expect(shouldAskAccounts({ at: now - 1 }, now, true)).toBe(false);
    expect(shouldAskAccounts({ at: now - ACCOUNTS_DISCORD_FRESH_MIN_INTERVAL_MS }, now, true)).toBe(true);
    expect(shouldAskAccounts({}, now, true)).toBe(true);
  });
});

describe("accountsDiscordMetadata", () => {
  test("marks the row OAuth-verified and keeps other keys", () => {
    const meta = accountsDiscordMetadata({ foo: 1, [OAUTH_VERIFIED_KEY]: false });
    expect(meta).toEqual({ foo: 1, [OAUTH_VERIFIED_KEY]: true, source: "serika-accounts" });
    expect(isOAuthVerifiedConnection({ metadata: meta })).toBe(true);
    expect(accountsDiscordMetadata(null)).toEqual({ [OAUTH_VERIFIED_KEY]: true, source: "serika-accounts" });
    expect(accountsDiscordMetadata(["x"])).toEqual({ [OAUTH_VERIFIED_KEY]: true, source: "serika-accounts" });
  });
});
