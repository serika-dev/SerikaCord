import { describe, expect, test } from "bun:test";
import {
  APP_CATEGORIES, appCategoryLabel, buildInstallUrl, cleanStaffReason, directoryState, isAppCategory,
  isDirectoryPageVisible, isDirectoryVisible, isOwnerListed, isSafeHttpUrl, isStaffVerificationAction, listingProblems,
  planStaffVerification, safeHttpUrlOrNull, showsVerified, staffAppChips, validateGeneralAppPatch, validateListingPatch,
  validateStaffListingPatch, verificationCooldownEndsAt, verificationRequirements, LISTING_LIMITS,
  VERIFICATION_REAPPLY_COOLDOWN_MS, VERIFICATION_SERVER_THRESHOLD,
} from "@/lib/appDirectory/listing";
import { hasOfficialAppBadge, isVerifiedBotUser, OFFICIAL_APP_BADGE } from "@/lib/appDirectory/official";
import { AUTOMATIC_BADGE_IDS, BUILTIN_BADGE_IDS, DEFAULT_BADGES } from "@/lib/constants/badges";
import { appAssetPrefix, isOwnedAppAssetUrl, isOwnedBotImageUrl } from "@/lib/appDirectory/assets";
import {
  clampLimit, compareKeys, decodeCursor, encodeCursor, isDirectorySort, matchesSearch, pageDirectory,
  searchTerms, sortKey, DIRECTORY_PAGE_MAX, type DirectoryEntry, type DirectoryPage,
} from "@/lib/appDirectory/paging";
import { serikaToDiscord } from "@/lib/botapi/permissionBits";

const BOT = "11111111-1111-4111-8111-111111111111";

describe("directory visibility", () => {
  test("owner opt-in, public bot and not delisted are all required", () => {
    expect(isDirectoryVisible({ botId: BOT, botPublic: true, directoryListed: true })).toBe(true);
    expect(isDirectoryVisible({ botId: BOT, botPublic: true, directoryListed: false })).toBe(false);
    expect(isDirectoryVisible({ botId: BOT, botPublic: false, directoryListed: true })).toBe(false);
    expect(isDirectoryVisible({ botId: null, botPublic: true, directoryListed: true })).toBe(false);
    expect(isDirectoryVisible({ botId: BOT, botPublic: true, directoryListed: true, directoryDelisted: true })).toBe(false);
  });

  test("bot_public defaults to public; only an explicit false hides the bot", () => {
    expect(isDirectoryVisible({ botId: BOT, botPublic: null, directoryListed: true })).toBe(true);
  });

  test("a private, verified app that never opted in gets no public page", () => {
    const app = { botId: BOT, botPublic: false, verified: true, directoryListed: null };
    expect(isOwnerListed(app)).toBe(false);
    expect(isDirectoryVisible(app)).toBe(false);
    expect(isDirectoryPageVisible(app)).toBe(false);
    expect(directoryState(app)).toBe("draft");
    // Explicitly opted in, then made private: page stays, lists don't.
    expect(isDirectoryPageVisible({ ...app, directoryListed: true })).toBe(true);
    expect(isDirectoryVisible({ ...app, directoryListed: true })).toBe(false);
  });

  test("apps that never chose keep the old listed = verified meaning", () => {
    expect(isOwnerListed({ directoryListed: null, verified: true })).toBe(true);
    expect(isOwnerListed({ directoryListed: null, verified: false })).toBe(false);
    // An explicit choice wins over verification either way.
    expect(isOwnerListed({ directoryListed: false, verified: true })).toBe(false);
    expect(isOwnerListed({ directoryListed: true, verified: false })).toBe(true);
  });

  test("verification alone never lists an app that opted out", () => {
    expect(isDirectoryVisible({ botId: BOT, verified: true, directoryListed: false })).toBe(false);
  });

  test("a listed app made private keeps its page, but leaves the lists", () => {
    const app = { botId: BOT, botPublic: false, directoryListed: true };
    expect(isDirectoryVisible(app)).toBe(false);
    expect(isDirectoryPageVisible(app)).toBe(true);
    expect(isDirectoryPageVisible({ ...app, directoryDelisted: true })).toBe(false);
  });

  test("states for the developer portal", () => {
    expect(directoryState({ botId: BOT, directoryListed: false })).toBe("draft");
    expect(directoryState({ botId: BOT, directoryListed: true })).toBe("listed");
    expect(directoryState({ botId: BOT, botPublic: false, directoryListed: true })).toBe("hidden");
    expect(directoryState({ botId: BOT, directoryListed: true, directoryDelisted: true })).toBe("delisted");
    expect(directoryState({ botId: BOT, directoryListed: false, directoryDelisted: true })).toBe("delisted");
  });

  test("listing problems", () => {
    expect(listingProblems({ botId: BOT, shortDescription: "Hi", categories: ["music"] })).toEqual([]);
    expect(listingProblems({ botId: null, shortDescription: " ", categories: ["nope"] })).toEqual(["no_bot", "missing_description", "missing_category"]);
    expect(listingProblems({ botId: BOT, botPublic: false, shortDescription: "x", categories: ["fun"] })).toEqual(["not_public"]);
  });
});

