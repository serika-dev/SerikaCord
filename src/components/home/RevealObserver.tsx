"use client";

import { useEffect } from "react";

/**
 * Scroll reveals for the homepage, in every browser (Firefox has no
 * scroll-driven animations). Marks each `[data-reveal]` element `is-in` once
 * it scrolls into view; home.css animates it in (and its children one after
 * another when it also has `data-reveal-stagger`). Anything already on screen
 * is marked before `hm-js` hides the rest, so nothing visible blinks, and
 * without JavaScript or with reduced motion nothing is ever hidden.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".hm-root");
    if (!root) return;
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("reduce-motion");
    if (reduced || typeof IntersectionObserver === "undefined") return;

    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const vh = window.innerHeight;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) el.classList.add("is-in");
    }
    root.classList.add("hm-js");

    const show = (el: Element) => {
      el.classList.add("is-in");
      io.unobserve(el);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) show(e.target);
        // Jumped past with an in-page link: what's above the screen shows too,
        // so scrolling back up never finds an empty gap.
        for (const el of els) {
          if (!el.classList.contains("is-in") && el.getBoundingClientRect().bottom < 0) show(el);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );
    for (const el of els) if (!el.classList.contains("is-in")) io.observe(el);

    return () => {
      io.disconnect();
      root.classList.remove("hm-js");
    };
  }, []);

  return null;
}
