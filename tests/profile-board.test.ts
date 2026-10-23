import { describe, expect, test } from "bun:test";
import { boardOrder, mergeWidgetPut, moveInOrder, reorderPlacements, withFixedIds } from "../src/lib/profileBoard";

const app = (id: string) => ({ id: `application:${id}`, type: "application", applicationId: id, builtin: null });
const wish = (slug: string) => ({ id: `serika_wishlist:${slug}`, type: "builtin", builtin: "serika_wishlist", applicationId: null, options: { listSlug: slug } });

describe("boardOrder", () => {
  test("implicit game sections come first, then stored order", () => {
    expect(boardOrder([app("1"), wish("a")])).toEqual([
      "game:favorite", "game:liked", "game:rotation", "game:wishlist", "application:1", "serika_wishlist:a", "section:connections", "section:activity",
    ]);
  });
  test("placed game sections keep their stored position", () => {
    const stored = [wish("a"), { id: "game:liked", type: "builtin", builtin: "games_i_like" }];
    expect(boardOrder(stored)).toEqual(["game:favorite", "game:rotation", "game:wishlist", "serika_wishlist:a", "game:liked", "section:connections", "section:activity"]);
  });
  test("old rows without ids still get stable ids", () => {
    expect(boardOrder([{ type: "application", applicationId: "9" }])).toContain("application:9");
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

describe("Connections and Recent activity sections", () => {
  const conn = { id: "section:connections", type: "builtin", builtin: "connections", applicationId: null };

  test("sit after everything until moved", () => {
    expect(boardOrder([wish("a")]).slice(-2)).toEqual(["section:connections", "section:activity"]);
  });

  test("first move saves them into the order", () => {
    const out = reorderPlacements([wish("a")], ["section:activity", "serika_wishlist:a", "section:connections"]);
    expect(out.map((p) => p.id)).toEqual(["section:activity", "serika_wishlist:a", "section:connections"]);
    expect(out[0]).toMatchObject({ type: "builtin", builtin: "recent_activity" });
    expect(boardOrder(out)).toEqual(["game:favorite", "game:liked", "game:rotation", "game:wishlist", "section:activity", "serika_wishlist:a", "section:connections"]);
  });

  test("moving one keeps everything else where the owner saw it", () => {
    // The client sends the full order it shows, with Connections moved up one.
    const shown = boardOrder([app("1")]);
    const next = moveInOrder(shown, shown, "section:connections", -1)!;
    const out = reorderPlacements([app("1")], next);
    expect(boardOrder(out)).toEqual(next);
    expect(next.slice(-3)).toEqual(["section:connections", "application:1", "section:activity"]);
  });

  test("older clients saving widgets can't drop them", () => {
    const out = mergeWidgetPut([conn, wish("a")], [{ type: "application", applicationId: "1" }]);
    expect(out.map((p) => p.id)).toEqual(["application:1", "section:connections", "serika_wishlist:a"]);
  });

  test("bogus section ids are ignored and never duplicated", () => {
    const out = reorderPlacements([conn], ["section:bio", "section:connections", "section:connections"]);
    expect(out.map((p) => p.id)).toEqual(["section:connections"]);
  });
});

describe("withFixedIds", () => {
  test("fills in fixed sections missing from an older server's order", () => {
    expect(withFixedIds(["game:liked", "application:1", "section:activity"])).toEqual([
      "game:favorite", "game:rotation", "game:wishlist", "game:liked", "application:1", "section:activity", "section:connections",
    ]);
    const full = boardOrder([]);
    expect(withFixedIds(full)).toEqual(full);
  });
});
