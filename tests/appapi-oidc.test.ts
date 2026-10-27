import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "crypto";
import { atHash, buildUserInfo, idTokenClaims, parseNonce, publicJwk, rsaThumbprint, signJwtRS256, verifyJwtRS256 } from "@/lib/oauth/oidc";
import { parseApplicationPatch, toDiscordApplication } from "@/lib/botapi/application";

const USER = { id: "u1", username: "neo", displayName: "Neo", avatar: "https://cdn.serika.chat/avatars/u1/a.png", email: "neo@example.com", isVerified: true };

describe("OIDC userinfo", () => {
  test("profile with openid, email only with the email scope", () => {
    expect(buildUserInfo(USER, ["openid"])).toEqual({ sub: "u1", preferred_username: "neo", nickname: "Neo", locale: "en-US", picture: USER.avatar });
    expect(buildUserInfo(USER, ["openid", "email"])).toMatchObject({ email: "neo@example.com", email_verified: true });
    expect(buildUserInfo({ ...USER, avatar: "javascript:alert(1)" }, ["openid"]).picture).toBeUndefined();
    expect(buildUserInfo({ ...USER, isVerified: false }, ["openid", "email"]).email_verified).toBe(false);
  });
});

describe("id_token", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  test("RS256 round trip with the published JWK", () => {
    const kid = rsaThumbprint(publicKey);
    const claims = idTokenClaims({ issuer: "https://serika.chat", clientId: "123", user: USER, scopes: ["openid"], accessToken: "tok", nonce: "n-1", now: 1_700_000_000_000 });
    expect(claims).toMatchObject({ iss: "https://serika.chat", sub: "u1", aud: "123", iat: 1_700_000_000, exp: 1_700_000_000 + 604_800, nonce: "n-1", preferred_username: "neo" });
    const jwt = signJwtRS256(claims, privateKey, kid);
    expect(JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid });
    expect(verifyJwtRS256(jwt, publicKey)).toEqual(claims);
    const tampered = jwt.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ ...claims, sub: "evil" })).toString("base64url")}.`);
    expect(verifyJwtRS256(tampered, publicKey)).toBeNull();
    const jwk = publicJwk(privateKey, kid);
    expect(jwk).toMatchObject({ kty: "RSA", use: "sig", alg: "RS256", kid, e: "AQAB" });
    expect(Object.keys(jwk)).not.toContain("d");
  });

  test("at_hash is the left half of SHA-256", () => {
    const d = createHash("sha256").update("abc").digest();
    expect(atHash("abc")).toBe(d.subarray(0, 16).toString("base64url"));
  });

  test("nonce parsing", () => {
    expect(parseNonce("abc-123")).toBe("abc-123");
    expect(parseNonce("")).toBeNull();
    expect(parseNonce("a b")).toBeNull();
    expect(parseNonce("x".repeat(257))).toBeNull();
    expect(parseNonce(5)).toBeNull();
  });
});

describe("PATCH /applications/@me fields", () => {
  const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")}`;

  test("images, linked roles URL and side-table fields", () => {
    const r = parseApplicationPatch({
      icon: PNG,
      cover_image: null,
      role_connections_verification_url: "https://example.com/verify",
      event_webhooks_url: "https://example.com/events",
      event_webhooks_types: ["APPLICATION_AUTHORIZED", "APPLICATION_AUTHORIZED"],
      event_webhooks_status: 1,
      explicit_content_filter: 1,
      max_participants: -1,
      type: null,
      team_id: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.updates).toEqual({ coverImage: null });
      expect(r.images?.icon?.contentType).toBe("image/png");
      expect(r.extras).toEqual({
        roleConnectionsVerificationUrl: "https://example.com/verify",
        eventWebhooksUrl: "https://example.com/events",
        eventWebhooksTypes: ["APPLICATION_AUTHORIZED"],
        eventWebhooksStatus: 1,
        explicitContentFilter: 1,
        maxParticipants: -1,
      });
      expect(r.teamId).toBeNull();
    }
  });

  test("rejections", () => {
    const r = parseApplicationPatch({
      icon: "https://evil.example/x.png",
      role_connections_verification_url: "ftp://x",
      event_webhooks_url: "http://insecure.example",
      event_webhooks_types: ["NOPE"],
      event_webhooks_status: 2,
      explicit_content_filter: 3,
      max_participants: 1.5,
      type: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.error.errors ?? {}).sort()).toEqual([
        "event_webhooks_status", "event_webhooks_types", "event_webhooks_url", "explicit_content_filter", "icon", "max_participants",
        "role_connections_verification_url", "type",
      ]);
    }
    // A PNG declared as JPEG is refused (sniffed type must match).
    expect(parseApplicationPatch({ icon: PNG.replace("image/png", "image/jpeg") }).ok).toBe(false);
  });

  test("the application object shows the side-table fields", () => {
    const o = toDiscordApplication({ id: "a", name: "A", coverImage: "https://cdn.serika.chat/app-covers/a/x.png" }, {
      extras: { roleConnectionsVerificationUrl: "https://example.com/v", eventWebhooksStatus: 1, explicitContentFilter: 1, maxParticipants: 4 },
    });
    expect(o).toMatchObject({
      role_connections_verification_url: "https://example.com/v",
      event_webhooks_status: 1,
      event_webhooks_types: [],
      explicit_content_filter: 1,
      max_participants: 4,
      cover_image: "https://cdn.serika.chat/app-covers/a/x.png",
    });
    expect(toDiscordApplication({ id: "a", name: "A" }, {})).toMatchObject({ role_connections_verification_url: null, event_webhooks_url: null, explicit_content_filter: 0 });
  });
});
