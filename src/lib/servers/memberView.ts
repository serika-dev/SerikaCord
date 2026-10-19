/**
 * Server Settings → Members list (CORD-54): search, role filter and sort.
 * Pure so it can be unit tested; the dialog renders the result.
 */

export type MemberSort = 'joined_desc' | 'joined_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';

export interface MemberViewRow {
  id: string;
  username: string;
  displayName?: string | null;
  nickname?: string | null;
  joinedAt?: string | null;
  createdAt?: string | null;
  roles: ReadonlyArray<{ id: string }>;
}

function time(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function label(m: MemberViewRow): string {
  return (m.nickname || m.displayName || m.username || '').toLowerCase();
}

export function filterAndSortMembers<T extends MemberViewRow>(
  members: readonly T[],
  opts: { search?: string; roleId?: string | null; sort?: MemberSort },
): T[] {
  const needle = (opts.search ?? '').trim().toLowerCase();
  const roleId = opts.roleId ? opts.roleId.toLowerCase() : null;
  const rows = members.filter((m) => {
    if (roleId && !m.roles.some((r) => r.id.toLowerCase() === roleId)) return false;
    if (!needle) return true;
    return [m.username, m.displayName, m.nickname, m.id].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
  });
  const byName = (a: T, b: T) => label(a).localeCompare(label(b)) || a.id.localeCompare(b.id);
  const sort = opts.sort ?? 'joined_desc';
  rows.sort((a, b) => {
    switch (sort) {
      case 'joined_asc': return time(a.joinedAt) - time(b.joinedAt) || byName(a, b);
      case 'name_asc': return byName(a, b);
      case 'name_desc': return byName(b, a);
      case 'created_desc': return time(b.createdAt) - time(a.createdAt) || byName(a, b);
      case 'created_asc': return time(a.createdAt) - time(b.createdAt) || byName(a, b);
      case 'joined_desc':
      default: return time(b.joinedAt) - time(a.joinedAt) || byName(a, b);
    }
  });
  return rows;
}
