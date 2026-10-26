import { describe, expect, test } from "bun:test";
import {
  accountsIdFromUserId,
  addWishlistPlacement,
  findWishlistPlacements,
  hasLegacyWishlistPlacement,
  listForPlacement,
  migrateLegacyWishlistPlacements,
  removeWishlistPlacements,
  sanitizeWishlistProfile,
  safeHttpUrl,
  wishlistPlacementId,
  type WishlistList,
} from "../src/lib/serikaWishlist";

const upstream = {
  user: { id: "65f0c0ffee0000000000abcd", username: "ado", displayName: "Ado", avatar: null },
  profileUrl: "https://wish.serika.dev/u/ado",
  lists: [
    {
      slug: "birthday",
      title: "Birthday",
      emoji: "x",
      iconUrl: "https://f003.backblazeb2.com/file/wish/icon.png",
      description: "things",
      url: "https://wish.ado.wtf/w/birthday",
      itemCount: 9,
      totalValue: { amount: 420.5, currency: "EUR" },
      updatedAt: "2026-10-01T10:00:00.000Z",
      items: [
        { title: "Lamp", imageUrl: "https://shop.example/lamp.jpg", price: 39.99, currency: "EUR", url: "https://shop.example/lamp", store: "Shop", priority: 1, received: false },
        { title: "Bad", imageUrl: "javascript:alert(1)", price: "12", currency: "eur", url: "data:text/html,x", store: null, priority: 7, received: "yes" },
        { title: "", imageUrl: null, price: null, currency: null, url: null, store: null, priority: 0, received: false },
      ],
    },
    { slug: "", title: "no slug", url: "https://wish.ado.wtf/w/x", items: [] },
    { slug: "evil", title: "Evil", url: "javascript:alert(1)", items: [] },
  ],
};

describe("sanitizeWishlistProfile", () => {
  test("keeps valid lists and items, drops unsafe URLs and malformed rows", () => {
    const p = sanitizeWishlistProfile(upstream)!;
    expect(p.profileUrl).toBe("https://wish.serika.dev/u/ado");
    expect(p.lists.map((l) => l.slug)).toEqual(["birthday"]);
    const list = p.lists[0];
    expect(list.totalValue).toEqual({ amount: 420.5, currency: "EUR" });
    expect(list.iconUrl).toBe("https://f003.backblazeb2.com/file/wish/icon.png");
    expect("emoji" in list).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({ title: "Lamp", priority: 1, price: 39.99 });
    expect(list.items[1]).toMatchObject({ title: "Bad", imageUrl: null, url: null, price: 12, currency: "EUR", priority: 0, received: false });
  });

  test("rejects non-objects and missing lists", () => {
    expect(sanitizeWishlistProfile(null)).toBeNull();
    expect(sanitizeWishlistProfile({ error: "nope" })).toBeNull();
  });

  test("iconUrl is optional and must be http(s)", () => {
    const p = sanitizeWishlistProfile({ lists: [{ slug: "a", url: "https://x.test/a", iconUrl: "javascript:x" }, { slug: "b", url: "https://x.test/b" }] })!;
    expect(p.lists.map((l) => l.iconUrl)).toEqual([null, null]);
  });

  test("caps items per list", () => {
    const many = { lists: [{ slug: "a", url: "https://x.test/a", items: Array.from({ length: 30 }, (_, i) => ({ title: `i${i}` })) }] };
    expect(sanitizeWishlistProfile(many, 6)!.lists[0].items).toHaveLength(6);
  });
});

describe("safeHttpUrl", () => {
  test("only http(s)", () => {
    expect(safeHttpUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});

describe("accountsIdFromUserId", () => {
  test("reverses the zero-padded ObjectId UUID form", () => {
    expect(accountsIdFromUserId("65f0c0ff-ee00-0000-0000-abcd00000000")).toBe("65f0c0ffee0000000000abcd");
  });
  test("ignores real UUIDs", () => {
    expect(accountsIdFromUserId("3f2b8c1e-9d4a-4b7e-8c21-5a6f7e8d9c0b")).toBeNull();
    expect(accountsIdFromUserId("not-a-uuid")).toBeNull();
  });
});

const mk = (slug: string, itemCount: number): WishlistList => ({
  slug, title: slug, iconUrl: null, description: "", url: `https://x.test/${slug}`, itemCount, totalValue: null, updatedAt: null, items: [],
});

describe("wishlist placements (one list per widget)", () => {
  const app = { id: "application:1", type: "application", applicationId: "1", builtin: null, position: 0 };

  test("adds one widget per list with a stable id, no duplicates", () => {
    let w = addWishlistPlacement([app], "birthday");
    w = addWishlistPlacement(w, "books");
    w = addWishlistPlacement(w, "birthday");
    expect(findWishlistPlacements(w).map((p) => p.id)).toEqual([wishlistPlacementId("birthday"), wishlistPlacementId("books")]);
    expect(w.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  test("removes one list or all", () => {
    const w = addWishlistPlacement(addWishlistPlacement([app], "a"), "b");
    expect(findWishlistPlacements(removeWishlistPlacements(w, "a")).map((p) => p.options.listSlug)).toEqual(["b"]);
    expect(removeWishlistPlacements(w, null)).toEqual([app]);
  });

  test("rejects bad slugs", () => {
    expect(addWishlistPlacement([], "../../etc")).toEqual([]);
  });

  test("legacy placement migrates to the first public list in place", () => {
    const legacy = [{ id: "builtin:serika_wishlist", type: "builtin", builtin: "serika_wishlist", applicationId: null, options: { listSlug: null } }, app];
    expect(hasLegacyWishlistPlacement(legacy)).toBe(true);
    const out = migrateLegacyWishlistPlacements(legacy, [mk("empty", 0), mk("bday", 3)])!;
    expect(out[0].id).toBe(wishlistPlacementId("bday"));
    expect(out[1]).toMatchObject({ id: "application:1", position: 1 });
    expect(hasLegacyWishlistPlacement(out)).toBe(false);
  });

  test("legacy placement is dropped without public lists, untouched otherwise", () => {
    const legacy = [{ builtin: "serika_wishlist", type: "builtin", options: { listSlug: null } }];
    expect(migrateLegacyWishlistPlacements(legacy, [])).toEqual([]);
    expect(migrateLegacyWishlistPlacements([app], [mk("a", 1)])).toBeNull();
  });

  test("legacy placement doesn't duplicate a list already on the Board", () => {
    const w = [{ builtin: "serika_wishlist", type: "builtin", options: { listSlug: null } }, ...addWishlistPlacement([], "a")];
    const out = migrateLegacyWishlistPlacements(w, [mk("a", 2)])!;
    expect(findWishlistPlacements(out).map((p) => p.options.listSlug)).toEqual(["a"]);
  });
});

describe("listForPlacement", () => {
  const lists = [mk("a", 3), mk("empty", 0), mk("b", 1)];
  test("own slug, or first public list not on the Board for legacy", () => {
    expect(listForPlacement(lists, "b", ["b"])?.slug).toBe("b");
    expect(listForPlacement(lists, "gone", ["gone"])).toBeNull();
    expect(listForPlacement(lists, null, [null, "a"])?.slug).toBe("b");
  });
});
