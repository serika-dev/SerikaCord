import { describe, expect, test } from "bun:test";
import { GET as aasaRoute } from "@/app/.well-known/apple-app-site-association/route";
import {
  DEFAULT_APPLE_TEAM_ID,
  UNIVERSAL_LINK_PATHS,
  buildAppleAppSiteAssociation,
  iosAppId,
} from "@/lib/native/appleAppSiteAssociation";
import { routeFromOpenedUrl } from "@/lib/native/navigation";
import { IOS_CALL_RING_TTL_SECONDS, buildFcmMessage } from "@/lib/push/fcm";

describe("apple-app-site-association", () => {
  test("route serves JSON with the app ID, link paths and web credentials", async () => {
    const res = aasaRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text());
    const appId = `${process.env.APPLE_TEAM_ID || DEFAULT_APPLE_TEAM_ID}.dev.serika.serikacord`;
    expect(body.applinks.apps).toEqual([]);
    expect(body.applinks.details[0].appIDs).toEqual([appId]);
    expect(body.applinks.details[0].appID).toBe(appId);
    expect(body.applinks.details[0].paths).toEqual([...UNIVERSAL_LINK_PATHS]);
    expect(body.applinks.details[0].components).toEqual(UNIVERSAL_LINK_PATHS.map((path) => ({ "/": path })));
    expect(body.webcredentials.apps).toEqual([appId]);
  });

  test("team ID override is validated", () => {
    expect(iosAppId("abcde12345")).toBe("ABCDE12345.dev.serika.serikacord");
    expect(iosAppId("not a team")).toBe(`${DEFAULT_APPLE_TEAM_ID}.dev.serika.serikacord`);
    expect(iosAppId(undefined)).toBe(`${DEFAULT_APPLE_TEAM_ID}.dev.serika.serikacord`);
    expect(buildAppleAppSiteAssociation("ZZZZZ99999").webcredentials.apps).toEqual(["ZZZZZ99999.dev.serika.serikacord"]);
  });

  test("every universal link path is one the app routes", () => {
    for (const path of UNIVERSAL_LINK_PATHS) {
      const sample = path.replace("*", "abc123");
      expect(routeFromOpenedUrl(`https://serika.chat${sample}`)).toBe(sample);
    }
  });
});

describe("routeFromOpenedUrl", () => {
  test("universal links keep path, query and hash", () => {
    expect(routeFromOpenedUrl("https://serika.chat/invite/abc")).toBe("/invite/abc");
    expect(routeFromOpenedUrl("https://canary.serika.chat/channels/s1/c1?jump=m1")).toBe("/channels/s1/c1?jump=m1");
    expect(routeFromOpenedUrl("https://serika.chat/dm/u1/")).toBe("/dm/u1");
    expect(routeFromOpenedUrl("https://serika.chat/qr/tok#x")).toBe("/qr/tok#x");
    expect(routeFromOpenedUrl("https://serika.chat/oauth2/authorize?client_id=1")).toBe("/oauth2/authorize?client_id=1");
  });

  test("custom scheme", () => {
    expect(routeFromOpenedUrl("serikacord://channels/me")).toBe("/channels/me");
    expect(routeFromOpenedUrl("serikacord://channels/s1/c1")).toBe("/channels/s1/c1");
    expect(routeFromOpenedUrl("serikacord://dm/u1")).toBe("/dm/u1");
  });

  test("anything else is ignored", () => {
    expect(routeFromOpenedUrl("https://evil.example/channels/me")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat.evil.example/invite/x")).toBeNull();
    expect(routeFromOpenedUrl("http://serika.chat/invite/x")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat:8443/invite/x")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat/")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat/login")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat/invite/")).toBeNull();
    expect(routeFromOpenedUrl("https://serika.chat/api/users/@me")).toBeNull();
    expect(routeFromOpenedUrl("serikacord://login")).toBeNull();
    expect(routeFromOpenedUrl("javascript:alert(1)")).toBeNull();
    expect(routeFromOpenedUrl("not a url")).toBeNull();
    expect(routeFromOpenedUrl(undefined)).toBeNull();
    expect(routeFromOpenedUrl(42)).toBeNull();
  });
});

describe("iOS pushes", () => {
  test("messages stay system-rendered with a thread id", () => {
    const msg = buildFcmMessage("tok", { kind: "message", title: "Alice", body: "hi", route: "/dm/a", tag: "message-c1" }, { protocol: 1, ios: true }) as {
      notification: { title: string };
      data: Record<string, string>;
      apns: { payload: { aps: Record<string, unknown> } };
    };
    expect(msg.notification.title).toBe("Alice");
    expect(msg.data.route).toBe("/dm/a");
    expect(msg.apns.payload.aps["thread-id"]).toBe("message-c1");
  });

  test("call rings are visible, short-lived alerts that open the DM", () => {
    const before = Math.floor(Date.now() / 1000);
    const msg = buildFcmMessage(
      "tok",
      { kind: "call_ring", roomId: "dm-a-b", callerName: "Bob", video: false, route: "/dm/b", answerRoute: "/dm/b?call=voice" },
      { ios: true },
    ) as {
      notification: { title: string; body: string };
      data: Record<string, string>;
      apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
      android?: unknown;
    };
    expect(msg.notification).toEqual({ title: "Bob", body: "Incoming voice call" });
    expect(msg.data.route).toBe("/dm/b");
    expect(Object.values(msg.data).every((v) => typeof v === "string")).toBe(true);
    expect(msg.apns.headers["apns-push-type"]).toBe("alert");
    const expires = Number(msg.apns.headers["apns-expiration"]);
    expect(expires).toBeGreaterThanOrEqual(before + IOS_CALL_RING_TTL_SECONDS);
    expect(expires).toBeLessThanOrEqual(before + IOS_CALL_RING_TTL_SECONDS + 5);
    expect(msg.apns.payload.aps["thread-id"]).toBe("call-dm-a-b");
    expect(msg.android).toBeUndefined();
  });

  test("an unnamed caller still gets a title", () => {
    const msg = buildFcmMessage(
      "tok",
      { kind: "call_ring", roomId: "r", callerName: "", video: true, route: "/channels/messages", answerRoute: "/channels/messages" },
      { ios: true },
    ) as { notification: { title: string; body: string } };
    expect(msg.notification).toEqual({ title: "Incoming video call", body: "Incoming video call" });
  });

  test("read / cancel are background pushes", () => {
    for (const payload of [{ kind: "message_read", tag: "message-c1" }, { kind: "call_cancel", roomId: "dm-a-b" }] as const) {
      const msg = buildFcmMessage("tok", payload, { ios: true }) as {
        notification?: unknown;
        data: Record<string, string>;
        apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
      };
      expect(msg.notification).toBeUndefined();
      expect(msg.apns.headers).toEqual({ "apns-push-type": "background", "apns-priority": "5" });
      expect(msg.apns.payload.aps["content-available"]).toBe(1);
    }
  });

  test("Android pushes are unchanged", () => {
    const ring = buildFcmMessage("tok", { kind: "call_ring", roomId: "r", callerName: "Bob", video: false, route: "/dm/b", answerRoute: "/dm/b?call=voice" }) as {
      notification?: unknown;
      apns?: unknown;
    };
    expect(ring.notification).toBeUndefined();
    expect(ring.apns).toBeUndefined();
  });
});
