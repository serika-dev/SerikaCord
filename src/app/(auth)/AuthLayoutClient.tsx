"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { T } from "gt-next";
import { RandomAuthBackground } from "@/components/auth/RandomAuthBackground";

/**
 * Split-screen auth shell shared by login / register / password pages, matching
 * the serika-accounts style (the house style for all Serika products):
 *   • Left pane  — full-bleed random serika.art artwork + artist attribution.
 *   • Right pane — fixed-width surface with the logo up top, the form centered,
 *     and the copyright pinned to the bottom.
 * On mobile the artwork sits fixed behind a bottom-sheet card that pops up from
 * under the screen (accounts' `popFromUnder`).
 */
export default function AuthLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lazily read the viewport so the bottom-sheet pop only animates on mobile.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden bg-[#09090b]">
      {/* ── Left: artwork (fixed behind on mobile) ────────────────────── */}
      <RandomAuthBackground />

      {/* ── Right: form surface ───────────────────────────────────────── */}
      <div className="relative z-10 flex w-full flex-col overflow-y-auto p-0 md:w-[400px] md:shrink-0 md:border-l md:border-white/[0.08] md:bg-[#121215] md:px-10 md:py-10 md:shadow-[-10px_0_30px_rgba(0,0,0,0.5)] lg:w-[500px] lg:px-12 max-md:justify-end">
        {/* Logo (top, desktop) */}
        <div className="pointer-events-none absolute left-0 top-10 z-[5] hidden w-full justify-center md:flex">
          <Link href="/" className="pointer-events-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="SerikaCord" className="h-[42px] w-auto" />
          </Link>
        </div>

        {/* Centered form (desktop) / bottom-sheet card (mobile) */}
        <motion.div
          className="mx-auto w-full max-w-[360px] md:my-auto md:py-2 max-md:max-w-full max-md:rounded-t-[1.5rem] max-md:border max-md:border-b-0 max-md:border-white/20 max-md:bg-[#121215] max-md:px-6 max-md:pt-8 max-md:pb-[calc(2rem+env(safe-area-inset-bottom,0px))] max-md:shadow-[0_-10px_40px_rgba(0,0,0,0.3)]"
          initial={isMobile ? { y: "100%", opacity: 0 } : { y: 10, opacity: 0 }}
          animate={{ y: isMobile ? 0 : 0, opacity: 1 }}
          transition={{ duration: isMobile ? 0.5 : 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Logo (mobile, above the form) */}
          <div className="mb-6 flex justify-center md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="SerikaCord" className="h-10 w-auto" />
          </div>
          {children}
        </motion.div>

        {/* Copyright (bottom, desktop) */}
        <div className="pointer-events-none absolute bottom-6 left-0 hidden w-full text-center text-xs text-[#a1a1aa] md:block">
          <T>© 2026 SerikaCord. All rights reserved.</T>
        </div>
      </div>
    </div>
  );
}
