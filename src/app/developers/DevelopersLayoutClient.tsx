"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoInline } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { Home, Book, Boxes, Users, ExternalLink } from "lucide-react";
import { useGT } from "gt-next";

export default function DevelopersLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const gt = useGT();
  const pathname = usePathname();
  const isDocs = pathname?.startsWith("/developers/docs");

  const navItems = [
    { label: gt("Home"), href: "/developers/home", icon: Home },
    { label: gt("Applications"), href: "/developers/applications", icon: Boxes },
    { label: gt("Teams"), href: "/developers/teams", icon: Users },
    { label: gt("Documentation"), href: "/developers/docs/intro", icon: Book },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
        {/* Top Navigation */}
        <header className="h-14 border-b border-white/[0.06] bg-[#0a0a0a] sticky top-0 z-50 flex items-center px-4 gap-6 backdrop-blur-sm">
          <Link href="/developers/home" className="flex items-center gap-2 shrink-0">
            <LogoInline size={28} />
            <span className="font-bold text-sm hidden sm:inline">
              {gt("SerikaCord Developers")}
            </span>
          </Link>

          <nav className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const active =
                item.href === "/developers/docs/intro"
                  ? isDocs
                  : item.href === "/developers/home"
                    ? pathname === "/developers/home" || pathname === "/developers"
                    : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-[#949ba4] hover:text-white hover:bg-white/[0.04]"
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/developers/docs/intro"
              className="text-xs text-[#777] hover:text-white transition-colors hidden md:flex items-center gap-1"
            >
              {gt("API Docs")} <ExternalLink className="size-3" />
            </Link>
            <Link
              href="/channels/me"
              className="text-xs text-[#777] hover:text-white transition-colors"
            >
              {gt("Open SerikaCord")}
            </Link>
          </div>
        </header>

        <div className="flex-1 flex">{children}</div>
      </div>
  );
}
