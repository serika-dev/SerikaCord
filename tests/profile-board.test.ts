import { describe, expect, test } from "bun:test";
import { boardOrder, mergeWidgetPut, moveInOrder, reorderPlacements } from "../src/lib/profileBoard";

const app = (id: string) => ({ id: `application:${id}`, type: "application", applicationId: id, builtin: null });
const wish = (slug: string) => ({ id: `serika_wishlist:${slug}`, type: "builtin", builtin: "serika_wishlist", applicationId: null, options: { listSlug: slug } });

describe("boardOrder", () => {
  test("implicit game sections come first, then stored order", () => {
    expect(boardOrder([app("1"), wish("a")])).toEqual(["game:favorite", "game:liked", "game:rotation", "game:wishlist", "application:1", "serika_wishlist:a"]);
  });
  test("placed game sections keep their stored position", () => {
    const stored = [wish("a"), { id: "game:liked", type: "builtin", builtin: "games_i_like" }];
    expect(boardOrder(stored)).toEqual(["game:favorite", "game:rotation", "game:wishlist", "serika_wishlist:a", "game:liked"]);
  });
  test("old rows without ids still get stable ids", () => {
    expect(boardOrder([{ type: "application", applicationId: "9" }]).at(-1)).toBe("application:9");
  });
});

describe("reorderPlacements", () => {
  test("moves wishlist, app and game widgets in one order", () => {
    const out = reorderPlacements([app("1"), wish("a")], ["serika_wishlist:a", "game:liked", "application:1"]);
    expect(out.map((p) => p.id)).toEqual(["serika_wishlist:a", "game:liked", "application:1"]);
    expect(out[1]).toMatchObject({ type: "builtin", builtin: "games_i_like" });
    expect(out.map((p) => p.position)).toEqual([0, 1, 2]);
  });
  test("ignores unknown ids and never drops unmentioned widgets", () => {
    const out = reorderPlacements([app("1"), wish("a"), app("2")], ["application:2", "serika_wishlist:evil", "application:999"]);
    expect(out.map((p) => p.id)).toEqual(["application:2", "application:1", "serika_wishlist:a"]);
  });
  test("keeps wishlist options", () => {
    expect(reorderPlacements([wish("a")], ["serika_wishlist:a"])[0]).toMatchObject({ options: { listSlug: "a" } });
  });
});

describe("mergeWidgetPut", () => {
  test("body controls app widgets and order; built-ins keep settings", () => {
    const stored = [wish("a"), app("1")];
    const out = mergeWidgetPut(stored, [
      { type: "application", applicationId: "2" },
      { id: "serika_wishlist:a", type: "builtin", builtin: "serika_wishlist" },
    ]);
    expect(out.map((p) => p.id)).toEqual(["application:2", "serika_wishlist:a"]);
    expect(out[1]).toMatchObject({ options: { listSlug: "a" } });
  });
  test("omitted built-ins are kept, unknown built-ins can't be created", () => {
    const out = mergeWidgetPut([wish("a")], [
      { type: "application", applicationId: "1" },
      { id: "serika_wishlist:new", type: "builtin", builtin: "serika_wishlist" },
      { id: "game:rotation", type: "builtin", builtin: "games_rotation" },
    ]);
    expect(out.map((p) => p.id)).toEqual(["application:1", "game:rotation", "serika_wishlist:a"]);
  });
});

describe("moveInOrder", () => {
  const order = ["game:favorite", "game:liked", "application:1", "serika_wishlist:a"];
  test("swaps with the next visible neighbour, skipping hidden ones", () => {
    const visible = ["game:favorite", "application:1", "serika_wishlist:a"];
    expect(moveInOrder(order, visible, "application:1", -1)).toEqual(["application:1", "game:liked", "game:favorite", "serika_wishlist:a"]);
    expect(moveInOrder(order, visible, "serika_wishlist:a", 1)).toBeNull();
  });
});
