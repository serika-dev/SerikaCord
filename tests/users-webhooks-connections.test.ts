import { describe, expect, test } from "bun:test";
import { buildWebhookAuthor, cleanWebhookAvatarUrl, cleanWebhookUsername } from "@/lib/chat/webhook";
import {
  filterVisibleConnections,
  isOAuthVerifiedConnection,
  isSelfDeclarableProvider,
  toOwnConnection,
} from "@/lib/connections/policy";
import { groupMessages, messageGroupKey } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";
import { isGlobalRateLimitExempt, pickClientIpFromHeaders } from "@/lib/security";

const WH = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";

describe("webhook author", () => {
  test("uses overrides when valid and falls back to the webhook's own identity", () => {
    const base = { id: WH, name: "Deploy Bot", avatar: "https://cdn.example/a.png" };
    const plain = buildWebhookAuthor(base);
    expect(plain.id).toBe(WH);
    expect(plain.username).toBe("Deploy Bot");
    expect(plain.avatar).toBe("https://cdn.example/a.png");
    expect(plain.isBot).toBeTrue();
    expect(plain.isWebhook).toBeTrue();

    const over = buildWebhookAuthor(base, { username: "  Alice  ", avatarUrl: "https://x.example/b.png" });
    expect(over.username).toBe("Alice");
    expect(over.avatar).toBe("https://x.example/b.png");
    // The author id is always the webhook's, never someone else's.
    expect(over.id).toBe(WH);
  });

  test("rejects unusable overrides", () => {
    expect(cleanWebhookUsername("   ")).toBeNull();
    expect(cleanWebhookUsername(42)).toBeNull();
    expect(cleanWebhookUsername("x".repeat(200))?.length).toBe(80);
    expect(cleanWebhookAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(cleanWebhookAvatarUrl("not a url")).toBeNull();
    expect(cleanWebhookAvatarUrl("https://ok.example/p.png")).toBe("https://ok.example/p.png");
  });
});

describe("message grouping with webhooks", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
  const msg = (id: string, authorId: string, username: string, min: number, webhookId?: string): ChatMessage => ({
    id,
    content: id,
    authorId,
    author: { id: authorId, username, displayName: username },
    channelId: "c",
    createdAt: at(min),
    webhookId,
  });

  test("different override names through one webhook do not merge", () => {
    const groups = groupMessages([
      msg("1", WH, "Alice", 0, WH),
      msg("2", WH, "Bob", 1, WH),
      msg("3", WH, "Bob", 2, WH),
    ]);
    expect(groups.map((g) => g.messages.length)).toEqual([1, 2]);
  });

  test("webhook posts never merge with the creator's own messages", () => {
    const groups = groupMessages([msg("1", CREATOR, "creator", 0), msg("2", WH, "creator", 1, WH)]);
    expect(groups.length).toBe(2);
    expect(messageGroupKey(msg("x", CREATOR, "creator", 0))).toBe(CREATOR);
  });
});

describe("connection policy", () => {
  test("only display-only providers can be self-declared", () => {
    for (const p of ["website", "twitter", "instagram", "youtube", "xbox", "psn", "roblox", "battlenet"]) {
      expect(isSelfDeclarableProvider(p)).toBeTrue();
    }
    for (const p of ["discord", "github", "spotify", "twitch", "steam", "lastfm", "serika", "", null]) {
      expect(isSelfDeclarableProvider(p)).toBeFalse();
    }
  });

  test("only the server-set OAuth marker counts as verified", () => {
    expect(isOAuthVerifiedConnection({ metadata: { oauthVerified: true } })).toBeTrue();
    expect(isOAuthVerifiedConnection({ metadata: { oauthVerified: "true" } })).toBeFalse();
    expect(isOAuthVerifiedConnection({ metadata: { accessToken: "forged" } })).toBeFalse();
    expect(isOAuthVerifiedConnection({ metadata: null })).toBeFalse();
    expect(isOAuthVerifiedConnection(null)).toBeFalse();
  });

  test("hidden connections are only shown to their owner; NULL means visible", () => {
    const rows = [
      { id: "a", visible: true },
      { id: "b", visible: false },
      { id: "c", visible: null },
    ];
    expect(filterVisibleConnections(rows, false).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterVisibleConnections(rows, true).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("owner view strips OAuth metadata", () => {
    const own = toOwnConnection({ id: "a", provider: "lastfm", metadata: { sessionKey: "secret" } });
    expect("metadata" in own).toBeFalse();
    expect(own.id).toBe("a");
  });
});

describe("client IP and global rate-limit policy", () => {
  test("trusts only the proxy-appended (right-most) X-Forwarded-For hop", () => {
    expect(pickClientIpFromHeaders("6.6.6.6, 203.0.113.9", null)).toBe("203.0.113.9");
    expect(pickClientIpFromHeaders("203.0.113.9", null)).toBe("203.0.113.9");
    expect(pickClientIpFromHeaders(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(pickClientIpFromHeaders(" , ", null)).toBe("unknown");
    expect(pickClientIpFromHeaders(null, null)).toBe("unknown");
  });

  test("exempts streams, polling, admin and bot traffic only", () => {
    expect(isGlobalRateLimitExempt("/api/channels/x/stream")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/users/@me/activity")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/users/activity/batch")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/voice/states")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/health")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/admin/users")).toBeTrue();
    expect(isGlobalRateLimitExempt("/api/v10/channels/1/messages", "Bot abc.def")).toBeTrue();

    expect(isGlobalRateLimitExempt("/api/auth/login")).toBeFalse();
    expect(isGlobalRateLimitExempt("/api/tts/fish")).toBeFalse();
    expect(isGlobalRateLimitExempt("/api/webhooks/c/t")).toBeFalse();
    expect(isGlobalRateLimitExempt("/api/administrator")).toBeFalse();
    expect(isGlobalRateLimitExempt("/api/v10/channels/1/messages", "Bearer x")).toBeFalse();
  });
});
