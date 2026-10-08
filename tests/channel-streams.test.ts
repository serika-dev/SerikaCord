import { describe, expect, test } from "bun:test";
import {
  recheckLocalUserChannelStreams,
  requestUserChannelStreamRecheck,
  setChannelStreamRecheckPublisher,
  trackUserChannelStream,
} from "@/lib/realtime/channelStreams";

describe("channel stream access recheck registry", () => {
  test("rechecks only the given user's streams", async () => {
    const calls: string[] = [];
    const untrackA1 = trackUserChannelStream("user-a", { channelId: "c1", revalidate: async () => { calls.push("a:c1"); } });
    const untrackA2 = trackUserChannelStream("user-a", { channelId: "c2", revalidate: async () => { calls.push("a:c2"); } });
    const untrackB = trackUserChannelStream("user-b", { channelId: "c1", revalidate: async () => { calls.push("b:c1"); } });

    await recheckLocalUserChannelStreams("user-a");
    expect(calls.sort()).toEqual(["a:c1", "a:c2"]);

    untrackA1();
    untrackA2();
    untrackB();
  });

  test("untracked streams are no longer rechecked", async () => {
    let count = 0;
    const untrack = trackUserChannelStream("user-c", { channelId: "c1", revalidate: async () => { count += 1; } });
    untrack();
    untrack(); // idempotent
    await recheckLocalUserChannelStreams("user-c");
    expect(count).toBe(0);
  });

  test("a failing revalidate doesn't stop the others", async () => {
    let ok = 0;
    const u1 = trackUserChannelStream("user-d", { channelId: "c1", revalidate: async () => { throw new Error("db down"); } });
    const u2 = trackUserChannelStream("user-d", { channelId: "c2", revalidate: async () => { ok += 1; } });
    await recheckLocalUserChannelStreams("user-d");
    expect(ok).toBe(1);
    u1();
    u2();
  });

  test("requesting a recheck also fans out through the registered publisher", () => {
    const published: string[] = [];
    setChannelStreamRecheckPublisher((userId) => { published.push(userId); });
    requestUserChannelStreamRecheck("user-e");
    expect(published).toEqual(["user-e"]);
    setChannelStreamRecheckPublisher(() => {});
  });
});
