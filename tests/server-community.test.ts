import { describe, expect, test } from "bun:test";
import {
  generateTemplateCode,
  isScreeningBlocked,
  isTemplateDirty,
  isWelcomeScreenVisible,
  normalizeScreeningConfig,
  normalizeTemplateMeta,
  normalizeWelcomeScreen,
  parseServerSnapshot,
  parseTemplateCode,
  remapTemplateOverwrites,
  serializeServerTemplate,
  stableStringify,
  summarizeSnapshot,
} from "@/lib/servers/community";

describe("welcome screen", () => {
  test("normalizes, dedupes and caps recommended channels", () => {
    const screen = normalizeWelcomeScreen({
      enabled: true,
      description: "  Hello   there  ",
      welcomeChannels: [
        { channelId: "a", description: "Rules", emojiName: "📜" },
        { channelId: "a", description: "dupe" },
        { channelId: "b", description: "x".repeat(80), emojiName: "has space" },
        { channelId: "gone" },
        { channelId: "c" }, { channelId: "d" }, { channelId: "e" }, { channelId: "f" },
      ],
    }, new Set(["a", "b", "c", "d", "e", "f"]));
    expect(screen.description).toBe("Hello there");
    expect(screen.welcomeChannels.map((c) => c.channelId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(screen.welcomeChannels[0].emojiName).toBe("📜");
    expect(screen.welcomeChannels[1].emojiName).toBeNull();
    expect(screen.welcomeChannels[1].description.length).toBe(50);
  });

  test("visibility needs enabled + content", () => {
    expect(isWelcomeScreenVisible(normalizeWelcomeScreen({ enabled: true }))).toBe(false);
    expect(isWelcomeScreenVisible(normalizeWelcomeScreen({ enabled: false, description: "hi" }))).toBe(false);
    expect(isWelcomeScreenVisible(normalizeWelcomeScreen({ enabled: true, description: "hi" }))).toBe(true);
    expect(normalizeWelcomeScreen(null).enabled).toBe(false);
  });
});

describe("rules screening", () => {
  test("config drops empty rules and can't be enabled without rules", () => {
    expect(normalizeScreeningConfig({ enabled: true, rules: ["", "  "] }).enabled).toBe(false);
    const cfg = normalizeScreeningConfig({ enabled: true, description: "Read these", rules: [" Be nice ", "No spam", 3] });
    expect(cfg).toEqual({ enabled: true, description: "Read these", rules: ["Be nice", "No spam"] });
    expect(normalizeScreeningConfig({ rules: Array.from({ length: 40 }, (_, i) => `r${i}`) }).rules.length).toBe(16);
  });

  test("gate blocks only pending members without roles", () => {
    expect(isScreeningBlocked({ enabled: true, pending: true, roleCount: 0 })).toBe(true);
    expect(isScreeningBlocked({ enabled: false, pending: true, roleCount: 0 })).toBe(false);
    expect(isScreeningBlocked({ enabled: true, pending: false, roleCount: 0 })).toBe(false);
    expect(isScreeningBlocked({ enabled: true, pending: true, roleCount: 1 })).toBe(false);
    expect(isScreeningBlocked({ enabled: true, pending: true, roleCount: 0, exempt: true })).toBe(false);
  });
});

describe("server templates", () => {
  const server = { id: "srv", name: "Cool", description: "desc", verificationLevel: "low", systemChannelId: "general", afkChannelId: "afk" };
  const roles = [
    { id: "everyone", name: "@everyone", isDefault: true, permissions: "1024", position: 0 },
    { id: "mod", name: "Mod", permissions: "8", position: 2, color: 255, hoist: true },
    { id: "member", name: "Member", permissions: "0", position: 1 },
    { id: "bot", name: "Bot", permissions: "8", position: 3, managed: true },
  ];
  const channels = [
    { id: "general", name: "general", type: "text", position: 0, parentId: "cat",
      permissionOverwrites: [
        { id: "srv", type: "role", allow: "0", deny: "2048" },
        { id: "everyone", type: "role", allow: "64", deny: "0" },
        { id: "mod", type: "role", allow: "2048", deny: "0" },
        { id: "someuser", type: "member", allow: "8", deny: "0" },
        { id: "bot", type: "role", allow: "8", deny: "0" },
      ] },
    { id: "cat", name: "Text", type: "category", position: 0 },
    { id: "afk", name: "AFK", type: "voice", position: 1, parentId: null },
    { id: "thread", name: "a thread", type: "public_thread", parentId: "general" },
    { id: "dm", name: "dm", type: "dm" },
  ];

  test("serializes structure with local ids and no members/threads/bot roles", () => {
    const snap = serializeServerTemplate(server, roles, channels);
    expect(snap.roles.map((r) => r.name)).toEqual(["@everyone", "Member", "Mod"]);
    expect(snap.roles[0]).toMatchObject({ id: 0, permissions: "1024" });
    expect(snap.channels.map((c) => c.name)).toEqual(["Text", "general", "AFK"]);
    const general = snap.channels.find((c) => c.name === "general")!;
    expect(general.parentId).toBe(snap.channels[0].id);
    // @everyone spelled twice is merged; member + managed-role overwrites dropped.
    expect(general.permissionOverwrites).toEqual([
      { id: 0, allow: "64", deny: "2048" },
      { id: 2, allow: "2048", deny: "0" },
    ]);
    expect(snap.systemChannelId).toBe(general.id);
    expect(snap.afkChannelId).toBe(snap.channels[2].id);
    expect(summarizeSnapshot(snap)).toEqual({ categories: 1, textChannels: 1, voiceChannels: 1, roles: 2 });
  });

  test("remaps overwrites to new role ids and skips unknown roles", () => {
    const map = new Map<number, string>([[0, "new-everyone"], [2, "new-mod"]]);
    expect(remapTemplateOverwrites([{ id: 0, allow: "1", deny: "2" }, { id: 2, allow: "4", deny: "0" }, { id: 9, allow: "1", deny: "0" }], map)).toEqual([
      { id: "new-everyone", type: "role", allow: "1", deny: "2" },
      { id: "new-mod", type: "role", allow: "4", deny: "0" },
    ]);
  });

  test("dirty check ignores key order and round-trips through parse", () => {
    const snap = serializeServerTemplate(server, roles, channels);
    const stored = JSON.parse(JSON.stringify(snap));
    expect(isTemplateDirty(stored, snap)).toBe(false);
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    const changed = serializeServerTemplate({ ...server, name: "Renamed" }, roles, channels);
    expect(isTemplateDirty(stored, changed)).toBe(true);
    expect(parseServerSnapshot(stored)).toEqual(snap);
    expect(parseServerSnapshot({ roles: "nope" })).toBeNull();
  });

  test("codes and links", () => {
    const code = generateTemplateCode((n) => new Uint8Array(n).map((_, i) => i * 7));
    expect(code).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(parseTemplateCode(code)).toBe(code);
    expect(parseTemplateCode("https://serika.chat/template/AbC123xyz")).toBe("AbC123xyz");
    expect(parseTemplateCode("serika.chat/template/AbC123xyz/?ref=1")).toBe("AbC123xyz");
    expect(parseTemplateCode("bad code!")).toBeNull();
    expect(parseTemplateCode("")).toBeNull();
  });

  test("meta falls back to the server name", () => {
    expect(normalizeTemplateMeta({ name: "  ", description: "" }, "My Server")).toEqual({ name: "My Server", description: null });
    expect(normalizeTemplateMeta({ name: "T", description: "d" }, "x")).toEqual({ name: "T", description: "d" });
  });
});
