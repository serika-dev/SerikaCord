import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * Warm a conversation route on intent (hover / focus), page data included.
 *
 * `router.prefetch(href)` on its own is an "auto" prefetch: for our dynamic
 * routes, which have a `loading.tsx`, Next only fetches up to that loading
 * boundary. The click then still shows the skeleton and waits for a server
 * round trip before the page can mount, even when the messages are already
 * cached. A full prefetch fetches the page segment too, so the navigation
 * commits from the router cache (reused for `staleTimes.static`, 180 s).
 *
 * Only for links the user is about to open: each full prefetch renders the
 * route on the server.
 */
export function prefetchRoute(router: { prefetch: (href: string, options?: { kind: PrefetchKind }) => void }, href: string): void {
  router.prefetch(href, { kind: PrefetchKind.FULL });
}
