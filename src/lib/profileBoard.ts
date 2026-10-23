/**
 * Profile Board ordering — pure helpers shared by the API and the client.
 *
 * Everything on a user's Board (game library sections, app widgets from the
 * Social SDK, Serika Wishlist widgets, and the fixed Connections and Recent
 * activity sections) is one ordered list in `users.profile_widgets`. Fixed
 * built-ins are implicit until first reordered: game sections without a
 * placement are shown before everything else, Connections and Recent activity
 * after everything else (where they always were), and each gets a real
 * placement the first time the owner moves anything.
 *
 * Connections and Recent activity are on by default. Removing one stores its
 * placement with `hidden: true` (keeping its slot), so adding it back puts it
 * where it was. Only the dedicated section endpoint changes `hidden`; the
 * order endpoint and the generic widget PUT copy stored placements as-is.
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

/** Fixed profile sections that are part of the Board order (never removable). */
export type BoardSectionKey = "connections" | "activity";

export const BOARD_SECTION_ORDER: BoardSectionKey[] = ["connections", "activity"];

export const SECTION_BUILTIN_BY_KEY: Record<BoardSectionKey, string> = {
  connections: "connections",
  activity: "recent_activity",
};

const SECTION_BY_BUILTIN: Record<string, BoardSectionKey> = Object.fromEntries(
  Object.entries(SECTION_BUILTIN_BY_KEY).map(([k, b]) => [b, k as BoardSectionKey])
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

export function sectionPlacementId(key: BoardSectionKey): string {
  return `section:${key}`;
}

export function sectionKeyOf(p: Placement): BoardSectionKey | null {
  if (p.type !== "builtin" || typeof p.builtin !== "string") return null;
  return SECTION_BY_BUILTIN[p.builtin] ?? null;
}

export function makeSectionPlacement(key: BoardSectionKey): Placement {
  return { id: sectionPlacementId(key), type: "builtin", builtin: SECTION_BUILTIN_BY_KEY[key], applicationId: null };
}

/** Parse `section:<key>` ids sent by clients. */
export function sectionFromId(id: string): BoardSectionKey | null {
  const m = /^section:(connections|activity)$/.exec(id);
  return m ? (m[1] as BoardSectionKey) : null;
}

/** A fixed built-in (game section or profile section) for a client-sent id, if it isn't stored yet. */
function fixedPlacementFor(id: string, list: Placement[]): Placement | null {
  const cat = categoryFromGameId(id);
  if (cat) return list.some((p) => gameCategoryOf(p) === cat) ? null : makeGamePlacement(cat);
  const key = sectionFromId(id);
  if (key) return list.some((p) => sectionKeyOf(p) === key) ? null : makeSectionPlacement(key);
  return null;
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
  const key = sectionKeyOf(p);
  if (key) return sectionPlacementId(key);
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
 * sections placed first and implicit Connections / Recent activity last.
 * Removed sections stay in the order (so they keep their slot); renderers
 * skip placements with `hidden: true`.
 */
export function boardOrder(stored: unknown): string[] {
  const list = clean(stored);
  const ids = list.map(placementId);
  const leading = GAME_CATEGORY_ORDER.filter((c) => !list.some((p) => gameCategoryOf(p) === c)).map(gamePlacementId);
  const trailing = BOARD_SECTION_ORDER.filter((k) => !list.some((p) => sectionKeyOf(p) === k)).map(sectionPlacementId);
  return [...leading, ...ids, ...trailing];
}

export function isHiddenPlacement(p: Placement): boolean {
  return p.hidden === true;
}

/** Connections / Recent activity sections the owner removed from their Board. */
export function removedSections(stored: unknown): BoardSectionKey[] {
  return clean(stored)
    .map((p) => (isHiddenPlacement(p) ? sectionKeyOf(p) : null))
    .filter((k): k is BoardSectionKey => !!k);
}

/**
 * Remove (`enabled: false`) or add back (`enabled: true`) a fixed section.
 * Implicit sections are first written out at their implicit spot (after
 * everything, in default order) so the Board doesn't shift; a removed
 * section keeps its slot, so adding it back restores its previous position.
 */
export function setSectionEnabled(stored: unknown, key: BoardSectionKey, enabled: boolean): Placement[] {
  let list = clean(stored);
  if (!list.some((p) => sectionKeyOf(p) === key)) {
    if (enabled) return withPositions(list); // already on by default
    const missing = BOARD_SECTION_ORDER.filter((k) => !list.some((p) => sectionKeyOf(p) === k));
    list = [...list, ...missing.map(makeSectionPlacement)];
  }
  return withPositions(
    list.map((p) => {
      if (sectionKeyOf(p) !== key) return p;
      const next: Placement = { ...p, id: sectionPlacementId(key) };
      if (enabled) delete next.hidden;
      else next.hidden = true;
      return next;
    })
  );
}

/**
 * Make sure an order (e.g. from an older server) names every fixed built-in:
 * missing game sections go first, missing Connections / Recent activity last.
 */
export function withFixedIds(order: string[]): string[] {
  const leading = GAME_CATEGORY_ORDER.map(gamePlacementId).filter((id) => !order.includes(id));
  const trailing = BOARD_SECTION_ORDER.map(sectionPlacementId).filter((id) => !order.includes(id));
  return [...leading, ...order, ...trailing];
}

/**
 * Apply a client-chosen order. Known ids are moved into that order, implicit
 * fixed sections (games, Connections, Recent activity) named in it become
 * real placements, unknown ids are
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
    const fixed = fixedPlacementFor(id, list);
    if (fixed) {
      out.push(fixed);
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
 * order. Built-ins can't be dropped here (game sections follow the library,
 * Connections / Recent activity are fixed, wishlists have their own
 * endpoint): ones the body names keep their stored settings, valid fixed ids
 * are accepted, and stored built-ins the body omits are kept at the end, so
 * older clients can't wipe them.
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
    const fixed = fixedPlacementFor(id, list);
    if (fixed) {
      out.push(fixed);
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
