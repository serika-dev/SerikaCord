import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WEBHOOK_NAMES,
  WEBHOOK_NAME_MAX,
  checkWebhookName,
  checkWebhookOverrides,
  classifyWebhookAvatar,
  randomWebhookName,
  webhookErrorMessage,
  webhookNameError,
} from "@/lib/chat/webhook";
import { groupMessages, messageGroupKey } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

const WH = "11111111-1111-4111-8111-111111111111";
const OWN = (url: string) => url.startsWith("https://cdn.serika.chat/");

describe("webhook names (create / edit)", () => {
  test("trims, strips invisible characters and keeps the rest as typed", () => {
    expect(checkWebhookName("  Deploy Bot  ")).toEqual({ ok: true, name: "Deploy Bot" });
    expect(checkWebhookName("Build​bot")).toEqual({ ok: true, name: "Buildbot" });
    // Not HTML-escaped: names render as text and go out unchanged on the bot API.
    expect(checkWebhookName("Tom & Jerry <3")).toEqual({ ok: true, name: "Tom & Jerry <3" });
  });

  test("1 to 80 characters, rejected (not cut) when longer", () => {
    expect(checkWebhookName("")).toEqual({ ok: false, reason: "length" });
    expect(checkWebhookName("   ​ ")).toEqual({ ok: false, reason: "length" });
    expect(checkWebhookName("x".repeat(WEBHOOK_NAME_MAX)).ok).toBe(true);
    expect(checkWebhookName("x".repeat(WEBHOOK_NAME_MAX + 1))).toEqual({ ok: false, reason: "length" });
    expect(checkWebhookName(42)).toEqual({ ok: false, reason: "type" });
  });

  test("Discord's words and ours are blocked in any case or spacing", () => {
    expect(checkWebhookName("Clyde")).toEqual({ ok: false, reason: "blocked", word: "clyde" });
    expect(checkWebhookName("my DISCORD relay")).toEqual({ ok: false, reason: "blocked", word: "discord" });
    expect(checkWebhookName("S.e.r.i.k.a")).toEqual({ ok: false, reason: "blocked", word: "serika" });
    const blocked = checkWebhookName("Ad min");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(webhookNameError(blocked)).toBe('Webhook names cannot contain "admin"');
  });

  test("default names are valid and picked from the list", () => {
    for (const name of DEFAULT_WEBHOOK_NAMES) expect(checkWebhookName(name)).toEqual({ ok: true, name });
    expect(randomWebhookName(() => 0)).toBe(DEFAULT_WEBHOOK_NAMES[0]);
    expect(randomWebhookName(() => 0.9999)).toBe(DEFAULT_WEBHOOK_NAMES[DEFAULT_WEBHOOK_NAMES.length - 1]);
    expect(randomWebhookName(() => 1)).toBe(DEFAULT_WEBHOOK_NAMES[DEFAULT_WEBHOOK_NAMES.length - 1]);
  });
});

describe("webhook avatar input (create / edit)", () => {
  test("undefined keeps, null or empty clears", () => {
    expect(classifyWebhookAvatar(undefined, OWN)).toEqual({ kind: "keep" });
    expect(classifyWebhookAvatar(null, OWN)).toEqual({ kind: "clear" });
    expect(classifyWebhookAvatar("", OWN)).toEqual({ kind: "clear" });
  });

  test("image data is uploaded, our own CDN URLs are kept", () => {
    expect(classifyWebhookAvatar("data:image/png;base64,iVBORw0KGgo=", OWN).kind).toBe("data");
    expect(classifyWebhookAvatar("https://cdn.serika.chat/webhook-avatars/x/a.png", OWN)).toEqual({
      kind: "url",
      url: "https://cdn.serika.chat/webhook-avatars/x/a.png",
    });
  });

  test("other hosts, other schemes and other types are refused", () => {
    expect(classifyWebhookAvatar("https://evil.example/a.png", OWN).kind).toBe("invalid");
    expect(classifyWebhookAvatar("javascript:alert(1)", OWN).kind).toBe("invalid");
    expect(classifyWebhookAvatar(123, OWN).kind).toBe("invalid");
  });
});

