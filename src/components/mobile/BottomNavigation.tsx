"use client";

import { usePathname, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Home, MessageSquare, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: number;
  clearServer?: boolean;
  /** Renders the signed-in user's avatar instead of the icon */
  isProfile?: boolean;
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
  const { user } = useAuth();
  const gt = useGT();

  // Hide inside an open conversation (channel chat or DM) so the composer
  // gets the full viewport and the keyboard doesn't fight the nav.
  const isInConversation =
    /^\/dm\/[^/]+/.test(pathname || "") || /^\/channels\/[^/]+\/[^/]+$/.test(pathname || "");
  if (isInConversation) return null;

  const navItems: NavItem[] = [
    {
      icon: Home,
      label: gt("Servers"),
      href: "/channels/me",
      clearServer: true,
    },
    {
      icon: MessageSquare,
      label: gt("Messages"),
      href: "/channels/messages",
      badge: messageCount,
      clearServer: true,
    },
    {
      icon: Bell,
      label: gt("Notifications"),
      href: "/channels/notifications",
      badge: notificationCount,
      clearServer: true,
    },
    {
      icon: User,
      label: gt("You"),
      href: "/channels/profile",
      clearServer: true,
      isProfile: true,
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-app)]/95 backdrop-blur-2xl border-t border-[var(--border-subtle)] md:hidden">
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
                isActive ? "bg-[var(--app-accent)] opacity-100" : "opacity-0"
              )} />

              <div className={cn(
                "relative flex items-center justify-center w-10 h-8 rounded-2xl transition-all duration-200",
                isActive ? "bg-[var(--app-accent)]/15" : "bg-transparent"
              )}>
                {item.isProfile && user ? (
                  <Avatar
                    className={cn(
                      "w-[24px] h-[24px] ring-2 transition-all duration-200",
                      isActive ? "ring-[var(--app-accent)]" : "ring-transparent"
                    )}
                  >
                    <AvatarImage src={user.avatar || undefined} alt="" />
                    <AvatarFallback className="bg-[var(--app-accent)] text-white text-[10px]">
                      {(user.displayName || user.username || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Icon className={cn(
                    "w-[22px] h-[22px] transition-all duration-200",
                    isActive ? "text-[var(--app-accent)]" : "text-neutral-500"
                  )} />
                )}
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-[#ED4245] text-white text-[9px] font-bold rounded-full border-[2px] border-[var(--bg-app)]">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-semibold leading-none transition-colors duration-200",
                isActive ? "text-[var(--app-accent)]" : "text-neutral-600"
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
