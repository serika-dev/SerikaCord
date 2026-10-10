import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { BackStack, classifySwipe, isAppRoute, parentRoute } from "@/lib/native/navigation";
import { firstOpaque, isDarkColor, parseCssColor, toHex } from "@/lib/native/systemBars";
import {
  ACTIVE_HEARTBEAT_MS,
  buildFcmMessage,
  classifyFcmResponse,
  isPlausibleDeviceToken,
  parseServiceAccount,
  pushPreview,
  shouldPushToUser,
} from "@/lib/push/fcm";
import { PULL_THRESHOLD, pullResistance } from "@/hooks/usePullToRefresh";

describe("parentRoute (Android back)", () => {
  test("conversation → list → home → minimize", () => {
    expect(parentRoute("/channels/s1/c1")).toBe("/channels/s1");
    expect(parentRoute("/channels/s1")).toBe("/channels/me");
    expect(parentRoute("/channels/me")).toBeNull();
    expect(parentRoute("/channels")).toBeNull();
  });

  test("DMs and tabs go back to their list / home", () => {
    expect(parentRoute("/dm/u1")).toBe("/channels/messages");
    expect(parentRoute("/dm/u1?jump=m1")).toBe("/channels/messages");
    expect(parentRoute("/channels/me/u1")).toBe("/channels/messages");
    expect(parentRoute("/channels/messages")).toBe("/channels/me");
    expect(parentRoute("/channels/notifications")).toBe("/channels/me");
    expect(parentRoute("/channels/profile/")).toBe("/channels/me");
  });

  test("settings and explore", () => {
    expect(parentRoute("/channels/settings/appearance")).toBe("/channels/settings");
    expect(parentRoute("/channels/settings")).toBe("/channels/profile");
    expect(parentRoute("/channels/explore")).toBe("/channels/me");
  });

  test("outside the app shell there is no parent", () => {
    expect(parentRoute("/login")).toBeNull();
    expect(parentRoute(null)).toBeNull();
  });
});

describe("BackStack", () => {
  test("newest handler wins, removal works, false passes on", () => {
    const stack = new BackStack();
    const calls: string[] = [];
    const removeA = stack.push(() => { calls.push("a"); });
    const removeB = stack.push(() => { calls.push("b"); return false; });
    expect(stack.handle()).toBe(true);
    expect(calls).toEqual(["b", "a"]);
    removeA();
    calls.length = 0;
    expect(stack.handle()).toBe(false);
    expect(calls).toEqual(["b"]);
    removeB();
    expect(stack.size).toBe(0);
    expect(stack.handle()).toBe(false);
  });

  test("a throwing handler doesn't swallow the press", () => {
    const stack = new BackStack();
    let ran = false;
    stack.push(() => { ran = true; });
    stack.push(() => { throw new Error("boom"); });
    expect(stack.handle()).toBe(true);
    expect(ran).toBe(true);
  });
});

describe("isAppRoute", () => {
  test("accepts in-app paths only", () => {
    expect(isAppRoute("/dm/abc")).toBe(true);
    expect(isAppRoute("/channels/s/c?jump=1")).toBe(true);
    expect(isAppRoute("//evil.example")).toBe(false);
    expect(isAppRoute("https://evil.example")).toBe(false);
    expect(isAppRoute("/login")).toBe(false);
    expect(isAppRoute(42)).toBe(false);
  });
});

describe("classifySwipe", () => {
  const w = 400;
  test("long horizontal drags navigate", () => {
    expect(classifySwipe({ dx: 160, dy: 10, dt: 400, width: w })).toBe("right");
    expect(classifySwipe({ dx: -160, dy: 12, dt: 400, width: w })).toBe("left");
  });
  test("quick flicks count, slow short drags don't", () => {
    expect(classifySwipe({ dx: 70, dy: 5, dt: 100, width: w })).toBe("right");
    expect(classifySwipe({ dx: 70, dy: 5, dt: 600, width: w })).toBeNull();
  });
  test("vertical scrolling never navigates", () => {
    expect(classifySwipe({ dx: 120, dy: 100, dt: 200, width: w })).toBeNull();
    expect(classifySwipe({ dx: 20, dy: 0, dt: 10, width: w })).toBeNull();
  });
});

