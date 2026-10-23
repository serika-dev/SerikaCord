/**
 * Profile Board ordering — pure helpers shared by the API and the client.
 *
 * Everything on a user's Board (game library sections, app widgets from the
 * Social SDK, Serika Wishlist widgets) is one ordered list in
 * `users.profile_widgets`. Game sections are implicit until first reordered:
 * a category with games but no placement is shown before everything else in
 * the default order, and gets a real placement the first time the owner
 * moves anything.
 */

export type GameCategoryKey = "favorite" | "liked" | "rotation" | "wishlist";

export const GAME_CATEGORY_ORDER: GameCategoryKey[] = ["favorite", "liked", "rotation", "wishlist"];

/** `builtin` names from docs/social-sdk-design.md §1.4. */
export const GAME_BUILTIN_BY_CATEGORY: Record<GameCategoryKey, string> = {
  favorite: "favorite_game",
  liked: "games_i_like",
  rotation: "games_rotation",
  wishlist: "want_to_play",
};

const CATEGORY_BY_GAME_BUILTIN: Record<string, GameCategoryKey> = Object.fromEntries(
  Object.entries(GAME_BUILTIN_BY_CATEGORY).map(([c, b]) => [b, c as GameCategoryKey])
);

export const MAX_BOARD_PLACEMENTS = 40;

export type Placement = Record<string, unknown> & { id?: unknown; type?: unknown; builtin?: unknown; applicationId?: unknown };

export function gamePlacementId(category: GameCategoryKey): string {
  return `game:${category}`;
}

export function gameCategoryOf(p: Placement): GameCategoryKey | null {
  if (p.type !== "builtin" || typeof p.builtin !== "string") return null;
  return CATEGORY_BY_GAME_BUILTIN[p.builtin] ?? null;
}

export function makeGamePlacement(category: GameCategoryKey): Placement {
  return { id: gamePlacementId(category), type: "builtin", builtin: GAME_BUILTIN_BY_CATEGORY[category], applicationId: null };
}

/** Parse `game:<category>` ids sent by clients. */
export function categoryFromGameId(id: string): GameCategoryKey | null {
  const m = /^game:(favorite|liked|rotation|wishlist)$/.exec(id);
  return m ? (m[1] as GameCategoryKey) : null;
}

/** Stable id for any stored placement (old rows may lack one). */
export function placementId(p: Placement, index: number): string {
  if (typeof p.id === "string" && p.id) return p.id;
  const cat = gameCategoryOf(p);
  if (cat) return gamePlacementId(cat);
  if (p.type === "application" && typeof p.applicationId === "string") return `application:${p.applicationId}`;
  return `${String(p.type ?? "widget")}:${String(p.builtin ?? index)}`;
}

function clean(list: unknown): Placement[] {
  return (Array.isArray(list) ? list : []).filter((w): w is Placement => !!w && typeof w === "object");
}

function withPositions(list: Placement[]): Placement[] {
  return list.map((p, i) => ({ ...p, position: i }));
}

/**
 * Board order for rendering: stored placements in order, with implicit game
 * sections (categories without a placement) placed first.
 */
export function boardOrder(stored: unknown): string[] {
  const list = clean(stored);
  const ids = list.map(placementId);
  const implicit = GAME_CATEGORY_ORDER.filter((c) => !list.some((p) => gameCategoryOf(p) === c)).map(gamePlacementId);
  return [...implicit, ...ids];
}

/**
 * Apply a client-chosen order. Known ids are moved into that order, implicit
 * game sections named in it become real placements, unknown ids are
 * ignored, and anything the client didn't mention keeps its relative place
 * at the end. Never adds or removes app or wishlist widgets.
 */
export function reorderPlacements(stored: unknown, ids: string[]): Placement[] {
  const list = clean(stored);
  const byId = new Map(list.map((p, i) => [placementId(p, i), p] as const));
  const out: Placement[] = [];
  const used = new Set<string>();
  for (const id of ids) {
    if (used.has(id)) continue;
    const existing = byId.get(id);
    if (existing) {
      out.push({ ...existing, id });
      used.add(id);
      continue;
    }
    const cat = categoryFromGameId(id);
    if (cat && !list.some((p) => gameCategoryOf(p) === cat)) {
      out.push(makeGamePlacement(cat));
      used.add(id);
    }
  }
  list.forEach((p, i) => {
    const id = placementId(p, i);
    if (!used.has(id)) {
      out.push({ ...p, id });
      used.add(id);
    }
  });
  return withPositions(out.slice(0, MAX_BOARD_PLACEMENTS));
}

/**
 * PUT /users/@me/widgets: the body decides which app widgets exist and the
 * order. Built-ins can't be created or dropped here (game sections follow the
 * library, wishlists have their own endpoint): ones the body names keep their
 * stored settings, valid game ids are accepted, and stored built-ins the body
 * omits are kept at the end, so older clients can't wipe them.
 */
export function mergeWidgetPut(
  stored: unknown,
  incoming: Array<{ id?: string; type: string; applicationId?: string | null; builtin?: string | null }>
): Placement[] {
  const list = clean(stored);
  const byId = new Map(list.map((p, i) => [placementId(p, i), p] as const));
  const out: Placement[] = [];
  const used = new Set<string>();
  incoming.forEach((w, i) => {
    if (w.type === "application") {
      if (typeof w.applicationId !== "string" || !w.applicationId) return;
      const id = `application:${w.applicationId}`;
      if (used.has(id)) return;
      out.push({ id, type: "application", applicationId: w.applicationId, builtin: null });
      used.add(id);
      return;
    }
    const id = w.id || placementId(w as Placement, i);
    if (used.has(id)) return;
    const existing = byId.get(id);
    if (existing && existing.type === "builtin") {
      out.push({ ...existing, id });
      used.add(id);
      return;
    }
    const cat = categoryFromGameId(id);
    if (cat) {
      out.push(makeGamePlacement(cat));
      used.add(id);
    }
  });
  list.forEach((p, i) => {
    const id = placementId(p, i);
    if (p.type === "builtin" && !used.has(id)) {
      out.push({ ...p, id });
      used.add(id);
    }
  });
  return withPositions(out.slice(0, MAX_BOARD_PLACEMENTS));
}

/** Move `id` one step among `visible` ids; returns the new full order or null. */
export function moveInOrder(order: string[], visible: string[], id: string, dir: -1 | 1): string[] | null {
  const vi = visible.indexOf(id);
  const neighbour = visible[vi + dir];
  if (vi === -1 || !neighbour) return null;
  const next = [...order];
  const a = next.indexOf(id);
  const b = next.indexOf(neighbour);
  if (a === -1 || b === -1) return null;
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
