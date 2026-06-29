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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#050608]/95 backdrop-blur-2xl border-t border-white/[0.06] md:hidden">
      <div className="flex items-center justify-around h-[56px] px-1" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.map((item) => {
          const isActive = getIsActive(item.href);
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              onClick={() => handleNavigation(item)}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full pt-1 gap-0.5 transition-all duration-200",
                "active:scale-[0.88] touch-manipulation select-none"
              )}
            >
              {/* Active pill indicator at top */}
              <div className={cn(
                "absolute top-0 inset-x-1/4 h-[2px] rounded-full transition-all duration-300",
                isActive ? "bg-[#8B5CF6] opacity-100" : "opacity-0"
              )} />

              <div className={cn(
                "relative flex items-center justify-center w-10 h-8 rounded-2xl transition-all duration-200",
                isActive ? "bg-[#8B5CF6]/15" : "bg-transparent"
              )}>
                <Icon className={cn(
                  "w-[22px] h-[22px] transition-all duration-200",
                  isActive ? "text-[#8B5CF6]" : "text-neutral-500"
                )} />
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-[#ED4245] text-white text-[9px] font-bold rounded-full border-[2px] border-[#050608]">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-semibold leading-none transition-colors duration-200",
                isActive ? "text-[#8B5CF6]" : "text-neutral-600"
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
