import { describe, expect, test } from "bun:test";
import {
  applyCustomizationOverrides,
  cleanBio,
  copyMainIntoOverrides,
  diffOverrides,
  hasServerProfile,
  isMemberMediaUrl,
  memberOverridesFromRow,
  overriddenFields,
  overridesPatch,
  readProfileJson,
  resolveMemberProfile,
  sanitizeDisplayNameStyle,
  sanitizeMemberProfilePatch,
  sanitizeTheme,
  withServerProfile,
} from "@/lib/profiles/memberProfile";

const CDN = "https://cdn.serika.chat";
const SERVER = "0b7c1d1e-1111-4a2b-9c3d-0000000000aa";
const USER = "0b7c1d1e-1111-4a2b-9c3d-0000000000b0";
const OTHER = "0b7c1d1e-1111-4a2b-9c3d-0000000000b1";
const ctx = (current = {}) => ({ userId: USER, serverId: SERVER, cdnUrl: CDN, current });

const main = {
  username: "pika",
  displayName: "Pikachu",
  avatar: `${CDN}/avatars/${USER}/a.png`,
  banner: `${CDN}/banners/${USER}/b.png`,
  bio: "Main bio",
  pronouns: "he/him",
  customization: {
    displayNameStyle: { font: "serif", effect: "neon", color: "#ff0000", gradient: [] },
    nameplate: { type: "preset", presetId: "ocean" },
    profileColor: "#111111",
    profileGradient: ["#222222", "#333333"],
    serverTag: { serverId: SERVER },
  },
};

describe("override fallback", () => {
  test("no overrides: the main profile", () => {
    const p = resolveMemberProfile(main, {});
    expect(p.displayName).toBe("Pikachu");
    expect(p.avatar).toBe(main.avatar);
    expect(p.banner).toBe(main.banner);
    expect(p.bio).toBe("Main bio");
    expect(p.pronouns).toBe("he/him");
    expect(p.customization).toBe(main.customization);
  });

  test("each override wins over its main field only", () => {
    const p = resolveMemberProfile(main, {
      nickname: "Pika",
      avatar: `${CDN}/avatars/${SERVER}/${USER}/s.png`,
      bio: "Server bio",
      nameplate: { type: "none" },
      theme: { profileColor: "#abcdef", profileGradient: [] },
    });
    expect(p.displayName).toBe("Pika");
    expect(p.avatar).toContain(SERVER);
    expect(p.banner).toBe(main.banner);
    expect(p.bio).toBe("Server bio");
    expect(p.pronouns).toBe("he/him");
    const c = p.customization as Record<string, unknown>;
    expect(c.nameplate).toEqual({ type: "none" });
    // The theme replaces both colours: the main gradient must not win.
    expect(c.profileColor).toBe("#abcdef");
    expect(c.profileGradient).toEqual([]);
    expect(c.displayNameStyle).toEqual(main.customization.displayNameStyle);
    expect(c.serverTag).toEqual({ serverId: SERVER });
  });

  test("username when there is no display name", () => {
    expect(resolveMemberProfile({ username: "u" }, null).displayName).toBe("u");
  });

  test("customization is reused when no style is overridden", () => {
    const c = { a: 1 };
    expect(applyCustomizationOverrides(c, { nickname: "x" })).toBe(c);
    expect(applyCustomizationOverrides(null, { nameplate: { type: "color", color: "#ffffff" } })).toEqual({ nameplate: { type: "color", color: "#ffffff" } });
  });
});

