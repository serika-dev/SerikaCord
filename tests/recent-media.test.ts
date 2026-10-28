import { describe, expect, test } from "bun:test";
import {
  RECENT_MEDIA_LIMIT,
  discordAvatarUrl,
  discordBannerUrl,
  hasRecentMedia,
  isUserProfileMediaKey,
  normalizeRecentList,
  parseProfileMediaKey,
  profileMediaKeyFromUrl,
  profileMediaUrlForKey,
  recordRecentMedia,
  removeRecentMedia,
  type RecentMediaEntry,
} from "@/lib/profiles/recentMedia";
import { hostMatches, isGifSlug, isImportableGifUrl, parseGifHostList } from "@/lib/media/gifImport";
import { sanitizeMemberProfilePatch } from "@/lib/profiles/memberProfile";

const U = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U2 = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const S = "1111abcd-2222-4333-8444-555555555555";
const CDN = "https://cdn.serika.chat";
const B2 = { cdnUrl: CDN, bucket: "serikacord-media" };

const main = (n: number, uid = U) => `${CDN}/avatars/${uid}/file${n}AbCdEfGh.png`;
const list = (...urls: string[]): RecentMediaEntry[] => urls.map((url, i) => ({ url, at: 1000 - i }));

describe("profile media keys", () => {
  test("main and per-server keys parse", () => {
    expect(parseProfileMediaKey(`avatars/${U}/AbCdEf123.png`)).toEqual({ kind: "avatar", userId: U, serverId: null });
    expect(parseProfileMediaKey(`banners/${S}/${U.toUpperCase()}/AbCdEf123.gif`)).toEqual({ kind: "banner", userId: U, serverId: S });
  });

  test("anything else is refused", () => {
    for (const key of [
      "",
      `attachments/${U}/x.png`,
      `server-icons/${S}/x.png`,
      `avatars/${U}`,
      `avatars/${U}/`,
      `avatars/${U}/../x.png`,
      `avatars/${U}/sub/dir/x.png`,
      `avatars/not-a-uuid/x.png`,
      `Avatars/${U}/x.png`,
      `avatars/${U}/x`,
      `avatars/${S}/${U}/x.png/y`,
      42,
      null,
    ]) {
      expect(parseProfileMediaKey(key)).toBeNull();
    }
  });

  test("ownership checks the user and the kind", () => {
    expect(isUserProfileMediaKey(`avatars/${U}/a1.png`, U)).toBeTrue();
    expect(isUserProfileMediaKey(`avatars/${S}/${U}/a1.png`, U.toUpperCase(), "avatar")).toBeTrue();
    expect(isUserProfileMediaKey(`avatars/${U}/a1.png`, U, "banner")).toBeFalse();
    expect(isUserProfileMediaKey(`avatars/${U2}/a1.png`, U)).toBeFalse();
    // A server id in the user slot of a main key is someone else's folder.
    expect(isUserProfileMediaKey(`avatars/${U}/${U2}/a1.png`, U)).toBeFalse();
    expect(isUserProfileMediaKey(`avatars/${U}/a1.png`, "")).toBeFalse();
  });

  test("keys come only from our CDN or legacy Backblaze URLs", () => {
    expect(profileMediaKeyFromUrl(`${CDN}/avatars/${U}/a1.png`, B2)).toBe(`avatars/${U}/a1.png`);
    expect(profileMediaKeyFromUrl(`https://serikacord-media.s3.eu-central-003.backblazeb2.com/avatars/${U}/a1.png`, B2)).toBe(`avatars/${U}/a1.png`);
    expect(profileMediaKeyFromUrl(`https://s3.eu-central-003.backblazeb2.com/serikacord-media/banners/${S}/${U}/b.gif`, B2)).toBe(`banners/${S}/${U}/b.gif`);
    expect(profileMediaKeyFromUrl(`https://f003.backblazeb2.com/file/serikacord-media/avatars/${U}/a1.png`, B2)).toBe(`avatars/${U}/a1.png`);
    for (const url of [
      `https://evil.example/avatars/${U}/a1.png`,
      `http://cdn.serika.chat/avatars/${U}/a1.png`,
      `${CDN}/avatars/${U}/a1.png?x=1`,
      `${CDN}/avatars/${U}/a1.png#x`,
      `https://user:pw@cdn.serika.chat/avatars/${U}/a1.png`,
      `${CDN}/attachments/${U}/a1.png`,
      `https://cdn.discordapp.com/avatars/123/abc.png`,
      "not a url",
      `${CDN}/${"a".repeat(600)}`,
    ]) {
      expect(profileMediaKeyFromUrl(url, B2)).toBeNull();
    }
    expect(profileMediaUrlForKey(`avatars/${U}/a1.png`, `${CDN}/`)).toBe(`${CDN}/avatars/${U}/a1.png`);
  });
});

