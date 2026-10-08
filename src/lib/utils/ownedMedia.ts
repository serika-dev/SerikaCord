/**
 * True when a storage key sits inside the owner's own upload prefix (e.g.
 * `avatars/<userId>/`), so replacing a profile image only ever deletes that
 * owner's object. Rejects empty keys, path tricks and anything outside the
 * prefix (another user's file, a shared asset, a foreign URL).
 */
export function isOwnedMediaKey(key: string | null | undefined, ownerPrefix: string): boolean {
  if (!key || !ownerPrefix || !ownerPrefix.endsWith('/')) return false;
  if (!key.startsWith(ownerPrefix)) return false;
  const rest = key.slice(ownerPrefix.length);
  if (!rest) return false;
  return !rest.split('/').some((part) => part === '' || part === '.' || part === '..');
}