describe("stored overrides", () => {
  test("row columns + json", () => {
    const o = memberOverridesFromRow({ nickname: "N", avatar: null, banner: "", profileOverrides: { bio: "B", pronouns: "  they  " } });
    expect(o).toEqual({ nickname: "N", bio: "B", pronouns: "they" });
    expect(overriddenFields(o)).toEqual(["nickname", "pronouns", "bio"]);
    expect(hasServerProfile(o)).toBe(true);
    expect(hasServerProfile(memberOverridesFromRow({ profileOverrides: null }))).toBe(false);
  });

  test("malformed json is dropped, not rendered", () => {
    expect(readProfileJson("nope")).toEqual({});
    expect(readProfileJson([1, 2])).toEqual({});
    expect(readProfileJson({ bio: 5, displayNameStyle: { font: "comic" }, theme: { profileColor: "red" }, nameplate: { type: "evil" } })).toEqual({});
  });

  test("unknown keys are stripped", () => {
    expect(readProfileJson({ bio: "b", junk: 1, nameplate: { type: "color", color: "#ffffff", onclick: "x", gradient: [1] } }))
      .toEqual({ bio: "b", nameplate: { type: "color", color: "#ffffff" } });
  });
});

describe("validation", () => {
  test("display name style", () => {
    expect(sanitizeDisplayNameStyle({ font: "mono", effect: "gradient", gradient: ["#fff", "#000000"] })).toEqual({ font: "mono", effect: "gradient", color: "", gradient: ["#FFFFFF", "#000000"] });
    expect(sanitizeDisplayNameStyle({ font: "papyrus" })).toBeNull();
    expect(sanitizeDisplayNameStyle({ color: "url(x)" })).toBeNull();
    expect(sanitizeDisplayNameStyle({ gradient: ["#fff"] })).toBeNull();
  });

  test("theme", () => {
    expect(sanitizeTheme({ profileColor: "#abcdef" })).toEqual({ profileColor: "#ABCDEF", profileGradient: [] });
    expect(sanitizeTheme({ profileGradient: ["#000", "#111", "#222", "#333", "#444"] })).toBeNull();
    expect(sanitizeTheme({ profileColor: "blue" })).toBeNull();
  });

  test("bio cleaning keeps inner newlines", () => {
    expect(cleanBio("\r\nhello\r\n\nworld   \n")).toBe("hello\n\nworld");
    expect(Array.from(cleanBio("é".repeat(1200))).length).toBe(1000);
  });

  test("member media urls", () => {
    const ok = `${CDN}/avatars/${SERVER}/${USER}/abc_123.gif`;
    expect(isMemberMediaUrl(ok, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(true);
    expect(isMemberMediaUrl(ok.toUpperCase(), { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(ok, { kind: "banner", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(`${CDN}/avatars/${SERVER}/${OTHER}/a.png`, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(`${CDN}/avatars/${USER}/a.png`, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(`https://evil.example/avatars/${SERVER}/${USER}/a.png`, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(`${ok}?x=1`, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
    expect(isMemberMediaUrl(`${CDN}/avatars/${SERVER}/${USER}/..`, { kind: "avatar", serverId: SERVER, userId: USER, cdnUrl: CDN })).toBe(false);
  });
});

describe("PATCH sanitizing", () => {
  test("sets, clears and leaves fields", () => {
    const current = { nickname: "Old", bio: "Old bio", theme: { profileColor: "#000000", profileGradient: [] } };
    const r = sanitizeMemberProfilePatch({ nickname: " New ", bio: null, pronouns: "she/her", displayNameStyle: { font: "bold", effect: "pop" } }, ctx(current));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columns).toEqual({ nickname: "New" });
    expect(r.next).toEqual({ nickname: "New", pronouns: "she/her", displayNameStyle: { font: "bold", effect: "pop", color: "", gradient: [] }, theme: current.theme });
    expect(r.json).toEqual({ pronouns: "she/her", displayNameStyle: { font: "bold", effect: "pop", color: "", gradient: [] }, theme: current.theme });
    expect(r.changed.sort()).toEqual(["bio", "displayNameStyle", "nickname", "pronouns"]);
  });

  test("nickname length is checked before it is escaped for storage", () => {
    const name = "Tom & Jerry & Co & Friends & Me"; // 31 characters, longer once escaped
    const r = sanitizeMemberProfilePatch({ nickname: name }, { ...ctx(), storeNickname: (n) => n.replaceAll("&", "&amp;") });
    expect(r).toMatchObject({ ok: true, columns: { nickname: name.replaceAll("&", "&amp;") } });
  });

  test("untouched json is not rewritten", () => {
    const r = sanitizeMemberProfilePatch({ nickname: "x" }, ctx({ bio: "keep" }));
    expect(r.ok && r.json).toBeUndefined();
  });

  test("limits and types", () => {
    expect(sanitizeMemberProfilePatch({ nickname: "x".repeat(33) }, ctx())).toMatchObject({ ok: false, field: "nickname" });
    expect(sanitizeMemberProfilePatch({ pronouns: "x".repeat(40) }, ctx())).toMatchObject({ ok: false, field: "pronouns" });
    expect(sanitizeMemberProfilePatch({ bio: 7 }, ctx())).toMatchObject({ ok: false, field: "bio" });
    expect(sanitizeMemberProfilePatch({ theme: { profileColor: "javascript:" } }, ctx())).toMatchObject({ ok: false, field: "theme" });
    expect(sanitizeMemberProfilePatch({ nameplate: { type: "image", imageUrl: "https://evil.example/x.png" } }, ctx())).toMatchObject({ ok: false, field: "nameplate" });
    expect(sanitizeMemberProfilePatch("x", ctx())).toMatchObject({ ok: false });
  });

  test("images must be this member's per-server uploads, or unchanged", () => {
    const legacy = "https://legacy.example/a.png";
    expect(sanitizeMemberProfilePatch({ avatar: `${CDN}/avatars/${USER}/main.png` }, ctx())).toMatchObject({ ok: false, field: "avatar" });
    expect(sanitizeMemberProfilePatch({ avatar: legacy }, ctx({ avatar: legacy }))).toMatchObject({ ok: true, changed: [] });
    const r = sanitizeMemberProfilePatch({ banner: `${CDN}/banners/${SERVER}/${USER}/new.webp` }, ctx());
    expect(r).toMatchObject({ ok: true, columns: { banner: `${CDN}/banners/${SERVER}/${USER}/new.webp` } });
  });

  test("reset clears everything", () => {
    const r = sanitizeMemberProfilePatch({ reset: true }, ctx({ nickname: "n", avatar: "a", bio: "b", nameplate: { type: "none" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual({});
    expect(r.columns).toEqual({ nickname: null, avatar: null });
    expect(r.json).toEqual({});
  });
});

describe("editor helpers", () => {
  test("copy from main profile copies text and styles, not images", () => {
    const o = copyMainIntoOverrides(main, { avatar: "x" });
    expect(o.nickname).toBe("Pikachu");
    expect(o.bio).toBe("Main bio");
    expect(o.pronouns).toBe("he/him");
    expect(o.avatar).toBe("x");
    expect(o.banner).toBeUndefined();
    expect(o.displayNameStyle).toEqual({ font: "serif", effect: "neon", color: "#FF0000", gradient: [] });
    expect(o.nameplate).toEqual({ type: "preset", presetId: "ocean" });
    expect(o.theme).toEqual({ profileColor: "#111111", profileGradient: ["#222222", "#333333"] });
  });

  test("diff and patch body", () => {
    const saved = { nickname: "a", bio: "b" };
    const draft = { nickname: "a", bio: "", pronouns: "p" };
    expect(diffOverrides(saved, draft)).toEqual(["pronouns", "bio"]);
    expect(overridesPatch(saved, draft)).toEqual({ pronouns: "p", bio: null });
    expect(overridesPatch(saved, { ...saved })).toEqual({});
  });
});

describe("withServerProfile", () => {
  test("cards keep the main name and carry the nickname", () => {
    const card = { id: "u", ...main, nickname: null as string | null };
    const shown = withServerProfile(card, { nickname: "Srv", banner: `${CDN}/banners/${SERVER}/${USER}/x.png`, pronouns: "they/them" });
    expect(shown.displayName).toBe("Pikachu");
    expect(shown.nickname).toBe("Srv");
    expect(shown.banner).toContain(SERVER);
    expect(shown.avatar).toBe(main.avatar);
    expect(shown.pronouns).toBe("they/them");
    expect(shown.bio).toBe("Main bio");
    expect(withServerProfile(card, {})).toBe(card);
    expect(withServerProfile(card, null)).toBe(card);
  });
});
