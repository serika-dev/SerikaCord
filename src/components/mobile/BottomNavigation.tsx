"use client";

import { usePathname, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { Home, MessageSquare, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: number;
  clearServer?: boolean;
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
  const { setCurrentServer, setCurrentChannel } = useServer();

  const navItems: NavItem[] = [
    {
      icon: Home,
      label: "Servers",
      href: "/channels/me",
      clearServer: true,
    },
    {
      icon: MessageSquare,
      label: "Messages",
      href: "/channels/messages",
      badge: messageCount,
      clearServer: true,
    },
    {
      icon: Bell,
      label: "Notifications",
      href: "/channels/notifications",
      badge: notificationCount,
      clearServer: true,
    },
    {
      icon: User,
      label: "You",
      href: "/channels/profile",
      clearServer: true,
    },
  ];

  const getIsActive = (href: string) => {
    if (href === "/channels/me") {
      // Only active if at /channels/me or in a server (not messages/notifications/profile)
      return pathname === "/channels/me" || (pathname?.startsWith("/channels/") && 
        !pathname.includes("messages") && 
        !pathname.includes("notifications") && 
        !pathname.includes("profile") &&
        !pathname.startsWith("/dm/"));
    }
    if (href === "/channels/messages") {
      return pathname === "/channels/messages" || pathname?.startsWith("/dm/");
    }
    return pathname === href;
  };

  const handleNavigation = (item: NavItem) => {
    // Clear server context for DM/profile views
    if (item.clearServer && (item.href === "/channels/messages" || item.href === "/channels/notifications" || item.href === "/channels/profile")) {
      setCurrentServer(null);
      setCurrentChannel(null);
    }
    router.push(item.href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-t border-white/10 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-[60px] px-2">
        {navItems.map((item) => {
          const isActive = getIsActive(item.href);
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              onClick={() => handleNavigation(item)}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all duration-150",
                "active:scale-90 touch-manipulation",
                isActive ? "text-white" : "text-neutral-500"
              )}
            >
              <div className={cn(
                "relative p-2 rounded-2xl transition-all duration-150",
                isActive ? "bg-[#8B5CF6]/20 scale-105" : "scale-100"
              )}>
                <Icon className={cn(
                  "w-6 h-6 transition-all duration-150",
                  isActive ? "text-[#8B5CF6]" : "text-neutral-500"
                )} />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-[10px] font-bold rounded-full border-2 border-black shadow-lg">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-semibold transition-colors",
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
