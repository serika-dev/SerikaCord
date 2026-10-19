/**
 * Moves `fromId` so it lands just before or after `targetId` in `ids`
 * (highest role first). Returns null when nothing would change or an id is
 * missing. Used by the role list drag-and-drop in Server Settings.
 */
export function moveRoleId(
  ids: readonly string[],
  fromId: string,
  targetId: string,
  mode: 'before' | 'after',
): string[] | null {
  if (fromId === targetId) return null;
  const fromIndex = ids.indexOf(fromId);
  if (fromIndex < 0 || !ids.includes(targetId)) return null;
  const without = ids.filter((id) => id !== fromId);
  const targetIndex = without.indexOf(targetId);
  const insertAt = mode === 'before' ? targetIndex : targetIndex + 1;
  without.splice(insertAt, 0, fromId);
  return without.every((id, i) => id === ids[i]) ? null : without;
}

/**
 * Whether dropping on the top or bottom half of a row would be a no-op (the
 * dragged role already sits right there), so no indicator is drawn.
 */
export function isNoopRoleDrop(
  ids: readonly string[],
  fromId: string,
  targetId: string,
  mode: 'before' | 'after',
): boolean {
  return moveRoleId(ids, fromId, targetId, mode) === null;
}
