import { describe, expect, test } from "bun:test";
import { boardOrder, mergeWidgetPut, moveInOrder, removedSections, reorderPlacements, setSectionEnabled, withFixedIds } from "../src/lib/profileBoard";

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

describe("removing and re-adding Connections / Recent activity", () => {
  const visible = (stored: unknown) => {
    const hidden = new Set(removedSections(stored).map((k) => `section:${k}`));
    return boardOrder(stored).filter((id) => !hidden.has(id));
  };

  test("an untouched Board keeps both, in their default spots", () => {
    expect(removedSections([])).toEqual([]);
    expect(removedSections([app("1"), wish("a")])).toEqual([]);
    expect(visible([app("1")]).slice(-2)).toEqual(["section:connections", "section:activity"]);
  });

  test("removing one hides only it and keeps the other where it was", () => {
    const out = setSectionEnabled([app("1")], "connections", false);
    expect(removedSections(out)).toEqual(["connections"]);
    expect(visible(out).slice(-2)).toEqual(["application:1", "section:activity"]);
    expect(out.find((p) => p.id === "section:activity")).toBeDefined();
  });

  test("adding it back restores its previous position", () => {
    const moved = reorderPlacements([app("1")], ["section:activity", "application:1", "section:connections"]);
    const removed = setSectionEnabled(moved, "activity", false);
    expect(visible(removed)).not.toContain("section:activity");
    const back = setSectionEnabled(removed, "activity", true);
    expect(removedSections(back)).toEqual([]);
    expect(visible(back)).toEqual(boardOrder(moved));
    expect(back.find((p) => p.id === "section:activity")).not.toHaveProperty("hidden");
  });

  test("enabling an implicit section is a no-op", () => {
    expect(setSectionEnabled([app("1")], "activity", true).map((p) => p.id)).toEqual(["application:1"]);
  });

  test("the order endpoint can't bring a removed section back", () => {
    const removed = setSectionEnabled([app("1")], "connections", false);
    const out = reorderPlacements(removed, ["section:connections", "application:1", "section:activity"]);
    expect(removedSections(out)).toEqual(["connections"]);
  });

  test("older clients saving widgets can't resurrect or drop it", () => {
    const removed = setSectionEnabled([wish("a")], "activity", false);
    // An old client naming the section (5156bd2 bundle)...
    const named = mergeWidgetPut(removed, [
      { id: "section:activity", type: "builtin", builtin: "recent_activity" },
      { type: "application", applicationId: "1" },
    ]);
    expect(removedSections(named)).toEqual(["activity"]);
    // ...or leaving it out entirely (aad43d3 bundle).
    const omitted = mergeWidgetPut(removed, [{ type: "application", applicationId: "1" }]);
    expect(removedSections(omitted)).toEqual(["activity"]);
    expect(omitted.some((p) => p.id === "section:connections")).toBe(true);
  });
});
