import { describe, expect, test } from "bun:test";
import {
  SERIKA_WISHLIST_BUILTIN,
  accountsIdFromUserId,
  findWishlistPlacement,
  sanitizeWishlistProfile,
  safeHttpUrl,
  visibleWishlists,
  withWishlistPlacement,
  type WishlistList,
} from "../src/lib/serikaWishlist";

const upstream = {
  user: { id: "65f0c0ffee0000000000abcd", username: "ado", displayName: "Ado", avatar: null },
  profileUrl: "https://wish.serika.dev/u/ado",
  lists: [
    {
      slug: "birthday",
      title: "Birthday",
      emoji: "🎂",
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
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({ title: "Lamp", priority: 1, price: 39.99 });
    expect(list.items[1]).toMatchObject({ title: "Bad", imageUrl: null, url: null, price: 12, currency: "EUR", priority: 0, received: false });
  });

  test("rejects non-objects and missing lists", () => {
    expect(sanitizeWishlistProfile(null)).toBeNull();
    expect(sanitizeWishlistProfile({ error: "nope" })).toBeNull();
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

describe("wishlist placement", () => {
  const app = { id: "application:1", type: "application", applicationId: "1", builtin: null, position: 0 };

  test("adds, updates in place and removes", () => {
    const added = withWishlistPlacement([app], { enabled: true, listSlug: null });
    expect(added).toHaveLength(2);
    expect(findWishlistPlacement(added)?.options.listSlug).toBeNull();

    const moved = [added[1], added[0]];
    const updated = withWishlistPlacement(moved, { enabled: true, listSlug: "birthday" });
    expect(updated[0].builtin).toBe(SERIKA_WISHLIST_BUILTIN);
    expect(findWishlistPlacement(updated)?.options.listSlug).toBe("birthday");

    const removed = withWishlistPlacement(updated, { enabled: false, listSlug: null });
    expect(removed).toEqual([app]);
  });

  test("rejects bad slugs", () => {
    const p = withWishlistPlacement([], { enabled: true, listSlug: "../../etc" });
    expect(findWishlistPlacement(p)?.options.listSlug).toBeNull();
  });
});

describe("visibleWishlists", () => {
  const mk = (slug: string, itemCount: number): WishlistList => ({
    slug, title: slug, emoji: "", description: "", url: `https://x.test/${slug}`, itemCount, totalValue: null, updatedAt: null, items: [],
  });
  const lists = [mk("a", 3), mk("empty", 0), mk("b", 1), mk("c", 2), mk("d", 5)];

  test("owner sees everything", () => {
    expect(visibleWishlists(lists, null, true)).toHaveLength(5);
  });
  test("featured list only, falling back when it is gone", () => {
    expect(visibleWishlists(lists, "c", false).map((l) => l.slug)).toEqual(["c"]);
    expect(visibleWishlists(lists, "gone", false).map((l) => l.slug)).toEqual(["a", "b", "c"]);
  });
  test("skips empty lists unless nothing else exists", () => {
    expect(visibleWishlists([mk("empty", 0)], null, false).map((l) => l.slug)).toEqual(["empty"]);
  });
});