describe("categories", () => {
  test("fixed list, validated", () => {
    expect(APP_CATEGORIES).toContain("developer-tools");
    expect(APP_CATEGORIES).toHaveLength(12);
    expect(isAppCategory("music")).toBe(true);
    expect(isAppCategory("Music")).toBe(false);
    expect(isAppCategory("gaming")).toBe(false);
    expect(isAppCategory(undefined)).toBe(false);
  });

  test("every category has a label", () => {
    const gt = (s: string) => s;
    for (const id of APP_CATEGORIES) expect(appCategoryLabel(id, gt)).not.toBe(id);
    expect(appCategoryLabel("art", gt)).toBe("Art & Creativity");
  });
});

describe("verification requirements", () => {
  test("bot + server threshold", () => {
    const below = verificationRequirements({ botId: BOT }, 12);
    expect(below.find((r) => r.id === "servers")).toEqual({ id: "servers", met: false, current: 12, required: VERIFICATION_SERVER_THRESHOLD });
    expect(verificationRequirements({ botId: BOT }, VERIFICATION_SERVER_THRESHOLD).every((r) => r.met)).toBe(true);
    expect(verificationRequirements({ botId: null }, 500).find((r) => r.id === "bot")?.met).toBe(false);
  });
});

describe("listing input validation", () => {
  test("accepts a full listing", () => {
    const r = validateListingPatch({
      listed: true,
      shortDescription: "  Plays music  ",
      longDescription: "# Hello\r\nWorld",
      categories: ["music", "fun", "music"],
      tags: ["dj", "DJ", " radio "],
      website: "https://example.com",
      supportUrl: "https://serika.chat/invite/abc",
      termsOfServiceUrl: "",
      privacyPolicyUrl: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toEqual({
      listed: true,
      shortDescription: "Plays music",
      longDescription: "# Hello\nWorld",
      categories: ["music", "fun"],
      tags: ["dj", "radio"],
      website: "https://example.com",
      supportUrl: "https://serika.chat/invite/abc",
      termsOfServiceUrl: null,
      privacyPolicyUrl: null,
    });
  });

  test("rejects unsafe URLs", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://x.y", "//evil.example", "https://user:pw@x.y", "not a url"]) {
      expect(validateListingPatch({ website: url }).ok).toBe(false);
    }
    expect(isSafeHttpUrl("http://example.com/a?b")).toBe(true);
    expect(safeHttpUrlOrNull("javascript:alert(1)")).toBeNull();
  });

  test("enforces category enum and limits", () => {
    expect(validateListingPatch({ categories: ["gaming"] }).ok).toBe(false);
    expect(validateListingPatch({ categories: ["music", "fun", "games", "social"] }).ok).toBe(false);
    expect(validateListingPatch({ categories: "music" }).ok).toBe(false);
    expect(validateListingPatch({ shortDescription: "x".repeat(201) }).ok).toBe(false);
    expect(validateListingPatch({ longDescription: "x".repeat(4001) }).ok).toBe(false);
    expect(validateListingPatch({ tags: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(false);
    expect(validateListingPatch({ tags: ["x".repeat(25)] }).ok).toBe(false);
    expect(validateListingPatch({ listed: "yes" }).ok).toBe(false);
    expect(validateListingPatch(null).ok).toBe(false);
  });

  test("strips control characters and flattens the short description", () => {
    const r = validateListingPatch({ shortDescription: "a\u0000b\nc", longDescription: "x\u0007y\n\tz" });
    expect(r.ok && r.patch).toEqual({ shortDescription: "ab c", longDescription: "xy\n\tz" });
  });

  test("a cover can only be removed through the directory PATCH", () => {
    expect(validateListingPatch({ coverImage: "https://evil.example/x.png" }).ok).toBe(false);
    const r = validateListingPatch({ coverImage: null });
    expect(r.ok && r.patch.coverImage).toBeNull();
  });

  test("staff reasons are trimmed and capped", () => {
    expect(cleanStaffReason("  spam  ", 10)).toBe("spam");
    expect(cleanStaffReason("   ", 10)).toBeNull();
    expect(cleanStaffReason(5, 10)).toBeNull();
    expect(cleanStaffReason("x".repeat(20), 10)).toHaveLength(10);
  });
});

describe("general application PATCH validation", () => {
  test("caps and cleans public fields", () => {
    const r = validateGeneralAppPatch({ name: "  My   Bot ", description: "Line one\nline two", tags: ["a", "A", "b"], botPublic: false });
    expect(r).toEqual({ ok: true, patch: { name: "My Bot", description: "Line one line two", tags: ["a", "b"], botPublic: false } });
    expect(validateGeneralAppPatch({ name: "x".repeat(33) }).ok).toBe(false);
    expect(validateGeneralAppPatch({ name: "   " }).ok).toBe(false);
    expect(validateGeneralAppPatch({ name: 5 }).ok).toBe(false);
    expect(validateGeneralAppPatch({ description: "x".repeat(201) }).ok).toBe(false);
    expect(validateGeneralAppPatch({ tags: ["x".repeat(25)] }).ok).toBe(false);
    expect(validateGeneralAppPatch({ botPublic: "yes" }).ok).toBe(false);
  });

  test("icon and cover can only be cleared, never set to a URL", () => {
    for (const key of ["icon", "coverImage"]) {
      expect(validateGeneralAppPatch({ [key]: "https://cdn.serika.chat/avatars/u/x.png" }).ok).toBe(false);
      expect(validateGeneralAppPatch({ [key]: null })).toEqual({ ok: true, patch: { [key]: null } });
      expect(validateGeneralAppPatch({ [key]: "" })).toEqual({ ok: true, patch: { [key]: null } });
    }
  });

  test("link fields must be http(s)", () => {
    expect(validateGeneralAppPatch({ privacyPolicyUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateGeneralAppPatch({ customInstallUrl: " https://x.y/install " })).toEqual({ ok: true, patch: { customInstallUrl: "https://x.y/install" } });
    expect(validateGeneralAppPatch({ termsOfServiceUrl: "" })).toEqual({ ok: true, patch: { termsOfServiceUrl: null } });
  });

  test("untouched keys are left out", () => {
    expect(validateGeneralAppPatch({ redirectUris: ["x"] })).toEqual({ ok: true, patch: {} });
  });
});

describe("verification re-apply cooldown", () => {
  test("only after a rejection", () => {
    const reviewed = new Date("2026-10-01T00:00:00Z");
    expect(verificationCooldownEndsAt({ verificationStatus: "rejected", verificationReviewedAt: reviewed })?.getTime())
      .toBe(reviewed.getTime() + VERIFICATION_REAPPLY_COOLDOWN_MS);
    expect(verificationCooldownEndsAt({ verificationStatus: "none", verificationReviewedAt: reviewed })).toBeNull();
    expect(verificationCooldownEndsAt({ verificationStatus: "rejected", verificationReviewedAt: null })).toBeNull();
  });
});

describe("application image delete guard", () => {
  const APP = "22222222-2222-4222-8222-222222222222";
  const CDN = "https://cdn.serika.chat";
  const own = `${CDN}/app-covers/${APP}/AbCdEf123_-xyz9.png`;

  test("only this app's own uploads on the CDN can be deleted", () => {
    expect(appAssetPrefix("cover", APP)).toBe(`app-covers/${APP}/`);
    expect(isOwnedAppAssetUrl(own, CDN, "cover", APP)).toBe(true);
    expect(isOwnedAppAssetUrl(`${CDN}/app-icons/${APP}/AbCdEf123_-xyz9.webp`, CDN, "icon", APP)).toBe(true);
  });

  test("other users' media, other apps, legacy keys and foreign hosts are never deleted", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    for (const url of [
      `${CDN}/avatars/${other}/AbCdEf123_-xyz9.png`,              // someone's avatar
      `${CDN}/attachments/${other}/AbCdEf123_-xyz9.png`,
      `${CDN}/app-covers/${other}/AbCdEf123_-xyz9.png`,           // another app
      `${CDN}/app-icons/${APP}/AbCdEf123_-xyz9.png`,              // wrong kind
      `${CDN}/app-covers/${APP}/nested/AbCdEf123_-xyz9.png`,      // extra segment
      `${CDN}/app-covers/${APP}/../../avatars/x/AbCdEf123.png`,   // traversal (normalized away)
      `${CDN}/app-covers/${APP}/AbCdEf123%2F..%2Fx.png`,          // encoded slash
      `${CDN}/app-covers/${APP}/AbCdEf123_-xyz9.png?x=1`,
      `https://evil.example/app-covers/${APP}/AbCdEf123_-xyz9.png`,
      `https://serikacord-media.s3.eu-central-003.backblazeb2.com/app-covers/${APP}/AbCdEf123_-xyz9.png`,
      `http://cdn.serika.chat/app-covers/${APP}/AbCdEf123_-xyz9.png`, // different origin (scheme)
      "not a url",
      "",
    ]) {
      expect(isOwnedAppAssetUrl(url, CDN, "cover", APP)).toBe(false);
    }
    expect(isOwnedAppAssetUrl(own, CDN, "cover", "not-a-uuid")).toBe(false);
    expect(isOwnedAppAssetUrl(null, CDN, "cover", APP)).toBe(false);
  });

  test("legacy icons keyed by the owner's user id are left alone", () => {
    const ownerId = "44444444-4444-4444-8444-444444444444";
    expect(isOwnedAppAssetUrl(`${CDN}/app-icons/${ownerId}/AbCdEf123_-xyz9.png`, CDN, "icon", APP)).toBe(false);
  });
});

describe("install links", () => {
  test("default scopes and permissions", () => {
    const url = buildInstallUrl({ clientId: "123", installParams: null });
    const q = new URL(url, "https://serika.chat").searchParams;
    expect(url.startsWith("/oauth2/authorize?")).toBe(true);
    expect(q.get("client_id")).toBe("123");
    expect(q.get("scope")).toBe("bot applications.commands");
    expect(q.get("permissions")).toBe("0");
    expect(q.get("guild_id")).toBeNull();
  });

  test("saved params, bot always included, unknown scopes dropped, guild preselected", () => {
    const url = buildInstallUrl(
      { clientId: "9", installParams: { scopes: ["applications.commands", "email", "webhook.incoming"], permissions: "2048" } },
      { guildId: BOT },
    );
    const q = new URL(url, "https://serika.chat").searchParams;
    expect(q.get("scope")).toBe("bot applications.commands");
    expect(q.get("permissions")).toBe("2048");
    expect(q.get("guild_id")).toBe(BOT);
  });

  test("malformed permissions fall back to 0; snowflake apps get Discord numbering", () => {
    expect(new URL(buildInstallUrl({ clientId: "1", installParams: { permissions: "-1" } }), "https://x.y").searchParams.get("permissions")).toBe("0");
    const soundboard = String(1n << 44n); // Serika USE_SOUNDBOARD = Discord bit 42
    const url = buildInstallUrl({ clientId: "1", apiIdFormat: "snowflake", installParams: { permissions: soundboard } }, { toDiscordBits: serikaToDiscord });
    expect(new URL(url, "https://x.y").searchParams.get("permissions")).toBe(String(1n << 42n));
  });
});

function entry(id: string, over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    id, name: id, shortDescription: "", categories: [], tags: [], verified: false, featured: false,
    serverCount: 0, listedAtMs: 0, ...over,
  };
}

describe("directory sort, search and cursors", () => {
  const apps = [
    entry("a1", { name: "Melody", categories: ["music"], serverCount: 50, listedAtMs: 1000, tags: ["dj"] }),
    entry("a2", { name: "Guard", categories: ["moderation"], serverCount: 500, listedAtMs: 3000, verified: true, featured: true }),
    entry("a3", { name: "alpha", categories: ["utility"], serverCount: 50, listedAtMs: 2000, verified: true, shortDescription: "Polls and reminders" }),
    entry("a4", { name: "Beats", categories: ["music", "fun"], serverCount: 5, listedAtMs: 4000 }),
  ];

  test("sorts", () => {
    expect(pageDirectory(apps, { sort: "popular" }).items.map((a) => a.id)).toEqual(["a2", "a3", "a1", "a4"]);
    expect(pageDirectory(apps, { sort: "new" }).items.map((a) => a.id)).toEqual(["a4", "a2", "a3", "a1"]);
    expect(pageDirectory(apps, { sort: "name" }).items.map((a) => a.id)).toEqual(["a3", "a4", "a2", "a1"]);
  });

  test("category, featured and search filters", () => {
    expect(pageDirectory(apps, { category: "music" }).items.map((a) => a.id)).toEqual(["a1", "a4"]);
    expect(pageDirectory(apps, { featuredOnly: true }).items.map((a) => a.id)).toEqual(["a2"]);
    expect(pageDirectory(apps, { search: "REMINDERS" }).items.map((a) => a.id)).toEqual(["a3"]);
    expect(pageDirectory(apps, { search: "dj melody" }).items.map((a) => a.id)).toEqual(["a1"]);
    expect(pageDirectory(apps, { search: "%" }).total).toBe(0);
    expect(searchTerms("  a   b ")).toEqual(["a", "b"]);
    expect(matchesSearch(apps[3], ["fun"])).toBe(true);
  });

  test("keyset paging walks every app once", () => {
    for (const sort of ["popular", "new", "name"] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page: DirectoryPage<DirectoryEntry> = pageDirectory(apps, { sort, limit: 1, cursor: cursor ? decodeCursor(cursor, sort) : null });
        seen.push(...page.items.map((a) => a.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(pageDirectory(apps, { sort }).items.map((a) => a.id));
    }
  });

  test("a removed app does not shift the next page", () => {
    const first = pageDirectory(apps, { sort: "name", limit: 2 });
    expect(first.items.map((a) => a.id)).toEqual(["a3", "a4"]);
    const remaining = apps.filter((a) => a.id !== "a3");
    const next = pageDirectory(remaining, { sort: "name", limit: 2, cursor: decodeCursor(first.nextCursor, "name") });
    expect(next.items.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(next.nextCursor).toBeNull();
  });

  test("cursors are validated per sort", () => {
    const key = sortKey(apps[0], "popular");
    const c = encodeCursor(key);
    expect(decodeCursor(c, "popular")).toEqual(key);
    expect(decodeCursor(c, "name")).toBeNull();
    expect(decodeCursor("not base64!", "popular")).toBeNull();
    expect(decodeCursor(encodeCursor(["x", 1]), "new")).toBeNull();
    expect(decodeCursor(undefined, "new")).toBeNull();
    expect(compareKeys([1, "b"], [1, "a"])).toBeGreaterThan(0);
    expect(compareKeys([-5, "a"], [2, "a"])).toBeLessThan(0);
  });

  test("limits and sorts are clamped / validated", () => {
    expect(clampLimit("500")).toBe(DIRECTORY_PAGE_MAX);
    expect(clampLimit("abc")).toBe(24);
    expect(clampLimit(0)).toBe(24);
    expect(clampLimit("10")).toBe(10);
    expect(isDirectorySort("popular")).toBe(true);
    expect(isDirectorySort("random")).toBe(false);
  });

  test("unicode names survive the cursor round trip", () => {
    const key = sortKey(entry("z", { name: "Ännchen 🎵" }), "name");
    expect(decodeCursor(encodeCursor(key), "name")).toEqual(key);
  });
});

describe("bot avatar/banner delete guard", () => {
  const BOT = "44444444-4444-4444-8444-444444444444";
  const CDN = "https://cdn.serika.chat";

  test("only the bot's own avatar/banner on the CDN can be deleted", () => {
    expect(isOwnedBotImageUrl(`${CDN}/avatars/${BOT}/AbCdEf123_-xyz9.png`, CDN, "avatar", BOT)).toBe(true);
    expect(isOwnedBotImageUrl(`${CDN}/banners/${BOT}/AbCdEf123_-xyz9.gif`, CDN, "banner", BOT)).toBe(true);
  });

  test("anything else is left alone", () => {
    const other = "55555555-5555-4555-8555-555555555555";
    for (const [url, kind] of [
      [`${CDN}/avatars/${other}/AbCdEf123_-xyz9.png`, "avatar"],
      [`${CDN}/banners/${BOT}/AbCdEf123_-xyz9.png`, "avatar"],
      [`${CDN}/attachments/${BOT}/AbCdEf123_-xyz9.png`, "avatar"],
      [`${CDN}/avatars/${BOT}/nested/AbCdEf123_-xyz9.png`, "avatar"],
      [`https://evil.example/avatars/${BOT}/AbCdEf123_-xyz9.png`, "avatar"],
      [`https://serikacord-media.s3.eu-central-003.backblazeb2.com/avatars/${BOT}/AbCdEf123_-xyz9.png`, "avatar"],
    ] as const) {
      expect(isOwnedBotImageUrl(url, CDN, kind, BOT)).toBe(false);
    }
    expect(isOwnedBotImageUrl(`${CDN}/avatars/not-a-uuid/AbCdEf123_-xyz9.png`, CDN, "avatar", "not-a-uuid")).toBe(false);
  });
});

describe("official apps", () => {
  test("official apps always show as verified", () => {
    expect(showsVerified({ verified: false, official: true })).toBe(true);
    expect(showsVerified({ verified: true, official: false })).toBe(true);
    expect(showsVerified({ verified: false, official: false })).toBe(false);
    expect(showsVerified({ verified: null, official: null })).toBe(false);
    expect(showsVerified({})).toBe(false);
  });

  test("the official badge is a built-in, automatic badge", () => {
    expect(BUILTIN_BADGE_IDS as readonly string[]).toContain(OFFICIAL_APP_BADGE);
    expect(AUTOMATIC_BADGE_IDS as readonly string[]).toContain(OFFICIAL_APP_BADGE);
    expect(DEFAULT_BADGES.find((b) => b.id === OFFICIAL_APP_BADGE)?.hidden).toBe(false);
  });

  test("the BOT tag check follows is_verified or the official badge", () => {
    expect(hasOfficialAppBadge(["official_app"])).toBe(true);
    expect(hasOfficialAppBadge(["staff"])).toBe(false);
    expect(hasOfficialAppBadge(null)).toBe(false);
    expect(isVerifiedBotUser({ isVerified: true })).toBe(true);
    expect(isVerifiedBotUser({ isVerified: false, badges: ["official_app"] })).toBe(true);
    expect(isVerifiedBotUser({ isVerified: false, badges: ["verified_bot_developer"] })).toBe(false);
    expect(isVerifiedBotUser({})).toBe(false);
  });

  test("the directory can show only official apps", () => {
    const apps = [entry("a", { official: true }), entry("b"), entry("c", { official: false }), entry("d", { official: true })];
    expect(pageDirectory(apps, { officialOnly: true, sort: "name" }).items.map((a) => a.id)).toEqual(["a", "d"]);
    expect(pageDirectory(apps, { sort: "name" }).total).toBe(4);
  });
});

describe("staff verification", () => {
  test("known actions only", () => {
    for (const a of ["approve", "reject", "revoke", "verify"]) expect(isStaffVerificationAction(a)).toBe(true);
    for (const a of ["grant", "", null, 1, "VERIFY"]) expect(isStaffVerificationAction(a)).toBe(false);
  });

  test("verify works on any unverified app, with or without a request or note", () => {
    for (const verificationStatus of ["none", "pending", "rejected", "approved", null]) {
      const plan = planStaffVerification({ verified: false, verificationStatus }, "verify", null);
      expect(plan).toEqual({ ok: true, verified: true, verificationStatus: "approved" });
    }
    expect(planStaffVerification({ verified: false }, "verify", "checked by staff").ok).toBe(true);
  });

  test("verify refuses an app that is already verified", () => {
    expect(planStaffVerification({ verified: true, verificationStatus: "approved" }, "verify", null)).toEqual({
      ok: false, httpStatus: 409, error: "Application is already verified",
    });
  });

  test("approve needs a pending or rejected request", () => {
    expect(planStaffVerification({ verificationStatus: "pending" }, "approve", null).ok).toBe(true);
    expect(planStaffVerification({ verificationStatus: "rejected" }, "approve", null).ok).toBe(true);
    const none = planStaffVerification({ verificationStatus: "none" }, "approve", null);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.httpStatus).toBe(409);
  });

  test("reject needs a pending request and a reason", () => {
    expect(planStaffVerification({ verificationStatus: "pending" }, "reject", null)).toEqual({ ok: false, httpStatus: 400, error: "A reason is required" });
    expect(planStaffVerification({ verificationStatus: "pending" }, "reject", "no")).toEqual({ ok: true, verified: false, verificationStatus: "rejected" });
    expect(planStaffVerification({ verificationStatus: "rejected" }, "reject", "no").ok).toBe(false);
  });

  test("revoke needs a verified app and a reason", () => {
    expect(planStaffVerification({ verified: true }, "revoke", null).ok).toBe(false);
    expect(planStaffVerification({ verified: false }, "revoke", "why")).toEqual({ ok: false, httpStatus: 400, error: "Application is not verified" });
    expect(planStaffVerification({ verified: true, verificationStatus: "approved" }, "revoke", "why")).toEqual({ ok: true, verified: false, verificationStatus: "none" });
  });
});

describe("staff status chips", () => {
  test("a listed, verified, official staff pick", () => {
    expect(staffAppChips({ botId: BOT, botPublic: true, verified: true, official: true, directoryListed: true, directoryFeatured: true }))
      .toEqual(["official", "verified", "listed", "featured"]);
  });

  test("private, delisted and botless apps", () => {
    expect(staffAppChips({ botId: BOT, botPublic: false, directoryListed: true })).toEqual(["private"]);
    expect(staffAppChips({ botId: BOT, directoryListed: true, directoryDelisted: true, directoryFeatured: true })).toEqual(["delisted"]);
    expect(staffAppChips({ botId: null, verificationStatus: "pending" })).toEqual(["pending", "no_bot"]);
  });

  test("official does not list an app on its own", () => {
    expect(staffAppChips({ botId: BOT, official: true, directoryListed: null })).toEqual(["official"]);
  });
});

describe("staff listing fixes", () => {
  test("only description, categories and tags are taken", () => {
    const r = validateStaffListingPatch({ shortDescription: "  Fixed  ", categories: ["music", "music"], tags: ["a", "A", " b "], listed: true, website: "https://x.example" });
    expect(r).toEqual({ ok: true, patch: { shortDescription: "Fixed", categories: ["music"], tags: ["a", "b"] } });
  });

  test("owner limits apply", () => {
    expect(validateStaffListingPatch({ categories: ["music", "fun", "art", "games"] }).ok).toBe(false);
    expect(validateStaffListingPatch({ categories: ["not-a-category"] }).ok).toBe(false);
    expect(validateStaffListingPatch({ tags: Array.from({ length: LISTING_LIMITS.tags + 1 }, (_, i) => `t${i}`) }).ok).toBe(false);
    expect(validateStaffListingPatch({ shortDescription: "x".repeat(LISTING_LIMITS.shortDescription + 1) }).ok).toBe(false);
  });

  test("an empty or foreign body is refused", () => {
    expect(validateStaffListingPatch({})).toEqual({ ok: false, error: "Nothing to update" });
    expect(validateStaffListingPatch({ name: "x" })).toEqual({ ok: false, error: "Nothing to update" });
    expect(validateStaffListingPatch(null).ok).toBe(false);
    expect(validateStaffListingPatch([]).ok).toBe(false);
  });

  test("clearing categories and tags is allowed", () => {
    expect(validateStaffListingPatch({ categories: [], tags: [] })).toEqual({ ok: true, patch: { categories: [], tags: [] } });
  });
});