describe("execute overrides (username / avatar_url)", () => {
  test("valid overrides pass through, empty ones fall back", () => {
    expect(checkWebhookOverrides({ username: "  Alice ", avatarUrl: "https://x.example/a.png" })).toEqual({
      ok: true,
      username: "Alice",
      avatarUrl: "https://x.example/a.png",
    });
    expect(checkWebhookOverrides({})).toEqual({ ok: true, username: null, avatarUrl: null });
    expect(checkWebhookOverrides({ username: "   ", avatarUrl: "" })).toEqual({ ok: true, username: null, avatarUrl: null });
  });

  test("Discord's rules are errors", () => {
    expect(checkWebhookOverrides({ username: "clyde" })).toMatchObject({ ok: false, field: "username", code: "USERNAME_INVALID_CONTAINS" });
    expect(checkWebhookOverrides({ username: "Discord Bridge" })).toMatchObject({ ok: false, field: "username" });
    expect(checkWebhookOverrides({ username: "x".repeat(81) })).toMatchObject({ ok: false, code: "BASE_TYPE_BAD_LENGTH" });
    expect(checkWebhookOverrides({ username: 5 })).toMatchObject({ ok: false, code: "BASE_TYPE_BAD_TYPE" });
    expect(checkWebhookOverrides({ avatarUrl: "not a url" })).toMatchObject({ ok: false, field: "avatar_url", code: "URL_TYPE_INVALID_URL" });
    expect(checkWebhookOverrides({ avatarUrl: "ftp://x.example/a.png" })).toMatchObject({ ok: false, code: "URL_TYPE_INVALID_SCHEME" });
    expect(checkWebhookOverrides({ avatarUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, code: "URL_TYPE_INVALID_SCHEME" });
  });

  test("our extra blocked words fall back to the webhook's name instead of failing", () => {
    expect(checkWebhookOverrides({ username: "Moderator Mike" })).toEqual({ ok: true, username: null, avatarUrl: null });
  });

  test("http avatars are upgraded to https; credentials in the URL are dropped", () => {
    expect(checkWebhookOverrides({ avatarUrl: "http://x.example/a.png" })).toEqual({ ok: true, username: null, avatarUrl: "https://x.example/a.png" });
    expect(checkWebhookOverrides({ avatarUrl: "https://u:p@x.example/a.png" })).toEqual({ ok: true, username: null, avatarUrl: null });
  });
});

describe("webhook error messages for the web app", () => {
  test("first form error leaf, then the message, then the fallback", () => {
    const form = { code: 50035, message: "Invalid Form Body (name: x)", errors: { name: { _errors: [{ code: "X", message: "Bad name" }] } } };
    expect(webhookErrorMessage(form)).toBe("Bad name");
    expect(webhookErrorMessage({ code: 30007, message: "Maximum number of webhooks reached (15)" })).toBe("Maximum number of webhooks reached (15)");
    expect(webhookErrorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("grouping webhook posts", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
  const msg = (id: string, username: string, avatar: string | undefined, min: number): ChatMessage => ({
    id,
    content: id,
    authorId: WH,
    author: { id: WH, username, displayName: username, avatar },
    channelId: "c",
    createdAt: at(min),
    webhookId: WH,
  });

  test("same name but a different avatar starts a new group", () => {
    const groups = groupMessages([msg("1", "CI", "https://a/1.png", 0), msg("2", "CI", "https://a/2.png", 1), msg("3", "CI", "https://a/2.png", 2)]);
    expect(groups.map((g) => g.messages.length)).toEqual([1, 2]);
    expect(messageGroupKey(msg("x", "CI", undefined, 0))).not.toBe(messageGroupKey(msg("y", "CI", "https://a/1.png", 0)));
  });
});
