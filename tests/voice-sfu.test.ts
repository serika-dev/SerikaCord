import { describe, expect, test } from "bun:test";
import { pullDecision, trackNameFor, isTrackKind } from "@/lib/voice/sfu";
import { wantedKinds } from "@/lib/voice/sfuTransport";

const publisher = {
  userId: "pub",
  sfuSession: "s1",
  tracks: { audio: "pub:audio:1", video: "pub:video:1", screen: "pub:screen:1" },
  video: true,
  screenShare: true,
};
const listener = { userId: "me" };

describe("SFU pull rules (server)", () => {
  test("a published, allowed track may be pulled", () => {
    expect(pullDecision("audio", publisher, listener)).toBeNull();
    expect(pullDecision("video", publisher, listener)).toBeNull();
    expect(pullDecision("screen", publisher, listener)).toBeNull();
  });

  test("server mute and stage suppression stop audio, not video", () => {
    expect(pullDecision("audio", { ...publisher, serverMute: true }, listener)).toBe("publisher_muted");
    expect(pullDecision("audio", { ...publisher, suppress: true }, listener)).toBe("publisher_muted");
    expect(pullDecision("video", { ...publisher, suppress: true }, listener)).toBeNull();
  });

  test("a server-deafened member can't pull audio", () => {
    expect(pullDecision("audio", publisher, { ...listener, serverDeaf: true })).toBe("puller_deafened");
    expect(pullDecision("video", publisher, { ...listener, serverDeaf: true })).toBeNull();
  });

  test("camera and screen need the server-checked flags", () => {
    expect(pullDecision("video", { ...publisher, video: false }, listener)).toBe("not_live");
    expect(pullDecision("screen", { ...publisher, screenShare: false }, listener)).toBe("not_live");
  });

  test("nothing published, or yourself", () => {
    expect(pullDecision("audio", { userId: "pub" }, listener)).toBe("not_published");
    expect(pullDecision("audio", publisher, { userId: "pub" })).toBe("self");
  });

  test("track names are per user and kind, unique per publish", () => {
    const a = trackNameFor("ABC", "audio");
    expect(a.startsWith("abc:audio:")).toBe(true);
    expect(trackNameFor("ABC", "audio")).not.toBe(a);
    expect(isTrackKind("screenAudio")).toBe(true);
    expect(isTrackKind("data")).toBe(false);
  });
});

describe("SFU pull rules (client mirror)", () => {
  test("pulls what the server would allow", () => {
    expect(wantedKinds(publisher, {})).toEqual(["audio", "video", "screen"]);
    expect(wantedKinds({ ...publisher, serverMute: true }, {})).toEqual(["video", "screen"]);
    expect(wantedKinds(publisher, { serverDeaf: true })).toEqual(["video", "screen"]);
    expect(wantedKinds({ ...publisher, video: false, screenShare: false }, {})).toEqual(["audio"]);
    expect(wantedKinds({ userId: "x", tracks: { audio: "t" } }, {})).toEqual([]);
  });

  test("agrees with the server rules for every combination", () => {
    for (const serverMute of [false, true]) for (const video of [false, true]) for (const screenShare of [false, true]) for (const serverDeaf of [false, true]) {
      const p = { ...publisher, serverMute, video, screenShare };
      const me = { userId: "me", serverDeaf };
      const server = (["audio", "video", "screen"] as const).filter((k) => pullDecision(k, p, me) === null);
      expect(wantedKinds(p, me)).toEqual([...server]);
    }
  });
});
