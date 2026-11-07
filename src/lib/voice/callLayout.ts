// Which tiles a call shows and how the grid lays them out (Discord's voice /
// video grid): screen shares first, then everyone's camera or avatar card;
// clicking a tile spotlights it with the rest in a filmstrip. Pure.

export type StageTileKind = "screen" | "camera" | "avatar";

export interface StageTile {
  /** Stable key: `screen:<userId>` or `user:<userId>`. */
  id: string;
  kind: StageTileKind;
  userId: string;
  isSelf: boolean;
}

export interface StageMember {
  userId: string;
  /** Camera on and its video is available to show. */
  camera: boolean;
  /** Screen share available to show. */
  screen: boolean;
}

export function stageTileId(kind: StageTileKind, userId: string): string {
  return `${kind === "screen" ? "screen" : "user"}:${userId.toLowerCase()}`;
}

/**
 * Tiles for a call. `includeAudioOnly` shows people without a camera as avatar
 * cards (server voice channels); DM calls show only video, since the avatars
 * are already in the call header.
 */
export function buildStageTiles(input: {
  members: StageMember[];
  selfId: string;
  includeAudioOnly: boolean;
}): StageTile[] {
  const self = input.selfId.toLowerCase();
  const isSelf = (id: string) => id.toLowerCase() === self;
  // Self first among people, then everyone else in join order.
  const ordered = [
    ...input.members.filter((m) => isSelf(m.userId)),
    ...input.members.filter((m) => !isSelf(m.userId)),
  ];
  const seen = new Set<string>();
  const screens: StageTile[] = [];
  const people: StageTile[] = [];
  for (const m of ordered) {
    const key = m.userId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (m.screen) screens.push({ id: stageTileId("screen", m.userId), kind: "screen", userId: m.userId, isSelf: isSelf(m.userId) });
    if (m.camera) {
      people.push({ id: stageTileId("camera", m.userId), kind: "camera", userId: m.userId, isSelf: isSelf(m.userId) });
    } else if (input.includeAudioOnly) {
      people.push({ id: stageTileId("avatar", m.userId), kind: "avatar", userId: m.userId, isSelf: isSelf(m.userId) });
    }
  }
  return [...screens, ...people];
}

/** The spotlighted tile, or null once it's gone (they stopped sharing / left). */
export function resolveFocusedTile(tiles: StageTile[], focusedId: string | null): StageTile | null {
  if (!focusedId) return null;
  return tiles.find((t) => t.id === focusedId) ?? null;
}

/** Grid columns for `count` tiles (fewer on narrow screens). */
export function gridColumns(count: number, narrow: boolean): number {
  if (count <= 1) return 1;
  if (narrow) return 2;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}

/**
 * Discord-style grid fit: the column count (and tile width in px) that gives
 * the largest tiles of `aspect` where all `count` tiles fit inside
 * `width` x `height` with `gap` between them. Null until the area is measured.
 */
export function fitGrid(
  count: number,
  width: number,
  height: number,
  gap: number,
  aspect = 16 / 9,
): { cols: number; tileWidth: number } | null {
  if (count <= 0 || width <= 0 || height <= 0) return null;
  const options: { cols: number; tileWidth: number }[] = [];
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    const byHeight = ((height - gap * (rows - 1)) / rows) * aspect;
    const tileWidth = Math.floor(Math.min(byWidth, byHeight));
    if (tileWidth > 0) options.push({ cols, tileWidth });
  }
  if (options.length === 0) return null;
  const largest = Math.max(...options.map((o) => o.tileWidth));
  // Like Discord, people sit side by side rather than stacked: the most
  // columns whose tiles are still at least SIDE_BY_SIDE of the largest fit
  // (two people in a wide, short window get two columns, not two rows).
  return options.filter((o) => o.tileWidth >= largest * SIDE_BY_SIDE).reduce((a, b) => (b.cols > a.cols ? b : a));
}

/** How much smaller tiles may get to stay side by side instead of stacking. */
const SIDE_BY_SIDE = 0.75;
