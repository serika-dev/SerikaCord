"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, Download, Menu, X } from "lucide-react";
import { useGT } from "gt-next";
import { cdnImage, cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { detectPlatform, type ClientPlatform } from "@/lib/detectPlatform";

const noopSubscribe = () => () => {};
const serverPlatform = (): ClientPlatform => "unknown";

/** Sign in / sign up, or the signed-in user's avatar. Fixed footprint while loading. */
export function HomeNavActions() {
  const { user, isLoading } = useAuth();
  const gt = useGT();

  if (isLoading) {
    return <div className="h-9 w-[70px] sm:w-[160px]" aria-hidden />;
  }

  if (user) {
    const name = user.displayName || user.username;
    return (
      <Link href="/channels/me" className="group flex items-center gap-2 rounded-full py-1 pl-1 pr-1 md:pr-3" aria-label={gt("Open SerikaCord")}>
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN avatar, already resized by cdnImage
          <img
            src={cdnImage(user.avatar)}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full object-cover ring-2 ring-[var(--hm-line)] transition group-hover:ring-[var(--brand-violet)]"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-violet)] text-xs font-bold text-white ring-2 ring-[var(--hm-line)]">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[120px] truncate text-sm text-[var(--hm-ink)] md:block">{name}</span>
      </Link>
    );
  }

  return (
    // Phones: just "Log in" (the hero links to sign-up), so the bar fits at 360px.
    <div className="flex items-center gap-1 sm:gap-2">
      <Link href="/login" className="hm-nav-link font-medium">
        {gt("Log in")}
      </Link>
      <Link href="/register" className="hm-btn hm-btn-primary hm-btn-sm !hidden sm:!inline-flex">
        {gt("Sign up")}
      </Link>
    </div>
  );
}

export interface HomeMenuLink {
  label: string;
  href: string;
}

/** Phone-width menu for the section links (the bar shows them from md up). */
export function HomeMobileMenu({ links }: { links: HomeMenuLink[] }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--hm-ink)] hover:bg-white/10"
        aria-expanded={open}
        aria-controls="hm-mobile-menu"
        aria-label={open ? gt("Close menu") : gt("Open menu")}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <div
          id="hm-mobile-menu"
          className="hm-nav absolute inset-x-0 top-full border-t-0 px-4 pb-4 pt-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="block rounded-[12px] px-3 py-3 text-base font-medium text-[var(--hm-ink)] hover:bg-white/10"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Hero / closing CTAs. Every state renders two working links of the same size,
 * so nothing jumps while the session loads: the download button names the
 * visitor's OS (product names are never translated), the second button opens
 * the app, labelled for signed-in vs new visitors.
 */
export function HomeHeroActions({ align = "center" }: { align?: "center" | "start" }) {
  const { user, isLoading } = useAuth();
  const gt = useGT();
  const platform = useSyncExternalStore(noopSubscribe, detectPlatform, serverPlatform);

  const downloadLabel =
    platform === "windows"
      ? gt("Download for {platform}", { platform: "Windows" })
      : platform === "mac"
        ? gt("Download for {platform}", { platform: "macOS" })
        : platform === "linux"
          ? gt("Download for {platform}", { platform: "Linux" })
          : platform === "android"
            ? gt("Download for {platform}", { platform: "Android" })
            : platform === "ios"
              ? gt("Get the app")
              : gt("Download");

  const openLabel = user || isLoading ? gt("Open SerikaCord") : gt("Open in browser");
  const name = user ? user.displayName || user.username : "";

  return (
    <div className={cn("flex flex-col gap-3 sm:gap-4", align === "center" ? "items-center" : "items-start")}>
      <div className={cn("flex w-full max-w-[22rem] flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row sm:gap-3", align === "center" && "sm:justify-center")}>
        <Link href="/channels/me" className="hm-btn hm-btn-primary w-full sm:w-auto sm:min-w-[200px]">
          {openLabel}
          <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
        </Link>
        <Link href="/download" className="hm-btn hm-btn-ghost w-full sm:w-auto sm:min-w-[200px]">
          <Download className="h-4 w-4" aria-hidden />
          {downloadLabel}
        </Link>
      </div>
      <p className="min-h-5 text-sm text-[var(--hm-faint)]">
        {isLoading ? null : user ? (
          gt("Signed in as {name}", { name })
        ) : (
          <>
            {gt("New here?")}{" "}
            <Link href="/register" className="hm-link">
              {gt("Create a free account")}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
