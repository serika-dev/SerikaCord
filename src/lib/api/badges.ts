import { Elysia } from 'elysia';
import { getBadgeRegistry } from '@/lib/services/badgeRegistry';
import { toPublicBadge } from '@/lib/badges/shared';

// Public badge catalogue. Clients fetch it once per session (useBadges) to
// render the ids stored on users. Hidden badges are left out so they render
// nowhere. Staff CRUD lives under /api/admin/badges (admin.ts).
export const badgeRoutes = new Elysia({ prefix: '/badges' })
  .get('/', async ({ set }) => {
    const { list } = await getBadgeRegistry();
    set.headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=600';
    return { badges: list.filter((b) => !b.hidden).map(toPublicBadge) };
  });
