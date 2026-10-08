import { describe, expect, test } from "bun:test";
import { mergeSettingsDeep } from "@/lib/settings/mergeSettings";
import { acceptsDmsFromNonFriends, acceptsFriendRequests } from "@/lib/settings/privacy";
import { evaluateNotification, setUserNotificationSettings } from "@/lib/services/notificationUX";
import { cdnImage } from "@/lib/utils";

describe("mergeSettingsDeep", () => {
  test("merges nested sections without dropping sibling keys", () => {
    const base = { voiceVideo: { inputVolume: 100, noiseSuppression: true }, theme: "dark" };
    const out = mergeSettingsDeep(base, { voiceVideo: { inputVolume: 40 } });
    expect(out).toEqual({ voiceVideo: { inputVolume: 40, noiseSuppression: true }, theme: "dark" });
    expect(base.voiceVideo.inputVolume).toBe(100);
  });
  test("arrays replace, undefined is skipped", () => {
    expect(mergeSettingsDeep({ a: [1, 2], b: 1 }, { a: [3], b: undefined })).toEqual({ a: [3], b: 1 });
  });
});

describe("privacy gates", () => {
  test("friend requests", () => {
    expect(acceptsFriendRequests(undefined)).toBe(true);
    expect(acceptsFriendRequests({ privacy: { friendRequests: "everyone" } })).toBe(true);
    expect(acceptsFriendRequests({ privacy: { friendRequests: "none" } })).toBe(false);
    expect(acceptsFriendRequests({ privacy: { friendRequests: "everyone" }, friendRequests: { allowEveryone: false } })).toBe(false);
  });
  test("DMs from non-friends", () => {
    expect(acceptsDmsFromNonFriends({ privacy: { directMessages: "everyone" } })).toBe(true);
    expect(acceptsDmsFromNonFriends({ privacy: { directMessages: "friends" } })).toBe(false);
    expect(acceptsDmsFromNonFriends({ privacy: { directMessages: "everyone" }, friendRequests: { allowServerMembers: false } })).toBe(false);
  });
});

describe("evaluateNotification @everyone", () => {
  const ctx = { isMentioned: false, isDM: false, isEveryoneMention: true, channelId: "c1", isTabVisible: false };
  test("muted @everyone is suppressed", () => {
    setUserNotificationSettings({ muteEveryone: true } as never);
    const d = evaluateNotification(ctx);
    expect(d.showDesktop || d.showToast || d.playSound).toBe(false);
  });
  test("un-muted @everyone notifies like a mention", () => {
    setUserNotificationSettings({ muteEveryone: false } as never);
    const d = evaluateNotification(ctx);
    expect(d.showDesktop).toBe(true);
    expect(d.showToast).toBe(true);
  });
  test("direct mention still notifies when @everyone is muted", () => {
    setUserNotificationSettings({ muteEveryone: true } as never);
    expect(evaluateNotification({ ...ctx, isMentioned: true }).showDesktop).toBe(true);
  });
});

describe("cdnImage still", () => {
  test("adds first-frame param on CDN urls only", () => {
    const u = new URL(cdnImage("https://cdn.serika.chat/emoji/a.gif?n=-1", { still: true }));
    expect(u.searchParams.get("n")).toBe("1");
    expect(u.searchParams.get("format")).toBe("webp");
    expect(cdnImage("https://media.tenor.com/x.gif", { still: true })).toBe("https://media.tenor.com/x.gif");
  });
});
