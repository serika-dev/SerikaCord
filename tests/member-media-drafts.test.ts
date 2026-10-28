import { describe, expect, test } from "bun:test";
import {
  MEMBER_MEDIA_DRAFT_MAX_AGE_MS,
  memberMediaPrefix,
  memberMediaPrefixes,
  memberOwnedKeys,
  memberPairKey,
  memberPairsForKeys,
  parseMemberMediaKey,
  planDraftSweep,
  savedMemberKeys,
  serverMemberMediaFolders,
  serverMemberMediaKeys,
} from "@/lib/profiles/memberMediaDrafts";

const S = "1111abcd-2222-4333-8444-555555555555";
const S2 = "9999abcd-2222-4333-8444-555555555555";
const U = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U2 = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const av = (sid: string, uid: string, file = "AbCdEfGhIjKlMnOp.png") => `avatars/${sid}/${uid}/${file}`;
const bn = (sid: string, uid: string, file = "QrStUvWxYz012345.gif") => `banners/${sid}/${uid}/${file}`;
const CDN = "https://cdn.serika.chat";
const keyFromUrl = (url: string) => new URL(url).pathname.replace(/^\/+/, "");

describe("prefixes", () => {
  test("a member's own avatar / banner prefix", () => {
    expect(memberMediaPrefix("avatar", S, U)).toBe(`avatars/${S}/${U}/`);
    expect(memberMediaPrefix("banner", S, U.toUpperCase())).toBe(`banners/${S}/${U}/`);
    expect(memberMediaPrefixes(S, U)).toEqual([`avatars/${S}/${U}/`, `banners/${S}/${U}/`]);
  });

  test("ids that aren't UUIDs give no prefix (never a broad folder)", () => {
    expect(memberMediaPrefix("avatar", "", U)).toBeNull();
    expect(memberMediaPrefix("avatar", S, "..")).toBeNull();
    expect(memberMediaPrefix("avatar", `${S}/x`, U)).toBeNull();
    expect(memberMediaPrefixes("nope", U)).toEqual([]);
    expect(serverMemberMediaFolders("")).toEqual([]);
    expect(serverMemberMediaFolders(S)).toEqual([`avatars/${S}/`, `banners/${S}/`]);
  });

  test("the draft age is a day", () => {
    expect(MEMBER_MEDIA_DRAFT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("parseMemberMediaKey", () => {
  test("parses per-server avatar and banner keys", () => {
    expect(parseMemberMediaKey(av(S, U))).toEqual({ kind: "avatar", serverId: S, userId: U, prefix: `avatars/${S}/${U}/` });
    expect(parseMemberMediaKey(bn(S, U))?.kind).toBe("banner");
  });

  test("refuses main-profile keys, server files, other folders and path tricks", () => {
    for (const key of [
      `avatars/${U}/AbCdEfGhIjKlMnOp.png`, // main profile avatar
      `avatars/${S}/AbCdEfGhIjKlMnOp.png`, // file directly in the server folder
      `server-icons/${S}/${U}/AbCdEfGhIjKlMnOp.png`,
      `avatars/${S}/${U}/x/AbCdEfGhIjKlMnOp.png`,
      `avatars/${S}/${U}/..`,
      `avatars/${S}/${U}/`,
      `avatars/${S}/../${U}/a.png`,
      `avatars/${S}/${U}/.hidden`,
      `Avatars/${S}/${U}/AbCdEfGhIjKlMnOp.png`,
      `avatars/${S}/${U.toUpperCase()}/AbCdEfGhIjKlMnOp.png`,
      `avatars/not-a-uuid/${U}/AbCdEfGhIjKlMnOp.png`,
      "",
      null,
      42,
    ]) {
      expect(parseMemberMediaKey(key)).toBeNull();
    }
  });
});

describe("draft bookkeeping", () => {
  test("memberPairsForKeys dedupes members and skips invalid keys", () => {
    const pairs = memberPairsForKeys([av(S, U), bn(S, U), av(S2, U), "avatars/x/y/z.png", av(S, U2)]);
    expect(pairs).toEqual([
      { serverId: S, userId: U },
      { serverId: S2, userId: U },
      { serverId: S, userId: U2 },
    ]);
  });

  test("savedMemberKeys turns the row's URLs into lower-case keys", () => {
    const keys = savedMemberKeys({ avatar: `${CDN}/${av(S, U)}`, banner: null }, keyFromUrl);
    expect([...keys]).toEqual([av(S, U).toLowerCase()]);
    expect(savedMemberKeys({}, keyFromUrl).size).toBe(0);
  });
});

describe("planDraftSweep", () => {
  test("deletes unsaved drafts, keeps the saved avatar / banner", () => {
    const saved = new Map([[memberPairKey(S, U), savedMemberKeys({ avatar: `${CDN}/${av(S, U, "saved0000000000.png")}`, banner: `${CDN}/${bn(S, U)}` }, keyFromUrl)]]);
    const unsaved = av(S, U, "draft00000000000.png");
    const plan = planDraftSweep([unsaved, av(S, U, "saved0000000000.png"), bn(S, U)], saved);
    expect(plan.remove).toEqual([unsaved]);
    expect(plan.untrack).toEqual([av(S, U, "saved0000000000.png"), bn(S, U)]);
  });

  test("a saved key matches whatever the case of the stored URL", () => {
    const saved = new Map([[memberPairKey(S, U), new Set([av(S, U).toLowerCase()])]]);
    expect(planDraftSweep([av(S, U)], saved)).toEqual({ remove: [], untrack: [av(S, U)] });
  });

  test("drafts of someone who left (no member row) are deleted", () => {
    expect(planDraftSweep([av(S, U)], new Map())).toEqual({ remove: [av(S, U)], untrack: [] });
  });

  test("another member's saved image doesn't protect this member's draft", () => {
    const saved = new Map([[memberPairKey(S, U2), new Set([av(S, U).toLowerCase()])]]);
    expect(planDraftSweep([av(S, U)], saved).remove).toEqual([av(S, U)]);
  });

  test("invalid entries are only untracked, never deleted; duplicates handled once", () => {
    const bad = [`avatars/${U}/AbCdEfGhIjKlMnOp.png`, "attachments/x/y.png", `avatars/${S}/${U}/../../etc`];
    const plan = planDraftSweep([...bad, av(S, U), av(S, U)], new Map());
    expect(plan.remove).toEqual([av(S, U)]);
    expect(plan.untrack).toEqual(bad);
  });
});

describe("removal listings", () => {
  test("memberOwnedKeys keeps only that member's avatar / banner keys", () => {
    const listed = [av(S, U), bn(S, U), av(S, U2), av(S2, U), `avatars/${S}/${U}/deeper/x.png`];
    expect(memberOwnedKeys(listed, S, U)).toEqual([av(S, U), bn(S, U)]);
    expect(memberOwnedKeys(listed, "bad", U)).toEqual([]);
  });

  test("serverMemberMediaKeys keeps member images of that server only", () => {
    const listed = [av(S, U), bn(S, U2), av(S2, U), `avatars/${S}/AbCdEfGhIjKlMnOp.png`, `avatars/${S}/${U}/a/b.png`];
    expect(serverMemberMediaKeys(listed, S)).toEqual([av(S, U), bn(S, U2)]);
    expect(serverMemberMediaKeys(listed, S.toUpperCase())).toEqual([av(S, U), bn(S, U2)]);
  });
});
