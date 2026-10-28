import { describe, expect, test } from "bun:test";
import {
  activityHiddenByStatus,
  activitySharing,
  dmAllowedFromNonFriend,
  dmAllowedViaServer,
  dmAudience,
  dmNeedsSharedServers,
  sanitizePrivacyPatch,
  typingIndicatorsEnabled,
  MAX_DM_SERVER_OVERRIDES,
} from "@/lib/settings/privacy";
import { canStartDm } from "@/lib/chat/dmAccess";
import { dmSendDenyReason } from "@/lib/chat/dmPolicy";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("dmAudience", () => {
  test("defaults to everyone", () => {
    expect(dmAudience(null)).toBe("everyone");
    expect(dmAudience({})).toBe("everyone");
    expect(dmAudience({ privacy: { directMessages: "bogus" } })).toBe("everyone");
  });
  test("reads the three modes and legacy keys", () => {
    expect(dmAudience({ privacy: { directMessages: "servers" } })).toBe("servers");
    expect(dmAudience({ privacy: { directMessages: "friends" } })).toBe("friends");
    expect(dmAudience({ privacy: { directMessages: "none" } })).toBe("friends");
    expect(dmAudience({ privacy: { directMessages: "servers" }, friendRequests: { allowServerMembers: false } })).toBe("friends");
  });
});

describe("dmAllowedFromNonFriend", () => {
  test("everyone needs no shared server", () => {
    expect(dmAllowedFromNonFriend({}, undefined)).toBe(true);
    expect(dmNeedsSharedServers({})).toBe(false);
  });
  test("servers mode needs a shared, non-blocked server and fails closed", () => {
    const settings = { privacy: { directMessages: "servers", dmBlockedServerIds: [S1] } };
    expect(dmNeedsSharedServers(settings)).toBe(true);
    expect(dmAllowedFromNonFriend(settings, undefined)).toBe(false);
    expect(dmAllowedFromNonFriend(settings, [])).toBe(false);
    expect(dmAllowedFromNonFriend(settings, [S1])).toBe(false);
    expect(dmAllowedFromNonFriend(settings, [S1, S2])).toBe(true);
    expect(dmAllowedFromNonFriend(settings, [S2.toUpperCase()])).toBe(true);
  });
  test("friends mode only lets in members of allowed servers", () => {
    const plain = { privacy: { directMessages: "friends" } };
    expect(dmNeedsSharedServers(plain)).toBe(false);
    expect(dmAllowedFromNonFriend(plain, [S1])).toBe(false);
    const allow = { privacy: { directMessages: "friends", dmAllowedServerIds: [S1] } };
    expect(dmNeedsSharedServers(allow)).toBe(true);
    expect(dmAllowedFromNonFriend(allow, [S1])).toBe(true);
    expect(dmAllowedFromNonFriend(allow, [S2])).toBe(false);
  });
  test("per-server toggle state", () => {
    expect(dmAllowedViaServer({}, S1)).toBe(true);
    expect(dmAllowedViaServer({ privacy: { directMessages: "servers", dmBlockedServerIds: [S1] } }, S1)).toBe(false);
    expect(dmAllowedViaServer({ privacy: { directMessages: "servers" } }, S1)).toBe(true);
    expect(dmAllowedViaServer({ privacy: { directMessages: "friends", dmAllowedServerIds: [S1] } }, S1)).toBe(true);
    expect(dmAllowedViaServer({ privacy: { directMessages: "friends" } }, S2)).toBe(false);
  });
  test("ignores junk ids in stored lists", () => {
    const settings = { privacy: { directMessages: "friends", dmAllowedServerIds: ["nope", 5, S1] } };
    expect(dmAllowedFromNonFriend(settings, [S1])).toBe(true);
  });
});

describe("DM policy with shared servers", () => {
  const recipient = { id: B, settings: { privacy: { directMessages: "servers" } } };
  test("dmSendDenyReason", () => {
    expect(dmSendDenyReason({ id: A }, recipient)).not.toBeNull();
    expect(dmSendDenyReason({ id: A }, recipient, { sharedServerIds: [S1] })).toBeNull();
    expect(dmSendDenyReason({ id: A, friends: [B] }, recipient)).toBeNull();
    expect(dmSendDenyReason({ id: A }, recipient, { recipientIsSystem: true })).toBeNull();
  });
  test("canStartDm", () => {
    expect(canStartDm({ id: A }, recipient)).toBe(false);
    expect(canStartDm({ id: A }, recipient, false, [S1])).toBe(true);
    expect(canStartDm({ id: A }, { ...recipient, blockedUsers: [A] }, false, [S1])).toBe(false);
  });
});

describe("activitySharing", () => {
  test("defaults on", () => {
    expect(activitySharing({})).toEqual({ enabled: true, games: true, watching: true, music: true });
  });
  test("master switch turns every source off", () => {
    expect(activitySharing({ privacy: { showActivity: false, activitySharing: { games: true } } })).toEqual({ enabled: false, games: false, watching: false, music: false });
  });
  test("per-source switches", () => {
    expect(activitySharing({ privacy: { activitySharing: { music: false } } })).toEqual({ enabled: true, games: true, watching: true, music: false });
  });
  test("invisible hides activity", () => {
    expect(activityHiddenByStatus("invisible")).toBe(true);
    expect(activityHiddenByStatus("online")).toBe(false);
  });
});

test("typingIndicatorsEnabled defaults on", () => {
  expect(typingIndicatorsEnabled({})).toBe(true);
  expect(typingIndicatorsEnabled({ privacy: { typingIndicators: false } })).toBe(false);
});

describe("sanitizePrivacyPatch", () => {
  test("accepts valid values and dedupes lists", () => {
    const r = sanitizePrivacyPatch({ directMessages: "servers", dmBlockedServerIds: [S1, S1.toUpperCase()], typingIndicators: false, activitySharing: { music: false, junk: true } });
    expect("patch" in r && r.patch).toEqual({ directMessages: "servers", dmBlockedServerIds: [S1], typingIndicators: false, activitySharing: { music: false } });
  });
  test("passes unknown keys through", () => {
    const r = sanitizePrivacyPatch({ somethingOld: 1 });
    expect("patch" in r && r.patch).toEqual({ somethingOld: 1 });
  });
  test("rejects bad values", () => {
    expect("error" in sanitizePrivacyPatch({ directMessages: "nobody" })).toBe(true);
    expect("error" in sanitizePrivacyPatch({ friendRequests: "strangers" })).toBe(true);
    expect("error" in sanitizePrivacyPatch({ showActivity: "yes" })).toBe(true);
    expect("error" in sanitizePrivacyPatch({ dmAllowedServerIds: ["not-an-id"] })).toBe(true);
    expect("error" in sanitizePrivacyPatch({ dmAllowedServerIds: S1 })).toBe(true);
    expect("error" in sanitizePrivacyPatch({ activitySharing: { games: "no" } })).toBe(true);
    expect("error" in sanitizePrivacyPatch(["x"])).toBe(true);
  });
  test("caps the per-server lists", () => {
    const ids = Array.from({ length: MAX_DM_SERVER_OVERRIDES + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect("error" in sanitizePrivacyPatch({ dmBlockedServerIds: ids })).toBe(true);
  });
});
