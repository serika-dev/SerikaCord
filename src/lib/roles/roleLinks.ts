/**
 * Linked roles (CORD-57): "members who get role A also get role B" (one way).
 *
 * Stored in `servers.settings.roleLinks` as `{ [sourceRoleId]: targetRoleId[] }`
 * (jsonb, no schema change). Pure helpers only: the routes load the server and
 * its roles, then call these.
 *
 * Links apply when a role is granted (and to current holders when a link is
 * added). Removing role A later does not take B away: we don't know whether B
 * was also given by hand.
 */

export type RoleLinks = Record<string, string[]>;

export interface LinkableRole {
  id: string;
  isDefault?: boolean | null;
  managed?: boolean | null;
}

/** Most roles one role can link to. */
export const MAX_LINKED_ROLES_PER_ROLE = 10;
/** Most roles with links in one server. */
export const MAX_ROLE_LINK_SOURCES = 250;

const lower = (id: string) => id.toLowerCase();

/** Whether a role can be granted through a link (never @everyone or a bot/integration role). */
export function isLinkableRole(role: LinkableRole | undefined | null): boolean {
  return Boolean(role) && !role!.isDefault && !role!.managed;
}

/**
 * Clean a stored or client-supplied link map: lowercase ids, drop self links,
 * duplicates, unknown / unlinkable roles (when `roles` is given) and empty
 * entries, and apply the caps.
 */
export function normalizeRoleLinks(raw: unknown, roles?: readonly LinkableRole[]): RoleLinks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const byId = roles ? new Map(roles.map((r) => [lower(r.id), r])) : null;
  const ok = (id: string) => !byId || isLinkableRole(byId.get(id));
  const out: RoleLinks = {};
  let sources = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (sources >= MAX_ROLE_LINK_SOURCES) break;
    const source = lower(key);
    if (!ok(source) || !Array.isArray(value)) continue;
    const targets: string[] = [];
    for (const v of value) {
      if (typeof v !== 'string') continue;
      const id = lower(v);
      if (id === source || targets.includes(id) || !ok(id)) continue;
      targets.push(id);
      if (targets.length >= MAX_LINKED_ROLES_PER_ROLE) break;
    }
    if (targets.length === 0) continue;
    out[source] = targets;
    sources++;
  }
  return out;
}

/** The link map stored in a server's settings, cleaned against its roles. */
export function readRoleLinks(settings: unknown, roles?: readonly LinkableRole[]): RoleLinks {
  if (!settings || typeof settings !== 'object') return {};
  return normalizeRoleLinks((settings as { roleLinks?: unknown }).roleLinks, roles);
}

/**
 * Every role reachable from `sources` through links (transitively), minus the
 * sources themselves. A role is only followed further when `canAdd` allows it
 * (a link the actor may not grant doesn't fire, so neither do its own links).
 * Cycles are harmless: each role is visited once.
 */
export function linkedRoleClosure(
  sources: Iterable<string>,
  links: RoleLinks,
  canAdd: (roleId: string) => boolean = () => true,
): string[] {
  const start = new Set([...sources].map(lower));
  const visited = new Set(start);
  const queue = [...start];
  const found: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const target of links[id] ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      if (!canAdd(target)) continue;
      found.push(target);
      queue.push(target);
    }
  }
  return found;
}

/**
 * The member's role list after linked roles are applied: roles in `next` that
 * were not in `current` (newly granted) pull in the roles they link to.
 * Returns `next` unchanged (same order) plus the added roles at the end.
 */
export function expandLinkedRoles(params: {
  current: readonly string[];
  next: readonly string[];
  links: RoleLinks;
  canAdd?: (roleId: string) => boolean;
}): string[] {
  const { current, next, links, canAdd } = params;
  if (Object.keys(links).length === 0) return [...next];
  const had = new Set(current.map(lower));
  const has = new Set(next.map(lower));
  const granted = next.map(lower).filter((id) => !had.has(id));
  if (granted.length === 0) return [...next];
  const out = [...next];
  // Follow links through roles the member already holds too: A → B → C still
  // gives C when B was already held.
  for (const id of linkedRoleClosure(granted, links, (id) => has.has(id) || !canAdd || canAdd(id))) {
    if (has.has(id)) continue;
    has.add(id);
    out.push(id);
  }
  return out;
}

/** Targets in `after` that `before` didn't have for the same source (new links). */
export function addedRoleLinkTargets(before: RoleLinks, after: RoleLinks): RoleLinks {
  const out: RoleLinks = {};
  for (const [source, targets] of Object.entries(after)) {
    const prev = new Set(before[source] ?? []);
    const fresh = targets.filter((t) => !prev.has(t));
    if (fresh.length > 0) out[source] = fresh;
  }
  return out;
}
