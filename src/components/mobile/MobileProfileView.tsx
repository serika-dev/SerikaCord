"use client";

import Link from "next/link";
import { useState } from "react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { CustomStatusLine } from "@/components/user/CustomStatus";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { useBadges } from "@/hooks/useBadges";
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
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { VERSION_LABEL } from "@/lib/version";
import { KeyRound } from "lucide-react";
import { useE2ee } from "@/hooks/useE2ee";
import { statusLabelInvisible } from "@/lib/statusLabels";
import { StatusBadge, StatusIcon } from "@/components/user/StatusBadge";

const MobileStatusSheet = dynamic(() => import("./MobileStatusSheet").then((m) => m.MobileStatusSheet), { ssr: false });
const CustomStatusDialog = dynamic(() => import("@/components/user/CustomStatusDialog").then((m) => m.CustomStatusDialog), { ssr: false });

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
  const [showStatusSheet, setShowStatusSheet] = useState(false);
  const [showCustomStatus, setShowCustomStatus] = useState(false);

  const status = user?.status ?? "offline";
  const displayName = user?.displayName || user?.username || "";
  const { resolve: resolveBadges } = useBadges();
  const badges = resolveBadges(user?.badges);
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

  // Settings → Encryption once E2EE is on (server flag) or this device has keys.
  const e2ee = useE2ee();
  const showEncryption = e2ee.enabled || e2ee.phase === "ready" || e2ee.phase === "needs-restore";

  const settingsSections: SettingsSection[] = [
    {
      title: gt("Account"),
      items: [
        { icon: User, label: gt("My Account"), href: "/channels/settings/account" },
        { icon: LinkIcon, label: gt("Connections"), href: "/channels/settings/connections" },
        { icon: Shield, label: gt("Privacy & Safety"), href: "/channels/settings/privacy" },
        { icon: ShieldCheck, label: gt("Account Standing"), href: "/channels/settings/account-standing" },
        ...(showEncryption ? [{ icon: KeyRound, label: gt("Encryption"), href: "/channels/settings/encryption" }] : []),
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
        { icon: MonitorSmartphone, label: gt("Streamer Mode"), href: "/channels/settings/streamer-mode" },
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
        { icon: MessageSquare, label: gt("Feedback & Bug Reports"), href: "/channels/settings/bug-report" },
      ],
    },
  ];

  return (
    <div className="relative flex flex-col w-full h-full min-w-0 overflow-x-hidden bg-[var(--bg-app)]" style={getProfileBackgroundStyle(customization)}>
      {/* Themed wash so the whole page picks up the profile colours */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-app)]/70 to-[var(--bg-app)]" />

      <ScrollArea className="profile-scroll-area relative min-h-0 flex-1 w-full overflow-x-hidden">
        <div className="w-full max-w-full overflow-x-hidden" style={{ paddingBottom: "calc(var(--mobile-content-pb) + 1rem)" }}>
          {/* ── Fullscreen profile hero ── */}
          <div className="relative">
            {/* Banner */}
            <div className="relative h-52">
              {user?.banner ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${user.banner})` }} />
              ) : hasBannerStyle ? (
                <div className="absolute inset-0" style={getProfileBannerStyle(customization)} />
              ) : (
                <div className="absolute inset-0 bg-[var(--app-accent)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-app)] via-[var(--bg-app)]/20 to-transparent" />
            </div>

            {/* Identity block */}
            <div className="relative px-5 sm:px-6 -mt-14">
              <div className="relative w-fit">
                <Avatar className="w-28 h-28 border-4 border-[var(--bg-app)] shadow-2xl">
                  <AvatarImage src={cdnImage(user?.avatar)} alt={displayName} />
                  <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-4xl font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <StatusBadge
                  status={status === "offline" ? "invisible" : status}
                  size={16}
                  ring={4}
                  ringColor="var(--bg-app)"
                  className="absolute bottom-1.5 right-1.5"
                />
              </div>

              <div className="mt-3 flex min-w-0 items-start gap-2">
                <h1
                  className={cn("min-w-0 [overflow-wrap:anywhere] text-3xl font-extrabold text-[var(--text-primary)] leading-tight", getDisplayNameStyleClasses(customization?.displayNameStyle))}
                  style={getDisplayNameStyleInline(customization?.displayNameStyle)}
                >
                  {displayName}
                </h1>
                {user?.isPremium && <Crown className="mt-1.5 w-6 h-6 text-[var(--app-accent)] shrink-0" />}
              </div>
              <p className="[overflow-wrap:anywhere] text-[var(--text-muted)] font-medium mt-0.5">@{user?.username}</p>
              {user?.pronouns && (
                <p className="[overflow-wrap:anywhere] text-sm text-[var(--text-muted)] mt-0.5">{user.pronouns}</p>
              )}

              {user?.customStatus ? (
                <CustomStatusLine
                  text={user.customStatus}
                  customization={customization}
                  className="mt-2 max-w-full text-sm text-[var(--text-secondary)]"
                />
              ) : null}

              {/* Online status pill (tap to change, like Discord's You tab) */}
              <button
                type="button"
                onClick={() => setShowStatusSheet(true)}
                aria-haspopup="dialog"
                aria-expanded={showStatusSheet}
                className="mt-3 flex w-fit min-h-11 max-w-full touch-manipulation items-center gap-2 px-3 py-2 rounded-full bg-[var(--bg-card)]/80 backdrop-blur-sm border border-[var(--border-subtle)] transition-transform duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
              >
                <StatusIcon status={status === "offline" ? "invisible" : status} size={12} />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{statusLabelInvisible(status, gt)}</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
              </button>

              {/* Badges */}
              {badges.length > 0 && (
                <div className="mt-4">
                  <BadgeList badges={badges.map((b) => b.id) as UIBadgeId[]} size="md" maxDisplay={badges.length} expandable={false} />
                </div>
              )}
            </div>
          </div>

          {/* Customize + status quick actions */}
          <div className="px-5 sm:px-6 mt-6 mb-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => router.push("/channels/settings/profiles")}
              className="flex min-h-12 min-w-0 touch-manipulation items-center justify-center gap-2 px-3 py-3 rounded-2xl bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold shadow-lg shadow-[var(--app-accent)]/20 active:scale-[0.98] transition-transform duration-200 ease-out motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
            >
              <Palette className="w-4 h-4 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{gt("Customize Profile")}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowStatusSheet(true)}
              aria-haspopup="dialog"
              aria-expanded={showStatusSheet}
              className="flex min-h-12 min-w-0 touch-manipulation items-center justify-center gap-2 px-3 py-3 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm font-semibold active:scale-[0.98] transition-transform duration-200 ease-out motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
            >
              <User className="w-4 h-4 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{gt("Set Status")}</span>
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
                          "w-full flex min-w-0 touch-manipulation items-center gap-3 p-3.5 hover:bg-[var(--bg-hover)] transition-colors active:bg-[var(--bg-active)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-accent)]",
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
                          "min-w-0 flex-1 [overflow-wrap:anywhere] text-left font-medium",
                          item.danger ? "text-red-500" : "text-[var(--text-primary)]"
                        )}>
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--app-accent)]/20 text-[var(--app-accent)]">
                            {item.badge}
                          </span>
                        )}
                        <ChevronRight className={cn(
                          "w-4 h-4 shrink-0",
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
              <p className="text-xs font-medium text-[var(--text-muted)]">SerikaCord {VERSION_LABEL}</p>
              <Link
                href="/changelog"
                className="mt-1 inline-block text-xs text-[var(--app-accent)] hover:underline underline-offset-2"
              >
                {gt("What's new")}
              </Link>
            </div>
          </div>
        </div>
      </ScrollArea>

      <MountWhenOpened open={showStatusSheet}>
        {showStatusSheet && (
          <MobileStatusSheet onClose={() => setShowStatusSheet(false)} onCustomStatus={() => setShowCustomStatus(true)} />
        )}
      </MountWhenOpened>
      <MountWhenOpened open={showCustomStatus}>
        <CustomStatusDialog open={showCustomStatus} onOpenChange={setShowCustomStatus} />
      </MountWhenOpened>
    </div>
  );
}
