"use client";

import { usePathname, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useUnreadSelector } from "@/contexts/UnreadContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Home, MessageSquare, Bell, User } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
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
  notificationCount,
  messageCount
}: BottomNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { setCurrentServer, setCurrentChannel } = useServer();
  // Just the two totals: not a re-render for every unread change.
  const totalDmUnreadCount = useUnreadSelector((u) => u.totalDmUnreadCount);
  const totalMentionCount = useUnreadSelector((u) => u.totalMentionCount);
  const { user } = useAuth();
  const gt = useGT();

  // Live badge counts come from the app-wide unread engine. Explicit props (if
  // ever passed) win, so callers can still override.
  const messages = messageCount ?? totalDmUnreadCount;
  const notifications = notificationCount ?? totalMentionCount;

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
      badge: messages,
      clearServer: true,
    },
    {
      icon: Bell,
      label: gt("Notifications"),
      href: "/channels/notifications",
      badge: notifications,
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
    // Re-tapping the tab you're on doesn't push a duplicate history entry.
    if (pathname === item.href) return;
    router.push(item.href);
  };

  return (
    <nav
      aria-label={gt("Main")}
      className="mobile-bottom-nav theme-solid fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-app)] border-t border-[var(--border-subtle)] pl-safe pr-safe desk:hidden"
      style={{ paddingBottom: "var(--safe-area-bottom)" }}
    >
      <div className="flex items-stretch justify-around h-[56px] px-1">
        {navItems.map((item) => {
          const isActive = getIsActive(item.href);
          const Icon = item.icon;

          return (
            <button
              key={item.href}
              type="button"
              onClick={() => handleNavigation(item)}
              onTouchStart={() => router.prefetch(item.href)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 touch-manipulation select-none active:opacity-70"
            >
              <span className={cn(
                "relative flex items-center justify-center w-12 h-7 rounded-full transition-colors duration-150",
                isActive ? "bg-[var(--app-accent)]/15" : "bg-transparent"
              )}>
                {item.isProfile && user ? (
                  <Avatar
                    className={cn(
                      "w-[24px] h-[24px] ring-2 transition-[box-shadow] duration-150",
                      isActive ? "ring-[var(--app-accent)]" : "ring-transparent"
                    )}
                  >
                    <AvatarImage src={cdnImage(user.avatar || undefined)} alt="" />
                    <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-[10px]">
                      {(user.displayName || user.username || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Icon className={cn(
                    "w-[22px] h-[22px] transition-colors duration-150",
                    isActive ? "text-[var(--app-accent)]" : "text-[var(--text-muted)]"
                  )} />
                )}
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -top-1 right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-[var(--bg-app)]">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              <span className={cn(
                "text-[10px] font-semibold leading-none transition-colors duration-150",
                isActive ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
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
