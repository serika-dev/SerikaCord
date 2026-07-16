"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { getBadgesByPriority } from "@/lib/constants/badges";
import {
  getDisplayNameStyleClasses,
  getDisplayNameStyleInline,
  getProfileBackgroundStyle,
  getProfileBannerStyle,
} from "@/lib/userDisplayNameStyle";
import {
  User,
  Shield,
  Bell,
  Palette,
  HelpCircle,
  LogOut,
  ChevronRight,
  Sparkles,
  Volume2,
  Lock,
  Languages,
  Accessibility,
  MessageSquare,
  Crown,
  Link as LinkIcon,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { statusLabelInvisible } from "@/lib/statusLabels";

const STATUS_COLORS: Record<string, string> = {
  online: "#23A559",
  idle: "#F0B232",
  dnd: "#EF4444",
  offline: "#80848E",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Invisible",
};

// STATUS_LABELS is static; we'll use gt() at render time instead

interface SettingsItem {
  icon: React.ElementType;
  label: string;
  href?: string;
  onClick?: () => void;
  description?: string;
  badge?: string;
  danger?: boolean;
}

interface SettingsSection {
  title: string;
  items: SettingsItem[];
}

export function MobileProfileView() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const gt = useGT();

  const status = user?.status ?? "offline";
  const displayName = user?.displayName || user?.username || "";
  const badges = user?.badges?.length ? getBadgesByPriority(user.badges as string[]) : [];
  const customization = user?.customization;
  const hasBannerStyle =
    Boolean(user?.banner) ||
    (Array.isArray(customization?.profileGradient) && customization!.profileGradient!.length >= 2) ||
    Boolean(customization?.profileColor);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  const settingsSections: SettingsSection[] = [
    {
      title: gt("Account"),
      items: [
        { icon: User, label: gt("My Account"), href: "/channels/settings/account" },
        { icon: LinkIcon, label: gt("Connections"), href: "/channels/settings/connections" },
        { icon: Shield, label: gt("Privacy & Safety"), href: "/channels/settings/privacy" },
        { icon: Lock, label: gt("Authorized Apps"), href: "/channels/settings/apps" },
      ],
    },
    {
      title: gt("App Settings"),
      items: [
        { icon: Bell, label: gt("Notifications"), href: "/channels/settings/notifications" },
        { icon: Palette, label: gt("Appearance"), href: "/channels/settings/appearance" },
        { icon: Accessibility, label: gt("Accessibility"), href: "/channels/settings/accessibility" },
        { icon: Volume2, label: gt("Voice & Video"), href: "/channels/settings/voice" },
        { icon: Languages, label: gt("Language"), href: "/channels/settings/language" },
      ],
    },
    {
      title: gt("Premium"),
      items: [
        {
          icon: Sparkles,
          label: gt("SerikaCord Premium"),
          href: "/channels/settings/premium",
          badge: user?.isPremium ? gt("Active") : gt("Upgrade"),
        },
      ],
    },
    {
      title: gt("Support"),
      items: [
        { icon: HelpCircle, label: gt("Help & Support"), onClick: () => openExternal("https://serika.cc/serika") },
        { icon: MessageSquare, label: gt("Feedback & Bug Reports"), onClick: () => openExternal("https://serika.cc/serika") },
      ],
    },
  ];

  return (
    <div className="relative flex flex-col w-full h-full min-w-0 overflow-x-hidden bg-[var(--bg-app)]" style={getProfileBackgroundStyle(customization)}>
      {/* Themed wash so the whole page picks up the profile colours */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-app)]/70 to-[var(--bg-app)]" />

      <ScrollArea className="profile-scroll-area relative flex-1 w-full overflow-x-hidden">
        <div className="w-full max-w-full pb-24 overflow-x-hidden">
          {/* ── Fullscreen profile hero ── */}
          <div className="relative">
            {/* Banner */}
            <div className="relative h-52">
              {user?.banner ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${user.banner})` }} />
              ) : hasBannerStyle ? (
                <div className="absolute inset-0" style={getProfileBannerStyle(customization)} />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#8B5CF6] via-[#7C3AED] to-[#4F46E5]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-app)] via-[var(--bg-app)]/20 to-transparent" />
            </div>

            {/* Identity block */}
            <div className="relative px-6 -mt-14">
              <div className="relative inline-block">
                <Avatar className="w-28 h-28 border-4 border-[var(--bg-app)] shadow-2xl">
                  <AvatarImage src={cdnImage(user?.avatar)} />
                  <AvatarFallback className="bg-[#8B5CF6] text-white text-4xl font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full border-4 border-[var(--bg-app)]"
                  style={{ backgroundColor: STATUS_COLORS[status] }}
                  title={statusLabelInvisible(status, gt)}
                />
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <h1
                  className={cn("text-3xl font-extrabold text-[var(--text-primary)] leading-tight", getDisplayNameStyleClasses(customization?.displayNameStyle))}
                  style={getDisplayNameStyleInline(customization?.displayNameStyle)}
                >
                  {displayName}
                </h1>
                {user?.isPremium && <Crown className="w-6 h-6 text-[#F59E0B] shrink-0" />}
              </div>
              <p className="text-[var(--text-muted)] font-medium mt-0.5">@{user?.username}</p>
              {user?.pronouns && (
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{user.pronouns}</p>
              )}

              {/* Online status pill */}
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-card)]/80 backdrop-blur-sm border border-[var(--border-subtle)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{statusLabelInvisible(status, gt)}</span>
              </div>

              {/* Badges */}
              {badges.length > 0 && (
                <div className="mt-4">
                  <BadgeList badges={badges.map((b) => b.id) as UIBadgeId[]} size="md" maxDisplay={badges.length} expandable={false} />
                </div>
              )}
            </div>
          </div>

          {/* Customize + status quick actions */}
          <div className="px-6 mt-6 mb-8 grid grid-cols-2 gap-3">
            <button
              onClick={() => router.push("/channels/settings/profiles")}
              className="flex items-center justify-center gap-2 py-2.5 sm:py-3.5 rounded-2xl bg-[var(--app-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--app-accent)]/20 active:scale-[0.98] transition-transform"
            >
              <Palette className="w-4 h-4" />
              {gt("Customize Profile")}
            </button>
            <button
              onClick={() => router.push("/channels/settings/status")}
              className="flex items-center justify-center gap-2 py-2.5 sm:py-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              <User className="w-4 h-4" />
              {gt("Set Status")}
            </button>
          </div>

          {/* Settings Sections */}
          <div className="px-5 space-y-8">
            {settingsSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] mb-3 px-2 tracking-wider">
                  {section.title}
                </h3>
                <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)]">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={() => item.onClick?.() || (item.href && router.push(item.href))}
                        className={cn(
                          "w-full flex items-center gap-3.5 p-3.5 hover:bg-[var(--bg-hover)] transition-all active:bg-[var(--bg-active)]",
                          item.danger && "text-red-500"
                        )}
                      >
                        <span className={cn(
                          "flex items-center justify-center w-9 h-9 rounded-xl shrink-0",
                          item.danger ? "bg-red-500/10 text-red-500" : "bg-[var(--bg-app)] text-[var(--text-secondary)]"
                        )}>
                          <Icon className="w-[18px] h-[18px]" />
                        </span>
                        <span className={cn(
                          "flex-1 text-left font-medium",
                          item.danger ? "text-red-500" : "text-[var(--text-primary)]"
                        )}>
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-bold",
                            item.badge === gt("Active")
                              ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]"
                              : "bg-[#F59E0B]/20 text-[#F59E0B]"
                          )}>
                            {item.badge}
                          </span>
                        )}
                        <ChevronRight className={cn(
                          "w-4 h-4",
                          item.danger ? "text-red-500/50" : "text-[var(--text-muted)]"
                        )} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Logout Button */}
            <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden border border-[var(--border-subtle)]">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3.5 p-3.5 hover:bg-[var(--bg-hover)] transition-colors text-red-500 active:bg-[var(--bg-active)]"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-500/10 text-red-500 shrink-0">
                  <LogOut className="w-[18px] h-[18px]" />
                </span>
                <span className="flex-1 text-left font-medium">{gt("Log Out")}</span>
                <ChevronRight className="w-4 h-4 text-red-500/50" />
              </button>
            </div>

            {/* App Info */}
            <div className="text-center py-6">
              <p className="text-xs font-medium text-[var(--text-muted)]">SerikaCord v1.0.5 (Beta)</p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