describe("recent list", () => {
  test("normalize drops junk and duplicates and caps the list", () => {
    const raw = [
      { url: main(1), at: 5 },
      { url: main(1), at: 4 },
      { url: 7 },
      null,
      "x",
      { url: main(2) },
      ...Array.from({ length: 10 }, (_, i) => ({ url: main(10 + i), at: i })),
    ];
    const out = normalizeRecentList(raw);
    expect(out.length).toBe(RECENT_MEDIA_LIMIT);
    expect(out[0]).toEqual({ url: main(1), at: 5 });
    expect(out[1]).toEqual({ url: main(2), at: 0 });
    expect(normalizeRecentList("nope")).toEqual([]);
  });

  test("a new image moves to the front, deduped", () => {
    const { list: next, evicted } = recordRecentMedia(list(main(1), main(2), main(3)), { url: main(3) }, 2000);
    expect(next.map((e) => e.url)).toEqual([main(3), main(1), main(2)]);
    expect(next[0].at).toBe(2000);
    expect(evicted).toEqual([]);
  });

  test("the replaced image is kept right behind the new one", () => {
    const { list: next } = recordRecentMedia(list(main(1)), { url: main(2), previous: main(9) }, 2000);
    expect(next.map((e) => e.url)).toEqual([main(2), main(9), main(1)]);
  });

  test("a replaced image that is already listed keeps its place", () => {
    const { list: next } = recordRecentMedia(list(main(1), main(2), main(3)), { url: main(4), previous: main(3) }, 2000);
    expect(next.map((e) => e.url)).toEqual([main(4), main(1), main(2), main(3)]);
  });

  test("clearing an image keeps the old one at the front", () => {
    const { list: next } = recordRecentMedia(list(main(1)), { url: null, previous: main(2) }, 2000);
    expect(next.map((e) => e.url)).toEqual([main(2), main(1)]);
  });

  test("the list is capped and evicted entries are reported", () => {
    const full = list(main(1), main(2), main(3), main(4), main(5), main(6));
    const { list: next, evicted } = recordRecentMedia(full, { url: main(7), previous: main(8) }, 2000);
    expect(next.length).toBe(RECENT_MEDIA_LIMIT);
    expect(next.map((e) => e.url)).toEqual([main(7), main(8), main(1), main(2), main(3), main(4)]);
    expect(evicted).toEqual([main(5), main(6)]);
  });

  test("remove one entry", () => {
    const { list: next, removed } = removeRecentMedia(list(main(1), main(2)), main(1));
    expect(removed).toBeTrue();
    expect(next.map((e) => e.url)).toEqual([main(2)]);
    expect(removeRecentMedia(next, main(5)).removed).toBeFalse();
    expect(hasRecentMedia(next, main(2))).toBeTrue();
    expect(hasRecentMedia(next, main(1))).toBeFalse();
  });
});

describe("Discord avatar URLs", () => {
  const id = "123456789012345678";
  const hash = "0123456789abcdef0123456789abcdef";
  test("static avatars are PNG, animated a_ hashes GIF", () => {
    expect(discordAvatarUrl(id, hash)).toBe(`https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=1024`);
    expect(discordAvatarUrl(id, `a_${hash}`, 128)).toBe(`https://cdn.discordapp.com/avatars/${id}/a_${hash}.gif?size=128`);
    expect(discordBannerUrl(id, `a_${hash}`, 600)).toBe(`https://cdn.discordapp.com/banners/${id}/a_${hash}.gif?size=1024`);
  });
  test("sizes snap to Discord's powers of two", () => {
    expect(discordAvatarUrl(id, hash, 1)).toContain("size=16");
    expect(discordAvatarUrl(id, hash, 100000)).toContain("size=4096");
  });
  test("bad ids and hashes give null", () => {
    expect(discordAvatarUrl("12", hash)).toBeNull();
    expect(discordAvatarUrl(id, null)).toBeNull();
    expect(discordAvatarUrl(id, "../../x")).toBeNull();
    expect(discordBannerUrl(`${id}/../x`, hash)).toBeNull();
  });
});

describe("GIF import", () => {
  test("slugs", () => {
    expect(isGifSlug("hYe3X-V95w")).toBeTrue();
    expect(isGifSlug("../x")).toBeFalse();
    expect(isGifSlug("")).toBeFalse();
  });
  test("only allowed GIF hosts over https", () => {
    expect(isImportableGifUrl("https://cdn.ado.wtf/gifs/a/b.gif")).toBeTrue();
    expect(isImportableGifUrl("https://media.tenor.com/x/y.gif")).toBeTrue();
    expect(isImportableGifUrl("https://media2.giphy.com/media/x/giphy.gif")).toBeTrue();
    expect(isImportableGifUrl("http://cdn.ado.wtf/gifs/a/b.gif")).toBeFalse();
    expect(isImportableGifUrl("https://cdn.ado.wtf.evil.com/b.gif")).toBeFalse();
    expect(isImportableGifUrl("https://giphy.com.evil.com/b.gif")).toBeFalse();
    expect(isImportableGifUrl("https://user@cdn.ado.wtf/b.gif")).toBeFalse();
    expect(isImportableGifUrl("https://cdn.ado.wtf:8443/b.gif")).toBeFalse();
    expect(isImportableGifUrl("https://169.254.169.254/latest")).toBeFalse();
  });
  test("host matching and env host lists", () => {
    expect(hostMatches("a.serika.dev", [".serika.dev"])).toBeTrue();
    expect(hostMatches("serika.dev", [".serika.dev"])).toBeFalse();
    expect(parseGifHostList(" Media.Example.com, .cdn.example.org, bad host, localhost ,")).toEqual(["media.example.com", ".cdn.example.org"]);
  });
});

describe("server profile accepts recent images", () => {
  const ctx = { userId: U, serverId: S, cdnUrl: CDN, current: {} };
  test("a main-profile image is refused unless it is in the recent list", () => {
    expect(sanitizeMemberProfilePatch({ avatar: main(1) }, ctx).ok).toBeFalse();
    const ok = sanitizeMemberProfilePatch({ avatar: main(1) }, { ...ctx, recentMedia: { avatar: [main(1)] } });
    expect(ok.ok).toBeTrue();
    // The avatar list never allows it as a banner.
    expect(sanitizeMemberProfilePatch({ banner: main(1) }, { ...ctx, recentMedia: { avatar: [main(1)] } }).ok).toBeFalse();
  });
});
