import Link from "next/link";
import { getGT } from "gt-next/server";
import { Logo } from "@/components/ui/Logo";
import { HomeMobileMenu, HomeNavActions } from "./HomeNav";

/** Brand-band nav (dark in every theme, so the white-and-violet wordmark always reads). */
export async function HomeHeader() {
  const gt = await getGT();
  const links = [
    { label: gt("Features"), href: "#features" },
    { label: gt("Privacy"), href: "#privacy" },
    { label: gt("Apps"), href: "#apps" },
    { label: gt("Developers"), href: "/developers" },
    { label: gt("Compare"), href: "/compare" },
  ];

  return (
    <header className="hm-dark hm-nav fixed inset-x-0 top-0 z-50 pt-[var(--safe-area-top)]">
      <a href="#main" className="hm-skip">
        {gt("Skip to content")}
      </a>
      <div className="relative mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link href="/" aria-label={gt("SerikaCord home")} className="shrink-0">
          <Logo size="sm" />
        </Link>
        <nav aria-label={gt("Main")} className="hidden items-center gap-0.5 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hm-nav-link">
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
