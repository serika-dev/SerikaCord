"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fires once the observed element scrolls within `rootMargin` of the viewport.
 * Latches to `true` and disconnects — so heavy work (network fetches, media,
 * iframes) is deferred until a row is near view, and never re-runs when the
 * user scrolls away. This is what keeps an invite/embed-heavy channel from
 * firing 50–200 concurrent fetches the instant it opens.
 *
 * Returns a ref to attach to the element and whether it has entered view yet.
 * Falls back to `true` (eager) when IntersectionObserver is unavailable.
 */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin = "600px"
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState<boolean>(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}
