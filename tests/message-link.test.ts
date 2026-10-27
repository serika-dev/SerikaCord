import { describe, expect, test } from "bun:test";
import { messageLinkTarget } from "@/lib/chat/messageLink";

const S = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const known: Record<string, string> = { "1464024795882181149": S, "1464024795882181150": C, "1464024795882181151": M };
const resolve = (sf: string) => known[sf];

describe("Discord-style message links", () => {
  test("snowflakes and UUIDs open the channel at the message", () => {
    expect(messageLinkTarget("1464024795882181149", "1464024795882181150", "1464024795882181151", resolve))
      .toBe(`/channels/${S}/${C}?jump=${M}`);
    expect(messageLinkTarget(S, C, M, resolve)).toBe(`/channels/${S}/${C}?jump=${M}`);
    expect(messageLinkTarget(S.toUpperCase(), C, M, resolve)).toBe(`/channels/${S}/${C}?jump=${M}`);
  });

  test("unknown or malformed ids fall back to the closest page", () => {
    expect(messageLinkTarget(S, C, "1464024795882189999", resolve)).toBe(`/channels/${S}/${C}`);
    expect(messageLinkTarget(S, "nope", M, resolve)).toBe(`/channels/${S}`);
    expect(messageLinkTarget("../x", C, M, resolve)).toBe("/channels/me");
    expect(messageLinkTarget("@me", C, M, resolve)).toBe("/channels/me");
  });
});