describe("system bar colours", () => {
  test("parses computed colours", () => {
    expect(parseCssColor("rgb(10, 10, 10)")).toEqual({ r: 10, g: 10, b: 10, a: 1 });
    expect(parseCssColor("rgba(255, 255, 255, 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseCssColor("rgb(1 2 3 / 40%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.4 });
    expect(parseCssColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseCssColor("transparent")).toBeNull();
  });
  test("hex and darkness", () => {
    expect(toHex({ r: 10, g: 10, b: 10, a: 1 })).toBe("#0A0A0A");
    expect(isDarkColor({ r: 10, g: 10, b: 10, a: 1 })).toBe(true);
    expect(isDarkColor({ r: 250, g: 250, b: 250, a: 1 })).toBe(false);
  });
  test("skips transparent layers", () => {
    expect(firstOpaque(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"])).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(firstOpaque([null, "transparent"])).toBeNull();
  });
});

describe("pull to refresh", () => {
  test("resistance and threshold", () => {
    expect(pullResistance(-10)).toBe(0);
    expect(pullResistance(100)).toBe(50);
    expect(pullResistance(1000)).toBe(120);
    expect(pullResistance(PULL_THRESHOLD * 2) >= PULL_THRESHOLD).toBe(true);
  });
});

describe("FCM helpers", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const sa = { project_id: "serika-test", client_email: "push@serika-test.iam.gserviceaccount.com", private_key: pem };

  test("parses raw, escaped and base64 service accounts", () => {
    expect(parseServiceAccount(JSON.stringify(sa))?.projectId).toBe("serika-test");
    const escaped = JSON.stringify({ ...sa, private_key: pem.replace(/\n/g, "\\n") });
    expect(parseServiceAccount(escaped)?.privateKey).toBe(pem);
    const b64 = Buffer.from(JSON.stringify(sa)).toString("base64");
    expect(parseServiceAccount(b64)?.clientEmail).toBe(sa.client_email);
  });

  test("rejects missing or broken config", () => {
    expect(parseServiceAccount("")).toBeNull();
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("{not json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull();
  });

  test("message pushes carry route, tag and the messages channel", () => {
    const msg = buildFcmMessage("tok", { kind: "message", title: "Alice", body: "hi  there", route: "/dm/a", tag: "message-c1" }) as {
      notification: { title: string; body: string };
      data: Record<string, string>;
      android: { notification: { channel_id: string; tag: string } };
    };
    expect(msg.notification).toEqual({ title: "Alice", body: "hi there" });
    expect(msg.data).toEqual({ type: "message", route: "/dm/a", tag: "message-c1" });
    expect(msg.android.notification.channel_id).toBe("messages");
    expect(msg.android.notification.tag).toBe("message-c1");
  });

  test("call rings are data-only with string values", () => {
    const msg = buildFcmMessage("tok", {
      kind: "call_ring", roomId: "dm-a-b", callerName: "Bob", video: true, route: "/dm/b", answerRoute: "/dm/b?call=video",
    }) as { notification?: unknown; data: Record<string, unknown>; android: { priority: string } };
    expect(msg.notification).toBeUndefined();
    expect(msg.android.priority).toBe("HIGH");
    expect(Object.values(msg.data).every((v) => typeof v === "string")).toBe(true);
    expect(msg.data.video).toBe("1");
    const cancel = buildFcmMessage("tok", { kind: "call_cancel", roomId: "dm-a-b" }) as { data: Record<string, string> };
    expect(cancel.data).toEqual({ type: "call_cancel", roomId: "dm-a-b" });
  });

  test("classifies send results", () => {
    expect(classifyFcmResponse(200, {})).toBe("ok");
    expect(classifyFcmResponse(404, { error: { status: "NOT_FOUND" } })).toBe("unregistered");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } })).toBe("unregistered");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } })).toBe("unregistered");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } })).toBe("failed");
    expect(classifyFcmResponse(503, null)).toBe("retry");
    expect(classifyFcmResponse(429, null)).toBe("retry");
  });

  test("push only when the user isn't in the app", () => {
    const now = 1_000_000_000;
    expect(shouldPushToUser({ away: true, connectedHere: true, now })).toBe(true);
    expect(shouldPushToUser({ away: false, connectedHere: true, now })).toBe(false);
    expect(shouldPushToUser({ away: false, connectedHere: false, lastHeartbeatAt: now - 10_000, now })).toBe(false);
    expect(shouldPushToUser({ away: false, connectedHere: false, lastHeartbeatAt: now - ACTIVE_HEARTBEAT_MS - 1, now })).toBe(true);
    expect(shouldPushToUser({ away: false, connectedHere: false, lastHeartbeatAt: null, now })).toBe(true);
  });

  test("previews decode entities and markup", () => {
    expect(pushPreview("hey &lt;@abcdef12-3456&gt; &amp; <@abcdef12-3456> <:wave:123456789>")).toBe("hey @user & @user :wave:");
    expect(pushPreview("x".repeat(500)).length <= 240).toBe(true);
  });

  test("device token shape", () => {
    expect(isPlausibleDeviceToken("fcm-token_abc:APA91bExample-1234567890")).toBe(true);
    expect(isPlausibleDeviceToken("short")).toBe(false);
    expect(isPlausibleDeviceToken("has spaces in it but long enough")).toBe(false);
    expect(isPlausibleDeviceToken(undefined)).toBe(false);
  });
});
