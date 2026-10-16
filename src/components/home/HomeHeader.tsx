import Link from "next/link";
import { getGT } from "gt-next/server";
import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { HomeMobileMenu, HomeNavActions } from "./HomeNav";

/**
 * Brand-band nav (dark in every theme, so the white-and-violet wordmark always
 * reads). Shared by the homepage and the /compare pages: on the homepage the
 * section links are in-page anchors; elsewhere they point back to the homepage
 * and the comparison pages get their own links. `current` marks the open page.
 */
export async function HomeHeader({ variant = "home", current }: { variant?: "home" | "site"; current?: string } = {}) {
  const gt = await getGT();
  const links =
    variant === "home"
      ? [
          { label: gt("Features"), href: "#features" },
          { label: gt("Privacy"), href: "#privacy" },
          { label: gt("Apps"), href: "#apps" },
          { label: gt("Developers"), href: "/developers" },
          { label: gt("Compare"), href: "/compare" },
        ]
      : [
          { label: gt("Features"), href: "/#features" },
          { label: gt("Apps"), href: "/#apps" },
          { label: gt("Developers"), href: "/developers" },
          { label: gt("Compare"), href: "/compare" },
          { label: gt("Tier list"), href: "/compare/tier-list" },
        ];

  return (
    <header className="hm-dark hm-nav fixed inset-x-0 top-0 z-50 pt-[var(--safe-area-top)]">
      <a href="#main" className="hm-skip">
        {gt("Skip to content")}
      </a>
      <div className="relative mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link href="/" aria-label={gt("SerikaCord home")} className="shrink-0">
          <BrandMark />
        </Link>
        <nav aria-label={gt("Main")} className="hidden items-center gap-0.5 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.href === current ? "page" : undefined}
              className={cn("hm-nav-link", l.href === current && "text-[var(--hm-ink)]")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <HomeNavActions />
          <HomeMobileMenu links={links} />
        </div>
      </div>
    </header>
  );
}
