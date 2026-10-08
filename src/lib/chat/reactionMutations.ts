/**
 * Pure helpers for the server-side reaction array stored on a message row.
 * Used inside `Message.mutateReactions` (a row-locked read-modify-write), so
 * they must only transform the array they are given.
 */

export interface StoredReaction {
  emoji: { name: string; id?: string; url?: string; animated?: boolean };
  count: number;
  userIds: string[];
}

export type ReactionMatcher = (reaction: StoredReaction) => boolean;
type IdEquals = (a: string, b: string) => boolean;

const strictEquals: IdEquals = (a, b) => a === b;

/** Match a custom emoji by id, a unicode emoji by name. */
export function matchReactionEmoji(emoji: { name: string; id?: string | null }): ReactionMatcher {
  return (r) => (emoji.id ? r.emoji?.id === emoji.id : r.emoji?.name === emoji.name);
}

/**
 * Add `userId`'s reaction. Creates the reaction entry when missing; a repeat
 * reaction by the same user is a no-op. Returns the new array and the count
 * for this emoji after the change.
 */
export function addReaction(
  reactions: StoredReaction[],
  match: ReactionMatcher,
  emoji: StoredReaction['emoji'],
  userId: string,
  idEquals: IdEquals = strictEquals,
): { reactions: StoredReaction[]; count: number } {
  const next = reactions.map((r) => ({ ...r, emoji: { ...r.emoji }, userIds: [...(r.userIds || [])] }));
  const existing = next.find(match);
  if (!existing) {
    next.push({ emoji: { ...emoji }, count: 1, userIds: [userId] });
    return { reactions: next, count: 1 };
  }
  if (!existing.userIds.some((id) => idEquals(id, userId))) {
    existing.userIds.push(userId);
    existing.count = existing.userIds.length;
  }
  // Keep the custom emoji URL populated on older entries.
  if (emoji.url) existing.emoji.url = emoji.url;
  return { reactions: next, count: existing.count };
}

/**
 * Remove `userId`'s reaction. Drops the entry once nobody is left on it.
 * `changed` is false when there was nothing to remove.
 */
export function removeReaction(
  reactions: StoredReaction[],
  match: ReactionMatcher,
  userId: string,
  idEquals: IdEquals = strictEquals,
): { reactions: StoredReaction[]; count: number; changed: boolean } {
  const index = reactions.findIndex(match);
  if (index === -1) return { reactions, count: 0, changed: false };
  const target = reactions[index];
  const userIds = (target.userIds || []).filter((id) => !idEquals(id, userId));
  if (userIds.length === (target.userIds || []).length) {
    return { reactions, count: userIds.length, changed: false };
  }
  const next = reactions.slice();
  if (userIds.length === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { ...target, userIds, count: userIds.length };
  }
  return { reactions: next, count: userIds.length, changed: true };
}
