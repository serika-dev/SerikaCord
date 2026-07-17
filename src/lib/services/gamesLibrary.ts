import { UserGame, USER_GAME_LIMITS, type IUserGame, type UserGameCategory } from '@/lib/models';

export const GAME_CATEGORIES: UserGameCategory[] = ['favorite', 'liked', 'rotation', 'wishlist'];

export function isValidCategory(c: string): c is UserGameCategory {
  return (GAME_CATEGORIES as string[]).includes(c);
}

export interface GameLibraryEntryInput {
  igdbId?: number | null;
  steamAppId?: string | null;
  name: string;
  coverUrl?: string | null;
  tags?: string[];
  note?: string | null;
}

/** Public shape returned to clients. */
export function serializeGame(g: IUserGame) {
  return {
    id: g.id,
    igdbId: g.igdbId ?? null,
    steamAppId: g.steamAppId ?? null,
    name: g.name,
    coverUrl: g.coverUrl ?? null,
    category: g.category,
    tags: (g.tags as string[]) || [],
    note: g.note ?? null,
    position: g.position,
  };
}

/** All of a user's library, grouped by category, ordered by position. */
export async function getUserLibrary(userId: string) {
  const rows = await UserGame.find({ userId });
  const grouped: Record<UserGameCategory, ReturnType<typeof serializeGame>[]> = {
    favorite: [], liked: [], rotation: [], wishlist: [],
  };
  for (const row of rows) {
    if (isValidCategory(row.category)) grouped[row.category].push(serializeGame(row));
  }
  return grouped;
}

export async function getUserCategory(userId: string, category: UserGameCategory) {
  const rows = await UserGame.find({ userId, category });
  return rows.map(serializeGame);
}

export class GameLibraryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/**
 * Add a game to a category. Enforces per-category limits and dedupes by
 * igdbId (falling back to name). Appends at the end of the category.
 */
export async function addGame(userId: string, category: UserGameCategory, input: GameLibraryEntryInput) {
  if (!input.name?.trim()) throw new GameLibraryError('Game name is required');

  const existing = await UserGame.find({ userId, category });

  // Dedupe: same igdbId, or same name when no igdbId.
  const dup = existing.find((g) =>
    (input.igdbId != null && g.igdbId === input.igdbId) ||
    (input.igdbId == null && g.name.toLowerCase() === input.name.trim().toLowerCase()),
  );
  if (dup) throw new GameLibraryError('That game is already in this list', 409);

  const limit = USER_GAME_LIMITS[category];
  if (existing.length >= limit) {
    throw new GameLibraryError(`You can only have ${limit} game${limit === 1 ? '' : 's'} in "${category}"`, 409);
  }

  const position = existing.length;
  return serializeGame(await UserGame.create({
    userId,
    category,
    igdbId: input.igdbId ?? null,
    steamAppId: input.steamAppId ?? null,
    name: input.name.trim(),
    coverUrl: input.coverUrl ?? null,
    tags: input.tags ?? [],
    note: input.note ?? null,
    position,
  }));
}

export async function updateGame(userId: string, id: string, patch: { tags?: string[]; note?: string | null; coverUrl?: string | null }) {
  const row = await UserGame.findOne({ id });
  if (!row || row.userId !== userId) throw new GameLibraryError('Game not found', 404);
  const updated = await UserGame.updateById(id, {
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl } : {}),
  });
  return updated ? serializeGame(updated) : null;
}

export async function removeGame(userId: string, id: string) {
  const row = await UserGame.findOne({ id });
  if (!row || row.userId !== userId) throw new GameLibraryError('Game not found', 404);
  await UserGame.deleteById(id);
}

/** Reorder a category: `orderedIds` is the full list of entry ids in the new order. */
export async function reorderCategory(userId: string, category: UserGameCategory, orderedIds: string[]) {
  const rows = await UserGame.find({ userId, category });
  const byId = new Map(rows.map((r) => [r.id, r]));
  let position = 0;
  for (const id of orderedIds) {
    if (byId.has(id)) {
      await UserGame.updateById(id, { position });
      position++;
    }
  }
  return getUserCategory(userId, category);
}
