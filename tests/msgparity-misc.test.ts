import { describe, expect, test } from "bun:test";
import { parseVoiceStatus, MAX_VOICE_STATUS } from "../src/lib/botapi/voiceChannelStatus";
import { checkGdmJoinGrant } from "../src/lib/botapi/gdmJoin";
import { consumeForumStarter, grantForumStarter, revokeForumStarter } from "../src/lib/botapi/forumStarterGrant";

describe("voice channel status", () => {
  test("validation", () => {
    expect(parseVoiceStatus(undefined).ok).toBe(false);
    expect(parseVoiceStatus(null)).toEqual({ ok: true, status: null });
    expect(parseVoiceStatus("  ")).toEqual({ ok: true, status: null });
    expect(parseVoiceStatus(" Playing chess ")).toEqual({ ok: true, status: "Playing chess" });
    expect(parseVoiceStatus(5).ok).toBe(false);
    expect(parseVoiceStatus("x".repeat(MAX_VOICE_STATUS)).ok).toBe(true);
    expect(parseVoiceStatus("x".repeat(MAX_VOICE_STATUS + 1)).ok).toBe(false);
  });
});

describe("gdm.join grants", () => {
  const app = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  test("needs the same app, the same user and gdm.join", () => {
    expect(checkGdmJoinGrant({ applicationId: app, userId: user, scopes: ["identify", "gdm.join"] }, user, app)).toEqual({ ok: true, userId: user });
    expect(checkGdmJoinGrant(null, user, app)).toMatchObject({ ok: false, status: 403, body: { code: 50025 } });
    expect(checkGdmJoinGrant({ applicationId: "other", userId: user, scopes: ["gdm.join"] }, user, app)).toMatchObject({ ok: false, body: { code: 50025 } });
    expect(checkGdmJoinGrant({ applicationId: app, userId: "someone-else", scopes: ["gdm.join"] }, user, app)).toMatchObject({ ok: false, body: { code: 50025 } });
    expect(checkGdmJoinGrant({ applicationId: app, userId: user, scopes: ["identify"] }, user, app)).toMatchObject({ ok: false, body: { code: 50026 } });
  });
});

describe("forum starter grant", () => {
  test("single use, per thread and bot", () => {
    grantForumStarter("T1", "B1");
    expect(consumeForumStarter("t1", "b2")).toBe(false);
    expect(consumeForumStarter("t1", "b1")).toBe(true);
    expect(consumeForumStarter("t1", "b1")).toBe(false);
    grantForumStarter("T2", "B1");
    revokeForumStarter("t2", "b1");
    expect(consumeForumStarter("t2", "b1")).toBe(false);
  });
});
