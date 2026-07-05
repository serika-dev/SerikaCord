// Slugs that can never be used as invite or vanity URL codes because they
// collide with real routes or reserved branding. Shared by the invite page,
// invite creation, and vanity URL management so the lists never drift apart.
export const RESERVED_SLUGS = new Set([
  'login', 'register', 'logout', 'signup', 'sign-up', 'sign-in',
  'channels', 'me', 'messages', 'notifications', 'profile', 'settings',
  'explore', 'discover', 'download', 'widget', 'dm', 'api',
  'terms', 'privacy', 'legal', 'guidelines', 'about', 'careers', 'blog',
  'admin', 'staff', 'system', 'support',
  'help', 'status', 'cdn', 'static', 'assets', 'favicon',
  'developers', 'docs',
  '404', '500', 'robots', 'sitemap', 'manifest',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

// Vanity codes: lowercase letters, digits, hyphens; 3-32 chars; no leading/
// trailing hyphen.
export const VANITY_CODE_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;

export function isValidVanityCode(code: string): boolean {
  return VANITY_CODE_REGEX.test(code) && !isReservedSlug(code);
}
