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
