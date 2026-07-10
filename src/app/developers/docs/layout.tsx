"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { docNav } from "@/lib/constants/docs-nav";
import { Search, Menu, X, ExternalLink } from "lucide-react";
import { useGT } from "gt-next";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentSlug = useMemo(() => {
    const parts = pathname?.replace("/developers/docs/", "").split("/") || [];
    return parts.join("/");
  }, [pathname]);

  const filteredNav = useMemo(() => {
    if (!search.trim()) return docNav;
    const q = search.toLowerCase();
    return docNav
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          item.label.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [search]);

  return (
    <div className="flex-1 flex relative">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed bottom-4 right-4 z-50 size-12 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center shadow-lg"
      >
        {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "w-64 border-r border-white/[0.06] bg-[#0d0d0d] flex flex-col shrink-0",
          "fixed md:sticky top-0 left-0 z-40 transition-transform md:translate-x-0",
          "h-screen md:h-[calc(100vh-3.5rem)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Search */}
        <div className="p-3 border-b border-white/[0.06] shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#555]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search docs...")}
              className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2 docs-sidebar-scroll">
          {filteredNav.map((section) => (
            <div key={section.title} className="mb-4">
              <h3 className="text-[11px] font-bold text-[#555] uppercase tracking-wider px-3 mb-1.5">
                {section.title}
              </h3>
              {section.items.map((item) => {
                const href = `/developers/docs/${item.slug}`;
                const active = currentSlug === item.slug;
                return (
                  <Link
                    key={item.slug}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] transition-colors mb-0.5",
                      active
                        ? "bg-[#8B5CF6]/12 text-[#a78bfa] font-medium"
                        : "text-[#949ba4] hover:text-white hover:bg-white/[0.04]"
                    )}
                  >
                    {item.label}
                    {item.badge && (
                      <span className="ml-auto text-[10px] bg-[#5865F2] text-white px-1.5 py-0.5 rounded font-medium">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-white/[0.06] shrink-0">
          <Link
            href="/developers/applications"
            className="text-xs text-[#666] hover:text-white transition-colors flex items-center gap-1.5"
          >
            <ExternalLink className="size-3" /> Go to Applications
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-12">{children}</div>
      </div>
    </div>
  );
}
