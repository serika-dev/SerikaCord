"use client";

import { usePathname, useRouter } from "next/navigation";
import { Home, MessageSquare, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: number;
}

interface BottomNavigationProps {
  activeTab?: string;
  notificationCount?: number;
  messageCount?: number;
}

export function BottomNavigation({
  notificationCount = 0,
  messageCount = 0
}: BottomNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems: NavItem[] = [
    {
      icon: Home,
      label: "Servers",
      href: "/channels/me",
    },
    {
      icon: MessageSquare,
      label: "Messages",
      href: "/channels/messages",
      badge: messageCount,
    },
    {
      icon: Bell,
      label: "Notifications",
      href: "/channels/notifications",
      badge: notificationCount,
    },
    {
      icon: User,
      label: "You",
      href: "/channels/profile",
    },
  ];

  const getIsActive = (href: string) => {
    if (href === "/channels/me") {
      return pathname === "/channels/me" || (pathname?.startsWith("/channels/") && !pathname.includes("messages") && !pathname.includes("notifications") && !pathname.includes("profile") && !pathname.includes("settings"));
    }
    if (href === "/channels/profile") {
      return pathname === "/channels/profile" || pathname?.includes("/settings");
    }
    return pathname === href;
  };

  return (
    <nav className="mobile-bottom-nav bg-[#0a0a0a]/95 backdrop-blur-xl border-t border-white/[0.08] md:hidden">
      <div className="flex items-stretch justify-around h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = getIsActive(item.href);
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 gap-0.5",
                "transition-all duration-150 active:scale-[0.92] active:opacity-80",
                "min-w-[64px] touch-manipulation"
              )}
            >
              {/* Active indicator pill */}
              {isActive && (
                <div className="absolute top-2 w-8 h-1 rounded-full bg-[#8B5CF6]" />
              )}

              <div className={cn(
                "relative flex items-center justify-center w-10 h-10 rounded-2xl transition-all duration-200",
                isActive ? "bg-[#8B5CF6]/15" : "bg-transparent"
              )}>
                <Icon
                  className={cn(
                    "w-6 h-6 transition-colors duration-200",
                    isActive ? "text-[#8B5CF6]" : "text-neutral-500"
                  )}
                />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-[10px] font-bold rounded-full ring-2 ring-[#0a0a0a]">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[11px] font-medium transition-colors duration-200",
                isActive ? "text-[#8B5CF6]" : "text-neutral-500"
              )}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
