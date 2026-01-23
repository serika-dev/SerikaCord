"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Settings, 
  User, 
  Shield, 
  Bell, 
  Palette, 
  HelpCircle, 
  LogOut,
  ChevronRight,
  Sparkles,
  Moon,
  Volume2,
  Lock,
  Languages,
  Accessibility,
  Bug,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  const statusColors: Record<string, string> = {
    online: "#8B5CF6",
    idle: "#A78BFA",
    dnd: "#EF4444",
    offline: "#555555",
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const settingsSections: SettingsSection[] = [
    {
      title: "Account",
      items: [
        { icon: User, label: "My Account", href: "/channels/settings/account" },
        { icon: Shield, label: "Privacy & Safety", href: "/channels/settings/privacy" },
        { icon: Lock, label: "Authorized Apps", href: "/channels/settings/apps" },
      ],
    },
    {
      title: "App Settings",
      items: [
        { icon: Bell, label: "Notifications", href: "/channels/settings/notifications" },
        { icon: Palette, label: "Appearance", href: "/channels/settings/appearance" },
        { icon: Accessibility, label: "Accessibility", href: "/channels/settings/accessibility" },
        { icon: Volume2, label: "Voice & Video", href: "/channels/settings/voice" },
        { icon: Languages, label: "Language", href: "/channels/settings/language" },
      ],
    },
    {
      title: "Premium",
      items: [
        { 
          icon: Sparkles, 
          label: "SerikaCord Premium", 
          href: "/channels/settings/premium",
          badge: user?.isPremium ? "Active" : "Upgrade",
        },
      ],
    },
    {
      title: "Support",
      items: [
        { icon: HelpCircle, label: "Help & Support", href: "/channels/settings/help" },
        { icon: Bug, label: "Report a Bug", href: "/channels/settings/bug-report" },
        { icon: MessageSquare, label: "Give Feedback", href: "/channels/settings/feedback" },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="px-4 py-4 border-b border-[#1a1a1a]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">You</h1>
          <button 
            onClick={() => router.push("/channels/settings")}
            className="p-2 rounded-full hover:bg-[#1a1a1a] transition-colors"
          >
            <Settings className="w-5 h-5 text-[#888888]" />
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="pb-20">
          {/* Profile Card */}
          <div className="p-4">
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-[#8B5CF6] to-[#6366F1]">
              {/* Banner */}
              {user?.banner ? (
                <div 
                  className="h-24 bg-cover bg-center"
                  style={{ backgroundImage: `url(${user.banner})` }}
                />
              ) : (
                <div className="h-24" />
              )}

              {/* Profile Info */}
              <div className="relative bg-[#111111] px-4 pt-12 pb-4 -mt-8 rounded-t-2xl">
                {/* Avatar */}
                <div className="absolute -top-10 left-4">
                  <div className="relative">
                    <Avatar className="w-20 h-20 border-4 border-[#111111]">
                      <AvatarImage src={user?.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white text-2xl">
                        {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className="absolute bottom-1 right-1 w-5 h-5 rounded-full border-4 border-[#111111]"
                      style={{ backgroundColor: statusColors[user?.status || "online"] }}
                    />
                  </div>
                </div>

                {/* Edit Profile Button */}
                <div className="flex justify-end mb-4">
                  <button 
                    onClick={() => router.push("/channels/settings/profile")}
                    className="px-4 py-1.5 rounded-full bg-[#1a1a1a] text-white text-sm font-medium hover:bg-[#222222] transition-colors"
                  >
                    Edit Profile
                  </button>
                </div>

                {/* Name & Status */}
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-white">
                      {user?.displayName || user?.username}
                    </h2>
                    {user?.isPremium && (
                      <Sparkles className="w-5 h-5 text-[#F59E0B]" />
                    )}
                  </div>
                  <p className="text-[#888888]">@{user?.username}</p>
                  {user?.bio && (
                    <p className="text-[#cccccc] text-sm mt-2">{user.bio}</p>
                  )}
                </div>

                {/* Status Selector */}
                <button 
                  onClick={() => router.push("/channels/settings/status")}
                  className="w-full mt-4 flex items-center gap-3 p-3 rounded-xl bg-[#0a0a0a] hover:bg-[#1a1a1a] transition-colors"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: statusColors[user?.status || "online"] }}
                  />
                  <span className="text-white capitalize">{user?.status || "Online"}</span>
                  <ChevronRight className="w-4 h-4 text-[#666666] ml-auto" />
                </button>
              </div>
            </div>
          </div>

          {/* Settings Sections */}
          <div className="px-4 space-y-6">
            {settingsSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold uppercase text-[#666666] mb-2 px-2">
                  {section.title}
                </h3>
                <div className="rounded-xl bg-[#111111] overflow-hidden divide-y divide-[#1a1a1a]">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={() => item.onClick?.() || (item.href && router.push(item.href))}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 hover:bg-[#1a1a1a] transition-colors",
                          item.danger && "text-red-500"
                        )}
                      >
                        <Icon className={cn(
                          "w-5 h-5",
                          item.danger ? "text-red-500" : "text-[#888888]"
                        )} />
                        <span className={cn(
                          "flex-1 text-left",
                          item.danger ? "text-red-500" : "text-white"
                        )}>
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            item.badge === "Active" 
                              ? "bg-[#8B5CF6]/20 text-[#8B5CF6]" 
                              : "bg-[#F59E0B]/20 text-[#F59E0B]"
                          )}>
                            {item.badge}
                          </span>
                        )}
                        <ChevronRight className={cn(
                          "w-4 h-4",
                          item.danger ? "text-red-500/50" : "text-[#666666]"
                        )} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Logout Button */}
            <div className="rounded-xl bg-[#111111] overflow-hidden">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 p-4 hover:bg-[#1a1a1a] transition-colors text-red-500"
              >
                <LogOut className="w-5 h-5" />
                <span className="flex-1 text-left">Log Out</span>
                <ChevronRight className="w-4 h-4 text-red-500/50" />
              </button>
            </div>

            {/* App Info */}
            <div className="text-center py-4">
              <p className="text-xs text-[#666666]">SerikaCord v0.0.1</p>
              <p className="text-xs text-[#666666] mt-1">Made with 💜 by Serika Team</p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
